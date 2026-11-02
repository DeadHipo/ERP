import { reportDate } from './allocation';
import type { Layer } from './types';

/**
 * Layer 1: the label string of the unit → alias → label. The label of record is the label itself if it is ours,
 * else the own label of the sublabel; the sublabel rule is the one in force at the report month. An unmapped string
 * has no label of record: its label share waits in C `label_unmapped`, rows and carves still run, no sublabel carve.
 */
export const labelOfRecord: Layer = (s, ctx) => {
  const l = ctx.labelOf(s.unit.labelName, reportDate(s.unit));
  if (!l)
    return { ...s, ourLabelId: null, ourLabelName: null, rule: null, sublabelId: null, sublabelName: null, labelShareCategory: 'label_unmapped' };
  const ourLabelId = l.kind === 'own' ? l.id : l.ownLabelId;
  return {
    ...s,
    ourLabelId,
    ourLabelName: ourLabelId ? (ctx.labelName(ourLabelId) ?? null) : null,
    sublabelId: l.kind === 'sublabel' ? l.id : null,
    sublabelName: l.kind === 'sublabel' ? l.name : null,
    rule: l.kind === 'sublabel' ? l.rule : null,
    labelShareCategory: ourLabelId ? 'ours' : 'label_unmapped',
  };
};
