import { NotFoundError, ValidationError } from '../shared/errors';
import { BLOCKING_KINDS } from '@erp/shared/operation-kinds';
import { SPLIT_DOCUMENT_KINDS } from '@erp/shared/document-kinds';
import { type OwnersService } from '../modules/owners';
import { type SplitsService } from '../modules/splits';
import { type LabelsService } from '../modules/labels';
import type { SourcesService } from '../modules/sources';
import { type CutView, type OperationView, type SettlementsService } from '../modules/settlements';
import { type PublishingService } from '../modules/publishing';
import { type AuditService } from '../modules/audit';
import { type AdsService } from '../modules/ads';
import { artistReach, ownerReach } from './owner-scope';
import { scoped } from './scope';
import { calculate, type PeriodFilter } from './calculation';
import { artistBalance, ownerBalance, type BalanceView } from './balance';
import { labelBook, labelVisibility, type LabelBook } from './label-scope';
import { payoutGate } from './payout-gate';
import { cutBoundsOf, cutCalculation, cutCalculationBy, cutFilter, cutOperations, cutOperationsBy } from './as-of';
import { admissionOf, contractThresholds, type AdmissionRows } from './admission';
import type { Admission } from './payout-gate';
import { viewerScope, type Viewer } from './viewer';
import { Decimal, floorToCents } from '../shared/money';

/** The area of a payout or of its gate (D-173 К10): `all` = the whole book. */
export type PayoutArea = 'master' | 'publishing' | 'all';
import { stubPaymentService, type PaymentService } from './payment-service';
import type { Db } from '../shared/pg-db';
import { timed, timedSync } from '../shared/timing';

export interface FacadeConfig {
  /**
   * The PostgreSQL database of the modules owners, splits, settlements and publishing (one schema each, D-121).
   * The caller owns the pool and closes it.
   */
  db: Db;
  /** The organization the modules are opened under (D-170); `sources.orgId` must be the same. */
  orgId: string;
  /** Directory of the kept original files (orgs/<orgId>/files/publishing/...). */
  dataDir: string;
  /** The sources module of the same organization: Believe files in PostgreSQL + ClickHouse. The caller owns the connections and closes them. */
  sources: SourcesService;
  /** Where the calculation reads publishing (D-185): `v1` the old module (default), `v2` the report summaries and the links. */
  publishingSource?: 'v1' | 'v2';
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

/** One entry of `owners.artistIndex()`: every artist id (merged ones too) → the surviving artist and its owner. */
export type ArtistIndexEntry = Awaited<ReturnType<OwnersService['artistIndex']>> extends Map<string, infer E> ? E : never;

/**
 * The pseudonym index of ONE write transaction (D-172, the split import): `owners.artistIndex()` read once at the start
 * of the transaction and kept current by the writer itself (every artist it creates, every owner it assigns), so that
 * `createSplit` / `changeSplit` / `resolveShares` called with it (`opts.index`) do not read the whole index per call.
 * Only valid inside the transaction that built it; the API and every other caller pass nothing.
 */
export interface ArtistIndexCache {
  readonly map: Map<string, ArtistIndexEntry>;
}

/** Builds the cache (one `owners.artistIndex()` read); call inside the write transaction that uses it. */
export async function artistIndexCache(owners: Pick<OwnersService, 'artistIndex'>): Promise<ArtistIndexCache> {
  return { map: await owners.artistIndex() };
}

/** Records an artist created (or re-owned) inside the transaction of the cache. */
export function cacheArtist(
  cache: ArtistIndexCache,
  a: { id: string; pseudonym: string; ownerId: string | null },
): void {
  const prev = cache.map.get(a.id);
  cache.map.set(a.id, {
    id: a.id,
    pseudonym: a.pseudonym,
    ownerId: a.ownerId,
    status: a.ownerId ? (prev?.status === 'confirmed' ? 'confirmed' : 'unconfirmed') : 'no_owner',
  });
}

/** The optional last argument of `createSplit` / `changeSplit` / `resolveShares` (D-172). */
export interface SplitWriteOpts {
  index?: ArtistIndexCache;
}

/**
 * Document kinds that can confirm a split row or a participation (`SPLIT_DOCUMENT_KINDS` of `@erp/shared`): an
 * appendix, the contract itself, a buyout document, an assumption (a council decision, never approved), a label
 * decision (D-172) or another document.
 */
const splitDocumentKinds: readonly string[] = SPLIT_DOCUMENT_KINDS;

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
    // the blocking kinds (D-173 FIX-5): payouts and advances, never a buyout; the same rule as the module's and the balance's
    const pending = (await settlements.listOperations({ ownerId })).filter(
      (o) => (BLOCKING_KINDS as readonly string[]).includes(o.kind) && o.active && !o.migration,
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
    if (!splitDocumentKinds.includes(d.kind))
      throw new ValidationError(
        `A split or participation is confirmed by an appendix, contract, buyout, assumption, label decision or other document, not "${d.kind}"`,
      );
  }

