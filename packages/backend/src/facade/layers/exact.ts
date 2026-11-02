import { Decimal, ZERO } from '../../shared/money';

/** Decimals of every allocation amount: pico-USD, the precision of the source amounts (10 §3 "Exactness"). */
export const SCALE = 12;

/** Quantises an amount right after its multiplication: 12 decimals, half up. */
export const q = (d: Decimal): Decimal => d.toDecimalPlaces(SCALE, Decimal.ROUND_HALF_UP);

/** `amount × percent / 100`, quantised. */
export const pct = (amount: Decimal, percent: Decimal): Decimal => q(amount.mul(percent).div(100));

export const sumOf = (xs: Iterable<Decimal>): Decimal => {
  let s = ZERO;
  for (const x of xs) s = s.add(x);
  return s;
};

/**
 * Distributes `total` over items pro rata to their weights: each share is quantised, and the residue
 * (total − Σ shares) goes to the item with the largest absolute weight (a tie: the first by key). So the shares sum
 * to `total` exactly. A zero sum of weights gives zero shares (the caller records a shortfall when needed).
 */
export function distribute(total: Decimal, items: { key: string; weight: Decimal }[]): Decimal[] {
  const w = sumOf(items.map((i) => i.weight));
  if (items.length === 0 || w.isZero()) return items.map(() => ZERO);
  const shares = items.map((i) => q(total.mul(i.weight).div(w)));
  const residue = total.sub(sumOf(shares));
  if (!residue.isZero()) {
    let best = 0;
    for (let k = 1; k < items.length; k++) {
      const a = (items[k] as { weight: Decimal; key: string }).weight.abs();
      const b = (items[best] as { weight: Decimal; key: string }).weight.abs();
      const c = a.cmp(b);
      if (c > 0 || (c === 0 && (items[k] as { key: string }).key < (items[best] as { key: string }).key))
        best = k;
    }
    shares[best] = (shares[best] as Decimal).add(residue);
  }
  return shares;
}

/** True when `available` can fund `want` in full: same sign (or zero want) and |want| ≤ |available|. */
export function fits(want: Decimal, available: Decimal): boolean {
  if (want.isZero()) return true;
  if (available.isZero() || available.isNegative() !== want.isNegative()) return false;
  return want.abs().lte(available.abs());
}

/** What of `available` can be used for a want of this sign: the bucket itself, or 0 when the signs differ. */
export const usable = (want: Decimal, available: Decimal): Decimal =>
  available.isZero() || want.isZero() || available.isNegative() === want.isNegative() ? available : ZERO;
