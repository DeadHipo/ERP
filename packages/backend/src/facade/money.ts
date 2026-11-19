import { ZERO } from '../shared/money';
import { assertIsrc } from '../shared/identifiers';
import { assertMonth, inMonthRange } from '../shared/dates';
import type { UnitResult } from './calculation';
import type { FacadeContext } from './context';
import { groupBy, sortedMonths, sumUnits, type Sums } from './aggregates';

// The master money as rows (D-247): one answer for the screens that used to read the money of a release
// (`release().tracks` / `.months`, which left that answer with D-257) and of a list of ISRCs (`trackSummary().items`). Nothing is decided here: the units
// are those of the same scoped calculation the old answers ran, a row is `sumUnits` of the units of its key (so the
// C side is the same `cItems`), and no amount is multiplied or rounded. The rights are `can()` by `?label=` (no viewer).

/** B, C (by reason), ours and net of a row: the very `Sums` of the money aggregates. */
export type MoneySums = Sums;

export type MasterScope = { kind: 'release'; upc: string } | { kind: 'isrcs'; isrcs?: string[] };
export type MasterGrain = 'isrc' | 'month' | 'isrc,month';

export interface MasterQuery {
  scope: MasterScope;
  grain: MasterGrain;
  /** Report months, inclusive; an open bound is not a limit. */
  period?: { from?: string; to?: string };
}

export interface MasterRow {
  isrc?: string;
  month?: string;
  sums: MoneySums;
  /** The report months of the units of the row (metadata, not money): only at the grain `isrc`. */
  months?: { from: string; to: string; count: number };
}

const noSums = (): MoneySums => ({ net: ZERO, B: ZERO, C: ZERO, ours: ZERO, cByReason: {} });

/** The key of a unit at a grain; an ISRC has no `|`, so the pair key sorts by ISRC, then by month. */
const keyOf: Record<MasterGrain, (u: UnitResult) => string> = {
  isrc: (u) => u.isrc,
  month: (u) => u.reportingMonth,
  'isrc,month': (u) => `${u.isrc}|${u.reportingMonth}`,
};

export function moneyApi(ctx: FacadeContext) {
  const { labelContext, calcScoped } = ctx;

  return {
    /**
     * The master money of a release or of a list of ISRCs, grouped by ISRC, by report month or by both (D-247).
     * Under a label: the units of its files only (its book, D-169) and, for a list, the ISRCs visible under it.
     * `isrcs` not given = every ISRC of the scope; `isrcs: []` = nothing, without a calculation. Rows are sorted by
     * their keys; a key without units has no row.
     */
    async masterRows(q: MasterQuery, label?: string): Promise<{ rows: MasterRow[]; totals: MoneySums; calculatedAt: string }> {
      const from = q.period?.from === undefined ? undefined : assertMonth(q.period.from);
      const to = q.period?.to === undefined ? undefined : assertMonth(q.period.to);
      const period = {
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(from !== undefined || to !== undefined ? { basis: 'report' as const } : {}),
      };
      const lc = await labelContext(label);
      const book = lc ? { labelIds: [lc.book.id] } : {};
      // the filters below repeat the scope of the read, so the answer is the same on the full calculation
      const picked = (u: UnitResult) => u.isrc !== '' && inMonthRange(u.reportingMonth, from, to);

      let units: UnitResult[];
      let calc: Awaited<ReturnType<typeof calcScoped>>;
      if (q.scope.kind === 'release') {
        // the units of a release: the lines of the UPC with an ISRC (the card `release()` lists the same ISRCs, D-257)
        const upc = q.scope.upc;
        calc = await calcScoped({ upcs: [upc], ...book, ...period, publishingLines: false });
        units = calc.units.filter((u) => u.upc === upc && picked(u));
      } else {
        // the units of `trackSummary({ isrcs, label })`: the list asked (checked, unique, sorted), under a label only
        // the ISRCs of its files
        const asked = q.scope.isrcs === undefined ? undefined : [...new Set(q.scope.isrcs.map(assertIsrc))].sort();
        const only = lc ? (asked ?? [...lc.visible.isrcs].sort()).filter((i) => lc.visible.isrcs.has(i)) : asked;
        if (only !== undefined && only.length === 0) return { rows: [], totals: noSums(), calculatedAt: new Date().toISOString() };
        calc = await calcScoped({ ...(only ? { isrcs: only } : {}), ...book, ...period, publishingLines: false });
        const onlySet = only ? new Set(only) : undefined;
        units = calc.units.filter((u) => picked(u) && (onlySet === undefined || onlySet.has(u.isrc)));
      }

      const { grain } = q;
      const rows = [...groupBy(units, keyOf[grain]).entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, us]): MasterRow => {
          const first = us[0] as UnitResult;
          const ms = sortedMonths(us);
          return {
            ...(grain !== 'month' ? { isrc: first.isrc } : {}),
            ...(grain !== 'isrc' ? { month: first.reportingMonth } : {}),
            sums: sumUnits(calc, us),
            ...(grain === 'isrc' ? { months: { from: ms[0] as string, to: ms.at(-1) as string, count: ms.length } } : {}),
          };
        });
      return { rows, totals: sumUnits(calc, units), calculatedAt: new Date().toISOString() };
    },
  };
}
