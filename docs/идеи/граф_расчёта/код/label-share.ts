// Узел 3c: участия из доли лейбла. База вида — доля лейбла после сплита; процент от net или от неё (base).
import { Decimal } from '../../../../packages/backend/src/shared/money';
import type { Split } from './split';
import { node, type Remainder, type Seed } from './types';
import { canonical, fund, minus, pct, transfer } from './state';
import { rulesOf } from './rules';

export interface LabelCarved { labelShareAfterCarve: Remainder }

export const labelShare = node<Pick<Seed, 'unit'> & Pick<Split, 'labelShareAfterSplit'>, LabelCarved>({
  name: 'carve:label_share',
  run({ unit, labelShareAfterSplit: available }, ctx) {
    const parts = rulesOf(ctx, unit, 'label_share');
    const bases = parts.map((p) => (p.base === 'net' ? unit.net : available));
    const targets = parts.map((p, i) => pct(bases[i] as Decimal, p.percent));
    const { amounts, notes } = fund('labelShare', ctx, parts, targets, available);
    const edges = parts.map((p, i) => transfer('labelShare', `artist:${canonical(ctx, p.artistId)}`, amounts[i] as typeof amounts[number], {
      kind: 'label_share', ruleId: p.id, documentId: p.documentId, percent: p.percent, base: bases[i] as Decimal, target: targets[i] as Decimal,
    }));
    return { out: { labelShareAfterCarve: minus(available, edges) }, edges, notes };
  },
});
