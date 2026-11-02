import { allocation, reportDate } from './allocation';
import { capToBase, pct, sumOf } from './exact';
import type { Layer } from './types';

/**
 * Layer 4: the rows of the split in force at the report month take `q(scaledNet × percent / 100)` each (rows with
 * percent 0 are skipped); the label share is the rest by subtraction, never of the opposite sign of the unit (an
 * excess from rounding comes off the largest row, D-130). No split: status `no_split`, the label share
 * is the whole scaled net (D-029).
 */
export const split: Layer = (s, ctx) => {
  const sp = ctx.splitAt(s.unit.isrc, reportDate(s.unit));
  if (!sp) return { ...s, status: 'no_split' };
  const rows = sp.shares
    .filter((sh) => !sh.percent.isZero())
    .map((sh) =>
      allocation(ctx, {
        artistId: sh.artistId,
        layer: 'split',
        kind: 'row',
        ruleId: sp.splitId,
        documentId: sh.documentId ?? sp.documentId,
        percent: sh.percent,
        amount: pct(s.scaledNet, sh.percent),
      }),
    );
  // Rows summing to exactly 100 can exceed the base by a few pico after rounding: the excess comes off the largest
  // row, so the label share never has the opposite sign of the unit (D-130).
  const amounts = capToBase(
    s.labelShare,
    rows.map((r) => r.amount),
    rows.map((r) => r.artistId),
  );
  const capped = rows.map((r, i) => ({ ...r, amount: amounts[i] as typeof r.amount }));
  return {
    ...s,
    status: 'allocated',
    rows: [...s.rows, ...capped],
    labelShare: s.labelShare.sub(sumOf(amounts)),
  };
};
