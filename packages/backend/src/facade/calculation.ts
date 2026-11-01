import { Decimal, picoToDecimal, ZERO } from '../shared/money';
import { inMonthRange, monthStart } from '../shared/dates';
import type { OwnersService } from '../modules/owners';
import type { SplitsService } from '../modules/splits';
import type { ActiveFile, SourcesService } from '../modules/sources';
import type { PublishingService } from '../modules/publishing';
import type { Db } from '../shared/pg-db';

/** Category of money in the completeness check (09, principle 11). */
export type Category = 'B' | 'C';

export type CReason =
  | 'split_unconfirmed'
  | 'artist_without_owner'
  | 'owner_unconfirmed'
  | 'unknown_pair'
  | 'no_isrc'
  | 'publishing_terms_unconfirmed'
  | 'writer_unmapped';

export interface MasterAllocation {
  isrc: string;
  upc: string;
  reportingMonth: string;
  salesMonth: string;
  artistId: string;
  ownerId: string | null;
  percent: Decimal;
  amount: Decimal;
  category: Category;
  reason: CReason | null;
}

export interface UnitResult {
  account: string;
  isrc: string;
  upc: string;
  reportingMonth: string;
  salesMonth: string;
  net: Decimal;
  status: 'allocated' | 'no_split' | 'unknown_pair' | 'no_isrc';
  ours: Decimal;
  allocations: MasterAllocation[];
}

export interface PublishingResult {
  period: string;
  reportMonth: string;
  writerName: string;
  ownerId: string | null;
  workTitle: string;
  payable: Decimal;
  percent: Decimal;
  authorAmount: Decimal;
  labelAmount: Decimal;
  category: Category;
  reason: CReason | null;
}

export interface Calculation {
  units: UnitResult[];
  /** The Believe files these units were read from, exactly (stored with a payout). */
  believeFiles: ActiveFile[];
  publishing: PublishingResult[];
  artistIndex: Awaited<ReturnType<OwnersService['artistIndex']>>;
  confirmedOwners: Set<string>;
  documentStatus: (id: string | null | undefined) => 'approved' | 'not_approved' | 'not_attached' | 'missing';
}

export interface Modules {
  /** The PostgreSQL database of the modules: the calculation reads them in one snapshot. */
  db: Db;
  owners: OwnersService;
  splits: SplitsService;
  sources: SourcesService;
  publishing: PublishingService;
}

/**
 * Full recalculation from scratch over all loaded data: no stored accruals, no caches.
 * The sources (PostgreSQL + ClickHouse) are read first, as one snapshot of the loaded files; then every other module is
 * read in one read-only REPEATABLE READ transaction (db.snapshot), so all totals come from one consistent version of
 * the data (D-012, D-121).
 */
export async function calculate(m: Modules, extraDocumentIds: string[] = []): Promise<Calculation> {
  const snapshot = await m.sources.snapshot();
  const { artistIndex, confirmedOwners, labelOwners, knownPairs, splitIndex, statuses, accruals } =
    await m.db.snapshot(async () => {
      const artistIndex = await m.owners.artistIndex();
      const confirmedOwners = await m.owners.confirmedOwnerIds();
      // Publishing is never accrued to a label (08, decision 7): a writer resolved to a label owner counts as unmapped.
      const labelOwners = new Set(
        (await m.owners.listOwners()).filter((o) => o.kind === 'label').map((o) => o.id),
      );
      const knownPairs = await m.owners.knownPairs();
      const splitIndex = await m.splits.index();
      const terms = await m.publishing.allTerms();
      const docIds = [
        ...splitIndex.documentIds(),
        ...terms.map((t) => t.documentId).filter((x): x is string => !!x),
        ...extraDocumentIds,
      ];
      const statuses = await m.owners.documentStatuses(docIds);
      const accruals = await m.publishing.accruals({}, await m.owners.ownerResolver());
      return { artistIndex, confirmedOwners, labelOwners, knownPairs, splitIndex, statuses, accruals };
    });
  const documentStatus = (id: string | null | undefined) =>
    id ? (statuses.get(id) ?? 'missing') : 'missing';

  const units: UnitResult[] = [];
  for (const u of snapshot.units) {
    const net = picoToDecimal(u.netPico);
    const base = {
      account: u.account,
      isrc: u.isrc,
      upc: u.upc,
      reportingMonth: u.reportingMonth,
      salesMonth: u.salesMonth,
      net,
    };
    if (!u.isrc) {
      units.push({ ...base, status: 'no_isrc', ours: ZERO, allocations: [] });
      continue;
    }
    if (!knownPairs.has(`${u.isrc}|${u.upc}`)) {
      units.push({ ...base, status: 'unknown_pair', ours: ZERO, allocations: [] });
      continue;
    }
    // The split is chosen by the report date (first day of the reporting month).
    const split = splitIndex.at(u.isrc, monthStart(u.reportingMonth));
    if (!split) {
      units.push({ ...base, status: 'no_split', ours: net, allocations: [] });
      continue;
    }
    const splitConfirmed = documentStatus(split.documentId) === 'approved';
    const allocations: MasterAllocation[] = [];
    let allocated = ZERO;
    for (const share of split.shares) {
      if (share.percent.isZero()) continue;
      const artist = artistIndex.get(share.artistId);
      const ownerId = artist?.ownerId ?? null;
      const amount = net.mul(share.percent).div(100);
      allocated = allocated.add(amount);
      let reason: CReason | null = null;
      if (!splitConfirmed) reason = 'split_unconfirmed';
      else if (!ownerId) reason = 'artist_without_owner';
      else if (!confirmedOwners.has(ownerId)) reason = 'owner_unconfirmed';
      allocations.push({
        isrc: u.isrc,
        upc: u.upc,
        reportingMonth: u.reportingMonth,
        salesMonth: u.salesMonth,
        artistId: artist?.id ?? share.artistId,
        ownerId,
        percent: share.percent,
        amount,
        category: reason ? 'C' : 'B',
        reason,
      });
    }
    // Our share is the remainder: 100 minus the artist and MC shares.
    units.push({ ...base, status: 'allocated', ours: net.sub(allocated), allocations });
  }

  const publishing: PublishingResult[] = accruals.map((raw) => {
    const a = { ...raw, ownerId: raw.ownerId && !labelOwners.has(raw.ownerId) ? raw.ownerId : null };
    let reason: CReason | null = null;
    if (!a.ownerId) reason = 'writer_unmapped';
    else if (!confirmedOwners.has(a.ownerId)) reason = 'owner_unconfirmed';
    else if (a.defaultTerms || documentStatus(a.termsDocumentId) !== 'approved')
      reason = 'publishing_terms_unconfirmed';
    return {
      period: a.period,
      reportMonth: a.reportMonth,
      writerName: a.writerName,
      ownerId: a.ownerId,
      workTitle: a.workTitle,
      payable: a.payable,
      percent: a.percent,
      authorAmount: a.ownerId ? a.authorAmount : ZERO,
      labelAmount: a.ownerId ? a.payable.sub(a.authorAmount) : ZERO,
      category: reason ? 'C' : 'B',
      reason,
    };
  });

  return { units, believeFiles: snapshot.files, publishing, artistIndex, confirmedOwners, documentStatus };
}

