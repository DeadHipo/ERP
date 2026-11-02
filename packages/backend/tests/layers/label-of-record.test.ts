import { describe, expect, it } from 'vitest';
import { labelOfRecord } from '../../src/facade/layers/label-of-record';
import { initialState } from '../../src/facade/layers';
import { makeContext, run, unit } from './world';

const A50 = { splits: { QZTST2600001: [{ shares: [['A', '50']] as [string, string][] }] } };

describe('layer 1: label of record (10 §3, M8, E13–E15)', () => {
  it('an alias of an own label: the label itself, no rule', () => {
    const s = labelOfRecord(initialState(unit('100', { labelName: 'Ahh Music' })), makeContext());
    expect([s.ourLabelId, s.ourLabelName, s.rule, s.labelShareCategory]).toEqual([
      'L0',
      '0to8',
      null,
      'ours',
    ]);
  });
  it('a sublabel string: its own label and its rule in force at the report month', () => {
    const s = labelOfRecord(initialState(unit('100', { labelName: ' noghost  RECORDS ' })), makeContext());
    expect(s.ourLabelName).toBe('0to8');
    expect(s.rule?.percent.toFixed()).toBe('50');
  });
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
  it('G08c (E15): an unmapped string still pays the rows; the remainder is C label_unmapped, no sublabel', () => {
    const o = run(A50, unit('100', { labelName: 'Mystery Records' }));
    expect([o.amount('A'), o.B, o.C, o.ours]).toEqual(['50', '50', '50', '0']);
    expect(o.state.labelShareCategory).toBe('label_unmapped');
  });
  it('G38 (E14): the same ISRC under NoGhost in March and Test Label in April', () => {
    const m = run(A50, unit('100', { labelName: 'NoGhost Records', reportingMonth: '2026-03' }));
    expect([m.amount('A'), m.amount('NG'), m.ours]).toEqual(['50', '25', '25']);
    const a = run(A50, unit('100', { labelName: 'Test Label', reportingMonth: '2026-04' }));
    expect([a.amount('A'), a.amount('NG'), a.ours]).toEqual(['50', undefined, '50']);
  });
  it('a rule outside its period does not apply', () => {
    const labels = makeContext().labelOf('NoGhost Records', '2026-01-01');
    expect(labels?.rule).not.toBeNull();
    const w = {
      ...A50,
      labels: [
        { id: 'L0', name: '0to8', kind: 'own' as const, aliases: ['Test Label'] },
        {
          id: 'LNG',
          name: 'NoGhost Records',
          kind: 'sublabel' as const,
          own: 'L0',
          aliases: ['NoGhost Records'],
          rule: { percent: '50', recipient: 'NG', from: '2026-06-01' },
        },
      ],
    };
    const o = run(w, unit('100', { labelName: 'NoGhost Records' }));
    expect([o.amount('NG'), o.ours, o.state.ourLabelName]).toEqual([undefined, '50', '0to8']);
  });
});
