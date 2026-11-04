// Узел 0: строка лейбла → наш лейбл, правило саблейбла, распознана ли строка. Денег не двигает.
import { node, type Seed, type SublabelRule } from './types';
import { reportDate } from './state';

export interface Labelled { ourLabelId: string | null; rule: SublabelRule | null; labelMapped: boolean }

export const labelOfRecord = node<Pick<Seed, 'unit'>, Labelled>({
  name: 'label-of-record',
  run({ unit }, ctx) {
    const label = ctx.labelOf(unit.labelName, reportDate(unit));
    if (!label) return { out: { ourLabelId: null, rule: null, labelMapped: false }, edges: [] };
    return { out: { ourLabelId: label.kind === 'own' ? label.id : label.ownLabelId, rule: label.rule, labelMapped: true }, edges: [] };
  },
});
