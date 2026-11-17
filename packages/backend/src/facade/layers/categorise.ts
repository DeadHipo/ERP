import type { Allocation, AssumptionBasis, CReason, Layer } from './types';

/**
 * Layer 6: B or C per allocation, the first reason wins:
 * 1. an assumption: the allocation's document is of kind `assumption` (a row: its own document, else the split's);
 * 2. the document is not approved: `split_unconfirmed` (rows) or `rule_unconfirmed` (top, carves);
 * 3. the pseudonym has no owner: `artist_without_owner`;
 * 4. the owner is not confirmed: `owner_unconfirmed`;
 * otherwise B. The label share keeps its category (ours, or C `label_unmapped` / the perimeter reasons).
 */
export const categorise: Layer = (s, ctx) => {
  const rows = s.rows.map((a): Allocation => {
    let assumption: AssumptionBasis | null = null;
    if (ctx.documentKind(a.documentId) === 'assumption') assumption = 'document';
    let reason: CReason | null = null;
    if (assumption) reason = 'assumption';
    else if (ctx.documentStatus(a.documentId) !== 'approved')
      reason = a.kind === 'row' ? 'split_unconfirmed' : 'rule_unconfirmed';
    else if (!a.ownerId) reason = 'artist_without_owner';
    else if (!ctx.confirmedOwners.has(a.ownerId)) reason = 'owner_unconfirmed';
    return { ...a, category: reason ? 'C' : 'B', reason, assumption };
  });
  return { ...s, rows };
};
