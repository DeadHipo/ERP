import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/shared/money';
import { exactAfterEveryLayer, I1, run, unit, type PartSpec, type World } from './world';

// The seeded random exactness test of 10 §3 "Exactness" and 12 "Checks": 10,000 units, 6-decimal percents in every
// position, nets up to 1e5 with 12 decimals, rows and carves of every kind, signs and zeros. After every layer
// Σ allocations + label share = net exactly, and every amount has at most 12 decimals.

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

function generator(seed: number) {
  const r = prng(seed);
  const int = (n: number) => Math.floor(r() * n);
  /** a percent in [0, max] with 6 decimals */
  const percent = (max: number) => {
    const micro = int(max * 1_000_000 + 1);
    return `${Math.floor(micro / 1_000_000)}.${pad(micro % 1_000_000, 6)}`;
  };
  const net = () => {
    const k = int(10);
    if (k === 0) return '0';
    const sign = k <= 2 ? '-' : '';
    const whole = int(3) === 0 ? int(100) : int(100_000);
    return `${sign}${whole}.${pad(int(1_000_000), 6)}${pad(int(1_000_000), 6)}`;
  };
  const world = (): World => {
    const nRows = int(5);
    const shares: [string, string][] = [];
    for (let i = 0; i < nRows; i++) shares.push([`A${i}`, percent(100 / Math.max(nRows, 1))]);
    const parts: PartSpec[] = [];
    const nTop = int(3);
    const topMax = int(10) === 0 ? 80 : 30; // sometimes above 100 in total (data-side cap)
    for (let i = 0; i < nTop; i++) parts.push({ artist: `T${i}`, percent: percent(topMax), funded: 'top' });
    for (let i = 0, n = int(4); i < n; i++)
      parts.push({ artist: `M${i}`, percent: percent(int(4) === 0 ? 60 : 20), funded: 'artist_pool' });
    for (let i = 0, n = int(3); i < n; i++)
      parts.push({
        artist: `E${i}`,
        percent: percent(int(4) === 0 ? 90 : 30),
        funded: 'artist_share',
        from: `A${int(nRows + 1)}`, // sometimes a missing source row
      });
    for (let i = 0, n = int(4); i < n; i++)
      parts.push({
        artist: `P${i}`,
        percent: percent(int(4) === 0 ? 70 : 25),
        funded: 'label_share',
        base: int(2) === 0 ? 'net' : 'bucket',
      });
    return { splits: int(8) === 0 ? {} : { [I1]: [{ shares }] }, parts };
  };
  const label = () =>
    ['Test Label', 'NoGhost Records', 'Mystery Records', 'qaraqshy records', 'Echo8'][int(5)] as string;
  const shuffle = <T>(xs: T[]) => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  return { world, net, label, shuffle };
}

describe('exactness of the layer chain (10 §3)', () => {
  it('10,000 seeded random units: Σ allocations + label share = net after every layer, ≤ 12 decimals', () => {
    const g = generator(20261102);
    let failures = 0;
    let scaled = 0;
    const first: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const w = g.world();
      const n = g.net();
      const o = run(w, unit(n, { labelName: g.label() }));
      if (o.state.shortfalls.length) scaled++;
      const err = exactAfterEveryLayer(o, new Decimal(n));
      if (err) {
        failures++;
        if (first.length < 3) first.push(`${n}: ${err}`);
      }
      // every allocation has the sign of the unit (or is 0)
      for (const a of o.state.rows)
        if (
          !a.amount.isZero() &&
          !new Decimal(n).isZero() &&
          a.amount.isNegative() !== new Decimal(n).isNegative()
        ) {
          failures++;
          if (first.length < 3) first.push(`${n}: ${a.kind} ${a.amount.toFixed()} has the wrong sign`);
        }
    }
    expect(first).toEqual([]);
    expect(failures).toBe(0);
    expect(scaled).toBeGreaterThan(500); // the scale-downs and shortfalls are really exercised
  });

  it('a shuffled order of units and of participations gives identical results', () => {
    const g = generator(7);
    const cases = Array.from({ length: 500 }, () => ({ w: g.world(), n: g.net(), l: g.label() }));
    const key = (o: ReturnType<typeof run>) =>
      JSON.stringify([
        o.state.rows.map((r) => `${r.ruleId}|${r.artistId}|${r.amount.toFixed()}|${r.reason}`).sort(),
        o.state.labelShare.toFixed(),
        o.state.shortfalls.map((s) => `${s.ruleId}|${s.missing.toFixed()}`).sort(),
      ]);
    const straight = cases.map((c) => key(run(c.w, unit(c.n, { labelName: c.l }))));
    const order = g.shuffle(cases.map((_, i) => i));
    for (const i of order) {
      const c = cases[i] as (typeof cases)[number];
      // the same participations (same ids) in another order inside the list
      const parts = (c.w.parts ?? []).map((p, k) => ({ ...p, id: `part-${k}-${p.artist}` }));
      const w = { ...c.w, parts: g.shuffle(parts) };
      expect(key(run(w, unit(c.n, { labelName: c.l }))), `case ${i}`).toBe(straight[i]);
    }
  });
});
