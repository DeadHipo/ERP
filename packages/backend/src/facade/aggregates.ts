import { Decimal, ZERO } from '../shared/money';
import { NotFoundError } from '../shared/errors';
import { assertIsrc } from '../shared/identifiers';
import { assertMonth } from '../shared/dates';
import type { CReason } from '@erp/shared/api-responses';
import { calculate, type Calculation, type UnitResult } from './calculation';
import { ownerBalance, ownerIndex } from './balance';
import { cItems } from './queue';
import type { FacadeContext } from './context';
import type { splitsApi } from './splits';

// Money aggregates for the screens (D-142, 17 N4..N13): every one is a view of ONE calculation, grouped in JS.
// Nothing here decides who gets what: the numbers are sums of the layers' own allocations, and the C side is the same
// `cItems` that `reconcile()` and the queue use, so the pages cannot drift from the reconciliation.

export interface Sums {
  net: Decimal;
  B: Decimal;
  C: Decimal;
  ours: Decimal;
  cByReason: Partial<Record<CReason, Decimal>>;
}

/** B, C (by reason), ours and net of a set of units of one calculation (publishing is not part of a track). */
export function sumUnits(calc: Calculation, units: UnitResult[]): Sums {
  const s: Sums = { net: ZERO, B: ZERO, C: ZERO, ours: ZERO, cByReason: {} };
  for (const u of units) {
    s.net = s.net.add(u.net);
    s.ours = s.ours.add(u.ours);
    for (const a of u.allocations) if (a.category === 'B') s.B = s.B.add(a.amount);
  }
  for (const it of cItems({ ...calc, units, publishing: [] })) {
    s.C = s.C.add(it.amount);
    s.cByReason[it.reason] = (s.cByReason[it.reason] ?? ZERO).add(it.amount);
  }
  return s;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const a = m.get(k);
    if (a) a.push(x);
    else m.set(k, [x]);
  }
  return m;
}

const sortedMonths = (units: UnitResult[]) => [...new Set(units.map((u) => u.reportingMonth))].sort();

