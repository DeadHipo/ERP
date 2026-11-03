/**
 * Integer cents of an operation (`amountCents`) as a decimal string for `Money`, by string slicing only (R1: no
 * division, no float): `500` -> `5.00`, `-5500` -> `-55.00`, `7` -> `0.07`, `0` -> `0.00`.
 */
export function centsToText(cents: number): string {
  const text = String(cents);
  const negative = text.startsWith('-');
  const digits = (negative ? text.slice(1) : text).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
