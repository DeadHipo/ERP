import { ValidationError } from '../shared/errors';
import { type OwnersService } from '../modules/owners';
import { type SplitsService } from '../modules/splits';
import { type LabelsService } from '../modules/labels';
import type { SourcesService } from '../modules/sources';
import { type SettlementsService } from '../modules/settlements';
import { type PublishingService } from '../modules/publishing';
import { type AuditService } from '../modules/audit';
import { type AdsService } from '../modules/ads';
import { artistReach, ownerReach } from './owner-scope';
import { scoped } from './scope';
import { calculate, type PeriodFilter } from './calculation';
import { artistBalance, ownerBalance } from './balance';
import { payoutGate } from './payout-gate';
import { floorToCents } from '../shared/money';
import { stubPaymentService, type PaymentService } from './payment-service';
import type { Db } from '../shared/pg-db';
import { timed, timedSync } from '../shared/timing';

export interface FacadeConfig {
  /**
   * The PostgreSQL database of the modules owners, splits, settlements and publishing (one schema each, D-121).
   * The caller owns the pool and closes it.
   */
  db: Db;
  /** Directory of the kept original files (files/publishing/...). */
  dataDir: string;
  /** The sources module: Believe files in PostgreSQL + ClickHouse. The caller owns the connections and closes them. */
  sources: SourcesService;
  /** Payout threshold: not part of the calculation, below it the payout button is unavailable. */
  payoutThresholdCents: number;
  paymentService?: PaymentService;
}

export interface ShareSpec {
  artistId?: string;
  /** An artist not yet in module 1: created without owner ("waiting for documents"). */
  newArtistPseudonym?: string;
  percent: string;
  /** The row's own document (overrides the split's document for this row, D-126). */
  documentId?: string | null;
}

/**
 * Document kinds that can confirm a split row or a participation: an appendix, the contract itself, a buyout
 * document, an assumption (a council decision, never approved) or another document.
 */
const SPLIT_DOCUMENT_KINDS = ['appendix', 'contract', 'buyout', 'other', 'assumption'];

