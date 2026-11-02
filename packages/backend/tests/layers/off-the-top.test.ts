import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/shared/money';
import { exactAfterEveryLayer, run, unit, type World } from './world';

const rows = (...s: [string, string][]): World['splits'] => ({ QZTST2600001: [{ shares: s }] });

describe('layer 3: off the top (M4, E24)', () => {
  it('G04: R 15 of net; scaled net 85; A 21.25, B 21.25; ours 42.5', () => {
    const o = run(
      { splits: rows(['A', '25'], ['B', '25']), parts: [{ artist: 'R', percent: '15', funded: 'top' }] },
      unit('100'),
    );
    expect([o.amount('R'), o.amount('A'), o.amount('B'), o.B, o.ours]).toEqual(['15', '21.25', '21.25', '57.5', '42.5']);
    expect(o.state.scaledNet.toFixed()).toBe('85');
  });
  it('G32: A 100 after a top 15: A 85, label share 0', () => {
    const o = run({ splits: rows(['A', '100']), parts: [{ artist: 'R', percent: '15', funded: 'top' }] }, unit('100'));
    expect([o.amount('R'), o.amount('A'), o.B, o.ours]).toEqual(['15', '85', '100', '0']);
  });
  it('over-100 tops in data (G23 data-side twin): scaled down to net, scaled net 0, the excess a shortfall', () => {
    const o = run(
      {
        splits: rows(['A', '50']),
        parts: [
          { artist: 'R1', percent: '60', funded: 'top' },
          { artist: 'R2', percent: '60', funded: 'top' },
        ],
      },
      unit('100'),
    );
    expect([o.amount('R1'), o.amount('R2'), o.amount('A'), o.ours]).toEqual(['50', '50', '0', '0']);
    expect(o.state.scaledNet.toFixed()).toBe('0');
    expect(o.state.shortfalls.map((s) => [s.why, s.missing.toFixed()])).toEqual([
      ['top_above_100', '10'],
      ['top_above_100', '10'],
    ]);
    expect(exactAfterEveryLayer(o, new Decimal(100))).toBeNull();
  });
  it('over-100 tops with a non-terminating ratio: quantised, residue to the largest, Σ = net', () => {
    const o = run(
      {
        parts: [
          { artist: 'R1', percent: '70', funded: 'top' },
          { artist: 'R2', percent: '40', funded: 'top' },
          { artist: 'R3', percent: '1.5', funded: 'top' },
        ],
      },
      unit('33.333333333333'),
    );
    expect(exactAfterEveryLayer(o, new Decimal('33.333333333333'))).toBeNull();
    expect(o.state.scaledNet.toFixed()).toBe('0');
  });
  it('a top on a negative unit is negative with the same ratio', () => {
    const o = run({ splits: rows(['A', '50']), parts: [{ artist: 'R', percent: '15', funded: 'top' }] }, unit('-100'));
    expect([o.amount('R'), o.amount('A'), o.ours]).toEqual(['-15', '-42.5', '-42.5']);
  });
});
