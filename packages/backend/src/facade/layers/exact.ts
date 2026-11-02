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

/** Order of the indices by absolute amount, largest first (a tie: the first by key). */
function byLargest(amounts: Decimal[], keys: string[]): number[] {
  return amounts
    .map((_, i) => i)
    .sort((x, y) => {
      const c = (amounts[y] as Decimal).abs().cmp((amounts[x] as Decimal).abs());
      if (c !== 0) return c;
      const kx = keys[x] as string;
      const ky = keys[y] as string;
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });
}

/**
 * Sign-safe residue (D-130): amounts of the sign of `base` are taken from it, and each is quantised half up, so
 * when their percents sum to exactly 100 their total can exceed the base by a few pico. Then the excess is taken
 * off the largest absolute amount (a tie: the first by key; if that is not enough, the next), so the remainder
 * `base − Σ` is zero or of the sign of the base and no amount changes its sign.
 */
export function capToBase(base: Decimal, amounts: Decimal[], keys: string[]): Decimal[] {
  const rest = base.sub(sumOf(amounts));
  if (rest.isZero() || (!base.isZero() && rest.isNegative() === base.isNegative())) return amounts;
  const out = [...amounts];
  let excess = rest.neg(); // what must come off, of the sign of the amounts
  for (const i of byLargest(out, keys)) {
    if (excess.isZero()) break;
    const a = out[i] as Decimal;
    if (a.isZero() || a.isNegative() !== excess.isNegative()) continue;
    const take = a.abs().lt(excess.abs()) ? a : excess;
    out[i] = a.sub(take);
    excess = excess.sub(take);
  }
  return out;
}

/**
 * `distribute` with a cap per item (D-130): no share exceeds its cap in absolute value (the caps have the sign of
 * the total and sum to at least it). A share above its cap after the residue gives the overflow to the item with
 * the largest room left (a tie: the first by key).
 */
export function distributeCapped(
  total: Decimal,
  items: { key: string; weight: Decimal }[],
  caps: Decimal[],
): Decimal[] {
  const shares = distribute(total, items);
  const keys = items.map((i) => i.key);
  let overflow = ZERO;
  shares.forEach((sh, i) => {
    const cap = caps[i] as Decimal;
    if (sh.abs().gt(cap.abs()) && (cap.isZero() || cap.isNegative() === sh.isNegative())) {
      overflow = overflow.add(sh.sub(cap));
      shares[i] = cap;
    }
  });
  while (!overflow.isZero()) {
    const room = shares.map((sh, i) => (caps[i] as Decimal).sub(sh));
    const fit = byLargest(room, keys).find(
      (i) => !(room[i] as Decimal).isZero() && (room[i] as Decimal).isNegative() === overflow.isNegative(),
    );
    // The caps cannot hold the total (not the case for a pool, which is funded within its rows): Σ stays exact.
    const to = fit ?? (byLargest(shares, keys)[0] as number);
    const r = room[to] as Decimal;
    const take = fit === undefined || overflow.abs().lte(r.abs()) ? overflow : r;
    shares[to] = (shares[to] as Decimal).add(take);
    overflow = overflow.sub(take);
  }
  return shares;
}