export type DateBasis = 'report' | 'sales';
export interface PeriodFilter {
  from?: string;
  to?: string;
  basis?: DateBasis;
}

export const unitInPeriod = (u: Pick<UnitResult, 'reportingMonth' | 'salesMonth'>, f: PeriodFilter) =>
  inMonthRange((f.basis ?? 'report') === 'sales' ? u.salesMonth : u.reportingMonth, f.from, f.to);

/** Publishing has no sales date: both bases use the statement's report month (quarter end). */
export const pubInPeriod = (p: Pick<PublishingResult, 'reportMonth'>, f: PeriodFilter) =>
  inMonthRange(p.reportMonth, f.from, f.to);

export interface Reconciliation {
  source: 'believe' | 'b17';
  month: string;
  A_received: Decimal;
  B_notOurs: Decimal;
  C_waiting: Decimal;
  C_breakdown: Partial<Record<CReason | 'unallocated', Decimal>>;
  ourShare: Decimal;
  ourShareNoSplit: Decimal;
  /** A - B - C must equal the sum of remainders; any difference is an alarm. */
  discrepancy: Decimal;
}

/** Completeness check per source and month: A received = B not ours + C waiting + our share. */
export function reconcile(calc: Calculation, f: PeriodFilter = {}): Reconciliation[] {
  const rows = new Map<string, Reconciliation>();
  const row = (source: 'believe' | 'b17', month: string) => {
    const k = `${source}|${month}`;
    let r = rows.get(k);
    if (!r) {
      r = {
        source,
        month,
        A_received: ZERO,
        B_notOurs: ZERO,
        C_waiting: ZERO,
        C_breakdown: {},
        ourShare: ZERO,
        ourShareNoSplit: ZERO,
        discrepancy: ZERO,
      };
      rows.set(k, r);
    }
    return r;
  };
  const addC = (r: Reconciliation, reason: CReason | 'unallocated', v: Decimal) => {
    r.C_waiting = r.C_waiting.add(v);
    r.C_breakdown[reason] = (r.C_breakdown[reason] ?? ZERO).add(v);
  };
  const remainders = new Map<string, Decimal>();
  for (const u of calc.units) {
    if (!unitInPeriod(u, f)) continue;
    const month = (f.basis ?? 'report') === 'sales' ? u.salesMonth : u.reportingMonth;
    const r = row('believe', month);
    r.A_received = r.A_received.add(u.net);
    if (u.status === 'unknown_pair' || u.status === 'no_isrc') addC(r, u.status, u.net);
    if (u.status === 'no_split') r.ourShareNoSplit = r.ourShareNoSplit.add(u.net);
    for (const a of u.allocations) {
      if (a.category === 'B') r.B_notOurs = r.B_notOurs.add(a.amount);
      else addC(r, a.reason as CReason, a.amount);
    }
    const k = `believe|${month}`;
    remainders.set(k, (remainders.get(k) ?? ZERO).add(u.ours));
  }
  for (const p of calc.publishing) {
    if (!pubInPeriod(p, f)) continue;
    const r = row('b17', p.reportMonth);
    r.A_received = r.A_received.add(p.payable);
    if (!p.ownerId) addC(r, 'writer_unmapped', p.payable);
    else if (p.category === 'B') r.B_notOurs = r.B_notOurs.add(p.authorAmount);
    else addC(r, p.reason as CReason, p.authorAmount);
    const k = `b17|${p.reportMonth}`;
    remainders.set(k, (remainders.get(k) ?? ZERO).add(p.labelAmount));
  }
  for (const [k, r] of rows) {
    r.ourShare = r.A_received.sub(r.B_notOurs).sub(r.C_waiting);
    r.discrepancy = r.ourShare.sub(remainders.get(k) ?? ZERO);
  }
  return [...rows.values()].sort((a, b) =>
    a.month < b.month ? -1 : a.month > b.month ? 1 : a.source < b.source ? -1 : 1,
  );
}

export { Decimal };
