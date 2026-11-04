import { Decimal, ZERO } from '../shared/money';
import { inMonthRange } from '../shared/dates';
import { assertIsrc } from '../shared/identifiers';
import { calculate, reconcile, type Calculation, type PeriodFilter, type Reconciliation } from './calculation';
import { cQueue, type QueueOptions } from './queue';
import { periodScope, scoped } from './scope';
import { ownerReach } from './owner-scope';
import type { CReason } from '@erp/shared/api-responses';
import type { FacadeContext } from './context';

/** The six sums of the KPI cards of P1 (D-160): the same fields as a reconciliation row, over a set of rows. */
export interface KpiSums {
  received: Decimal;
  notOurs: Decimal;
  waiting: Decimal;
  ourShare: Decimal;
  ourShareNoSplit: Decimal;
  discrepancy: Decimal;
}

const zeroSums = (): KpiSums => ({
  received: ZERO,
  notOurs: ZERO,
  waiting: ZERO,
  ourShare: ZERO,
  ourShareNoSplit: ZERO,
  discrepancy: ZERO,
});

const addRow = (s: KpiSums, r: Reconciliation): KpiSums => ({
  received: s.received.add(r.A_received),
  notOurs: s.notOurs.add(r.B_notOurs),
  waiting: s.waiting.add(r.C_waiting),
  ourShare: s.ourShare.add(r.ourShare),
  ourShareNoSplit: s.ourShareNoSplit.add(r.ourShareNoSplit),
  discrepancy: s.discrepancy.add(r.discrepancy),
});

/**
 * The totals of the KPI cards of P1 over the reconciliation rows of the period (D-160): all rows, per source, and per
 * source × account (every account of the rows, in the order of the rows). The frontend computes nothing (R1), so the
 * sums it shows are these; a row set filtered to one account on the client picks that account's entry.
 */
export function overviewTotals(rows: readonly Reconciliation[]) {
  let all = zeroSums();
  const bySource = { believe: zeroSums(), b17: zeroSums() };
  const byAccount = new Map<string, { source: 'believe' | 'b17'; account: string; sums: KpiSums }>();
  for (const r of rows) {
    all = addRow(all, r);
    bySource[r.source] = addRow(bySource[r.source], r);
    const k = `${r.source}|${r.account}`;
    const a = byAccount.get(k) ?? { source: r.source, account: r.account, sums: zeroSums() };
    byAccount.set(k, { ...a, sums: addRow(a.sums, r) });
  }
  return {
    all,
    bySource,
    byAccount: [...byAccount.values()]
      .sort((a, b) => (a.source !== b.source ? (a.source < b.source ? -1 : 1) : a.account < b.account ? -1 : a.account > b.account ? 1 : 0))
      .map(({ source, account, sums }) => ({ source, account, ...sums })),
  };
}

/** The reconciliation rows of one calculation, with the stored file totals. */
export async function reconciliationFrom(
  ctx: Pick<FacadeContext, 'sources'>,
  calc: Calculation,
  f: PeriodFilter = {},
) {
  const { sources } = ctx;
  const rows = reconcile(calc, f);
  const believeTotals = new Map<string, Decimal>();
  const loadedIds = new Set(calc.believeFiles.map((x) => x.id));
  for (const file of await sources.listFiles()) {
    // only the files this calculation was made from, with the totals stored when each was loaded
    if (file.status !== 'loaded' || !loadedIds.has(file.id) || file.netTotal === null) continue;
    const k = `${file.account}|${file.reportingMonth}`;
    believeTotals.set(k, (believeTotals.get(k) ?? ZERO).add(file.netTotal));
  }
  // Alarm: our remainder has the opposite sign of the line (shares above 100); negative report lines alone are normal.
  const negativeRemainders = calc.units.filter(
    (u) => !u.net.isZero() && !u.labelShare.isZero() && u.labelShare.isNegative() !== u.net.isNegative(),
  ).length;
  return rows.map((r) => {
    const fileTotal =
      r.source === 'believe' && (f.basis ?? 'report') === 'report'
        ? (believeTotals.get(`${r.account}|${r.month}`) ?? null)
        : null;
    return {
      ...r,
      fileTotal,
      fileDiscrepancy: fileTotal ? r.A_received.sub(fileTotal) : null,
      negativeRemainders: r.source === 'believe' ? negativeRemainders : 0,
    };
  });
}

