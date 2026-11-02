import { Decimal } from '../../shared/money';
import { monthStart } from '../../shared/dates';
import { DEFAULT_AUTHOR_PERCENT, type PublishingLayer, type PublishingTerm } from './writer-parts';

/**
 * Layer 2: the author's percentage of a part. The terms of the part's owner at the quarter-end month (report date =
 * first day of that month, `valid_to` exclusive); a term with the line's operation type first, then the one without
 * a type (D-128). No terms: the default 50 and `defaultTerms` (waits for confirmation, D-043).
 * `authorAmount = part × percent / 100`, the same arithmetic the module used to apply (no new rounding).
 */
export const authorShare: PublishingLayer = (s, ctx) => {
  const date = monthStart(s.line.reportMonth);
  const opType = s.line.operationType;
  const valid = (x: PublishingTerm) => x.validFrom <= date && (x.validTo === null || date < x.validTo);
  const parts = s.parts.map((p) => {
    const pick = (typed: boolean) => {
      const fits = (x: PublishingTerm) =>
        valid(x) && (typed ? opType !== null && x.operationType === opType : x.operationType === null);
      return (
        ctx.terms.find((x) => x.ownerId === p.ownerId && fits(x)) ??
        ctx.terms.find((x) => ctx.resolveOwner(x.ownerId) === p.ownerId && fits(x))
      );
    };
    const t = p.ownerId ? (pick(true) ?? pick(false)) : undefined;
    const percent = new Decimal(t?.percent ?? DEFAULT_AUTHOR_PERCENT);
    return {
      ...p,
      percent,
      authorAmount: p.payable.mul(percent).div(100),
      termsId: t?.id ?? null,
      termsDocumentId: t?.documentId ?? null,
      defaultTerms: t === undefined,
    };
  });
  return { ...s, parts };
};
