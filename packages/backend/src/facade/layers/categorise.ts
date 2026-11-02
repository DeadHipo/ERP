import type { Allocation, AssumptionBasis, CReason, Layer } from './types';

/**
 * Layer 6: B or C per allocation, the first reason wins:
 * 1. an assumption: the allocation's document is of kind `assumption` (a row: its own document, else the split's);
 *    Q11: a unit with a label-share carve and a sublabel allocation marks both; R1: a sublabel allocation on a
 *    `no_split` unit;
 * 2. the document is not approved: `split_unconfirmed` (rows) or `rule_unconfirmed` (top, carves, sublabel);
 * 3. the pseudonym has no owner: `artist_without_owner`;
 * 4. the owner is not confirmed: `owner_unconfirmed`;
 * otherwise B. The label share keeps its category (ours, or C `label_unmapped` / the perimeter reasons).
 */
export const categorise: Layer = (s, ctx) => {
  const q11 = s.rows.some((r) => r.kind === 'label_share') && s.rows.some((r) => r.kind === 'sublabel');
  const rows = s.rows.map((a): Allocation => {
    let assumption: AssumptionBasis | null = null;
    if (ctx.documentKind(a.documentId) === 'assumption') assumption = 'document';
    else if (q11 && (a.kind === 'label_share' || a.kind === 'sublabel')) assumption = 'q11';
    else if (a.kind === 'sublabel' && s.status === 'no_split') assumption = 'r1';
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
