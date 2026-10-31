import Decimal from 'decimal.js';
import { ValidationError } from './errors';

// Exact decimal arithmetic for money. Floats are never used for amounts.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

// JSON money is always a plain decimal string: never exponent notation ("1e-9") and never "-0".
Decimal.prototype.toJSON = function toJSON(this: Decimal): string {
  return this.isZero() ? '0' : this.toFixed();
};

export { Decimal };

/** Number of decimals kept for source amounts (Believe has up to 12). */
export const SOURCE_SCALE = 12;
const PICO = 10n ** BigInt(SOURCE_SCALE);

const DECIMAL_RE = /^[-+]?(\d+)(\.(\d+))?$/;

/**
 * Parses an exact decimal string into "pico-USD" (integer, 1e-12 USD) without rounding.
 * Exponent notation (seen in xlsx cells) is accepted through decimal.js.
 * Throws if the value has more than SOURCE_SCALE significant decimals.
 */
export function parsePico(raw: string): bigint {
  const s = raw.trim();
  if (s === '') throw new ValidationError('Empty amount');
  let normalized = s;
  if (!DECIMAL_RE.test(s)) {
    let d: Decimal;
    try {
      d = new Decimal(s);
    } catch {
      throw new ValidationError(`Not a decimal amount: "${raw}"`);
    }
    if (!d.isFinite()) throw new ValidationError(`Not a finite amount: "${raw}"`);
    normalized = d.toFixed();
  }
  const m = DECIMAL_RE.exec(normalized);
  if (!m) throw new ValidationError(`Not a decimal amount: "${raw}"`);
  const negative = normalized.startsWith('-');
  const intPart = m[1] ?? '0';
  const frac = m[3] ?? '';
  if (frac.length > SOURCE_SCALE && /[^0]/.test(frac.slice(SOURCE_SCALE))) {
    throw new ValidationError(`Amount has more than ${SOURCE_SCALE} decimals: "${raw}"`);
  }
  const fracPadded = (frac + '0'.repeat(SOURCE_SCALE)).slice(0, SOURCE_SCALE);
  const v = BigInt(intPart) * PICO + BigInt(fracPadded);
  return negative ? -v : v;
}

export function picoToDecimal(v: bigint | number): Decimal {
  return new Decimal(v.toString()).div(PICO.toString());
}

export function decimalToPico(d: Decimal): bigint {
  const scaled = d.mul(PICO.toString());
  if (!scaled.isInteger())
    throw new ValidationError(`Amount ${d.toFixed()} has more than ${SOURCE_SCALE} decimals`);
  return BigInt(scaled.toFixed(0));
}

export function picoToString(v: bigint | number): string {
  return picoToDecimal(v).toFixed();
}

/** Integer cents, used by settlement operations and payouts. */
export function centsToDecimal(cents: number): Decimal {
  return new Decimal(cents).div(100);
}

export function decimalToCents(d: Decimal): number {
  const scaled = d.mul(100);
  if (!scaled.isInteger()) throw new ValidationError(`Amount ${d.toFixed()} is not a whole number of cents`);
  return scaled.toNumber();
}

/** The only rounding in the system: forming a payout rounds DOWN to cents, so we never overpay. */
export function floorToCents(d: Decimal): number {
  return d.mul(100).toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber();
}

/** Parses a user-entered USD amount (exact decimal string). */
export function parseUsd(raw: string): Decimal {
  if (!DECIMAL_RE.test(raw.trim())) throw new ValidationError(`Not a decimal amount: "${raw}"`);
  return new Decimal(raw.trim());
}

/** Money as sent in JSON: an exact decimal string. */
export function money(d: Decimal): string {
  return d.toFixed();
}

export function sum(values: Iterable<Decimal>): Decimal {
  let acc = new Decimal(0);
  for (const v of values) acc = acc.add(v);
  return acc;
}

export const ZERO = new Decimal(0);
