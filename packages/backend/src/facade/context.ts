import { ValidationError } from '../shared/errors';
import { type OwnersService } from '../modules/owners';
import { type SplitsService } from '../modules/splits';
import type { SourcesService } from '../modules/sources';
import { type SettlementsService } from '../modules/settlements';
import { type PublishingService } from '../modules/publishing';
import { calculate, type PeriodFilter } from './calculation';
import { ownerBalance } from './balance';
import { stubPaymentService, type PaymentService } from './payment-service';

export interface FacadeConfig {
  /** Directory with one SQLite file per module (owners, splits, settlements, publishing), or ':memory:' for tests. */
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
}

/** Document kinds that can confirm a split: an appendix to the contract, the contract itself, a buyout document. */
const SPLIT_DOCUMENT_KINDS = ['appendix', 'contract', 'buyout'];

/** What every facade section works with: the modules and the checks shared between sections. */
export function createFacadeContext(
  config: FacadeConfig,
  m: {
    owners: OwnersService;
    splits: SplitsService;
    sources: SourcesService;
    settlements: SettlementsService;
    publishing: PublishingService;
  },
) {
  const { owners, splits, sources, settlements, publishing } = m;
  const payments = config.paymentService ?? stubPaymentService;
  const modules = { owners, splits, sources, publishing };

  /**
   * Payouts of an owner that block new money going out: no payment proof, a deferred one, or a proof that is not
   * approved (counted only once approved). Migrated payouts never block.
   */
  function blockingPayoutsOf(ownerId: string) {
    const pending = settlements
      .listOperations({ ownerId })
      .filter((o) => o.direction === 'out' && o.active && !o.migration);
    const statuses = owners.documentStatuses(
      pending.map((o) => o.paymentProofId).filter((x): x is string => !!x),
    );
    return pending.filter(
      (o) => !o.paymentProofId || o.deferred || statuses.get(o.paymentProofId) !== 'approved',
    );
  }

  function opDocIds() {
    return settlements
      .allOperations()
      .flatMap((o) => [o.documentId, o.paymentProofId].filter((x): x is string => !!x));
  }

  function checkSplitDocument(documentId: string | null | undefined) {
    if (!documentId) return;
    const d = owners.getDocument(documentId);
    if (!SPLIT_DOCUMENT_KINDS.includes(d.kind))
      throw new ValidationError(
        `A split is confirmed by an appendix, contract or buyout document, not "${d.kind}"`,
      );
  }

  /** Validates every share before new artists are created, so a rejected split leaves nothing behind in module 1. */
  function resolveShares(shares: ShareSpec[]) {
    // A merged artist id stands for the surviving artist (D-095): one person can appear only once in a split.
    const idx = owners.artistIndex();
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
      if (s.artistId) owners.getArtist(s.artistId);
      else if (!s.newArtistPseudonym)
        throw new ValidationError('Each share needs an artistId or a newArtistPseudonym');
    }
    return () =>
      shares.map((s) =>
        s.artistId
          ? { artistId: canon(s.artistId), percent: s.percent }
          : {
              artistId: owners.createArtist({
                pseudonym: s.newArtistPseudonym as string,
                ownerId: null,
                origin: 'split',
              }).id,
              percent: s.percent,
            },
      );
  }

  /** The owner balance and the Believe files it was calculated from (a payout snapshot records them). */
  async function balanceWithFiles(ownerId: string, f: PeriodFilter = {}) {
    const id = owners.resolveOwnerId(ownerId);
    owners.getOwner(id);
    const calc = await calculate(modules, opDocIds());
    return {
      files: calc.believeFiles,
      balance: {
        owner: owners.getOwner(id),
        ...ownerBalance(calc, id, settlements.listOperations({ ownerId: id }), f),
      },
    };
  }

  return {
    config,
    owners,
    splits,
    sources,
    settlements,
    publishing,
    payments,
    modules,
    blockingPayoutsOf,
    opDocIds,
    checkSplitDocument,
    resolveShares,
    balanceWithFiles,
  };
}

export type FacadeContext = ReturnType<typeof createFacadeContext>;
