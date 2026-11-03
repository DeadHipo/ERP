import { inMonthRange } from '../shared/dates';

// Period predicates of the facade, a leaf module: `calculation.ts` and `queue.ts` both need them and must not import
// each other (D-150).

export type DateBasis = 'report' | 'sales';
export interface PeriodFilter {
  from?: string;
  to?: string;
  basis?: DateBasis;
}

export const unitInPeriod = (u: { reportingMonth: string; salesMonth: string }, f: PeriodFilter) =>
  inMonthRange((f.basis ?? 'report') === 'sales' ? u.salesMonth : u.reportingMonth, f.from, f.to);

/** Publishing has no sales date: both bases use the statement's report month (quarter end). */
export const pubInPeriod = (p: { reportMonth: string }, f: PeriodFilter) =>
  inMonthRange(p.reportMonth, f.from, f.to);
