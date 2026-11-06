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
 * One position over the capacities of its scope (`caps`, written in place): the netting of D-094, then the take,
 * oldest month first, with the forgivenesses of D-173. A forgiveness of month M frees the income of the months ≥ M:
 * before the first item of a month ≥ M it takes effect as `min(forgiven, amount − recouped so far − forgiven so far)`
 * (clamped at 0, D-173 К2: income of an earlier month may arrive after the forgiveness), and the capacity left for
 * the position becomes `amount − recouped so far − effective forgiveness`. The forgivenesses after the last item take
 * effect by the same rule. No multiplication: min, max and subtraction of cents and quantised amounts only (D-127).
 */
function settle(
  p: Position,
  inScope: IncomeItem[],
  caps: Map<string, Decimal>,
): { consumed: { itemId: string; amount: Decimal }[]; recouped: Decimal; forgiven: Decimal } {
  const forgiveness = [...(p.forgiven ?? [])].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const net = inScope.reduce((s, i) => s.add(caps.get(i.id) as Decimal), new Decimal(0));
  let left = Decimal.min(p.amount, Decimal.max(net, 0));
  // A position that takes something first offsets the negative lines in its scope against positive ones and
  // uses both up, so a later position with an overlapping scope cannot take the income these negatives already
  // cancelled (D-094). Whether it takes something is decided by the caller on a trial copy (D-101, D-173 FIX-1).
  const values = inScope.map((i) => caps.get(i.id) as Decimal);
  const negatives = values.reduce((s, c) => (c.lt(0) ? s.sub(c) : s), new Decimal(0));
  const positives = values.reduce((s, c) => (c.gt(0) ? s.add(c) : s), new Decimal(0));
  let offsetPos = left.gt(0) ? Decimal.min(negatives, positives) : new Decimal(0);
  let offsetNeg = offsetPos;
  for (const i of inScope) {
    const cap = caps.get(i.id) as Decimal;
    if (cap.gt(0) && offsetPos.gt(0)) {
      const take = Decimal.min(cap, offsetPos);
      caps.set(i.id, cap.sub(take));
      offsetPos = offsetPos.sub(take);
    } else if (cap.lt(0) && offsetNeg.gt(0)) {
      const cover = Decimal.min(cap.neg(), offsetNeg);
      caps.set(i.id, cap.add(cover));
      offsetNeg = offsetNeg.sub(cover);
    }
  }
  let recouped = new Decimal(0);
  let forgiven = new Decimal(0);
  let next = 0;
  // D-173: the forgivenesses of the months up to `month` (all of them for null) take effect in the order (date, id)
  const forgive = (month: string | null) => {
    while (next < forgiveness.length) {
      const f = forgiveness[next] as { month: string; amount: Decimal };
      if (month !== null && f.month > month) break;
      forgiven = forgiven.add(Decimal.min(f.amount, Decimal.max(p.amount.sub(recouped).sub(forgiven), 0)));
      next++;
      left = Decimal.min(left, Decimal.max(p.amount.sub(recouped).sub(forgiven), 0));
    }
  };
  const consumed: { itemId: string; amount: Decimal }[] = [];
  for (const i of inScope) {
    forgive(i.reportMonth);
    if (left.lte(0)) break;
    const cap = caps.get(i.id) as Decimal;
    if (cap.lte(0)) continue;
    const take = Decimal.min(cap, left);
    caps.set(i.id, cap.sub(take));
    left = left.sub(take);
    recouped = recouped.add(take);
    consumed.push({ itemId: i.id, amount: take });
  }
  forgive(null);
  return { consumed, recouped, forgiven };
}

/**
 * Recoups positions only from income in their scope, after their date, largest position first (07, question 6:
 * temporary rule, "largest" = the position amount). The unrecouped rest waits for future income in scope and
 * never reduces other income. A position never takes more than the NET income in its scope (negative lines of
 * other ISRCs or months reduce it), so a scoped position cannot eat income outside its scope.
 *
 * D-173: a forgiven advance (`Position.forgiven`) is recouped up to `amount − recouped before the date − effective
 * forgiveness` from the income of the months from the date on; `amount = recouped + forgiven + remaining`. Each
 * position runs on a trial copy of the capacities of its scope; the copy is kept only when the position takes
 * something, so a position that takes nothing (forgiven in full, or no net income) nets nothing for the others
 * (D-101, FIX-1). Without forgivenesses the result is the one before D-173.
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
    const trial = new Map(inScope.map((i) => [i.id, capacity.get(i.id) as Decimal]));
    const { consumed, recouped, forgiven } = settle(p, inScope, trial);
    if (recouped.gt(0)) for (const [id, cap] of trial) capacity.set(id, cap);
    results.push({
      positionId: p.id,
      amount: p.amount,
      recouped,
      forgiven,
      remaining: p.amount.sub(recouped).sub(forgiven),
      consumed,
    });
  }
  return results;
}
