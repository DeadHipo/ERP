import { monthOf } from '../shared/dates';
import type { OperationView } from '../modules/settlements';
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