/**
 * Signals of one calculation (the lists are complete; `counts` is the full length of each list, the route applies the
 * limit). Needs the sources, owners, splits and publishing modules for the lists that are not in the calculation.
 */
export async function signalsFrom(
  ctx: Pick<FacadeContext, 'owners' | 'splits' | 'sources' | 'publishing' | 'modules'>,
  calc: Calculation,
  f: PeriodFilter = {},
) {
  const { owners, splits, sources, publishing, modules } = ctx;
  const attrs = await sources.pairAttributes();
  const unknown = new Map<string, { isrc: string; upc: string; net: Decimal; months: Set<string> }>();
  const noSplit = new Map<string, Decimal>();
  const unmapped = new Map<string, Decimal>();
  const assumptions = new Map<
    string,
    { documentId: string | null; basis: string; amount: Decimal; isrcs: Set<string> }
  >();
  const unfunded: {
    isrc: string;
    upc: string;
    month: string;
    salesMonth: string;
    ruleId: string;
    missing: Decimal;
    why: string;
  }[] = [];
  const byRule = new Map<string, Decimal>();
  const noRule = new Map<string, { label: string; month: string; net: Decimal }>();
  const recipientRows = new Map<
    string,
    { isrc: string; artistId: string; pseudonym: string; month: string }
  >();
  const twoRows = new Map<string, { isrc: string; ownerId: string; month: string; pseudonyms: string[] }>();
  const pseudonymOf = (id: string) => calc.artistIndex.get(id)?.pseudonym ?? '?';
  let noIsrc = ZERO;
  for (const u of calc.units) {
    if (!inMonthRange((f.basis ?? 'report') === 'sales' ? u.salesMonth : u.reportingMonth, f.from, f.to))
      continue;
    if (u.status === 'unknown_pair' || u.status === 'no_isrc') {
      const k = `${u.isrc}|${u.upc}`;
      const r = unknown.get(k) ?? { isrc: u.isrc, upc: u.upc, net: ZERO, months: new Set<string>() };
      r.net = r.net.add(u.net);
      r.months.add(u.reportingMonth);
      unknown.set(k, r);
      if (u.status === 'no_isrc') noIsrc = noIsrc.add(u.net);
      continue;
    }
    if (u.status === 'no_split') noSplit.set(u.isrc, (noSplit.get(u.isrc) ?? ZERO).add(u.net));
    if (u.labelShareCategory === 'label_unmapped')
      unmapped.set(u.labelName, (unmapped.get(u.labelName) ?? ZERO).add(u.net));
    unfunded.push(...u.shortfalls);
    if (u.sublabelId && !u.ruleId) {
      const k = `${u.sublabelId}|${u.reportingMonth}`;
      const r = noRule.get(k) ?? {
        label: u.sublabelName ?? u.labelName,
        month: u.reportingMonth,
        net: ZERO,
      };
      r.net = r.net.add(u.net);
      noRule.set(k, r);
    }
    const rows = u.allocations.filter((a) => a.layer === 'split' && a.kind === 'row');
    if (u.ruleId) {
      const rule = u.allocations.find((a) => a.layer === 'sublabel');
      if (rule && rows.some((a) => a.artistId === rule.artistId))
        recipientRows.set(`${u.isrc}|${rule.artistId}|${u.reportingMonth}`, {
          isrc: u.isrc,
          artistId: rule.artistId,
          pseudonym: pseudonymOf(rule.artistId),
          month: u.reportingMonth,
        });
    }
    const byOwner = new Map<string, Set<string>>();
    for (const a of rows)
      if (a.ownerId) byOwner.set(a.ownerId, (byOwner.get(a.ownerId) ?? new Set<string>()).add(a.artistId));
    for (const [ownerId, ids] of byOwner)
      if (ids.size > 1)
        twoRows.set(`${u.isrc}|${ownerId}|${u.reportingMonth}`, {
          isrc: u.isrc,
          ownerId,
          month: u.reportingMonth,
          pseudonyms: [...ids].map(pseudonymOf).sort(),
        });
    for (const a of u.allocations) {
      byRule.set(a.ruleId, (byRule.get(a.ruleId) ?? ZERO).add(a.amount));
      if (a.reason !== 'assumption') continue;
      const k = `${a.documentId ?? ''}|${a.assumption}`;
      const r = assumptions.get(k) ?? {
        documentId: a.documentId,
        basis: a.assumption ?? 'document',
        amount: ZERO,
        isrcs: new Set<string>(),
      };
      r.amount = r.amount.add(a.amount);
      r.isrcs.add(u.isrc);
      assumptions.set(k, r);
    }
  }
  const unknownPairs = [...unknown.entries()]
    .map(([k, r]) => ({
      isrc: r.isrc,
      upc: r.upc,
      net: r.net,
      months: [...r.months].sort(),
      reportTitle: attrs.get(k)?.trackTitle || attrs.get(k)?.releaseTitle || '',
      reportArtist: attrs.get(k)?.artistName ?? '',
    }))
    .sort((a, b) => b.net.cmp(a.net));
  const { tracks, parts } = await modules.db.snapshot(async () => ({
    tracks: await owners.listTracks(),
    parts: await splits.listParticipations(),
  }));
  const partById = new Map(parts.map((p) => [p.id, p]));
  const lists = {
    unallocated: {
      total: unknownPairs.reduce((s, p) => s.add(p.net), ZERO),
      withoutIsrc: noIsrc,
      pairs: unknownPairs,
    },
    isrcsWithoutSplit: [...noSplit.entries()]
      .map(([isrc, net]) => ({ isrc, net }))
      .sort((a, b) => b.net.cmp(a.net)),
    ambiguousWriters: (await publishing.listWriters()).filter((w) => w.resolution === 'ambiguous'),
    unfunded: unfunded.map((u) => {
      const part = partById.get(u.ruleId);
      return {
        ...u,
        // The rule id is a participation id: its recipient and funding bucket tell identical rows apart (stage 3, product 4).
        artistId: part?.artistId ?? '',
        pseudonym: part ? pseudonymOf(part.artistId) : '?',
        fundedFrom: part?.fundedFrom ?? null,
      };
    }),
    labelUnmapped: [...unmapped.entries()]
      .map(([labelName, net]) => ({ labelName, net }))
      .sort((a, b) => b.net.cmp(a.net)),
    tracksWithNote: tracks
      .filter((t) => t.note)
      .map((t) => ({ trackId: t.id, isrc: t.isrc, upc: t.upc, title: t.title, note: t.note as string })),
    participantsWithoutOwner: parts
      .filter((p) => !calc.artistIndex.get(p.artistId)?.ownerId)
      .map((p) => ({
        participationId: p.id,
        isrc: p.isrc,
        artistId: p.artistId,
        pseudonym: calc.artistIndex.get(p.artistId)?.pseudonym ?? '?',
        fundedFrom: p.fundedFrom,
        amount: byRule.get(p.id) ?? ZERO,
      })),
    sublabelWithoutRule: [...noRule.values()].sort(
      (a, b) => b.net.cmp(a.net) || a.month.localeCompare(b.month),
    ),
    ruleRecipientIsRow: [...recipientRows.values()].sort(
      (a, b) => a.isrc.localeCompare(b.isrc) || a.month.localeCompare(b.month),
    ),
    twoRowsOneOwner: [...twoRows.values()].sort(
      (a, b) => a.isrc.localeCompare(b.isrc) || a.month.localeCompare(b.month),
    ),
    assumptions: [...assumptions.values()]
      .map((a) => ({
        documentId: a.documentId,
        basis: a.basis,
        amount: a.amount,
        isrcs: [...a.isrcs].sort(),
      }))
      .sort((a, b) => b.amount.abs().cmp(a.amount.abs())),
  };
  const counts: Record<string, number> = {
    unallocated: lists.unallocated.pairs.length,
    isrcsWithoutSplit: lists.isrcsWithoutSplit.length,
  };
  for (const [name, v] of Object.entries(lists)) if (Array.isArray(v)) counts[name] = v.length;
  return { ...lists, counts };
}

