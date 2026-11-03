/**
 * The only place that formats money (R1). The API sends exact decimal strings; Intl.NumberFormat (ES2023, number
 * format v3) accepts such a string and rounds it as a decimal, so no float is ever involved.
 * Examples: '4.165' -> '4,17', '999.995' -> '1 000,00', '-0.004' -> '0,00' (no sign), '-21.25' -> '-21,25'.
 */
const formatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  roundingMode: 'halfExpand',
  signDisplay: 'negative',
});

export function formatMoney(decimal: string): string {
  return formatter.format(decimal as Intl.StringNumericLiteral);
}

/** True when the formatted text carries a minus (so a value that rounds to zero is never red). */
export function isNegativeText(formatted: string): boolean {
  return formatted.startsWith('-') || formatted.startsWith('−');
}

/** A count (lines, rows) with the Russian thousands separator: `3601199` -> `3 601 199`. Not money. */
const countFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export function formatCount(count: number): string {
  return countFormatter.format(count);
}

/** Sign, integer digits without leading zeros, fraction digits without trailing zeros of a decimal string. */
function decimalParts(text: string): { negative: boolean; int: string; frac: string } {
  const trimmed = text.trim();
  const negative = trimmed.startsWith('-');
  const body = negative || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  const [rawInt = '', rawFrac = ''] = body.split('.');
  const int = rawInt.replace(/^0+/, '');
  const frac = rawFrac.replace(/0+$/, '');
  // "-0", "-0.000" are zero: never negative.
  return { negative: negative && (int !== '' || frac !== ''), int, frac };
}

/** Compares two non-negative digit strings by magnitude: integer length, then the integer digits, then the fraction. */
function compareMagnitude(a: { int: string; frac: string }, b: { int: string; frac: string }): -1 | 0 | 1 {
  if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -1 : 1;
  if (a.int !== b.int) return a.int < b.int ? -1 : 1;
  const width = a.frac.length > b.frac.length ? a.frac.length : b.frac.length;
  const fa = a.frac.padEnd(width, '0');
  const fb = b.frac.padEnd(width, '0');
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

/**
 * The order of two money values sent as decimal strings, as text (R1: no number is ever made): the sign first, then the
 * length of the integer part, then the digits. `null` / `undefined` / `''` sort before every value. The grid comparator
 * of every money column (`comparator: compareDecimal`).
 */
export function compareDecimal(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 {
  const emptyA = a === null || a === undefined || a.trim() === '';
  const emptyB = b === null || b === undefined || b.trim() === '';
  if (emptyA || emptyB) return emptyA && emptyB ? 0 : emptyA ? -1 : 1;
  const pa = decimalParts(a);
  const pb = decimalParts(b);
  if (pa.negative !== pb.negative) return pa.negative ? -1 : 1;
  const order = compareMagnitude(pa, pb);
  if (order === 0) return 0;
  // Two negatives: the larger magnitude is the smaller value.
  if (pa.negative) return order === 1 ? -1 : 1;
  return order;
}
