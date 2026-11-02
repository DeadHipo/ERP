import { Decimal } from './money';

/**
 * Dollar check of contractual coverage against a reference workbook.
 * The calculation is not involved: a recording's label amount is receipts times
 * (100 minus the registered percents), the same remainder `calculate()` already uses.
 * A reference cell is not a reason to change that remainder. A gap of 20 dollars
 * or more is reported as its own case and left as it is.
 */

export const DOLLAR_CASE = new Decimal(20);

const PERCENT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;

export type DollarGap = 'within' | 'case';

export function participationPercents(text: string): Decimal[] {
  const found: Decimal[] = [];
  for (const match of text.matchAll(PERCENT_RE)) {
    const raw = match[1];
    if (raw) found.push(new Decimal(raw.replace(',', '.')));
  }
  return found;
}

/** 100 minus the given percents. A sum above 100 stays negative; it is not clamped. */
export function remainderPercent(percents: readonly Decimal[]): Decimal {
  return percents.reduce((left, percent) => left.sub(percent), new Decimal(100));
}

/** `receipts * percent / 100`, with percent in points (50 means half). */
export function amountFromPercent(receipts: Decimal, percent: Decimal): Decimal {
  return receipts.mul(percent).div(100);
}

export function dollarGap(left: Decimal, right: Decimal, tolerance: Decimal = DOLLAR_CASE): DollarGap {
  return left.sub(right).abs().gte(tolerance) ? 'case' : 'within';
}

export interface CoverageRow {
  isrc: string;
  /** Distributor net in the reference, for the whole checked window. */
  receipts: Decimal | null;
  /** Label amount the reference states for that window. */
  referenceLabel: Decimal | null;
  /** Percents written next to the recording, as points. */
  percents: readonly Decimal[];
  /**
   * Label fraction the reference states beside those percents, from 0 to 1.
   * Absent when the reference has no such cell.
   */
  referenceLabelFraction: Decimal | null;
  /** A later row of the same ISRC named different percents. Null when there is one row. */
  conflictingPercents: readonly Decimal[] | null;
}

export interface CoverageCase {
  kind: 'label_remainder' | 'reference_internal' | 'receipts' | 'reference_only' | 'warehouse_only' | 'duplicate_split';
  isrc: string;
  delta: string;
  left: string;
  right: string;
}

export interface CoverageReport {
  toleranceUsd: string;
  recordings: number;
  labelRemainder: { within: number; cases: number };
  referenceInternal: { within: number; cases: number; skipped: number };
  receipts: {
    within: number;
    cases: number;
    referenceOnly: number;
    /** In the reference, not in the warehouse, and under the tolerance. Not a case. */
    smallReferenceOnly: number;
    warehouseOnly: number;
    /** In the warehouse, not in the reference, and under the tolerance. Not a case. */
    smallWarehouseOnly: number;
    skipped: number;
  };
  /** Sum of reference receipts, and of the label amount the remainder rule gives. */
  totals: { receipts: string; labelByRemainder: string; referenceLabel: string };
  /**
   * Absolute dollars kept inside the tolerance, summed across recordings.
   * Each recording stays "within", and this shows whether those small gaps add up.
   */
  absorbedUsd: { labelRemainder: string; receipts: string };
  cases: CoverageCase[];
}

function money(value: Decimal): string {
  return value.toFixed();
}

function pushCase(
  cases: CoverageCase[],
  kind: CoverageCase['kind'],
  isrc: string,
  left: Decimal,
  right: Decimal,
): void {
  cases.push({
    kind,
    isrc,
    delta: money(left.sub(right)),
    left: money(left),
    right: money(right),
  });
}

/**
 * Compares one window of recordings.
 * `warehouseNets` is every ISRC the loaded reports returned for the window.
 * Pass null when the warehouse was not asked: receipt gaps are then skipped, not treated as missing.
 */
