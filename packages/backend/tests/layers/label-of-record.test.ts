import { describe, expect, it } from 'vitest';
import { labelOfRecord } from '../../src/facade/layers/label-of-record';
import { initialState } from '../../src/facade/layers';
import { makeContext, run, unit } from './world';

const A50 = { splits: { QZTST2600001: [{ shares: [['A', '50']] as [string, string][] }] } };

describe('layer 1: label of record (10 §3, M8, E13–E15)', () => {
  it('an alias of an own label: the label itself', () => {
    const s = labelOfRecord(initialState(unit('100', { labelName: 'Ahh Music' })), makeContext());
    expect([s.ourLabelId, s.ourLabelName, s.labelShareCategory]).toEqual(['L0', '0to8', 'ours']);
  });
  // D-232: the sublabel rule model removed (a sublabel string: its own label and its rule in force)
  it('an unmapped string: no label of record, the label share waits in C label_unmapped', () => {
    const s = labelOfRecord(initialState(unit('100', { labelName: 'Mystery Records' })), makeContext());
    expect([s.ourLabelId, s.labelShareCategory]).toEqual([null, 'label_unmapped']);
  });
  it('G08a: Ahh Music is 0to8: A 50, ours 50', () => {
    const o = run(A50, unit('100', { labelName: 'Ahh Music' }));
    expect([o.amount('A'), o.B, o.C, o.ours, o.state.ourLabelName]).toEqual(['50', '50', '0', '50', '0to8']);
  });
  it('G08b: Echo8 is its own label of record', () => {
    const o = run(A50, unit('100', { labelName: 'Echo8' }));
    expect([o.amount('A'), o.ours, o.state.ourLabelName]).toEqual(['50', '50', 'Echo8']);
  });
  it('G08c (E15): an unmapped string still pays the rows; the remainder is C label_unmapped', () => {
    const o = run(A50, unit('100', { labelName: 'Mystery Records' }));
    expect([o.amount('A'), o.B, o.C, o.ours]).toEqual(['50', '50', '50', '0']);
    expect(o.state.labelShareCategory).toBe('label_unmapped');
  });
  // D-232: the sublabel rule model removed (G38: the same ISRC under the sublabel NoGhost and under Test Label)
  // D-232: the sublabel rule model removed (a rule outside its period does not apply)
});
