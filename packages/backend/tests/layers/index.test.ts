import { describe, expect, it } from 'vitest';
import { MASTER_LAYERS } from '../../src/facade/layers';
import { run, unit } from './world';

describe('the master layer list (10 §3)', () => {
  it('has the fixed order', () => {
    expect(MASTER_LAYERS.map((l) => l.name)).toEqual([
      'label-of-record',
      'perimeter',
      'off-the-top',
      'split',
      'carve',
      'categorise',
    ]);
  });
  it('allocateUnit returns the state after every layer', () => {
    const o = run({ splits: { QZTST2600001: [{ shares: [['A', '50']] }] } }, unit('100'));
    expect(o.states.map((s) => [s.layer, s.state.labelShare.toFixed()])).toEqual([
      ['label-of-record', '100'],
      ['perimeter', '100'],
      ['off-the-top', '100'],
      ['split', '50'],
      ['carve', '50'],
      ['categorise', '50'],
    ]);
    expect(o.state).toBe(o.states.at(-1)?.state);
  });
});
