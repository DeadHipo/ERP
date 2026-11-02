import { Decimal, picoToDecimal, ZERO } from '../shared/money';
import { inMonthRange } from '../shared/dates';
import type { OwnersService } from '../modules/owners';
import type { LabelsService } from '../modules/labels';
import type { SplitsService } from '../modules/splits';
import type { ActiveFile, SourcesService } from '../modules/sources';
import type { PublishingService } from '../modules/publishing';
import type { Db } from '../shared/pg-db';
import { timed, timedStep, timedSync } from '../shared/timing';
import {
  allocateUnit,
  MASTER_LAYERS,
  type Allocation,
  type Category,
  type CReason,
  type LabelShareCategory,
  type LayerContext,
  type NamedLayer,
  type Shortfall,
  type UnitAllocation,
  type UnitState,
} from './layers';

export type { CReason, Category };

/** One allocation of a unit (10 §3): recipient pseudonym, layer, rule, document, amount, category. */
export type MasterAllocation = Allocation;

export interface UnitResult {
  account: string;
  isrc: string;
  upc: string;
  reportingMonth: string;
  salesMonth: string;
  labelName: string;
  net: Decimal;
  status: UnitState['status'];
  /** Our label of record (null for an unmapped label string). */
  ourLabelId: string | null;
  ourLabelName: string | null;
  /** What remains of the net after every allocation (the layer state, D-127). */
  labelShare: Decimal;
  labelShareCategory: LabelShareCategory;
  /** labelShare when it is ours, else 0 (it is C for its category). */
  ours: Decimal;
  allocations: MasterAllocation[];
  shortfalls: Shortfall[];
  /** The state after every layer: only for the units of a traced ISRC (explainTrack). */
  layers?: UnitAllocation['states'];
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
  documentKind: (id: string | null | undefined) => string | undefined;
}

export interface CalculateOptions {
  /** The layer list (tests pass a broken one to prove that reconcile() shows a lost amount). */
  layers?: readonly NamedLayer[];
  /** Keep the state after every layer for the units of this ISRC (explainTrack). */
  traceIsrc?: string;
}

export interface Modules {
  /** The PostgreSQL database of the modules: the calculation reads them in one snapshot. */
  db: Db;
  owners: OwnersService;
  splits: SplitsService;
  labels: LabelsService;
  sources: SourcesService;
  publishing: PublishingService;
}

/**
 * Full recalculation from scratch over all loaded data: no stored accruals, no caches.
 * The sources (PostgreSQL + ClickHouse) are read first, as one snapshot of the loaded files; then every other module is
 * read in one read-only REPEATABLE READ transaction (db.snapshot), so all totals come from one consistent version of
 * the data (D-012, D-121).
 */
export async function calculate(
  m: Modules,
  extraDocumentIds: string[] = [],
  opts: CalculateOptions = {},
): Promise<Calculation> {
  const snapshot = await timed('sources.snapshot', () => m.sources.snapshot());
  const { artistIndex, confirmedOwners, labelOwners, knownPairs, splitIndex, labelIndex, docs, accruals } =
    await timed('pg snapshot: reference data', () =>
      m.db.snapshot(async () => {
        const artistIndex = await timed('owners.artistIndex', () => m.owners.artistIndex());
        const confirmedOwners = await timed('owners.confirmedOwnerIds', () => m.owners.confirmedOwnerIds());
        // Publishing is never accrued to a label (08, decision 7): a writer resolved to a label owner counts as unmapped.
        const labelOwners = new Set(
          (await timed('owners.listOwners', () => m.owners.listOwners()))
            .filter((o) => o.kind === 'label')
            .map((o) => o.id),
        );
        const knownPairs = await timed('owners.knownPairs', () => m.owners.knownPairs());
        const splitIndex = await timed('splits.index', () => m.splits.index());
        const labelIndex = await timed('labels.index', () => m.labels.index());
        const terms = await timed('publishing.allTerms', () => m.publishing.allTerms());
        const docIds = [
          ...splitIndex.documentIds(),
          ...labelIndex.documentIds(),
          ...terms.map((t) => t.documentId).filter((x): x is string => !!x),
          ...extraDocumentIds,
        ];
        const docs = await timed('owners.documentInfo', () => m.owners.documentInfo(docIds));
        const accruals = await timed(
          'publishing.accruals',
          async () => m.publishing.accruals({}, await m.owners.ownerResolver()),
          (r) => `${r.length} lines`,
        );
        return {
          artistIndex,
          confirmedOwners,
          labelOwners,
          knownPairs,
          splitIndex,
          labelIndex,
          docs,
          accruals,
        };
      }),
    );
  const documentStatus = (id: string | null | undefined) =>
    id ? (docs.get(id)?.status ?? 'missing') : 'missing';
  const documentKind = (id: string | null | undefined) => (id ? docs.get(id)?.kind : undefined);

  // The pure context of the layers: plain functions over this one snapshot (10 §3).
  const ctx: LayerContext = {
    labelOf: (s, date) => labelIndex.labelOf(s, date),
    labelName: (id) => labelIndex.labelName(id),
    knownPairs,
    splitAt: (isrc, date) => splitIndex.at(isrc, date),
    participationsAt: (isrc, date) => splitIndex.participationsAt(isrc, date),
    artistIndex,
    documentStatus,
    documentKind,
    confirmedOwners,
  };
  const layers = opts.layers ?? MASTER_LAYERS;

  const units: UnitResult[] = [];
  const endUnits = timedStep('allocate units (layers, JS)');
  for (const u of snapshot.units) {
    const { state, states } = allocateUnit(
      {
        account: u.account,
        isrc: u.isrc,
        upc: u.upc,
        reportingMonth: u.reportingMonth,
        salesMonth: u.salesMonth,
        labelName: u.labelName,
        net: picoToDecimal(u.netPico),
      },
      ctx,
      layers,
    );
    units.push({
      ...state.unit,
      status: state.status,
      ourLabelId: state.ourLabelId,
      ourLabelName: state.ourLabelName,
      labelShare: state.labelShare,
      labelShareCategory: state.labelShareCategory,
      ours: state.labelShareCategory === 'ours' ? state.labelShare : ZERO,
      allocations: state.rows,
      shortfalls: state.shortfalls,
      ...(opts.traceIsrc !== undefined && u.isrc === opts.traceIsrc ? { layers: states } : {}),
    });
  }
  endUnits(`${units.length} units`);

  const publishing: PublishingResult[] = timedSync('publishing results (JS)', () =>
    accruals.map((raw) => {
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
    }),
  );

  return {
    units,
    believeFiles: snapshot.files,
    publishing,
    artistIndex,
    confirmedOwners,
    documentStatus,
    documentKind,
  };
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
  /** Believe account of the files (B17: 'b17'). */
  account: string;
  month: string;
  A_received: Decimal;
  B_notOurs: Decimal;
  C_waiting: Decimal;
  C_breakdown: Partial<Record<CReason, Decimal>>;
  /** Σ of the units' label share where it is ours (the layer state, not A − B − C). */
  ourShare: Decimal;
  /** ourShare per our label of record (by name). */
  ourShareByLabel: Record<string, Decimal>;
  /** The part of ourShare that comes from units without a split. */
  ourShareNoSplit: Decimal;
  /** A − B − C − ourShare: must be 0; anything else means a layer lost or created money. */
  discrepancy: Decimal;
}

