import { monthOf } from '../shared/dates';
import type { CutView, OperationView } from '../modules/settlements';
import type { Calculation, PeriodFilter } from './calculation';

// The cut `asOf` (D-173 §3.3): the inputs of `ownerBalance()` as of the end of a month, made from ONE full calculation.
// Nothing is stored and `calculate()` never sees the date: the units of report months ≤ asOf, the publishing lines of
// report months ≤ asOf, the advertising of months ≤ asOf, the operations (payouts, positions, forgivenesses) dated
// ≤ the last day of the month. Document statuses stay those of now (О4). `balance.ts` is not touched: it gets the
// cut calculation and the cut operations.

/** The calculation as of the end of `asOf` (YYYY-MM); `undefined` = the calculation itself. */
export function cutCalculation(calc: Calculation, asOf: string | undefined): Calculation {
  if (asOf === undefined) return calc;
  return {
    ...calc,
    units: calc.units.filter((u) => u.reportingMonth <= asOf),
    publishing: calc.publishing.filter((p) => p.reportMonth <= asOf),
    ads: calc.ads.filter((a) => a.month <= asOf),
    adPositions: new Map([...calc.adPositions].map(([owner, list]) => [owner, list.filter((a) => a.adMonth <= asOf)])),
  };
}

/** The operations dated ≤ the last day of `asOf`. */
export function cutOperations<T extends Pick<OperationView, 'date'>>(ops: T[], asOf: string | undefined): T[] {
  return asOf === undefined ? ops : ops.filter((o) => monthOf(o.date) <= asOf);
}

/** `PeriodFilter.to = min(to, asOf)`. */
export function cutFilter(f: PeriodFilter, asOf: string | undefined): PeriodFilter {
  if (asOf === undefined) return f;
  return { ...f, to: f.to !== undefined && f.to < asOf ? f.to : asOf };
}

/**
 * The bounds of a cut (D-198): every `*To` is the first day of the first month no longer inside (a month m is inside
 * when m < the month of the bound); `date` is the moment, `cutDateOf` the date of the cut an operation is attributed to.
 */
export interface CutBounds {
  masterTo: string;
  publishingTo: string;
  adsTo: string;
  date: string;
  cutDateOf: (cutId: string) => string | undefined;
}

/** The calculation as of a cut: Believe units, publishing lines (their quarter's last month) and ads before the bounds. */
export function cutCalculationBy(calc: Calculation, b: CutBounds): Calculation {
  const [master, pub, ads] = [b.masterTo.slice(0, 7), b.publishingTo.slice(0, 7), b.adsTo.slice(0, 7)];
  return {
    ...calc,
    units: calc.units.filter((u) => u.reportingMonth < master),
    publishing: calc.publishing.filter((p) => p.reportMonth < pub),
    ads: calc.ads.filter((a) => a.month < ads),
    adPositions: new Map([...calc.adPositions].map(([owner, list]) => [owner, list.filter((a) => a.adMonth < ads)])),
  };
}

/**
 * The operations of a cut: one attributed to a cut is inside when that cut is not later than this one, whatever its
 * date; any other when it is dated up to the cut's day.
 */
export function cutOperationsBy<T extends Pick<OperationView, 'date' | 'cutId'>>(ops: T[], b: CutBounds): T[] {
  return ops.filter((o) => {
    const attributed = o.cutId ? b.cutDateOf(o.cutId) : undefined;
    return attributed !== undefined ? attributed <= b.date : o.date.slice(0, 10) <= b.date;
  });
}

/** The bounds of a cut (D-198) with the dates of every cut of its label (an operation attributed to a cut is inside this one when that cut is not later). */
export function cutBoundsOf(cut: CutView, cuts: readonly CutView[]): CutBounds {
  const dates = new Map(cuts.map((c) => [c.id, c.cutDate]));
  return { masterTo: cut.masterTo, publishingTo: cut.publishingTo, adsTo: cut.adsTo, date: cut.cutDate, cutDateOf: (id) => dates.get(id) };
}