export function reportsApi(ctx: FacadeContext) {
  const { owners, splits, sources, publishing, modules, balanceWithFiles } = ctx;
  const api = {
    /** Completeness check; A is also compared with the totals stored when each file was loaded. */
    async reconciliation(f: PeriodFilter = {}) {
      return reconciliationFrom(ctx, await calculate(modules), f);
    },

    /** The owner balance from the units of the owner's reach (D-163, D-164). */
    async ownerBalance(ownerId: string, f: PeriodFilter = {}) {
      return (await balanceWithFiles(ownerId, f)).balance;
    },

    /** The reach of an owner (D-163): its pseudonyms and the ISRCs their money can come from. */
    async ownerReach(ownerId: string) {
      return ownerReach(modules, await owners.resolveOwnerId(ownerId));
    },

    /**
     * Signals for managers: pairs not in module 1 (with money), ISRCs without split, ambiguous writers; and from the
     * layers (D-127): shortfalls of carves (`unfunded`), unmapped label strings with their net, tracks with a note,
     * participations whose recipient has no owner, money under assumptions grouped by document.
     */
    async signals(f: PeriodFilter = {}) {
      return signalsFrom(ctx, await calculate(modules), f);
    },

    /** Everything on the overview page from ONE calculation (17 N1). */
    async overview(f: PeriodFilter = {}) {
      const calc = await calculate(modules, await ctx.opDocIds());
      const [reconciliation, sg, statements, ownerList] = await Promise.all([
        reconciliationFrom(ctx, calc, f),
        signalsFrom(ctx, calc, f),
        publishing.listStatements(),
        owners.listOwners(),
      ]);
      const queue = cQueue(calc, f, {}, { ownerNames: new Map(ownerList.map((o) => [o.id, o.name])) });
      return {
        calculatedAt: new Date().toISOString(),
        reconciliation,
        totals: overviewTotals(reconciliation),
        queue: queue.summary,
        signals: Object.entries(sg.counts).map(([name, count]) => ({ name, count })),
        files: { believe: calc.believeFiles.length, b17: statements.length },
      };
    },

    /** One reason of the C queue, grouped by what the operator fixes (17 N3). */
    async queue(reason: CReason, f: PeriodFilter = {}, o: Omit<QueueOptions, 'reason'> = {}) {
      // the groups hold only the items of the period: the units outside it are not read (D-161)
      const calc = await calculate(scoped(modules, periodScope(f)), await ctx.opDocIds());
      const ownerList = await owners.listOwners();
      const { groups } = cQueue(
        calc,
        f,
        { ...o, reason },
        { ownerNames: new Map(ownerList.map((x) => [x.id, x.name])) },
      );
      return { calculatedAt: new Date().toISOString(), groups };
    },

    /**
     * Explains one ISRC: split periods, participations, units with their allocations and the state after every
     * layer (10 §6), platform/country breakdown.
     */
    async explainTrack(isrcRaw: string) {
      const isrc = assertIsrc(isrcRaw);
      const calc = await calculate(scoped(modules, { isrcs: [isrc], publishingLines: false }), [], { traceIsrc: isrc });
      const units = calc.units
        .filter((u) => u.isrc === isrc)
        .map(({ layers, ...u }) => ({
          ...u,
          layers: (layers ?? []).map(({ layer, state }) => ({
            layer,
            status: state.status,
            ourLabelId: state.ourLabelId,
            ourLabelName: state.ourLabelName,
            rule: state.rule,
            scaledNet: state.scaledNet,
            labelShare: state.labelShare,
            labelShareCategory: state.labelShareCategory,
            allocations: state.rows,
            shortfalls: state.shortfalls,
          })),
        }));
      return {
        isrc,
        splits: await splits.listSplits({ isrc }),
        participations: await splits.listParticipations({ isrc }),
        units,
        breakdown: await sources.breakdown(isrc),
      };
    },
  };
  return api;
}
