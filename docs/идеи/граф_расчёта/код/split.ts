// Узел 2: сплит на дату юнита. Строки — процент от scaledNet; доля лейбла после сплита — остаток.
import { capToBase } from '../../../../packages/backend/src/facade/layers/exact';
import type { TopTaken } from './off-the-top';
import { node, type ArtistId, type Quantised, type Remainder, type Seed } from './types';
import { asQ, canonical, minus, pct, remainderEdge, reportDate, transfer } from './state';

export interface Split {
  splitStatus: 'allocated' | 'no_split';
  /** Строка каждого псевдонима: сумма и правило (нужны пулу, доле артиста и закрытию строк). */
  rows: ReadonlyMap<ArtistId, { amount: Quantised; ruleId: string; documentId: string | null }>;
  labelShareAfterSplit: Remainder;
}

export const split = node<Pick<Seed, 'unit'> & TopTaken, Split>({
  name: 'split',
  run({ unit, scaledNet }, ctx) {
    const sp = ctx.splitAt(unit.isrc, reportDate(unit));
    if (!sp) {
      const rest = minus(scaledNet, []);
      return { out: { splitStatus: 'no_split', rows: new Map(), labelShareAfterSplit: rest }, edges: [remainderEdge('scaledNet', 'labelShare', rest)] };
    }
    const shares = sp.shares.filter((r) => !r.percent.isZero());
    const keys = shares.map((r) => canonical(ctx, r.artistId));
    const targets = shares.map((r) => pct(scaledNet, r.percent));
    const amounts = capToBase(scaledNet, targets, keys).map(asQ);
    const rows = new Map(shares.map((r, i) => [keys[i] as string, { amount: amounts[i] as Quantised, ruleId: sp.splitId, documentId: r.documentId ?? sp.documentId }]));
    const edges = shares.map((r, i) => transfer('scaledNet', `row:${keys[i]}`, amounts[i] as Quantised, {
      kind: 'row', ruleId: sp.splitId, documentId: r.documentId ?? sp.documentId, percent: r.percent, base: scaledNet, target: targets[i],
    }));
    const rest = minus(scaledNet, edges);
    return { out: { splitStatus: 'allocated', rows, labelShareAfterSplit: rest }, edges: [...edges, remainderEdge('scaledNet', 'labelShare', rest)] };
  },
});