/** Completeness check per source, account and month: A received = B not ours + C waiting + our share. */
export function reconcile(calc: Calculation, f: PeriodFilter = {}): Reconciliation[] {
  const rows = new Map<string, Reconciliation>();
  const row = (source: 'believe' | 'b17', account: string, month: string) => {
    const k = `${source}|${account}|${month}`;
    let r = rows.get(k);
    if (!r) {
      r = {
        source,
        account,
        month,
        A_received: ZERO,
        B_notOurs: ZERO,
        C_waiting: ZERO,
        C_breakdown: {},
        ourShare: ZERO,
        ourShareByLabel: {},
        ourShareNoSplit: ZERO,
        discrepancy: ZERO,
      };
      rows.set(k, r);
    }
    return r;
  };
  const addC = (r: Reconciliation, reason: CReason, v: Decimal) => {
    r.C_waiting = r.C_waiting.add(v);
    r.C_breakdown[reason] = (r.C_breakdown[reason] ?? ZERO).add(v);
  };
  for (const u of calc.units) {
    if (!unitInPeriod(u, f)) continue;
    const r = row('believe', u.account, (f.basis ?? 'report') === 'sales' ? u.salesMonth : u.reportingMonth);
    r.A_received = r.A_received.add(u.net);
    for (const a of u.allocations) {
      if (a.category === 'B') r.B_notOurs = r.B_notOurs.add(a.amount);
      else addC(r, a.reason as CReason, a.amount);
    }
    if (u.labelShareCategory === 'ours') {
      r.ourShare = r.ourShare.add(u.labelShare);
      const label = u.ourLabelName ?? '?';
      r.ourShareByLabel[label] = (r.ourShareByLabel[label] ?? ZERO).add(u.labelShare);
      if (u.status === 'no_split') r.ourShareNoSplit = r.ourShareNoSplit.add(u.labelShare);
    } else addC(r, u.labelShareCategory, u.labelShare);
  }
  for (const p of calc.publishing) {
    if (!pubInPeriod(p, f)) continue;
    const r = row('b17', 'b17', p.reportMonth);
    r.A_received = r.A_received.add(p.payable);
    if (!p.ownerId) addC(r, 'writer_unmapped', p.payable);
    else if (p.category === 'B') r.B_notOurs = r.B_notOurs.add(p.authorAmount);
    else addC(r, p.reason as CReason, p.authorAmount);
    r.ourShare = r.ourShare.add(p.labelAmount);
  }
  for (const r of rows.values())
    r.discrepancy = r.A_received.sub(r.B_notOurs).sub(r.C_waiting).sub(r.ourShare);
  return [...rows.values()].sort((a, b) =>
    a.month !== b.month
      ? a.month < b.month
        ? -1
        : 1
      : a.source !== b.source
        ? a.source < b.source
          ? -1
          : 1
        : a.account < b.account
          ? -1
          : a.account > b.account
            ? 1
            : 0,
  );
}

export { Decimal };
