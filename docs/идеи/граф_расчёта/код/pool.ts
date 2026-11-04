// Узел 3a: пул. Цели — процент от net; взятое (draw) берётся из строк пропорционально; выход — строки после пула.
import { Decimal } from '../../../../packages/backend/src/shared/money';
import { distributeCapped, sumOf } from '../../../../packages/backend/src/facade/layers/exact';
import type { Split } from './split';
import { node, type ArtistId, type Remainder, type Seed } from './types';
import { asQ, canonical, fund, minus, pct, transfer } from './state';
import { rulesOf } from './rules';

export interface Pooled { rowsAfterPool: ReadonlyMap<ArtistId, Remainder> }

export const pool = node<Pick<Seed, 'unit'> & Pick<Split, 'rows'>, Pooled>({
  name: 'carve:pool',
  run({ unit, rows }, ctx) {
    const parts = rulesOf(ctx, unit, 'artist_pool');
    const ids = [...rows.keys()];
    if (parts.length === 0) {
      return { out: { rowsAfterPool: new Map(ids.map((a) => [a, minus((rows.get(a) as { amount: Decimal }).amount, [])])) }, edges: [] };
    }
    const poolAmount = sumOf(ids.map((a) => (rows.get(a) as { amount: Decimal }).amount));
    const targets = parts.map((p) => pct(unit.net, p.percent));
    const { amounts, notes } = fund('pool', ctx, parts, targets, poolAmount);
    const draws = distributeCapped(sumOf(amounts), ids.map((a) => ({ key: a, weight: (rows.get(a) as { amount: Decimal }).amount })), ids.map((a) => (rows.get(a) as { amount: Decimal }).amount)).map(asQ);
    const drawEdges = ids.map((a, i) => transfer(`row:${a}`, 'pool', draws[i] as typeof draws[number], { kind: 'draw' }));
    const outEdges = parts.map((p, i) => transfer('pool', `artist:${canonical(ctx, p.artistId)}`, amounts[i] as typeof amounts[number], {
      kind: 'artist_pool', ruleId: p.id, documentId: p.documentId, percent: p.percent, base: unit.net, target: targets[i] as Decimal,
    }));
    const rowsAfterPool = new Map(ids.map((a, i) => [a, minus((rows.get(a) as { amount: Decimal }).amount, [drawEdges[i] as { amount: Decimal }])]));
    return { out: { rowsAfterPool }, edges: [...drawEdges, ...outEdges], notes };
  },
});
