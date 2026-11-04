// Сборка графа. chain проверяет на этапе компиляции: всё, что узлу нужно на входе, уже лежит в состоянии
// (пересечении Seed и выходов предыдущих узлов). Порядок — решение совета (10 §3, Q11), перестановка не соберётся.
import { labelOfRecord } from './label-of-record';
import { perimeter } from './perimeter';
import { offTheTop } from './off-the-top';
import { split } from './split';
import { pool } from './pool';
import { artistShare } from './artist-share';
import { rowsToArtists } from './rows-to-artists';
import { labelShare } from './label-share';
import { sublabel } from './sublabel';
import { categorise } from './categorise';
import type { Edge, LayerContext, MasterUnit, Node, NodeNote, Seed } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNode = Node<any, any>;
type InOf<N> = N extends Node<infer I, unknown> ? I : never;
type OutOf<N> = N extends Node<unknown, infer O> ? O : never;

type Valid<Ns extends readonly AnyNode[], Acc> = Ns extends readonly [infer A extends AnyNode, ...infer R extends readonly AnyNode[]]
  ? Acc extends InOf<A>
    ? Valid<R, Acc & OutOf<A>>
    : { 'узлу не хватает входов': A['name']; 'ему нужно': keyof InOf<A>; 'в состоянии есть': keyof Acc }
  : true;
type Assert<V> = V extends true ? unknown : V;

export function chain<const Ns extends readonly AnyNode[]>(...nodes: Ns & Assert<Valid<Ns, Seed>>): Ns {
  return nodes;
}

/** Схема «master/standard». */
export const MASTER_GRAPH = chain(labelOfRecord, perimeter, offTheTop, split, pool, artistShare, rowsToArtists, labelShare, sublabel, categorise);
export const SCHEME = 'master/standard';

/** Точка расширения (Р20): список узлов по юниту. Сегодня всегда MASTER_GRAPH. */
export type NodesFor = (unit: MasterUnit) => readonly AnyNode[];
export const defaultNodesFor: NodesFor = () => MASTER_GRAPH;

export interface Step { node: string; out: Record<string, unknown>; edges: readonly Edge[]; notes: readonly NodeNote[] }
export interface UnitRun { unit: MasterUnit; state: Record<string, unknown>; edges: readonly Edge[]; notes: readonly NodeNote[]; steps: Step[] }

/** Один юнит: состояние начинается с Seed и растёт выходами узлов; рёбра и подписи копятся отдельно. */
export function runUnit(unit: MasterUnit, ctx: LayerContext, nodesFor: NodesFor = defaultNodesFor): UnitRun {
  let state: Record<string, unknown> = { unit, net: unit.net, stopped: false } satisfies Seed;
  let edges: readonly Edge[] = [];
  let notes: readonly NodeNote[] = [];
  const steps: Step[] = [];
  for (const n of nodesFor(unit)) {
    const r = n.run(state, ctx, edges);
    state = { ...state, ...r.out };
    edges = r.replaceEdges ?? [...edges, ...r.edges];
    notes = [...notes, ...(r.notes ?? [])];
    steps.push({ node: n.name, out: r.out as Record<string, unknown>, edges: r.replaceEdges ?? r.edges, notes: r.notes ?? [] });
    if (state['stopped'] === true) break;
  }
  return { unit, state, edges, notes, steps };
}

/** Много юнитов: граф запускается на каждом по отдельности; между юнитами памяти нет. */
export const runUnits = (units: readonly MasterUnit[], ctx: LayerContext, nodesFor?: NodesFor): UnitRun[] =>
  units.map((u) => runUnit(u, ctx, nodesFor));
