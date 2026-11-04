import { describe, expect, it } from 'vitest';
import type { KpiSums } from '@erp/shared/api-responses';
import { breakdownLines, matchingAccounts, pickTotals, type KpiTotals } from '../src/pages/work/overview-kpi';

// The KPI cards of P1 (D-160) pick their numbers from `totals` of the overview and never sum (R1): no filter shows
// `all`, one matching account its own entry, several matching accounts no headline. Synthetic accounts and amounts.

const sums = (received: string, notOurs = '0', waiting = '0', ourShare = '0', ourShareNoSplit = '0', discrepancy = '0'): KpiSums => ({
  received,
  notOurs,
  waiting,
  ourShare,
  ourShareNoSplit,
  discrepancy,
});

const totals: KpiTotals = {
  all: sums('217', '111.5', '30.375', '75.125', '25'),
  bySource: { believe: sums('207', '107.5', '30.375', '69.125', '25'), b17: sums('10', '4', '0', '6') },
  byAccount: [
    { source: 'b17', account: 'b17', ...sums('10', '4', '0', '6') },
    { source: 'believe', account: '2701100', ...sums('150', '82.5', '23.375', '44.125', '25') },
    { source: 'believe', account: '2701101', ...sums('57', '25', '7', '25') },
  ],
};

describe('pickTotals (D-160)', () => {
  it('shows the overall totals of the API without a filter', () => {
    expect(pickTotals(totals, '')).toEqual({ kind: 'all', sums: totals.all });
  });
  it('shows the entry of the one account the filter matches, exactly as the API sent it', () => {
    const pick = pickTotals(totals, '2701101');
    expect(pick.kind).toBe('account');
    if (pick.kind === 'account') {
      expect(pick.sums.received).toBe('57');
      expect(pick.sums.waiting).toBe('7');
      expect(pick.account.account).toBe('2701101');
    }
  });
  it('matches a substring like the table filter and refuses to sum several accounts', () => {
    expect(matchingAccounts(totals.byAccount, '27011').map((a) => a.account)).toEqual(['2701100', '2701101']);
    const pick = pickTotals(totals, '27011');
    expect(pick.kind).toBe('ambiguous');
    if (pick.kind === 'ambiguous') expect(pick.accounts.map((a) => a.account)).toEqual(['2701100', '2701101']);
    expect(pickTotals(totals, '9999')).toEqual({ kind: 'none' });
  });
  it('picks the B17 entry by its account name', () => {
    expect(pickTotals(totals, 'b17')).toMatchObject({ kind: 'account', sums: { received: '10' } });
  });
});

describe('breakdownLines (D-160)', () => {
  it('lists Believe, its accounts indented, then B17, with the metric of each entry', () => {
    expect(breakdownLines(totals, 'waiting', '')).toEqual([
      { key: 'believe', level: 0, source: 'believe', value: '30.375' },
      { key: 'account-2701100', level: 1, source: 'believe', account: '2701100', value: '23.375' },
      { key: 'account-2701101', level: 1, source: 'believe', account: '2701101', value: '7' },
      { key: 'b17', level: 0, source: 'b17', value: '0' },
    ]);
  });
  it('lists only the matching accounts under a filter, without a source total that would cover other accounts', () => {
    expect(breakdownLines(totals, 'received', '27011')).toEqual([
      { key: 'account-2701100', level: 0, source: 'believe', account: '2701100', value: '150' },
      { key: 'account-2701101', level: 0, source: 'believe', account: '2701101', value: '57' },
    ]);
    expect(breakdownLines(totals, 'ourShare', 'b17')).toEqual([{ key: 'account-b17', level: 0, source: 'b17', account: 'b17', value: '6' }]);
    expect(breakdownLines(totals, 'received', 'none')).toEqual([]);
  });
});
