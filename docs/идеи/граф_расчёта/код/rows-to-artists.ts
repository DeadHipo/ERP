// Узел 3b': закрыть строки. Остаток каждой строки уходит её псевдониму с правилом и документом строки.
import type { SharesTaken } from './artist-share';
import type { Split } from './split';
import { node } from './types';
import { remainderEdge } from './state';

export interface RowsClosed { rowsClosed: true }

export const rowsToArtists = node<Pick<Split, 'rows'> & SharesTaken, RowsClosed>({
  name: 'rows-to-artists',
  run({ rows, rowsAfterShares }) {
    const edges = [...rowsAfterShares].map(([a, rest]) => {
      const r = rows.get(a);
      return remainderEdge(`row:${a}`, `artist:${a}`, rest, { ruleId: r?.ruleId ?? null, documentId: r?.documentId ?? null });
    });
    return { out: { rowsClosed: true }, edges };
  },
});
