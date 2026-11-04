// Узел 0': периметр. Пустой ISRC или неизвестная пара → весь net одним ребром в C; stopped останавливает цепочку.
import { node, type Seed } from './types';
import { minus, remainderEdge } from './state';

export interface Perimeter { perimeter: 'ok' | 'no_isrc' | 'unknown_pair'; stopped: boolean }

export const perimeter = node<Pick<Seed, 'unit' | 'net'>, Perimeter>({
  name: 'perimeter',
  run({ unit, net }, ctx) {
    const reason = !unit.isrc ? 'no_isrc' : !ctx.knownPairs.has(`${unit.isrc}|${unit.upc}`) ? 'unknown_pair' : null;
    if (!reason) return { out: { perimeter: 'ok', stopped: false }, edges: [] };
    return { out: { perimeter: reason, stopped: true }, edges: [remainderEdge('net', `c:${reason}`, minus(net, []), { kind: 'perimeter', category: 'C', reason })] };
  },
});
