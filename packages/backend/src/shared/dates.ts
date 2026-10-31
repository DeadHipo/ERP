import { ValidationError } from './errors';

/** Month as 'YYYY-MM'; a day as ISO 'YYYY-MM-DD'. All dates are ISO text (portable to PostgreSQL). */
export type Month = string;
export type IsoDate = string;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function assertMonth(m: string): Month {
  if (!MONTH_RE.test(m)) throw new ValidationError(`Invalid month "${m}", expected YYYY-MM`);
  return m;
}

/** The date exists in the calendar (Date.parse silently rolls 2024-02-30 forward to March). */
const realDay = (d: string) =>
  !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;

export function assertDate(d: string): IsoDate {
  if (!DATE_RE.test(d) || !realDay(d)) {
    throw new ValidationError(`Invalid date "${d}", expected YYYY-MM-DD`);
  }
  return d;
}

/** The report date of a monthly report is the first day of its reporting month. */
export const monthStart = (m: Month): IsoDate => `${m}-01`;

export const monthOf = (d: IsoDate): Month => d.slice(0, 7);

/** Quarter 'YYYY-Qn' -> its last month (publishing statements are dated by the quarter end month). */
export function quarterEndMonth(q: string): Month {
  const m = /^(\d{4})-Q([1-4])$/.exec(q);
  if (!m) throw new ValidationError(`Invalid quarter "${q}", expected YYYY-Qn`);
  return `${m[1]}-${String(Number(m[2]) * 3).padStart(2, '0')}`;
}

export const nowIso = (): string => new Date().toISOString();
export const todayIso = (): IsoDate => nowIso().slice(0, 10);

/** Inclusive month range filter; undefined bounds are open. */
export function inMonthRange(m: Month, from?: Month, to?: Month): boolean {
  return (from === undefined || m >= from) && (to === undefined || m <= to);
}

/**
 * A timestamp given by a user (e.g. report generation date): an ISO date, or an ISO date-time WITH a zone (Z or an
 * offset), so the stored UTC value does not depend on the server's timezone. Stored as ISO UTC.
 */
export function normalizeTimestamp(raw: string): string {
  const s = raw.trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/.exec(s);
  if (!m || !realDay(m[1] as string) || Number.isNaN(Date.parse(s))) {
    throw new ValidationError(
      `Invalid date "${raw}", expected YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ (with a zone)`,
    );
  }
  return new Date(s.length === 10 ? s + 'T00:00:00Z' : s).toISOString();
}
