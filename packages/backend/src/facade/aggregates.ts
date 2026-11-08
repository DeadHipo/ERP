import { Decimal, ZERO } from '../shared/money';
import { NotFoundError, ValidationError } from '../shared/errors';
import { assertIsrc } from '../shared/identifiers';
import { assertMonth } from '../shared/dates';
import type { CReason } from '@erp/shared/api-responses';
import { calculate, type Calculation, type UnitResult } from './calculation';
import { scoped, type UnitScope } from './scope';
import { registryRowOf } from './release-registry';
import { ownersReach } from './owner-scope';
import { artistsByIsrc, readArtistLinks, unionArtists } from './track-artists';

/**
 * The owner id list of `GET /owners/payables?ids=` (comma-separated). At most 200: UUIDs are long and the request line
 * must stay under the 16 KiB header limit of Node (a grid page of 500 asks in chunks).
 */
export const MAX_IDS_PER_REQUEST = 200;
export function parseIdList(raw: string): Set<string> {
  const list = raw.split(',').map((x) => x.trim()).filter((x) => x !== '');
  if (list.length > MAX_IDS_PER_REQUEST) throw new ValidationError(`ids: at most ${MAX_IDS_PER_REQUEST} ids per request`);
  return new Set(list);
}

/** The ISRC list of `GET /tracks/summary?isrcs=` (comma-separated, at most 500: the largest grid page). */
export function parseIsrcList(raw: string): string[] {
  const list = raw.split(',').map((x) => x.trim()).filter((x) => x !== '');
  if (list.length > 500) throw new ValidationError('isrcs: at most 500 ISRCs per request');
  return [...new Set(list.map(assertIsrc))].sort();
}
import { ownerBalance, ownerIndex, startsByOwner } from './balance';
import { admissionIndex, admissionOf, contractThresholds } from './admission';
import { cItems } from './queue';
import type { FacadeContext, PayoutArea } from './context';
import { cutCalculation, cutFilter, cutOperations } from './as-of';
import type { splitsApi } from './splits';
import { ALL_VIEWER, viewerHolds, viewerSees, type Viewer } from './viewer';

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
  const { owners, splits, sources, settlements, modules, db, opDocIds, gateOf, labelContext } = ctx;
  const calcWithOps = async () => calculate(modules, await opDocIds());
  /** The same calculation narrowed to a unit scope (D-161). */
  const calcScoped = async (scope: UnitScope) => calculate(scoped(modules, scope), await opDocIds());
  const nameMaps = async (filter: { isrcs?: string[]; upcs?: string[] } = {}) => {
    const attrs = await sources.pairAttributes(filter);
    const byIsrc = new Map<string, { artistName: string; trackTitle: string }>();
    // deterministic: the first pair of an ISRC in key order
    for (const k of [...attrs.keys()].sort()) {
      const isrc = k.split('|')[0] as string;
      if (!byIsrc.has(isrc)) byIsrc.set(isrc, attrs.get(k) as { artistName: string; trackTitle: string });
    }
    return { attrs, byIsrc };
  };
  /** The release registry rows by UPC (D-172, navigation): of one label or of every label, with the label name. */
  const registryByUpc = async (labelId: string | undefined, upcs?: string[]) => {
    const names = new Map((await ctx.labels.listLabels()).map((l) => [l.id, l.name]));
    const rows = await owners.releases.list({ ...(labelId === undefined ? {} : { labelId }), ...(upcs ? { upcs } : {}) });
    const out = new Map<string, ReturnType<typeof registryRowOf>[]>();
    for (const r of rows) {
      const list = out.get(r.upc) ?? out.set(r.upc, []).get(r.upc);
      list?.push(registryRowOf(r, names.get(r.labelId) ?? '?'));
    }
    return out;
  };
  /** One row per UPC: the label's, or under «Все» the last updated one (then the smaller label id). */
  const registryRows = async (labelId: string | undefined) =>
    new Map(
      [...(await registryByUpc(labelId)).entries()].map(([upc, rows]) => [
        upc,
        [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.labelId.localeCompare(b.labelId))[0],
      ]),
    );

  const api = {
    /**
     * The payables list (N4): one calculation, a per-owner index of the units and publishing lines, then the very
     * `ownerBalance()` per owner. `from` / `to` / `basis` shape `waitingBreakdown` only (the totals are all-time).
     */
    async ownerPayables(
      f: { from?: string; to?: string; basis?: 'report' | 'sales'; ids?: string; label?: string; asOf?: string; area?: PayoutArea } = {},
    ) {
      // D-173: `asOf` cuts the inputs of every balance (one calculation, `as-of.ts`); `area` changes only the gate (FIX-7)
      const { asOf, area } = f;
      const period = cutFilter({ from: f.from, to: f.to, basis: f.basis }, asOf);
      // `ids` (the visible rows of P9, D-163): only these owners, from a calculation of the units of their reach;
      // under a label (D-168): the owners visible under it, each balance projected to the label's book
      const only = f.ids === undefined ? undefined : parseIdList(f.ids);
      const lc = await labelContext(f.label);
      const view = lc ? { labelId: lc.book.id } : undefined;
      const { list, ops, startRows, admission } = await db.snapshot(async () => ({
        list: (await owners.listOwners()).filter((o) => (only === undefined || only.has(o.id)) && (!lc || lc.visible.ownerIds.has(o.id))),
        ops: await settlements.listOperations({}),
        startRows: await settlements.listOpeningBalances({ active: true }),
        // the admission (D-176): the payee, holds and answers of every owner, the contract thresholds under the label
        admission: await admissionIndex(settlements, contractThresholds(await owners.approvedContracts(), view?.labelId)),
      }));
      const calc = cutCalculation(
        only ? await calcScoped({ isrcs: (await ownersReach(modules, list.map((o) => o.id))).isrcs }) : await calcWithOps(),
        asOf,
      );
      const index = ownerIndex(calc);
      const startsOf = startsByOwner(calc, startRows);
      const opsOf = groupBy(
        cutOperations(ops, asOf).filter((o) => o.ownerId),
        (o) => o.ownerId as string,
      );
      const items = list.map((o) => {
        const b = ownerBalance(calc, o.id, opsOf.get(o.id) ?? [], period, { ...(index.get(o.id) ?? { units: [], publishing: [] }), starts: startsOf.get(o.id) ?? [] }, view);
        const payouts = (opsOf.get(o.id) ?? []).filter((x) => x.active && x.kind === 'payout' && (!view || x.labelId === view.labelId));
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
          buyouts: b.total.buyouts,
          forgiven: b.total.forgiven,
          writtenOff: b.total.writtenOff,
          adjustments: b.total.adjustments,
          start: b.total.start,
          startMissing: b.total.startMissing,
          payable: b.total.payable,
          payableShown: b.total.payableShown,
          payableNegative: b.total.payableNegative,
          payout: gateOf(b, area, admissionOf(admission.byOwner.get(o.id), { active: admission.active, thresholdCents: admission.thresholdOf(o.id), labelId: view?.labelId, operations: opsOf.get(o.id) ?? [] })),
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
    async trackSummary(f: { account?: string; month?: string; isrcs?: string; label?: string } = {}) {
      // one account and/or one report month, or a list of ISRCs (the visible rows of P5): only those units, splits,
      // tracks and names can appear in the answer, and the B17 side is not read (D-161, D-162); under a label the
      // units of its files and the ISRCs of those files (D-168, D-169)
      const lc = await labelContext(f.label);
      const asked = f.isrcs === undefined ? undefined : parseIsrcList(f.isrcs);
      const only = lc ? (asked ?? [...lc.visible.isrcs].sort()).filter((i) => lc.visible.isrcs.has(i)) : asked;
      const calc = await calcScoped({
        ...(f.account !== undefined ? { accounts: [f.account] } : {}),
        ...(f.month !== undefined ? { from: f.month, to: f.month, basis: 'report' as const } : {}),
        ...(only ? { isrcs: only } : {}),
        ...(lc ? { labelIds: [lc.book.id] } : {}),
        publishingLines: false,
      });
      const byIsrcs = only ? { isrcs: only } : {};
      const { tracks, splitList, partList, artistsOf } = await db.snapshot(async () => {
        const tracks = await owners.listTracks(byIsrcs);
        const splitList = await splits.listSplits(byIsrcs);
        const partList = await splits.listParticipations(byIsrcs);
        // the pseudonyms of every ISRC (D-166): the links of these tracks, the rows and participations above
        const { links, index } = await readArtistLinks(owners, tracks, only === undefined);
        return { tracks, splitList, partList, artistsOf: artistsByIsrc({ tracks, links, splits: splitList, participations: partList, index }) };
      });
      const { attrs, byIsrc } = await nameMaps(byIsrcs);
      const onlySet = only ? new Set(only) : undefined;
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
      // `only` is also a filter of the answer (not just of the read): the same rows with the scope switched off
      const isrcs = new Set([...unitsOf.keys(), ...tracksOf.keys()].filter((i) => onlySet === undefined || onlySet.has(i)));
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
          artists: artistsOf.get(isrc) ?? [],
          ...sumUnits(calc, us),
          months: { from: ms[0] ?? null, to: ms.at(-1) ?? null, count: ms.length },
          hasSplit: withSplit.has(isrc),
          hasParticipations: withParts.has(isrc),
        };
      });
      return { calculatedAt: new Date().toISOString(), items };
    },

    /**
     * The tracks without money (D-162, the first phase of P5): every ISRC that earns in the loaded files, is
     * registered, or has an open label-history interval (D-172), with its UPCs, names and whether it has a split or
     * participations. No calculation; the money of the visible rows comes from `trackSummary({ isrcs })`. The ISRC set
     * is the files' ISRCs (under a label: of its files) plus those of an open interval (under a label: of that label);
     * under «Все» an ISRC known only from an operator interval appears too. `catalog=current`: the open-interval ones
     * only. So it may hold ISRCs that `trackSummary()` does not (no units).
     */
    async trackCatalog(f: { label?: string; catalog?: 'all' | 'current' } = {}) {
      // under a label (D-168): the ISRCs of the label's files (D-169) and those whose open history interval is the
      // label's (D-172, К12); `catalog=current`: only the latter. A registered track without units is «Все» only
      const lc = await labelContext(f.label);
      const { tracks, splitList, partList, artistsOf, history, labelNames } = await db.snapshot(async () => {
        const tracks = await owners.listTracks();
        const splitList = await splits.listSplits();
        const partList = await splits.listParticipations();
        const { links, index } = await readArtistLinks(owners, tracks, true);
        // the catalog label now (D-172): navigation, the money of P5 stays by the files
        const history = await owners.trackLabels.list();
        const labelNames = new Map((await ctx.labels.listLabels()).map((l) => [l.id, l.name]));
        return { tracks, splitList, partList, artistsOf: artistsByIsrc({ tracks, links, splits: splitList, participations: partList, index }), history, labelNames };
      });
      const open = new Map(history.filter((h) => h.validTo === null).map((h) => [h.isrc, h]));
      const { attrs, byIsrc } = await nameMaps();
      const upcsOf = new Map<string, Set<string>>();
      for (const k of attrs.keys()) {
        const [isrc, upc] = k.split('|') as [string, string];
        if (isrc === '') continue;
        (upcsOf.get(isrc) ?? upcsOf.set(isrc, new Set()).get(isrc))?.add(upc);
      }
      const tracksOf = groupBy(
        tracks.filter((t) => t.isrc),
        (t) => t.isrc as string,
      );
      const withSplit = new Set(splitList.map((s) => s.isrc));
      const withParts = new Set(partList.map((p) => p.isrc));
      const current = (i: string) => {
        const h = open.get(i);
        return h !== undefined && (!lc || h.labelId === lc.book.id);
      };
      const isrcs = new Set(
        [...upcsOf.keys(), ...tracksOf.keys(), ...open.keys()].filter((i) =>
          f.catalog === 'current' ? current(i) : !lc || lc.visible.isrcs.has(i) || current(i),
        ),
      );
      const items = [...isrcs].sort().map((isrc) => {
        const ts = tracksOf.get(isrc) ?? [];
        const upcs = [...new Set([...(upcsOf.get(isrc) ?? []), ...ts.map((t) => t.upc).filter((x): x is string => !!x)])].sort();
        const names = upcs.map((u) => attrs.get(`${isrc}|${u}`)).find((x) => x) ?? byIsrc.get(isrc);
        return {
          isrc,
          upcs,
          title: ts[0]?.title ?? names?.trackTitle ?? '',
          artistName: names?.artistName ?? '',
          artists: artistsOf.get(isrc) ?? [],
          hasSplit: withSplit.has(isrc),
          hasParticipations: withParts.has(isrc),
          registered: ts.length > 0,
          catalogLabelId: open.get(isrc)?.labelId ?? null,
          catalogLabelName: open.has(isrc) ? (labelNames.get(open.get(isrc)?.labelId ?? '') ?? '?') : null,
          catalogFrom: open.get(isrc)?.validFrom ?? null,
        };
      });
      return { items };
    },

    /**
     * The money of one ISRC by month with the state after every layer (N6; no breakdown, that is N7). The trace is
     * kept for this ISRC only, so it is cheap.
     */
    async trackMoney(isrcRaw: string) {
      const isrc = assertIsrc(isrcRaw);
      const calc = await calculate(scoped(modules, { isrcs: [isrc], publishingLines: false }), [], { traceIsrc: isrc });
      const [tracks, ownerList, splitList, partList] = await Promise.all([
        owners.listTracks({ isrcs: [isrc] }),
        owners.listOwners(),
        lists.listSplits({ isrc, limit: 5000 }),
        lists.listParticipations({ isrc }),
      ]);
      const { attrs } = await nameMaps({ isrcs: [isrc] });
      const ownerName = new Map(ownerList.map((o) => [o.id, o.name]));
      const units = calc.units.filter((u) => u.isrc === isrc);
      const mine = tracks.filter((t) => t.isrc === isrc);
      const named = [...attrs.entries()].filter(([k]) => k.startsWith(`${isrc}|`)).sort(([a], [b]) => (a < b ? -1 : 1))[0]?.[1];
      const links = await owners.artistLinks({ trackIds: mine.map((t) => t.id) });
      const artistsOf = artistsByIsrc({ tracks: mine, links, splits: splitList.items, participations: partList.items, index: calc.artistIndex });
      return {
        isrc,
        tracks: mine,
        title: mine[0]?.title ?? named?.trackTitle ?? '',
        artistName: named?.artistName ?? '',
        artists: artistsOf.get(isrc) ?? [],
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
          bookLabelId: u.bookLabelId,
          bookLabelName: u.bookLabelName,
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
    async releases(q?: string, label?: string) {
      // under a label (D-168): the tracks of the label's ISRCs and the net of the label's units
      const lc = await labelContext(label);
      const [{ tracks, artistsOf, registry }, net, { attrs }] = await Promise.all([
        db.snapshot(async () => {
          const tracks = (await owners.listTracks()).filter((t) => !lc || (t.isrc !== null && lc.visible.isrcs.has(t.isrc)));
          // the pseudonyms of a UPC (D-166): those of its tracks (rows, participations, registry links)
          const [splitList, partList, { links, index }] = await Promise.all([
            splits.listSplits(),
            splits.listParticipations(),
            readArtistLinks(owners, tracks, true),
          ]);
          // the release registry (D-172, no money): of the label under a label, the last updated row of a UPC under «Все»
          const registry = await registryRows(lc?.book.id);
          return { tracks, artistsOf: artistsByIsrc({ tracks, links, splits: splitList, participations: partList, index }), registry };
        }),
        sources.netByUpc(lc ? { labelIds: [lc.book.id] } : {}),
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
            artists: unionArtists(artistsOf, ts.map((t) => t.isrc).filter((x): x is string => !!x)),
            trackCount: ts.length,
            net: net.get(upc) ?? '0',
            registered: registry.has(upc),
            registry: registry.get(upc) ?? null,
          };
        })
        .filter(
          (r) =>
            !needle ||
            r.upc.includes(needle) ||
            r.title.toLowerCase().includes(needle) ||
            r.artistName.toLowerCase().includes(needle) ||
            r.artists.some((a) => a.pseudonym.toLowerCase().includes(needle)),
        );
      return { items };
    },

    /** One release (N9): its tracks and report months with B, C and ours, from one calculation. */
    async release(upc: string, label?: string) {
      const lc = await labelContext(label);
      const calc = await calcScoped({ upcs: [upc], ...(lc ? { labelIds: [lc.book.id] } : {}), publishingLines: false });
      const [tracks, { attrs }] = await Promise.all([owners.listTracks(), nameMaps({ upcs: [upc] })]);
      const mine = tracks.filter((t) => t.upc === upc && (!lc || (t.isrc !== null && lc.visible.isrcs.has(t.isrc))));
      const units = calc.units.filter((u) => u.upc === upc && u.isrc !== '');
      // the release registry rows of the UPC (D-172, no money): under a label its row only
      const registry = (await registryByUpc(lc?.book.id, [upc])).get(upc) ?? [];
      if (mine.length === 0 && units.length === 0 && registry.length === 0) throw new NotFoundError('Release', upc);
      const pair = [...attrs.entries()].filter(([k]) => k.endsWith(`|${upc}`)).sort(([a], [b]) => (a < b ? -1 : 1))[0]?.[1];
      const titleOf = new Map(mine.map((t) => [t.isrc, t.title]));
      const unitsOf = groupBy(units, (u) => u.isrc);
      const isrcs = [...new Set([...unitsOf.keys(), ...mine.map((t) => t.isrc).filter((x): x is string => !!x)])].sort();
      // the pseudonyms of the tracks of the release (D-166): the rows, participations and registry links of its ISRCs
      const artistsOf = await db.snapshot(async () => {
        const [splitList, partList, links] = await Promise.all([
          splits.listSplits({ isrcs }),
          splits.listParticipations({ isrcs }),
          owners.artistLinks({ trackIds: mine.map((t) => t.id) }),
        ]);
        return artistsByIsrc({ tracks: mine, links, splits: splitList, participations: partList, index: calc.artistIndex });
      });
      return {
        upc,
        title: pair?.releaseTitle ?? '',
        artistName: pair?.artistName ?? '',
        artists: unionArtists(artistsOf, isrcs),
        tracks: isrcs.map((isrc) => ({
          isrc,
          title: titleOf.get(isrc) ?? attrs.get(`${isrc}|${upc}`)?.trackTitle ?? '',
          artists: artistsOf.get(isrc) ?? [],
          ...sumUnits(calc, unitsOf.get(isrc) ?? []),
        })),
        months: [...groupBy(units, (u) => u.reportingMonth).entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([reportingMonth, us]) => ({ reportingMonth, ...sumUnits(calc, us) })),
        registry,
      };
    },

    /**
     * Where a document is used and what waits for it (N13): the records that cite it, and the category C money that
     * cites it (allocations) or that its contracts would release (`owner_unconfirmed` of the contract owners).
     * A viewer of some labels (D-171): a document of its labels or of any label (else 404, as an unknown id); the
     * records listed are those of the ISRC rule and its operations; `waiting` stays the document's whole.
     */
    async documentUses(documentId: string, viewer: Viewer = ALL_VIEWER) {
      if (viewer.kind !== 'all' && !viewerSees(viewer, (await owners.getDocument(documentId)).labelId))
        throw new NotFoundError('Document', documentId);
      const mayTouch = await ctx.scopeOf(viewer).isrcFilter();
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
      const splitsOf = splitList.items.filter((s) => s.documentId === documentId && mayTouch(s.isrc));
      return {
        document,
        splits: splitsOf,
        rowsOnly: splitList.items.filter((s) => mayTouch(s.isrc)).flatMap((s) =>
          s.shares
            .filter((x) => x.documentId === documentId)
            .map((x) => ({ splitId: s.id, isrc: s.isrc, artistId: x.artistId })),
        ),
        participations: partList.items.filter((p) => p.documentId === documentId && mayTouch(p.isrc)),
        labelRules: labelList.flatMap((l) => l.rules).filter((r) => r.documentId === documentId),
        contracts: contracts.map(({ ownerId: _o, ...c }) => c),
        operations: ops.filter((o) => (o.documentId === documentId || o.paymentProofId === documentId) && viewerHolds(viewer, o.labelId)),
        waiting: { amount, cByReason: waiting },
      };
    },
  };
  return api;
}
