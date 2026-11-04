// Эскиз (не основной код). Третья редакция: входы и выходы узлов — интерфейсы.
// Узел получает ровно свои входы и возвращает ровно свои выходы; состояние юнита — пересечение выходов пройденных узлов.
import type { Decimal } from '../../../../packages/backend/src/shared/money';
import type { LayerContext, MasterUnit, SublabelRule } from '../../../../packages/backend/src/facade/layers/types';
import type { CReason } from '@erp/shared/api-responses';

export type { LayerContext, MasterUnit, SublabelRule };
export type ArtistId = string;
export type NodeId = 'net' | 'scaledNet' | 'pool' | 'labelShare' | 'ours' | `row:${string}` | `artist:${string}` | `c:${string}`;

/** Сумма после квантования (12 знаков). Получить можно только через asQ / pct. */
export type Quantised = Decimal & { readonly __quantised: unique symbol };
/** Остаток: получить можно только вычитанием, через minus(base, взятое). Никогда — процентом. */
export type Remainder = Decimal & { readonly __remainder: unique symbol };

export type EdgeKind = 'top' | 'row' | 'draw' | 'artist_pool' | 'artist_share' | 'label_share' | 'sublabel' | 'remainder' | 'perimeter';

/** Ребро: перенос из узла в узел по правилу. amount — Quantised или Remainder, третьего не дано. */
export interface Edge {
  from: NodeId;
  to: NodeId;
  amount: Quantised | Remainder;
  kind: EdgeKind;
  ruleId: string | null;
  documentId: string | null;
  percent: Decimal | null;
  base: Decimal | null;
  target: Decimal | null;
  category: 'B' | 'C' | 'ours' | null;
  reason: CReason | null;
  assumption: 'document' | 'q11' | 'r1' | null;
}
export type EdgeMeta = Partial<Omit<Edge, 'from' | 'to' | 'amount'>>;

export interface NodeNote { node: NodeId; ruleId: string; missing: Decimal; why: 'bucket_short' | 'no_source_row' | 'top_above_100' }

/** Что узел вернул: его выходы (вливаются в состояние), рёбра и подписи, которые он провёл. */
export interface NodeResult<Out> {
  out: Out;
  edges: readonly Edge[];
  notes?: readonly NodeNote[];
  /** Только для узла, который перекрашивает уже проведённые рёбра (categorise). */
  replaceEdges?: readonly Edge[];
}

/** Узел: интерфейс входов → интерфейс выходов. Ничего, кроме In, узел не видит; edgesSoFar — только для чтения. */
export interface Node<In, Out> {
  name: string;
  run(input: In, ctx: LayerContext, edgesSoFar: readonly Edge[]): NodeResult<Out>;
}
export const node = <In, Out>(spec: Node<In, Out>): Node<In, Out> => spec;

/** С чего начинается каждый юнит. */
export interface Seed { unit: MasterUnit; net: Decimal; stopped: boolean }
