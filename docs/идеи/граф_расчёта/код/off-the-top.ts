// Узел 1: участия «сверху» берут процент от net; выход — scaledNet как остаток (вычитанием, по типу).
import { Decimal } from '../../../../packages/backend/src/shared/money';
import { capToBase, distribute, sumOf } from '../../../../packages/backend/src/facade/layers/exact';
import { node, type Remainder, type Seed } from './types';
import { asQ, canonical, minus, pct, remainderEdge, transfer } from './state';
import { rulesOf } from './rules';

export interface TopTaken { scaledNet: Remainder }
const HUNDRED = new Decimal(100);

export const offTheTop = node<Pick<Seed, 'unit' | 'net'>, TopTaken>({
  name: 'off-the-top',
  run({ unit, net }, ctx) {
    const tops = rulesOf(ctx, unit, 'top'); // base: 'net' по типу
    const keys = tops.map((p) => canonical(ctx, p.artistId));
    const targets = tops.map((p) => pct(net, p.percent));
    const over = sumOf(tops.map((p) => p.percent)).gt(HUNDRED);
    const amounts = (over ? distribute(net, keys.map((k, i) => ({ key: k, weight: targets[i] as Decimal }))) : capToBase(net, targets, keys)).map(asQ);
    const edges = tops.map((p, i) => transfer('net', `artist:${keys[i]}`, amounts[i] as typeof amounts[number], {
      kind: 'top', ruleId: p.id, documentId: p.documentId, percent: p.percent, base: net, target: targets[i],
    }));
    const notes = over ? tops.map((p, i) => ({ node: 'net' as const, ruleId: p.id, missing: (targets[i] as Decimal).sub(amounts[i] as Decimal), why: 'top_above_100' as const })) : [];
    const scaledNet = minus(net, edges);
    return { out: { scaledNet }, edges: [...edges, remainderEdge('net', 'scaledNet', scaledNet)], notes };
  },
});
