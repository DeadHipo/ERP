import { Decimal, ZERO } from '../shared/money';
import { inMonthRange } from '../shared/dates';
import { assertIsrc } from '../shared/identifiers';
import { calculate, reconcile, type PeriodFilter } from './calculation';
import type { FacadeContext } from './context';

export function reportsApi(ctx: FacadeContext) {
  const { splits, sources, publishing, modules, balanceWithFiles } = ctx;
  const api = {
    /** Completeness check; A is also compared with the totals stored when each file was loaded. */
    async reconciliation(f: PeriodFilter = {}) {
      const calc = await calculate(modules);
      const rows = reconcile(calc, f);
      const believeTotals = new Map<string, Decimal>();
      const loadedIds = new Set(calc.believeFiles.map((x) => x.id));
      for (const file of await sources.listFiles()) {
        // only the files this calculation was made from, with the totals stored when each was loaded
        if (file.status !== 'loaded' || !loadedIds.has(file.id) || file.netTotal === null) continue;
        believeTotals.set(
          file.reportingMonth,
          (believeTotals.get(file.reportingMonth) ?? ZERO).add(file.netTotal),
        );
      }
      // Alarm: our remainder has the opposite sign of the line (shares above 100); negative report lines alone are normal.
      const negativeRemainders = calc.units.filter(
        (u) => !u.net.isZero() && !u.ours.isZero() && u.ours.isNegative() !== u.net.isNegative(),
      ).length;
      return rows.map((r) => {
        const fileTotal =
          r.source === 'believe' && (f.basis ?? 'report') === 'report'
            ? (believeTotals.get(r.month) ?? null)
            : null;
        return {
          ...r,
          fileTotal,
          fileDiscrepancy: fileTotal ? r.A_received.sub(fileTotal) : null,
          negativeRemainders: r.source === 'believe' ? negativeRemainders : 0,
        };
      });
    },

    async ownerBalance(ownerId: string, f: PeriodFilter = {}) {
      return (await balanceWithFiles(ownerId, f)).balance;
    },

    /** Signals for managers: pairs not in module 1 (with money), ISRCs without split, ambiguous writers. */
    async signals(f: PeriodFilter = {}) {
      const calc = await calculate(modules);
      const attrs = await sources.pairAttributes();
      const unknown = new Map<string, { isrc: string; upc: string; net: Decimal; months: Set<string> }>();
      const noSplit = new Map<string, Decimal>();
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
        } else if (u.status === 'no_split') noSplit.set(u.isrc, (noSplit.get(u.isrc) ?? ZERO).add(u.net));
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
      return {
        unallocated: {
          total: unknownPairs.reduce((s, p) => s.add(p.net), ZERO),
          withoutIsrc: noIsrc,
          pairs: unknownPairs,
        },
        isrcsWithoutSplit: [...noSplit.entries()]
          .map(([isrc, net]) => ({ isrc, net }))
          .sort((a, b) => b.net.cmp(a.net)),
        ambiguousWriters: publishing.listWriters().filter((w) => w.resolution === 'ambiguous'),
      };
    },

    /** Explains one ISRC: split periods, units with allocations, platform/country breakdown. */
    async explainTrack(isrcRaw: string) {
      const isrc = assertIsrc(isrcRaw);
      const calc = await calculate(modules);
      const units = calc.units.filter((u) => u.isrc === isrc);
      return { isrc, splits: splits.listSplits({ isrc }), units, breakdown: await sources.breakdown(isrc) };
    },
  };
  return api;
}
