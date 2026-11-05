import { describe, expect, it } from 'vitest';
import { Decimal, ZERO } from '../src/shared/money';
import type { Reconciliation } from '../src/facade/calculation';
import { overviewTotals, type KpiSums } from '../src/facade/reports';

// The KPI cards of P1 (D-160): the totals of the overview are sums of the reconciliation rows made by the backend
// (R1: the frontend computes nothing). Pure, no stack; synthetic rows only.

const row = (
  source: 'believe' | 'b17',
  account: string,
  month: string,
  [A, B, C, ours, noSplit = '0']: [string, string, string, string, string?],
): Reconciliation => ({
  source,
  account,
  month,
  A_received: new Decimal(A),
  B_notOurs: new Decimal(B),
  C_waiting: new Decimal(C),
  C_breakdown: {},
  ourShare: new Decimal(ours),
  ourShareByLabel: {},
  ourShareNoSplit: new Decimal(noSplit),
  discrepancy: new Decimal(A).sub(B).sub(C).sub(ours),
  byLabel: {},
});

const text = (s: Partial<KpiSums>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.toJSON()]));

describe('overviewTotals (D-160)', () => {
  it('sums the six fields over all rows, per source and per source × account, exactly', () => {
    const rows = [
      row('believe', '2701100', '2026-03', ['100', '57.5', '23.375', '19.125']),
      row('believe', '2701100', '2026-04', ['50', '25', '0', '25', '25']),
      row('believe', '2701101', '2026-03', ['57', '25', '7', '25']),
      row('b17', 'b17', '2026-03', ['10.000000000001', '4', '0', '6.000000000001']),
    ];
    const t = overviewTotals(rows);
    expect(text(t.all)).toEqual({
      received: '217.000000000001',
      notOurs: '111.5',
      waiting: '30.375',
      ourShare: '75.125000000001',
      ourShareNoSplit: '25',
      discrepancy: '0',
    });
    expect(text(t.bySource.believe)).toEqual({
      received: '207',
      notOurs: '107.5',
      waiting: '30.375',
      ourShare: '69.125',
      ourShareNoSplit: '25',
      discrepancy: '0',
    });
    expect(text(t.bySource.b17).received).toBe('10.000000000001');
    expect(t.byAccount.map((a) => `${a.source}|${a.account}`)).toEqual(['b17|b17', 'believe|2701100', 'believe|2701101']);
    const first = t.byAccount[1];
    expect(first && text({ received: first.received, waiting: first.waiting, ourShareNoSplit: first.ourShareNoSplit })).toEqual({
      received: '150',
      waiting: '23.375',
      ourShareNoSplit: '25',
    });
  });

  it('carries a non-zero discrepancy into the totals and gives zeros for no rows', () => {
    const broken = row('believe', '2701100', '2026-03', ['100', '50', '0', '49']);
    expect(overviewTotals([broken]).all.discrepancy.toJSON()).toBe('1');
    const empty = overviewTotals([]);
    expect(empty.all.received.eq(ZERO)).toBe(true);
    expect(empty.byAccount).toEqual([]);
    expect(empty.bySource.b17.ourShare.toJSON()).toBe('0');
  });
});
