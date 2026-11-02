import { describe, expect, it } from 'vitest';
import { run, unit } from './world';

const W = { splits: { QZTST2600001: [{ shares: [['A', '50']] as [string, string][] }] } };

describe('layer 2: perimeter (D-023, D-035)', () => {
  it('G30: empty ISRC → C no_isrc, nothing else runs', () => {
    const o = run(W, unit('2', { isrc: '' }));
    expect([o.state.status, o.state.labelShareCategory, o.C, o.ours, o.state.rows.length]).toEqual([
      'no_isrc',
      'no_isrc',
      '2',
      '0',
      0,
    ]);
    expect(o.states.map((s) => s.layer)).toEqual(['label-of-record', 'perimeter']);
  });
  it('G30: unknown pair → C unknown_pair', () => {
    const o = run(W, unit('7', { upc: '999' }));
    expect([o.state.status, o.C, o.ours]).toEqual(['unknown_pair', '7', '0']);
  });
  it('a known pair passes to the next layers', () => {
    const o = run(W, unit('100'));
    expect(o.state.status).toBe('allocated');
    expect(o.states).toHaveLength(6);
  });
});