  /** Validates every share before new artists are created, so a rejected split leaves nothing behind in module 1. */
  async function resolveShares(shares: ShareSpec[], opts: SplitWriteOpts = {}) {
    // A merged artist id stands for the surviving artist (D-095): one person can appear only once in a split.
    // With `opts.index` (one import transaction, D-172) the index is not read again, and an artist id is checked in it.
    const cache = opts.index;
    const idx = cache ? cache.map : await owners.artistIndex();
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
      if (s.artistId) {
        if (!cache) await owners.getArtist(s.artistId);
        else if (!idx.has(s.artistId)) throw new NotFoundError('Artist', s.artistId);
      } else if (!s.newArtistPseudonym)
        throw new ValidationError('Each share needs an artistId or a newArtistPseudonym');
    }
    return async () => {
      const out: { artistId: string; percent: string; documentId: string | null }[] = [];
      for (const s of shares) {
        if (s.artistId) {
          out.push({ artistId: canon(s.artistId), percent: s.percent, documentId: s.documentId ?? null });
          continue;
        }
        const created = await owners.createArtist({
          pseudonym: s.newArtistPseudonym as string,
          ownerId: null,
          origin: 'split',
        });
        if (cache) cacheArtist(cache, created);
        out.push({ artistId: created.id, percent: s.percent, documentId: s.documentId ?? null });
      }
      return out;
    };
  }

  /** An own label by id (D-168): 404 for an unknown id, 400 `label_not_own` for a sublabel. */
  async function assertOwnLabel(labelId: string) {
    const l = await labels.getLabel(labelId);
    if (l.kind !== 'own')
      throw new ValidationError(`Label "${l.name}" is a sublabel; an operation belongs to an own label`, { labelId }, 'label_not_own');
    return l;
  }

  /** The book of an own label and who is visible under it (D-168), or nothing when no label is asked. */
  async function labelContext(labelId: string | undefined): Promise<{ book: LabelBook; visible: Awaited<ReturnType<typeof labelVisibility>> } | undefined> {
    if (labelId === undefined) return undefined;
    const book = await timed('labelBook', () => labelBook(modules, labelId), (b) => `${b.fileIds.length} files`);
    const visible = await timed('labelVisibility', () => labelVisibility({ ...modules, settlements }, book), (v) => `${v.isrcs.size} ISRCs, ${v.artistIds.size} pseudonyms, ${v.ownerIds.size} owners`);
    return { book, visible };
  }

  /** The view of a balance under a label (D-168): the label must be an own label. */
  async function viewOf(labelId: string | undefined): Promise<BalanceView | undefined> {
    if (labelId === undefined) return undefined;
    await assertOwnLabel(labelId);
    return { labelId };
  }

  /**
   * The owner balance and the Believe files it was calculated from (a payout snapshot records them). The calculation
   * reads only the units of the owner's reach (`ownerReach`, D-163, D-164): the same balance, since the balance reads
   * only the units where the owner has an allocation and the reach is a superset of them (checked for every real
   * owner). The payout snapshot is this calculation; the file list it records comes from the registry and is complete.
   * Under a label (D-168) the same calculation is projected to that label's book: the recoup needs every income of
   * the owner, so the reach is never narrowed by the label.
   */
  async function balanceWithFiles(
    ownerId: string,
    f: PeriodFilter = {},
    view?: BalanceView,
    /**
     * D-173: `asOf` cuts the inputs of the balance at the end of a month (`as-of.ts`; the payout never passes it);
     * `area` decides the gate only (without it: the book).
     */
    opts: { asOf?: string; area?: PayoutArea; cut?: { cut: CutView; cuts: readonly CutView[] } } = {},
  ) {
    // D-208: the balance at a cut of the view's label: its bounds and the operations up to it or attributed to it
    const bounds = opts.cut ? cutBoundsOf(opts.cut.cut, opts.cut.cuts) : null;
    const opsAt = (ops: OperationView[]) => (bounds ? cutOperationsBy(ops, bounds) : cutOperations(ops, opts.asOf));
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
    const full = await timed('calculate', () => calculate(scoped(modules, { isrcs: reach.isrcs }), docIds));
    const calc = bounds ? cutCalculationBy(full, bounds) : cutCalculation(full, opts.asOf);
    // the owner and its operations in the same snapshot (inside a payout: the same write transaction)
    const { owner, operations, rows, active, thresholds } = await timed(
      'pg snapshot: owner + operations + admission',
      () =>
        db.snapshot(async () => ({
          owner: await owners.getOwner(id),
          operations: await settlements.listOperations({ ownerId: id }),
          // the admission of the owner (D-176): its payee, holds and answers, the thresholds of the contracts
          rows: {
            payee: (await settlements.listPayees({ ownerId: id, active: true }))[0] ?? null,
            holds: await settlements.listHolds({ ownerId: id, status: 'active' }),
            answers: await settlements.listAnswers({ ownerId: id, active: true }),
          } satisfies AdmissionRows,
          active: (await settlements.listPayees({})).length > 0,
          thresholds: contractThresholds(await owners.approvedContracts(), view?.labelId),
        })),
      (r) => `${r.operations.length} operations`,
    );
    // `confirmedAny` is the gate's input only, never in the answer (D-169)
    const { confirmedAny, ...balance } = timedSync('ownerBalance (JS)', () =>
      ownerBalance(calc, id, opsAt(operations), cutFilter(f, opts.asOf), {}, view),
    );
    // the payouts the owner had are those of the cut (`asOf`): a payout after it does not count
    const admission = admissionOf(rows, { active, thresholdCents: thresholds.get(id) ?? null, labelId: view?.labelId, operations: opsAt(operations) });
    return {
      files: calc.believeFiles,
      balance: {
        owner,
        ...balance,
        payout: gateOf({ ...balance, confirmedAny }, opts.area, admission),
        admission: { ...rows, active: admission.active, thresholdCents: admission.thresholdCents, hadPayout: admission.hadPayout },
      },
    };
  }

  /**
   * The money of one pseudonym from the units of its reach (`artistReach`, D-165): the artist row is the one
   * `ownerBalance()` builds, since that row reads only the units where the pseudonym has an allocation and recoups its
   * positions from its own master income and the owner's publishing (read whole). A merged id answers for the survivor.
   */
  async function artistBalanceWithReach(artistId: string, f: PeriodFilter = {}, view?: BalanceView) {
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
    const money = timedSync('artistBalance (JS)', () => artistBalance(calc, entry.id, operations, f, {}, view));
    return { artist, owner, ...money };
  }

  /** What a viewer reaches (D-171): the ISRC rule and the visibility of its labels, read lazily once per call. */
  function scopeOf(viewer: Viewer) {
    return viewerScope({ ...modules, settlements }, viewer);
  }

  /** The payout gate of a balance (N19): the very decision the payout button takes. */
  function gateOf(
    b: Pick<ReturnType<typeof ownerBalance>, 'confirmed' | 'confirmedAny' | 'blockingPayouts' | 'total'>,
    /** D-173 К10: the area pays min(payable of the area, payable of the book); without it (or `all`) the book. */
    area?: PayoutArea,
    /** D-176: the admission of the owner (payee, holds, answers, the contract threshold); without it the old checks only. */
    admission?: Admission,
  ) {
    // D-181: what is paid is Σ of the positive positions (`payableShown`), never the net of the formula
    const payable = area === undefined || area === 'all' ? b.total.payableShown : Decimal.min(b.total.byArea[area].payableShown, b.total.payableShown);
    return payoutGate({
      confirmed: b.confirmed,
      confirmedAny: b.confirmedAny,
      blocking: b.blockingPayouts,
      payableCents: floorToCents(payable),
      thresholdCents: config.payoutThresholdCents,
      ...(admission ? { admission } : {}),
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
    assertOwnLabel,
    labelContext,
    viewOf,
    scopeOf,
  };
}

export type FacadeContext = ReturnType<typeof createFacadeContext>;