/** What every facade section works with: the modules and the checks shared between sections. */
export function createFacadeContext(
  config: FacadeConfig,
  m: {
    db: Db;
    owners: OwnersService;
    splits: SplitsService;
    labels: LabelsService;
    sources: SourcesService;
    settlements: SettlementsService;
    publishing: PublishingService;
    audit: AuditService;
    ads: AdsService;
  },
) {
  const { db, owners, splits, labels, sources, settlements, publishing, audit, ads } = m;
  const payments = config.paymentService ?? stubPaymentService;
  const modules = { db, owners, splits, labels, sources, publishing, ads };

  /**
   * Payouts of an owner that block new money going out: no payment proof, a deferred one, or a proof that is not
   * approved (counted only once approved). Migrated payouts never block.
   */
  async function blockingPayoutsOf(ownerId: string) {
    const pending = (await settlements.listOperations({ ownerId })).filter(
      (o) => o.direction === 'out' && o.active && !o.migration,
    );
    const statuses = await owners.documentStatuses(
      pending.map((o) => o.paymentProofId).filter((x): x is string => !!x),
    );
    return pending.filter(
      (o) => !o.paymentProofId || o.deferred || statuses.get(o.paymentProofId) !== 'approved',
    );
  }

  async function opDocIds() {
    return (await settlements.allOperations()).flatMap((o) =>
      [o.documentId, o.paymentProofId].filter((x): x is string => !!x),
    );
  }

  async function checkSplitDocument(documentId: string | null | undefined) {
    if (!documentId) return;
    const d = await owners.getDocument(documentId);
    if (!SPLIT_DOCUMENT_KINDS.includes(d.kind))
      throw new ValidationError(
        `A split or participation is confirmed by an appendix, contract, buyout, assumption or other document, not "${d.kind}"`,
      );
  }

  /** Validates every share before new artists are created, so a rejected split leaves nothing behind in module 1. */
  async function resolveShares(shares: ShareSpec[]) {
    // A merged artist id stands for the surviving artist (D-095): one person can appear only once in a split.
    const idx = await owners.artistIndex();
    const canon = (id: string) => idx.get(id)?.id ?? id;
    const ids = shares
      .map((s) => s.artistId)
      .filter((x): x is string => !!x)
      .map(canon);
    if (new Set(ids).size !== ids.length)
      throw new ValidationError('The same artist appears twice in one split');
    const pseudonyms = shares
      .map((s) => s.newArtistPseudonym?.trim().toLowerCase())
      .filter((p): p is string => !!p);
    if (new Set(pseudonyms).size !== pseudonyms.length)
      throw new ValidationError('The same new artist appears twice in one split');
    for (const s of shares) {
      await checkSplitDocument(s.documentId);
      if (s.artistId) await owners.getArtist(s.artistId);
      else if (!s.newArtistPseudonym)
        throw new ValidationError('Each share needs an artistId or a newArtistPseudonym');
    }
    return async () => {
      const out: { artistId: string; percent: string; documentId: string | null }[] = [];
      for (const s of shares) {
        out.push(
          s.artistId
            ? { artistId: canon(s.artistId), percent: s.percent, documentId: s.documentId ?? null }
            : {
                artistId: (
                  await owners.createArtist({
                    pseudonym: s.newArtistPseudonym as string,
                    ownerId: null,
                    origin: 'split',
                  })
                ).id,
                percent: s.percent,
                documentId: s.documentId ?? null,
              },
        );
      }
      return out;
    };
  }

  /**
   * The owner balance and the Believe files it was calculated from (a payout snapshot records them). The calculation
   * reads only the units of the owner's reach (`ownerReach`, D-163, D-164): the same balance, since the balance reads
   * only the units where the owner has an allocation and the reach is a superset of them (checked for every real
   * owner). The payout snapshot is this calculation; the file list it records comes from the registry and is complete.
   */
  async function balanceWithFiles(ownerId: string, f: PeriodFilter = {}) {
    const id = await timed('owners.resolveOwnerId + getOwner', async () => {
      const id = await owners.resolveOwnerId(ownerId);
      await owners.getOwner(id);
      return id;
    });
    const docIds = await timed(
      'settlements.allOperations (document ids)',
      opDocIds,
      (r) => `${r.length} ids`,
    );
    const reach = await timed('ownerReach', () => ownerReach(modules, id), (r) => `${r.isrcs.length} ISRCs`);
    const calc = await timed('calculate', () => calculate(scoped(modules, { isrcs: reach.isrcs }), docIds));
    // the owner and its operations in the same snapshot (inside a payout: the same write transaction)
    const { owner, operations } = await timed(
      'pg snapshot: owner + operations',
      () =>
        db.snapshot(async () => ({
          owner: await owners.getOwner(id),
          operations: await settlements.listOperations({ ownerId: id }),
        })),
      (r) => `${r.operations.length} operations`,
    );
    const balance = timedSync('ownerBalance (JS)', () => ownerBalance(calc, id, operations, f));
    return { files: calc.believeFiles, balance: { owner, ...balance, payout: gateOf(balance) } };
  }

  /**
   * The money of one pseudonym from the units of its reach (`artistReach`, D-165): the artist row is the one
   * `ownerBalance()` builds, since that row reads only the units where the pseudonym has an allocation and recoups its
   * positions from its own master income and the owner's publishing (read whole). A merged id answers for the survivor.
   */
  async function artistBalanceWithReach(artistId: string, f: PeriodFilter = {}) {
    const entry = await timed('owners.artistIndex (resolve)', async () => {
      const e = (await owners.artistIndex()).get(artistId);
      if (!e) await owners.getArtist(artistId); // throws not_found
      return e as NonNullable<typeof e>;
    });
    const docIds = await timed('settlements.allOperations (document ids)', opDocIds, (r) => `${r.length} ids`);
    const reach = await timed('artistReach', () => artistReach(modules, entry.id), (r) => `${r.isrcs.length} ISRCs`);
    const calc = await timed('calculate', () => calculate(scoped(modules, { isrcs: reach.isrcs }), docIds));
    const { artist, owner, operations } = await timed(
      'pg snapshot: artist + owner + operations',
      () =>
        db.snapshot(async () => ({
          artist: await owners.getArtist(entry.id),
          owner: entry.ownerId ? await owners.getOwner(entry.ownerId) : null,
          operations: entry.ownerId ? await settlements.listOperations({ ownerId: entry.ownerId }) : [],
        })),
      (r) => `${r.operations.length} operations`,
    );
    const money = timedSync('artistBalance (JS)', () => artistBalance(calc, entry.id, operations, f));
    return { artist, owner, ...money };
  }

  /** The payout gate of a balance (N19): the very decision the payout button takes. */
  function gateOf(b: Pick<ReturnType<typeof ownerBalance>, 'confirmed' | 'blockingPayouts' | 'total'>) {
    return payoutGate({
      confirmed: b.confirmed,
      blocking: b.blockingPayouts,
      payableCents: floorToCents(b.total.payable),
      thresholdCents: config.payoutThresholdCents,
    });
  }

  return {
    config,
    db,
    owners,
    splits,
    labels,
    sources,
    settlements,
    publishing,
    audit,
    ads,
    payments,
    modules,
    blockingPayoutsOf,
    opDocIds,
    checkSplitDocument,
    resolveShares,
    balanceWithFiles,
    artistBalanceWithReach,
    gateOf,
  };
}

export type FacadeContext = ReturnType<typeof createFacadeContext>;