export function reconcileCoverage(
  rows: readonly CoverageRow[],
  warehouseNets: ReadonlyMap<string, Decimal> | null,
  tolerance: Decimal = DOLLAR_CASE,
): CoverageReport {
  const cases: CoverageCase[] = [];
  let labelWithin = 0;
  let labelCases = 0;
  let internalWithin = 0;
  let internalCases = 0;
  let internalSkipped = 0;
  let receiptWithin = 0;
  let receiptCases = 0;
  let referenceOnly = 0;
  let smallReferenceOnly = 0;
  let receiptSkipped = 0;
  let receipts = new Decimal(0);
  let labelByRemainder = new Decimal(0);
  let referenceLabel = new Decimal(0);
  let absorbedLabel = new Decimal(0);
  let absorbedReceipts = new Decimal(0);
  const seen = new Set<string>();

  for (const row of rows) {
    seen.add(row.isrc);
    const remainder = remainderPercent(row.percents);
    if (row.receipts) {
      receipts = receipts.add(row.receipts);
      const ours = amountFromPercent(row.receipts, remainder);
      labelByRemainder = labelByRemainder.add(ours);
      if (row.referenceLabel) {
        referenceLabel = referenceLabel.add(row.referenceLabel);
        const labelDelta = ours.sub(row.referenceLabel).abs();
        if (labelDelta.gte(tolerance)) {
          labelCases += 1;
          pushCase(cases, 'label_remainder', row.isrc, ours, row.referenceLabel);
        } else {
          labelWithin += 1;
          absorbedLabel = absorbedLabel.add(labelDelta);
        }
      }
      if (row.referenceLabelFraction && row.referenceLabel) {
        const stated = row.receipts.mul(row.referenceLabelFraction);
        if (dollarGap(stated, row.referenceLabel, tolerance) === 'case') {
          internalCases += 1;
          pushCase(cases, 'reference_internal', row.isrc, stated, row.referenceLabel);
        } else {
          internalWithin += 1;
        }
      } else {
        internalSkipped += 1;
      }
      if (row.conflictingPercents) {
        const other = amountFromPercent(row.receipts, remainderPercent(row.conflictingPercents));
        if (dollarGap(ours, other, tolerance) === 'case') {
          pushCase(cases, 'duplicate_split', row.isrc, ours, other);
        }
      }
    }

    if (!warehouseNets) {
      receiptSkipped += 1;
      continue;
    }
    const net = warehouseNets.get(row.isrc) ?? null;
    if (net === null) {
      if (row.receipts && dollarGap(row.receipts, new Decimal(0), tolerance) === 'case') {
        referenceOnly += 1;
        pushCase(cases, 'reference_only', row.isrc, row.receipts, new Decimal(0));
      } else {
        smallReferenceOnly += 1;
      }
      continue;
    }
    if (row.receipts === null) {
      receiptSkipped += 1;
      continue;
    }
    const receiptDelta = net.sub(row.receipts).abs();
    if (receiptDelta.gte(tolerance)) {
      receiptCases += 1;
      pushCase(cases, 'receipts', row.isrc, net, row.receipts);
    } else {
      receiptWithin += 1;
      absorbedReceipts = absorbedReceipts.add(receiptDelta);
    }
  }

  let warehouseOnly = 0;
  let smallWarehouseOnly = 0;
  if (warehouseNets) {
    for (const [isrc, net] of warehouseNets) {
      if (seen.has(isrc)) continue;
      if (dollarGap(net, new Decimal(0), tolerance) === 'case') {
        warehouseOnly += 1;
        pushCase(cases, 'warehouse_only', isrc, net, new Decimal(0));
      } else {
        smallWarehouseOnly += 1;
      }
    }
  }

  cases.sort((a, b) => new Decimal(b.delta).abs().cmp(new Decimal(a.delta).abs()));

  return {
    toleranceUsd: money(tolerance),
    recordings: rows.length,
    labelRemainder: { within: labelWithin, cases: labelCases },
    referenceInternal: { within: internalWithin, cases: internalCases, skipped: internalSkipped },
    receipts: {
      within: receiptWithin,
      cases: receiptCases,
      referenceOnly,
      smallReferenceOnly,
      warehouseOnly,
      smallWarehouseOnly,
      skipped: warehouseNets ? receiptSkipped : rows.length,
    },
    totals: {
      receipts: money(receipts),
      labelByRemainder: money(labelByRemainder),
      referenceLabel: money(referenceLabel),
    },
    absorbedUsd: {
      labelRemainder: money(absorbedLabel),
      receipts: money(absorbedReceipts),
    },
    cases,
  };
}

/** What the registered percents take from the reference receipts. The label keeps the rest. */
export function artistShareOfReceipts(rows: readonly CoverageRow[]): Decimal {
  let total = new Decimal(0);
  for (const row of rows) {
    if (!row.receipts) continue;
    const points = row.percents.reduce((sum, percent) => sum.add(percent), new Decimal(0));
    total = total.add(amountFromPercent(row.receipts, points));
  }
  return total;
}
