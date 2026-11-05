import { Decimal } from '../../shared/money';
import type { IncomeItem, Position, RecoupResult } from '../../modules/settlements';

// Moved as is from modules/settlements/recoup.ts (D-127): the settlements module keeps the shapes and their
// validation, the facade recoups (D-049, D-072, D-094, D-101).

function eligible(p: Position, i: IncomeItem): boolean {
  if (i.ownerId !== p.ownerId || (p.month !== null && i.reportMonth < p.month)) return false;
  if (i.isrc && p.scope.excludeIsrcs?.includes(i.isrc)) return false;
  const k = p.scope.kind;
  if (i.stream === 'publishing') {
    // The owner's publishing recoups an advance of any of the owner's artists if the scope includes publishing.
    return k === 'any' || k === 'publishing' || k === 'master_publishing';
  }
  // Master income recoups only positions of the same artist.
  if (i.artistId !== p.artistId) return false;
  // A position under a label is recouped from the master income of that label only (D-168).
  if (p.labelId !== null && i.labelId !== p.labelId) return false;
  if (k === 'isrcs') return i.isrc !== null && (p.scope.isrcs ?? []).includes(i.isrc);
  return k === 'any' || k === 'master' || k === 'master_publishing';
}

/**
 * Recoups positions only from income in their scope, after their date, largest position first (07, question 6:
 * temporary rule, "largest" = the position amount). The unrecouped rest waits for future income in scope and
 * never reduces other income. A position never takes more than the NET income in its scope (negative lines of
 * other ISRCs or months reduce it), so a scoped position cannot eat income outside its scope.
 */
export function recoup(positions: Position[], income: IncomeItem[]): RecoupResult[] {
  // Signed remaining amount per item: positives are consumed, negatives stay and reduce the net in scope.
  const capacity = new Map(income.map((i) => [i.id, i.amount]));
  const ordered = [...income].sort((a, b) =>
    a.reportMonth < b.reportMonth ? -1 : a.reportMonth > b.reportMonth ? 1 : a.id < b.id ? -1 : 1,
  );
  const byLargest = [...positions].sort(
    (a, b) =>
      b.amount.cmp(a.amount) || (a.month ?? '').localeCompare(b.month ?? '') || a.id.localeCompare(b.id),
  );
  const results: RecoupResult[] = [];
  for (const p of byLargest) {
    const inScope = ordered.filter((i) => eligible(p, i));
    const net = inScope.reduce((s, i) => s.add(capacity.get(i.id) as Decimal), new Decimal(0));
    let left = Decimal.min(p.amount, Decimal.max(net, 0));
    // A position that takes something first offsets the negative lines in its scope against positive ones and
    // uses both up, so a later position with an overlapping scope cannot take the income these negatives already
    // cancelled (D-094). A position that takes nothing changes nothing for the others (D-101).
    const caps = inScope.map((i) => capacity.get(i.id) as Decimal);
    const negatives = caps.reduce((s, c) => (c.lt(0) ? s.sub(c) : s), new Decimal(0));
    const positives = caps.reduce((s, c) => (c.gt(0) ? s.add(c) : s), new Decimal(0));
    let offsetPos = left.gt(0) ? Decimal.min(negatives, positives) : new Decimal(0);
    let offsetNeg = offsetPos;
    for (const i of inScope) {
      const cap = capacity.get(i.id) as Decimal;
      if (cap.gt(0) && offsetPos.gt(0)) {
        const take = Decimal.min(cap, offsetPos);
        capacity.set(i.id, cap.sub(take));
        offsetPos = offsetPos.sub(take);
      } else if (cap.lt(0) && offsetNeg.gt(0)) {
        const cover = Decimal.min(cap.neg(), offsetNeg);
        capacity.set(i.id, cap.add(cover));
        offsetNeg = offsetNeg.sub(cover);
      }
    }
    const consumed: { itemId: string; amount: Decimal }[] = [];
    for (const i of inScope) {
      if (left.lte(0)) break;
      const cap = capacity.get(i.id) as Decimal;
      if (cap.lte(0)) continue;
      const take = Decimal.min(cap, left);
      capacity.set(i.id, cap.sub(take));
      left = left.sub(take);
      consumed.push({ itemId: i.id, amount: take });
    }
    const recouped = consumed.reduce((s, c) => s.add(c.amount), new Decimal(0));
    results.push({
      positionId: p.id,
      amount: p.amount,
      recouped,
      remaining: p.amount.sub(recouped),
      consumed,
    });
  }
  return results;
}
