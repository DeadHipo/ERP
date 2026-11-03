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
