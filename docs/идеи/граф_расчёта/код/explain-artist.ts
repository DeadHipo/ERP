// История одного псевдонима внутри юнита: откуда пришли его деньги (путь от net) и что ушло из его строки.
// Всё берётся из рёбер: ни узлы, ни расчёт для этого ничего дополнительно не пишут.
// Запуск: npx tsx docs/идеи/граф_расчёта/код/explain-artist.ts
import { makeContext, unit } from '../../../../packages/backend/tests/layers/world';
import { sumOf } from '../../../../packages/backend/src/facade/layers/exact';
import { runUnit, type UnitRun } from './graph';
import type { Edge, NodeId } from './types';

export interface Story {
  artist: string;
  /** Рёбра, пришедшие в сток artist:X (каждое — по какому правилу и из какого узла). */
  received: Edge[];
  /** Для каждого входящего ребра — цепочка рёбер вверх до net (как деньги дошли до этой корзины). */
  pathsUp: Edge[][];
  /** Что ушло из строки row:X (пул, доли других артистов) — чужие деньги, взятые у этого псевдонима. */
  takenFromRow: Edge[];
  /** Подписи узлов, касающиеся псевдонима (недостача по его правилу, отсутствие строки-источника). */
  notes: UnitRun['notes'];
}

/** Путь вверх: от узла к net по рёбрам-остаткам и рёбрам-переносам, которые его наполнили. Ветвления (pool) раскрываются все. */
function pathsTo(node: NodeId, edges: readonly Edge[], seen = new Set<NodeId>()): Edge[][] {
  if (node === 'net' || seen.has(node)) return [[]];
  const incoming = edges.filter((e) => e.to === node);
  if (incoming.length === 0) return [[]];
  return incoming.flatMap((e) => pathsTo(e.from, edges, new Set([...seen, node])).map((p) => [...p, e]));
}

export function storyOf(run: UnitRun, artist: string): Story {
  const sink: NodeId = `artist:${artist}`;
  const row: NodeId = `row:${artist}`;
  const received = run.edges.filter((e) => e.to === sink);
  return {
    artist,
    received,
    pathsUp: received.flatMap((e) => pathsTo(e.from, run.edges).map((p) => [...p, e])),
    takenFromRow: run.edges.filter((e) => e.from === row && e.to !== sink),
    notes: run.notes.filter((n) => n.node === sink || n.node === row),
  };
}

const line = (e: Edge) =>
  `${e.from} → ${e.to}: ${e.amount.toFixed(12)} [${e.kind}${e.percent ? ` ${e.percent}% от ${e.base?.toFixed(2)}` : ''}${e.ruleId ? `, правило ${e.ruleId}` : ''}${e.documentId ? `, документ ${e.documentId}` : ''}${e.category ? `, ${e.category}${e.reason ? ' ' + e.reason : ''}` : ''}]`;

export function printStory(s: Story) {
  console.log(`\n${s.artist}: получено ${sumOf(s.received.map((e) => e.amount)).toFixed(12)}`);
  // Последнее ребро пути — приход в сток; у пула путей больше, чем приходов (по одному на каждую строку-источник).
  s.pathsUp.forEach((p, i) => {
    console.log(`  путь ${i + 1}: ${line(p[p.length - 1] as Edge)}`);
    p.slice(0, -1).forEach((e) => console.log(`     ← ${line(e)}`));
  });
  if (s.takenFromRow.length) {
    console.log(`  из строки ${s.artist} ушло другим: ${sumOf(s.takenFromRow.map((e) => e.amount)).toFixed(12)}`);
    s.takenFromRow.forEach((e) => console.log(`     ${line(e)}`));
  }
  s.notes.forEach((n) => console.log(`  подпись: ${n.why}, правило ${n.ruleId}, не хватило ${n.missing.toFixed(12)}`));
}

if (process.argv[1]?.endsWith('explain-artist.ts')) {
  const ctx = makeContext({
    labels: [
      { id: 'L0', name: '0to8', kind: 'own', aliases: ['0to8'] },
      { id: 'LS', name: 'S Records', kind: 'sublabel', own: 'L0', aliases: ['S Records'], rule: { id: 'r1', percent: '50', recipient: 'S', doc: 'ok' } },
    ],
    splits: { QZTST2600001: [{ id: 's1', doc: 'ok', shares: [['A', '40'], ['B', '20']] }] },
    parts: [
      { id: 'p1', artist: 'R', percent: '10', base: 'net', funded: 'top', doc: 'ok' },
      { id: 'p2', artist: 'MC', percent: '5', base: 'net', funded: 'artist_pool', doc: 'ok' },
      { id: 'p3', artist: 'AR', percent: '15', base: 'bucket', funded: 'label_share', doc: 'ok' },
    ],
  });
  const run = runUnit(unit('100', { labelName: 'S Records' }), ctx);
  for (const a of ['A', 'MC', 'S']) printStory(storyOf(run, a));
}
