/**
 * The duration of a recording (D-238), never money: milliseconds of the API shown as «m:ss» and read back from it. The
 * one place of the frontend that parses these digits (an eslint override allows `parseInt` here only).
 */
const MINUTE = 60000;
const SECOND = 1000;

/** 154000 → «2:34»; null → ''. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  const totalSeconds = (ms - (ms % SECOND)) / SECOND;
  const seconds = totalSeconds % 60;
  const minutes = (totalSeconds - seconds) / 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** «2:34» → 154000; '' → null; anything else → undefined (not a duration). */
export function parseDuration(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (!m) return undefined;
  const ms = parseInt(m[1] as string, 10) * MINUTE + parseInt(m[2] as string, 10) * SECOND;
  return ms > 0 ? ms : undefined;
}
