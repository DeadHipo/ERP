// Узел 3b: доля из строки одного артиста (fromArtistId обязателен по типу). База — строка после пула.
import { Decimal, ZERO } from '../../../../packages/backend/src/shared/money';
import type { Pooled } from './pool';
import { node, type ArtistId, type Edge, type NodeNote, type Remainder, type Seed } from './types';
import { canonical, fund, minus, pct, transfer } from './state';
import { rulesOf, type RuleOf } from './rules';

export interface SharesTaken { rowsAfterShares: ReadonlyMap<ArtistId, Remainder> }

export const artistShare = node<Pick<Seed, 'unit'> & Pooled, SharesTaken>({
  name: 'carve:artist_share',
  run({ unit, rowsAfterPool }, ctx) {
    const bySource = new Map<string, RuleOf<'artist_share'>[]>();
    for (const p of rulesOf(ctx, unit, 'artist_share')) {
      const k = canonical(ctx, p.fromArtistId);
      bySource.set(k, [...(bySource.get(k) ?? []), p]);
    }
    const edges: Edge[] = [];
    const notes: NodeNote[] = [];
    const rowsAfterShares = new Map<ArtistId, Remainder>();
    for (const [a, base] of rowsAfterPool) {
      const group = bySource.get(a) ?? [];
      const targets = group.map((p) => pct(base, p.percent));
      const f = fund(`row:${a}`, ctx, group, targets, base);
      notes.push(...f.notes);
      const taken = group.map((p, i) => transfer(`row:${a}`, `artist:${canonical(ctx, p.artistId)}`, f.amounts[i] as typeof f.amounts[number], {
        kind: 'artist_share', ruleId: p.id, documentId: p.documentId, percent: p.percent, base, target: targets[i] as Decimal,
      }));
      edges.push(...taken);
      rowsAfterShares.set(a, minus(base, taken));
    }
    for (const [from, group] of bySource)
      if (!rowsAfterPool.has(from)) group.forEach((p) => notes.push({ node: `artist:${canonical(ctx, p.artistId)}`, ruleId: p.id, missing: ZERO, why: 'no_source_row' }));
    return { out: { rowsAfterShares }, edges, notes };
  },
});
