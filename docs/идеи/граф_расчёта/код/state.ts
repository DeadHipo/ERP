// Помощники: единственные двери в типы Quantised и Remainder, конструкторы рёбер, недостача, баланс.
import { Decimal, ZERO } from '../../../../packages/backend/src/shared/money';
import { distribute, fits, q, sumOf, usable } from '../../../../packages/backend/src/facade/layers/exact';
import { monthStart } from '../../../../packages/backend/src/shared/dates';
import type { Edge, EdgeMeta, LayerContext, MasterUnit, NodeId, NodeNote, Quantised, Remainder } from './types';

export const reportDate = (u: MasterUnit) => monthStart(u.reportingMonth);
export const canonical = (ctx: LayerContext, id: string): string => ctx.artistIndex.get(id)?.id ?? id;

export const asQ = (d: Decimal): Quantised => q(d) as Quantised;
export const pct = (base: Decimal, percent: Decimal): Quantised => asQ(base.mul(percent).div(100));
/** Остаток = база − Σ взятого. Единственный способ получить Remainder. */
export const minus = (base: Decimal, taken: readonly { amount: Decimal }[]): Remainder =>
  base.sub(sumOf(taken.map((t) => t.amount))) as Remainder;

const META0 = { ruleId: null, documentId: null, percent: null, base: null, target: null, category: null, reason: null, assumption: null } as const;

/** Ребро по правилу: сумма только квантованная. */
export const transfer = (from: NodeId, to: NodeId, amount: Quantised, meta: EdgeMeta & { kind: Edge['kind'] }): Edge =>
  ({ ...META0, ...meta, from, to, amount });
/** Ребро-остаток: сумма только Remainder. */
export const remainderEdge = (from: NodeId, to: NodeId, amount: Remainder, meta: EdgeMeta = {}): Edge =>
  ({ ...META0, kind: 'remainder', ...meta, from, to, amount });

/** Цели, не влезающие в корзину, масштабируются к ней; разница каждой — подпись узла. */
export function fund(
  node: NodeId, ctx: LayerContext, parts: readonly { id: string; artistId: string }[], targets: readonly Quantised[], available: Decimal,
): { amounts: Quantised[]; notes: NodeNote[] } {
  const want = sumOf(targets);
  if (fits(want, available)) return { amounts: [...targets], notes: [] };
  const amounts = distribute(usable(want, available), parts.map((p, i) => ({ key: canonical(ctx, p.artistId), weight: targets[i] as Decimal }))).map(asQ);
  const notes = parts.flatMap((p, i) => {
    const missing = (targets[i] as Decimal).sub(amounts[i] as Decimal);
    return missing.isZero() ? [] : [{ node, ruleId: p.id, missing, why: 'bucket_short' as const }];
  });
  return { amounts, notes };
}

export const isSink = (id: NodeId) => id === 'ours' || id.startsWith('artist:') || id.startsWith('c:');

export function nodeBalance(net: Decimal, edges: readonly Edge[]): { node: NodeId; in: Decimal; out: Decimal; ok: boolean }[] {
  const ids = new Set<NodeId>(['net', ...edges.flatMap((e) => [e.from, e.to])]);
  return [...ids].filter((id) => !isSink(id)).map((id) => {
    const inn = id === 'net' ? net : sumOf(edges.filter((e) => e.to === id).map((e) => e.amount));
    const out = sumOf(edges.filter((e) => e.from === id).map((e) => e.amount));
    return { node: id, in: inn, out, ok: inn.eq(out) };
  });
}
export const sinkTotal = (edges: readonly Edge[]) => sumOf(edges.filter((e) => isSink(e.to)).map((e) => e.amount));
export const ZERO_R = ZERO as Remainder;
