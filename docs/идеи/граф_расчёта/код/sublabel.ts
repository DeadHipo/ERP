// Узел 3d: правило саблейбла — процент от доли лейбла после carve; затем остаток → ours или C (строка не распознана).
import type { Labelled } from './label-of-record';
import type { LabelCarved } from './label-share';
import { node, type Remainder, type Seed } from './types';
import { canonical, minus, pct, remainderEdge, transfer } from './state';

export interface Closed { ours: Remainder; waitingReason: 'label_unmapped' | null }

export const sublabel = node<Pick<Seed, 'unit'> & Labelled & LabelCarved, Closed>({
  name: 'sublabel',
  run({ rule, labelMapped, labelShareAfterCarve: base }, ctx) {
    if (!labelMapped) {
      const rest = minus(base, []);
      return { out: { ours: minus(base, [{ amount: base }]), waitingReason: 'label_unmapped' }, edges: [remainderEdge('labelShare', 'c:label_unmapped', rest, { category: 'C', reason: 'label_unmapped' })] };
    }
    const taken = rule
      ? [transfer('labelShare', `artist:${canonical(ctx, rule.recipientArtistId)}`, pct(base, rule.percent), {
          kind: 'sublabel', ruleId: rule.id, documentId: rule.documentId, percent: rule.percent, base, target: pct(base, rule.percent),
        })]
      : [];
    const ours = minus(base, taken);
    return { out: { ours, waitingReason: null }, edges: [...taken, remainderEdge('labelShare', 'ours', ours, { category: 'ours' })] };
  },
});
