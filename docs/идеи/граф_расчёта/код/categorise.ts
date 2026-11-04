// Узел 4: красит рёбра в стоки artist:*. Денег не двигает; читает edgesSoFar и возвращает их перекрашенными.
import type { CReason } from '@erp/shared/api-responses';
import type { Split } from './split';
import { node, type Edge } from './types';

export interface Categorised { categorised: true }

export const categorise = node<Pick<Split, 'splitStatus'>, Categorised>({
  name: 'categorise',
  run({ splitStatus }, ctx, edges) {
    const q11 = edges.some((e) => e.kind === 'label_share') && edges.some((e) => e.kind === 'sublabel');
    const paint = (e: Edge): Edge => {
      if (!e.to.startsWith('artist:')) return e;
      const artist = ctx.artistIndex.get(e.to.slice(7));
      const c = (reason: CReason, assumption: Edge['assumption'] = null): Edge => ({ ...e, category: 'C', reason, assumption });
      if (ctx.documentKind(e.documentId) === 'assumption') return c('assumption', 'document');
      if (q11 && (e.kind === 'label_share' || e.kind === 'sublabel')) return c('assumption', 'q11');
      if (e.kind === 'sublabel' && splitStatus === 'no_split') return c('assumption', 'r1');
      if (ctx.documentStatus(e.documentId) !== 'approved') return c(e.kind === 'row' || e.kind === 'remainder' ? 'split_unconfirmed' : 'rule_unconfirmed');
      if (!artist?.ownerId) return c('artist_without_owner');
      if (!ctx.confirmedOwners.has(artist.ownerId)) return c('owner_unconfirmed');
      return { ...e, category: 'B', reason: null, assumption: null };
    };
    return { out: { categorised: true }, edges: [], replaceEdges: edges.map(paint) };
  },
});
