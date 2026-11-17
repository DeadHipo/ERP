import type { Layer } from './types';

/**
 * Layer 1: the label string of the unit → alias → our label of record. An unmapped string has no label of record: its
 * label share waits in C `label_unmapped`, rows and carves still run. Since D-232 a string never leads to a sublabel:
 * a sublabel is the register and its terms (D-217), read by its report, never by the money.
 */
export const labelOfRecord: Layer = (s, ctx) => {
  const l = ctx.labelOf(s.unit.labelName);
  if (!l) return { ...s, ourLabelId: null, ourLabelName: null, labelShareCategory: 'label_unmapped' };
  return { ...s, ourLabelId: l.id, ourLabelName: l.name, labelShareCategory: 'ours' };
};
