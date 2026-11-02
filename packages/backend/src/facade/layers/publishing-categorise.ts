import { ZERO } from '../../shared/money';
import type { CReason } from './types';
import type { PublishingLayer } from './writer-parts';

/**
 * Layer 3: B or C per part, the first reason wins: no owner, or the owner is a label → `writer_unmapped` (nothing is
 * accrued: author and label amounts are 0, the whole part waits); the owner is not confirmed → `owner_unconfirmed`;
 * default or unapproved terms → `publishing_terms_unconfirmed`; otherwise B. `labelAmount = part − authorAmount`.
 */
export const publishingCategorise: PublishingLayer = (s, ctx) => {
  const parts = s.parts.map((p) => {
    const ownerId = p.ownerId && !ctx.labelOwners.has(p.ownerId) ? p.ownerId : null;
    let reason: CReason | null = null;
    if (!ownerId) reason = 'writer_unmapped';
    else if (!ctx.confirmedOwners.has(ownerId)) reason = 'owner_unconfirmed';
    else if (p.defaultTerms || ctx.documentStatus(p.termsDocumentId) !== 'approved')
      reason = 'publishing_terms_unconfirmed';
    return {
      ...p,
      ownerId,
      authorAmount: ownerId ? p.authorAmount : ZERO,
      labelAmount: ownerId ? p.payable.sub(p.authorAmount) : ZERO,
      category: reason ? ('C' as const) : ('B' as const),
      reason,
    };
  });
  return { ...s, parts };
};
