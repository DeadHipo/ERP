import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/shared/money';
import {
  deriveLabelPercent,
  labelAmount,
  parseBuyoutParty,
  parseParties,
  parsePercents,
  shareGap,
} from '../src/shared/share-layers';

describe('share layers', () => {
  it('deducts every itemized party and leaves the rest with the label', () => {
    const parties = parseParties('Alpha 25%; Beta 25%');
    expect(parties.map((party) => party.percent.toFixed())).toEqual(['25', '25']);
    const derived = deriveLabelPercent({ parties });
    expect(derived).toMatchObject({ rule: 'remainder' });
    expect(derived.percent.toFixed()).toBe('50');
  });

  it('a buyout removes only the named party', () => {
    const parties = parseParties('Alpha 40%; Beta 10%');
    const derived = deriveLabelPercent({ parties, buyoutParty: parseBuyoutParty('register; выкуп: Alpha') });
    expect(derived.rule).toBe('buyout');
    expect(derived.percent.toFixed()).toBe('90');
  });

  it('an outside percent is deducted, and a repeat of the same sum is not deducted twice', () => {
    const parties = parseParties('Alpha 50%');
    const extra = deriveLabelPercent({ parties, outsidePercents: parsePercents('sub-label allocation 25%') });
    expect(extra.rule).toBe('outside_extra');
    expect(extra.percent.toFixed()).toBe('25');
    const repeat = deriveLabelPercent({ parties, outsidePercents: [new Decimal(50)] });
    expect(repeat.rule).toBe('outside_repeat');
    expect(repeat.percent.toFixed()).toBe('50');
  });

  it('with nobody itemized, the term uses its own label percent, or allocates nothing', () => {
    expect(deriveLabelPercent({ parties: [], explicitLabelPercent: new Decimal(50) })).toMatchObject({
      rule: 'explicit',
      percent: new Decimal(50),
    });
    expect(deriveLabelPercent({ parties: [] }).rule).toBe('unallocated');
    expect(deriveLabelPercent({ parties: [] }).percent.toFixed()).toBe('0');
  });

  it('a month outside every term adds nothing, and 20 dollars is the case line', () => {
    const amount = labelAmount(
      [
        { month: '2026-01', receipts: new Decimal(100) },
        { month: '2026-02', receipts: new Decimal(100) },
      ],
      [{ from: '2026-02', to: '2026-02', percent: new Decimal(50) }],
    );
    expect(amount?.toFixed()).toBe('50');
    expect(shareGap(amount, new Decimal(50))).toBe('within');
    expect(shareGap(amount, new Decimal(80))).toBe('case');
    expect(labelAmount([{ month: '2026-01', receipts: new Decimal(10) }], [
      { from: '2026-01', to: '2026-01', percent: new Decimal(40) },
      { from: '2026-01', to: '2026-01', percent: new Decimal(80) },
    ])).toBeNull();
  });
});