export function aggregatesApi(ctx: FacadeContext, lists: ReturnType<typeof splitsApi>) {
  const { owners, splits, sources, settlements, modules, db, opDocIds, gateOf } = ctx;
  const calcWithOps = async () => calculate(modules, await opDocIds());
  const nameMaps = async () => {
    const attrs = await sources.pairAttributes();
    const byIsrc = new Map<string, { artistName: string; trackTitle: string }>();
    // deterministic: the first pair of an ISRC in key order
    for (const k of [...attrs.keys()].sort()) {
      const isrc = k.split('|')[0] as string;
      if (!byIsrc.has(isrc)) byIsrc.set(isrc, attrs.get(k) as { artistName: string; trackTitle: string });
    }
    return { attrs, byIsrc };
  };

  const api = {
    /**
     * The payables list (N4): one calculation, a per-owner index of the units and publishing lines, then the very
     * `ownerBalance()` per owner. `from` / `to` / `basis` shape `waitingBreakdown` only (the totals are all-time).
     */
    async ownerPayables(f: { from?: string; to?: string; basis?: 'report' | 'sales' } = {}) {
      const calc = await calcWithOps();
      const { list, ops } = await db.snapshot(async () => ({
        list: await owners.listOwners(),
        ops: await settlements.listOperations({}),
      }));
      const index = ownerIndex(calc);
      const opsOf = groupBy(
        ops.filter((o) => o.ownerId),
        (o) => o.ownerId as string,
      );
      const items = list.map((o) => {
        const b = ownerBalance(calc, o.id, opsOf.get(o.id) ?? [], f, index.get(o.id) ?? { units: [], publishing: [] });
        const payouts = (opsOf.get(o.id) ?? []).filter((x) => x.active && x.meaning === 'payout');
        return {
          ownerId: o.id,
          name: o.name,
          kind: o.kind,
          status: o.status,
          confirmed: b.confirmed,
          earned: b.total.earned,
          waiting: b.total.waiting,
          waitingBreakdown: b.period.waitingBreakdown,
          recouped: b.total.recouped,
          paid: b.total.paid,
          returns: b.total.returns,
          credits: b.total.credits,
          payable: b.total.payable,
          payableShown: b.total.payableShown,
          payableNegative: b.total.payableNegative,
          payout: gateOf(b),
          blockingPayouts: b.blockingPayouts.length,
          pendingOperations: b.pendingOperations.length,
          lastPayoutDate: payouts.reduce<string | null>((m, x) => (m === null || x.date > m ? x.date : m), null),
        };
      });
      return { calculatedAt: new Date().toISOString(), items };
    },

    /**
     * All tracks with their money (N5): the units of one calculation grouped by ISRC (optionally only one account
     * and one report month), joined with the tracks of module 1 and the names of the report. A track without money
     * shows zeros. Units without an ISRC are not tracks and are left out (they are on the signals page).
     */
    async trackSummary(f: { account?: string; month?: string } = {}) {
      const calc = await calcWithOps();
      const { tracks, splitList, partList } = await db.snapshot(async () => ({
        tracks: await owners.listTracks(),
        splitList: await splits.listSplits(),
        partList: await splits.listParticipations(),
      }));
      const { attrs, byIsrc } = await nameMaps();
      const units = calc.units.filter(
        (u) =>
          u.isrc !== '' &&
          (f.account === undefined || u.account === f.account) &&
          (f.month === undefined || u.reportingMonth === f.month),
      );
      const unitsOf = groupBy(units, (u) => u.isrc);
      const tracksOf = groupBy(
        tracks.filter((t) => t.isrc),
        (t) => t.isrc as string,
      );
      const withSplit = new Set(splitList.map((s) => s.isrc));
      const withParts = new Set(partList.map((p) => p.isrc));
      const isrcs = new Set([...unitsOf.keys(), ...tracksOf.keys()]);
      const items = [...isrcs].sort().map((isrc) => {
        const us = unitsOf.get(isrc) ?? [];
        const ts = tracksOf.get(isrc) ?? [];
        const ms = sortedMonths(us);
        const upcs = [...new Set([...us.map((u) => u.upc), ...ts.map((t) => t.upc).filter((x): x is string => !!x)])].sort();
        const names = upcs.map((u) => attrs.get(`${isrc}|${u}`)).find((x) => x) ?? byIsrc.get(isrc);
        return {
          isrc,
          upcs,
          title: ts[0]?.title ?? names?.trackTitle ?? '',
          artistName: names?.artistName ?? '',
          ...sumUnits(calc, us),
          months: { from: ms[0] ?? null, to: ms.at(-1) ?? null, count: ms.length },
          hasSplit: withSplit.has(isrc),
          hasParticipations: withParts.has(isrc),
        };
      });
      return { calculatedAt: new Date().toISOString(), items };
    },

    /**
     * The money of one ISRC by month with the state after every layer (N6; no breakdown, that is N7). The trace is
     * kept for this ISRC only, so it is cheap.
     */
    async trackMoney(isrcRaw: string) {
      const isrc = assertIsrc(isrcRaw);
      const calc = await calculate(modules, [], { traceIsrc: isrc });
      const [tracks, ownerList, splitList, partList] = await Promise.all([
        owners.listTracks(),
        owners.listOwners(),
        lists.listSplits({ isrc, limit: 5000 }),
        lists.listParticipations({ isrc }),
      ]);
      const { attrs } = await nameMaps();
      const ownerName = new Map(ownerList.map((o) => [o.id, o.name]));
      const units = calc.units.filter((u) => u.isrc === isrc);
      const mine = tracks.filter((t) => t.isrc === isrc);
      const named = [...attrs.entries()].filter(([k]) => k.startsWith(`${isrc}|`)).sort(([a], [b]) => (a < b ? -1 : 1))[0]?.[1];
      return {
        isrc,
        tracks: mine,
        title: mine[0]?.title ?? named?.trackTitle ?? '',
        artistName: named?.artistName ?? '',
        splits: splitList.items,
        participations: partList.items,
        totals: sumUnits(calc, units),
        months: units.map(({ layers, ...u }) => ({
          account: u.account,
          upc: u.upc,
          reportingMonth: u.reportingMonth,
          salesMonth: u.salesMonth,
          labelName: u.labelName,
          ourLabelName: u.ourLabelName,
          sublabelName: u.sublabelName,
          rule: u.ruleId,
          net: u.net,
          labelShare: u.labelShare,
          labelShareCategory: u.labelShareCategory,
          ours: u.ours,
          status: u.status,
          allocations: u.allocations.map((a) => ({
            ...a,
            pseudonym: calc.artistIndex.get(a.artistId)?.pseudonym ?? '?',
            ownerName: a.ownerId ? (ownerName.get(a.ownerId) ?? null) : null,
            documentStatus: calc.documentStatus(a.documentId),
          })),
          shortfalls: u.shortfalls,
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
        })),
      };
    },

    /** Platform and country rows of one report month of an ISRC, over the loaded files (N7); no calculation. */
    async trackBreakdown(isrcRaw: string, monthRaw: string) {
      const isrc = assertIsrc(isrcRaw);
      const month = assertMonth(monthRaw);
      return { isrc, month, rows: await sources.breakdown(isrc, month) };
    },

    /** Releases (N8): the tracks of module 1 grouped by UPC with the net of the loaded files; no calculation. */
    async releases(q?: string) {
      const [tracks, net, { attrs }] = await Promise.all([
        owners.listTracks(),
        sources.netByUpc(),
        nameMaps(),
      ]);
      const byUpc = groupBy(
        tracks.filter((t) => t.upc),
        (t) => t.upc as string,
      );
      // The first pair (smallest `isrc|upc` key) of every UPC in one pass: a scan of all pairs per UPC took 13 s (D-150).
      const firstKey = new Map<string, string>();
      for (const k of attrs.keys()) {
        const upc = k.slice(k.indexOf('|') + 1);
        const cur = firstKey.get(upc);
        if (cur === undefined || k < cur) firstKey.set(upc, k);
      }
      const firstPair = (upc: string) => {
        const k = firstKey.get(upc);
        return k ? attrs.get(k) : undefined;
      };
      const needle = q?.trim().toLowerCase();
      const items = [...byUpc.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([upc, ts]) => {
          const p = firstPair(upc);
          return {
            upc,
            title: p?.releaseTitle ?? '',
            artistName: p?.artistName ?? '',
            trackCount: ts.length,
            net: net.get(upc) ?? '0',
          };
        })
        .filter(
          (r) =>
            !needle ||
            r.upc.includes(needle) ||
            r.title.toLowerCase().includes(needle) ||
            r.artistName.toLowerCase().includes(needle),
        );
      return { items };
    },

    /** One release (N9): its tracks and report months with B, C and ours, from one calculation. */
    async release(upc: string) {
      const calc = await calcWithOps();
      const [tracks, { attrs }] = await Promise.all([owners.listTracks(), nameMaps()]);
      const mine = tracks.filter((t) => t.upc === upc);
      const units = calc.units.filter((u) => u.upc === upc && u.isrc !== '');
      if (mine.length === 0 && units.length === 0) throw new NotFoundError('Release', upc);
      const pair = [...attrs.entries()].filter(([k]) => k.endsWith(`|${upc}`)).sort(([a], [b]) => (a < b ? -1 : 1))[0]?.[1];
      const titleOf = new Map(mine.map((t) => [t.isrc, t.title]));
      const unitsOf = groupBy(units, (u) => u.isrc);
      const isrcs = new Set([...unitsOf.keys(), ...mine.map((t) => t.isrc).filter((x): x is string => !!x)]);
      return {
        upc,
        title: pair?.releaseTitle ?? '',
        artistName: pair?.artistName ?? '',
        tracks: [...isrcs].sort().map((isrc) => ({
          isrc,
          title: titleOf.get(isrc) ?? attrs.get(`${isrc}|${upc}`)?.trackTitle ?? '',
          ...sumUnits(calc, unitsOf.get(isrc) ?? []),
        })),
        months: [...groupBy(units, (u) => u.reportingMonth).entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([reportingMonth, us]) => ({ reportingMonth, ...sumUnits(calc, us) })),
      };
    },

    /**
     * Where a document is used and what waits for it (N13): the records that cite it, and the category C money that
     * cites it (allocations) or that its contracts would release (`owner_unconfirmed` of the contract owners).
     */
    async documentUses(documentId: string) {
      const calc = await calcWithOps();
      const { document, splitList, partList, labelList, ownerContracts, ops } = await db.snapshot(async () => {
        const document = await owners.getDocument(documentId);
        const ownerList = await owners.listOwners();
        const ids = document.ownerId ? [document.ownerId] : ownerList.map((o) => o.id);
        return {
          document,
          splitList: await lists.listSplits({ limit: 100000 }),
          partList: await lists.listParticipations(),
          labelList: await lists.listLabels(),
          ownerContracts: (
            await Promise.all(ids.map(async (id) => (await owners.contractsOfOwner(id)).map((c) => ({ ...c, ownerId: id }))))
          ).flat(),
          ops: await settlements.listOperations({}),
        };
      });
      const contracts = ownerContracts.filter((c) => c.documentId === documentId);
      const contractOwners = new Set(contracts.map((c) => c.ownerId));
      const waiting: Partial<Record<CReason, Decimal>> = {};
      let amount = ZERO;
      const add = (reason: CReason, v: Decimal) => {
        waiting[reason] = (waiting[reason] ?? ZERO).add(v);
        amount = amount.add(v);
      };
      for (const u of calc.units)
        for (const a of u.allocations) {
          if (a.category !== 'C') continue;
          if (
            a.documentId === documentId ||
            (a.reason === 'owner_unconfirmed' && a.ownerId && contractOwners.has(a.ownerId))
          )
            add(a.reason as CReason, a.amount);
        }
      for (const p of calc.publishing)
        if (p.category === 'C' && p.reason === 'owner_unconfirmed' && p.ownerId && contractOwners.has(p.ownerId))
          add('owner_unconfirmed', p.authorAmount);
      const splitsOf = splitList.items.filter((s) => s.documentId === documentId);
      return {
        document,
        splits: splitsOf,
        rowsOnly: splitList.items.flatMap((s) =>
          s.shares
            .filter((x) => x.documentId === documentId)
            .map((x) => ({ splitId: s.id, isrc: s.isrc, artistId: x.artistId })),
        ),
        participations: partList.items.filter((p) => p.documentId === documentId),
        labelRules: labelList.flatMap((l) => l.rules).filter((r) => r.documentId === documentId),
        contracts: contracts.map(({ ownerId: _o, ...c }) => c),
        operations: ops.filter((o) => o.documentId === documentId || o.paymentProofId === documentId),
        waiting: { amount, cByReason: waiting },
      };
    },
  };
  return api;
}
