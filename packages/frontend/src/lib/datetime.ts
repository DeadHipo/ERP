/** `DD.MM.YYYY HH:mm` in the browser's time zone, from an ISO timestamp of the API (the audit, «Расчёт»). */
const parts = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (date.toString() === 'Invalid Date') return iso;
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

/**
 * A time without a zone as the source gave it (D-195: the release time of an export, `YYYY-MM-DDTHH:MM:SS`):
 * `DD.MM.YYYY HH:mm`, never moved to the browser's zone; a midnight is the day alone.
 */
export function formatLocalDateTime(value: string | null): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return value;
  const day = `${m[3] as string}.${m[2] as string}.${m[1] as string}`;
  return m[4] === undefined || (m[4] === '00' && m[5] === '00') ? day : `${day} ${m[4]}:${m[5] as string}`;
}
