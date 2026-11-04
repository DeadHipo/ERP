import type { KpiSums, Overview } from '@erp/shared/api-responses';

/**
 * The KPI cards of P1 (D-160) pick their numbers from `totals` of `GET /overview`; nothing is summed here (R1).
 * The account filter of the table (`account.includes(text)`) selects the same accounts for the cards: no filter
 * shows `totals.all`; one matching account shows its own entry; several matching accounts cannot be summed on the
 * client, so the cards show no headline and list the accounts in the breakdown.
 */
export type KpiTotals = Overview['totals'];
export type KpiAccount = KpiTotals['byAccount'][number];
export type KpiMetric = 'received' | 'notOurs' | 'waiting' | 'ourShare';

export type KpiPick =
  | { kind: 'all'; sums: KpiSums }
  | { kind: 'account'; sums: KpiSums; account: KpiAccount }
  | { kind: 'ambiguous'; accounts: KpiAccount[] }
  | { kind: 'none' };

/** The same rule as the table filter of P1: a substring of the account (`'b17'` is the account of B17 rows). */
export function matchingAccounts(byAccount: readonly KpiAccount[], filter: string): KpiAccount[] {
  return filter === '' ? [...byAccount] : byAccount.filter((a) => a.account.includes(filter));
}

export function pickTotals(totals: KpiTotals, filter: string): KpiPick {
  if (filter === '') return { kind: 'all', sums: totals.all };
  const accounts = matchingAccounts(totals.byAccount, filter);
  const [one] = accounts;
  if (accounts.length === 1 && one) return { kind: 'account', sums: one, account: one };
  return accounts.length === 0 ? { kind: 'none' } : { kind: 'ambiguous', accounts };
}

export type KpiLine = { key: string; level: 0 | 1; source: 'believe' | 'b17'; account?: string; value: string };

/**
 * The breakdown of one metric by source and, inside Believe, by account: `believe` (the source total), its accounts,
 * then `b17`. With an account filter only the matching accounts are listed, each under its source, without the source
 * total (that total is of every account of the source, not of the filtered ones).
 */
export function breakdownLines(totals: KpiTotals, metric: KpiMetric, filter: string): KpiLine[] {
  const lines: KpiLine[] = [];
  const accounts = matchingAccounts(totals.byAccount, filter);
  for (const source of ['believe', 'b17'] as const) {
    const own = accounts.filter((a) => a.source === source);
    if (filter === '') lines.push({ key: source, level: 0, source, value: totals.bySource[source][metric] });
    else if (own.length === 0) continue;
    // B17 has one account ('b17'): its line is the source line itself unless the filter picked it
    if (source === 'b17' && filter === '') continue;
    for (const a of own) lines.push({ key: `account-${a.account}`, level: filter === '' ? 1 : 0, source, account: a.account, value: a[metric] });
  }
  return lines;
}
