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
