import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/shared/money';
import {
  amountFromPercent,
  artistShareOfReceipts,
  dollarGap,
  participationPercents,
  reconcileCoverage,
  remainderPercent,
  type CoverageRow,
} from '../src/shared/coverage-check';

const ISRC = 'QZTST2600101';

function row(partial: Partial<CoverageRow> & Pick<CoverageRow, 'isrc'>): CoverageRow {
  return {
    receipts: null,
    referenceLabel: null,
    percents: [],
    referenceLabelFraction: null,
    conflictingPercents: null,
    ...partial,
  };
}

describe('coverage check: remainder, not a new formula', () => {
  it('reads percents and leaves the label the rest of the hundred', () => {
    const percents = participationPercents('One 25%; Two 25%');
    expect(percents.map((percent) => percent.toFixed())).toEqual(['25', '25']);
    expect(remainderPercent(percents).toFixed()).toBe('50');
    expect(amountFromPercent(new Decimal('447364.22'), remainderPercent(percents)).toFixed(2)).toBe('223682.11');
  });

  it('keeps a comma decimal and does not clamp a stack above 100', () => {
    expect(participationPercents('16,6%').map((percent) => percent.toFixed())).toEqual(['16.6']);
    expect(remainderPercent([new Decimal(60), new Decimal(50)]).toFixed()).toBe('-10');
    expect(remainderPercent([]).toFixed()).toBe('100');
  });

  it('a gap of 20 dollars or more is its own case', () => {
    expect(dollarGap(new Decimal(100), new Decimal('119.99'))).toBe('within');
    expect(dollarGap(new Decimal(100), new Decimal(120))).toBe('case');
    expect(dollarGap(new Decimal(100), new Decimal(80))).toBe('case');
  });

  it('compares the remainder to the reference label amount and leaves a large gap as a case', () => {
    const report = reconcileCoverage(
      [
        row({
          isrc: ISRC,
          receipts: new Decimal(1000),
          percents: [new Decimal(50)],
          referenceLabel: new Decimal(400),
          referenceLabelFraction: new Decimal('0.4'),
        }),
        row({
          isrc: 'QZTST2600102',
          receipts: new Decimal(1000),
          percents: [new Decimal(50)],
          referenceLabel: new Decimal(500),
          referenceLabelFraction: new Decimal('0.9'),
        }),
      ],
      null,
    );
    expect(report.labelRemainder).toEqual({ within: 1, cases: 1 });
    expect(report.cases.filter((item) => item.kind === 'label_remainder')).toEqual([
      { kind: 'label_remainder', isrc: ISRC, delta: '100', left: '500', right: '400' },
    ]);
    // The reference's own fraction disagrees with its label amount on the second recording.
    expect(report.referenceInternal.cases).toBe(1);
    expect(report.cases.find((item) => item.kind === 'reference_internal')?.isrc).toBe('QZTST2600102');
    expect(report.receipts.skipped).toBe(2);
  });

  it('a receipt gap under 20 dollars is absorbed; a warehouse-only recording of 20 or more is a case', () => {
    const report = reconcileCoverage(
      [
        row({
          isrc: ISRC,
          receipts: new Decimal(1000),
          percents: [new Decimal(40)],
          referenceLabel: new Decimal(600),
          referenceLabelFraction: new Decimal('0.6'),
        }),
      ],
      new Map([
        [ISRC, new Decimal(1010)],
        ['QZTST2600199', new Decimal(25)],
        ['QZTST2600198', new Decimal(5)],
      ]),
    );
    expect(report.receipts).toMatchObject({
      within: 1,
      cases: 0,
      warehouseOnly: 1,
      smallWarehouseOnly: 1,
      referenceOnly: 0,
    });
    expect(report.absorbedUsd.receipts).toBe('10');
    expect(report.cases.map((item) => item.kind)).toEqual(['warehouse_only']);
    expect(report.cases[0]?.isrc).toBe('QZTST2600199');
  });

  it('two different percent rows for one recording are a case when the label amount moves by 20 dollars or more', () => {
    const report = reconcileCoverage(
      [
        row({
          isrc: ISRC,
          receipts: new Decimal(1000),
          percents: [new Decimal(50)],
          referenceLabel: new Decimal(500),
          referenceLabelFraction: new Decimal('0.5'),
          conflictingPercents: [new Decimal(25)],
        }),
      ],
      null,
    );
    expect(report.cases.filter((item) => item.kind === 'duplicate_split')).toEqual([
      { kind: 'duplicate_split', isrc: ISRC, delta: '-250', left: '500', right: '750' },
    ]);
  });

  it('the artist share of receipts is the part the percents take; the royalty ledger is a different list and is not a case here', () => {
    const rows = [row({ isrc: ISRC, receipts: new Decimal(1000), percents: [new Decimal(40)] })];
    expect(artistShareOfReceipts(rows).toFixed()).toBe('400');
  });
});
