import { allocation, reportDate } from './allocation';
import { pct, sumOf } from './exact';
import type { Layer } from './types';

/**
 * Layer 4: the rows of the split in force at the report month take `q(scaledNet × percent / 100)` each (rows with
 * percent 0 are skipped); the label share is the rest by subtraction. No split: status `no_split`, the label share
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
  return {
    ...s,
    status: 'allocated',
    rows: [...s.rows, ...rows],
    labelShare: s.labelShare.sub(sumOf(rows.map((r) => r.amount))),
  };
};
