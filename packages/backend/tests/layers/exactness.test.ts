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

/**
 * Percents that sum to exactly 100 (D-130): cut points of 100 at 6 decimals, or thirds `33.333333 / 33.333333 /
 * 33.333334`, for the split rows and for the tops; nets with 12 decimals that end in 1 pico, so the half-up
 * rounding of every row goes the same way and the quantised rows exceed their base unless the residue is capped.
 */
function hundredGenerator(seed: number) {
  const r = prng(seed);
  const int = (n: number) => Math.floor(r() * n);
  const fmt = (micro: number) => `${Math.floor(micro / 1_000_000)}.${pad(micro % 1_000_000, 6)}`;
  const toHundred = (n: number): string[] => {
    if (n === 3 && int(2) === 0) return ['33.333333', '33.333333', '33.333334'];
    const cuts = Array.from({ length: n - 1 }, () => int(100_000_001)).sort((a, b) => a - b);
    const bounds = [0, ...cuts, 100_000_000];
    return bounds.slice(1).map((b, i) => fmt(b - (bounds[i] as number)));
  };
  const net = () => {
    const k = int(12);
    if (k === 0) return '0';
    if (k === 1) return int(2) === 0 ? '0.000000000001' : '-0.000000000001';
    const sign = k <= 4 ? '-' : '';
    const whole = int(3) === 0 ? int(100) : int(100_000);
    return `${sign}${whole}.${pad(int(1_000_000), 6)}${pad(int(100_000), 5)}1`;
  };
  const world = (): World => {
    const nRows = 1 + int(4);
    const rows = toHundred(nRows);
    const shares: [string, string][] = rows.map((p, i) => [`A${i}`, p]);
    const parts: PartSpec[] = [];
    const topMode = int(3); // 0: no tops, 1: tops summing to 100, 2: one ordinary top
    if (topMode === 1)
      toHundred(1 + int(3)).forEach((p, i) => parts.push({ artist: `T${i}`, percent: p, funded: 'top' }));
    if (topMode === 2) parts.push({ artist: 'T0', percent: '15', funded: 'top' });
    if (int(3) === 0) parts.push({ artist: 'M0', percent: '13', funded: 'artist_pool' });
    if (int(3) === 0)
      toHundred(1 + int(3)).forEach((p, i) =>
        parts.push({ artist: `E${i}`, percent: p, funded: 'artist_share', from: 'A0' }),
      );
    if (int(3) === 0)
      toHundred(1 + int(3)).forEach((p, i) =>
        parts.push({
          artist: `P${i}`,
          percent: p,
          funded: 'label_share',
          base: int(2) === 0 ? 'net' : 'bucket',
        }),
      );
    return { splits: { [I1]: [{ shares }] }, parts };
  };
  const label = () =>
    ['Test Label', 'NoGhost Records', 'NoGhost Records', 'qaraqshy records', 'Echo8'][int(5)] as string;
  return { world, net, label };
}

/** After every layer: the label share and the scaled net never have the opposite sign of the unit, no allocation
 * has it either, and a zero unit gives only zeros. */
function signSafe(o: ReturnType<typeof run>, net: Decimal): string | null {
  const wrong = (d: Decimal) =>
    net.isZero() ? !d.isZero() : !d.isZero() && d.isNegative() !== net.isNegative();
  for (const { layer, state } of o.states) {
    if (wrong(state.labelShare)) return `${layer}: label share ${state.labelShare.toFixed()}`;
    if (wrong(state.scaledNet)) return `${layer}: scaled net ${state.scaledNet.toFixed()}`;
    for (const a of state.rows)
      if (wrong(a.amount)) return `${layer}: ${a.kind} ${a.artistId} ${a.amount.toFixed()}`;
  }
  return null;
}

describe('exactness of the layer chain (10 §3)', () => {
  it('percents summing to exactly 100: identity, ≤ 12 decimals and the sign of the unit after every layer', () => {
    const g = hundredGenerator(20261103);
    const first: string[] = [];
    let failures = 0;
    for (let i = 0; i < 10_000; i++) {
      const w = g.world();
      const n = g.net();
      const o = run(w, unit(n, { labelName: g.label() }));
      const err = exactAfterEveryLayer(o, new Decimal(n)) ?? signSafe(o, new Decimal(n));
      if (err) {
        failures++;
        if (first.length < 3) first.push(`${n} ${JSON.stringify(w.splits?.[I1]?.[0]?.shares)}: ${err}`);
      }
    }
    expect(first).toEqual([]);
    expect(failures).toBe(0);
  });

  it('the minimal reproductions of the 1-pico sign error (stage 3 QA) stay sign-safe', () => {
    const cases: { w: World; n: string; label: string }[] = [
      {
        w: {
          splits: {
            [I1]: [
              {
                shares: [
                  ['A', '50'],
                  ['B', '50'],
                ],
              },
            ],
          },
        },
        n: '10.000000000001',
        label: 'Test Label',
      },
      {
        w: {
          splits: {
            [I1]: [
              {
                shares: [
                  ['A', '50'],
                  ['B', '50'],
                ],
              },
            ],
          },
        },
        n: '10.000000000001',
        label: 'NoGhost Records',
      },
      {
        w: {
          splits: {
            [I1]: [
              {
                shares: [
                  ['A', '33.333333'],
                  ['B', '33.333333'],
                  ['C', '33.333334'],
                ],
              },
            ],
          },
        },
        n: '10.000000000002',
        label: 'Test Label',
      },
      {
        w: {
          splits: {
            [I1]: [
              {
                shares: [
                  ['A', '50'],
                  ['B', '50'],
                ],
              },
            ],
          },
          parts: [{ artist: 'R', percent: '15', funded: 'top' }],
        },
        n: '10.000000000001',
        label: 'NoGhost Records',
      },
      {
        w: {
          splits: {
            [I1]: [
              {
                shares: [
                  ['A', '50'],
                  ['B', '50'],
                ],
              },
            ],
          },
          parts: [
            { artist: 'T0', percent: '50', funded: 'top' },
            { artist: 'T1', percent: '50', funded: 'top' },
          ],
        },
        n: '10.000000000001',
        label: 'Test Label',
      },
    ];
    for (const c of cases) {
      const o = run(c.w, unit(c.n, { labelName: c.label }));
      expect(exactAfterEveryLayer(o, new Decimal(c.n)), c.n).toBeNull();
      expect(signSafe(o, new Decimal(c.n)), `${c.n} ${c.label}`).toBeNull();
    }
    // rows 50/50 on 10.000000000001: the excess pico comes off the first row by id, the label share is 0
    const o = run(cases[0]!.w, unit('10.000000000001'));
    expect([o.amount('A'), o.amount('B'), o.state.labelShare.toFixed()]).toEqual([
      '5',
      '5.000000000001',
      '0',
    ]);
    // the same under NoGhost: NG gets 0, never -1 pico
    expect(run(cases[1]!.w, unit('10.000000000001', { labelName: 'NoGhost Records' })).amount('NG')).toBe(
      '0',
    );
  });

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
      const err = exactAfterEveryLayer(o, new Decimal(n)) ?? signSafe(o, new Decimal(n));
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
