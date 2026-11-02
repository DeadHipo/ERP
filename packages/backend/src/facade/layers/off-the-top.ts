import { Decimal } from '../../shared/money';
import { allocation, canonical, reportDate } from './allocation';
import { distribute, pct, sumOf } from './exact';
import type { Layer, Shortfall } from './types';

const HUNDRED = new Decimal(100);

/**
 * Layer 3: participations (net, top) in force take `q(net × p / 100)` each before the split; the scaled net is the
 * rest by subtraction. If their percents sum above 100 (refused at entry, so only bad data), they are scaled down to
 * the net (quantised, residue to the largest), the scaled net is 0 and the excess is a shortfall.
 */
export const offTheTop: Layer = (s, ctx) => {
  const { unit } = s;
  const tops = ctx
    .participationsAt(unit.isrc, reportDate(unit))
    .filter((p) => p.fundedFrom === 'top' && !p.percent.isZero());
  if (tops.length === 0) return s;
  const targets = tops.map((p) => pct(unit.net, p.percent));
  let amounts = targets;
  const shortfalls: Shortfall[] = [];
  if (sumOf(tops.map((p) => p.percent)).gt(HUNDRED)) {
    amounts = distribute(
      unit.net,
      tops.map((p, i) => ({ key: canonical(ctx, p.artistId), weight: targets[i] as Decimal })),
    );
    tops.forEach((p, i) =>
      shortfalls.push({
        isrc: unit.isrc,
        upc: unit.upc,
        month: unit.reportingMonth,
        ruleId: p.id,
        missing: (targets[i] as Decimal).sub(amounts[i] as Decimal),
        why: 'top_above_100',
      }),
    );
  }
  const allocs = tops.map((p, i) =>
    allocation(ctx, {
      artistId: p.artistId,
      layer: 'top',
      kind: 'top',
      ruleId: p.id,
      documentId: p.documentId,
      percent: p.percent,
      amount: amounts[i] as Decimal,
    }),
  );
  const taken = sumOf(amounts);
  return {
    ...s,
    rows: [...s.rows, ...allocs],
    scaledNet: unit.net.sub(taken),
    labelShare: s.labelShare.sub(taken),
    shortfalls: [...s.shortfalls, ...shortfalls],
  };
};
