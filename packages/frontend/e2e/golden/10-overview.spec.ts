import { expect, test } from '@playwright/test';
import { account, apiError, expectMoneyCalls, expectP1, json, openAs, overviewRow, settled, trackErrors } from '../helpers';
import type { Page } from '@playwright/test';

// P1 «Обзор» (19 §4, S01–S11): the read-only rows of the reconciliation, keyed by source, account and month.
// Every number is the exact API string in `title`; the page never sums (no totals row).

const M = '2026-03';
/** [scenario, case, account index, month, "A / B / C / ours"] */
const ROWS: [number, number, number, string, string][] = [
  [1, 1, 0, M, '100 / 50 / 0 / 50'],
  [1, 2, 0, M, '100 / 50 / 0 / 50'],
  [2, 1, 0, M, '100 / 49.8 / 0 / 50.2'],
  [2, 2, 0, M, '100 / 50 / 0 / 50'],
  [2, 3, 0, M, '100 / 50 / 0 / 50'],
  [2, 4, 0, M, '100 / 66.6 / 0 / 33.4'],
  [2, 5, 0, M, '100 / 25 / 0 / 75'],
  [3, 1, 0, M, '100 / 50 / 0 / 50'],
  [3, 2, 0, M, '100 / 57.5 / 0 / 42.5'],
  [3, 3, 0, M, '100 / 57.5 / 0 / 42.5'],
  [3, 4, 0, M, '100 / 50 / 0 / 50'],
  [3, 5, 0, M, '100 / 100 / 0 / 0'],
  [3, 6, 0, M, '100 / 62.5 / 0 / 37.5'],
  [3, 7, 0, M, '100 / 65 / 0 / 35'],
  [3, 8, 0, M, '100 / 100 / 0 / 0'],
  [4, 1, 0, '2026-01', '100 / 50 / 0 / 50'],
  [4, 1, 0, M, '100 / 50 / 0 / 50'],
  [4, 2, 0, '2026-01', '100 / 50 / 0 / 50'],
  [4, 2, 0, M, '100 / 50 / 0 / 50'],
  [4, 3, 0, '2026-01', '100 / 50 / 0 / 50'],
  [4, 3, 0, '2026-02', '100 / 50 / 0 / 50'],
  [5, 1, 0, M, '100 / 75 / 0 / 25'],
  [5, 2, 0, M, '100 / 85 / 0 / 15'],
  [5, 3, 0, M, '100 / 100 / 0 / 0'],
  [5, 4, 0, M, '100 / 50 / 0 / 50'],
  [6, 1, 0, M, '100 / 50 / 0 / 50'],
  [6, 2, 0, M, '100 / 50 / 0 / 50'],
  [6, 3, 0, M, '100 / 75 / 0 / 25'],
  [6, 3, 0, '2026-04', '100 / 50 / 0 / 50'],
  [7, 1, 0, M, '-100 / -78.75 / 0 / -21.25'],
  [7, 2, 0, M, '0 / 0 / 0 / 0'],
  [8, 1, 0, M, '100 / 57.5 / 23.375 / 19.125'],
  [8, 2, 0, M, '100 / 57.5 / 23.375 / 19.125'],
  [8, 3, 0, M, '100 / 50 / 25 / 25'],
  [8, 4, 0, M, '100 / 0 / 100 / 0'], // D-175: the no-split share waits in C
  [9, 1, 0, M, '100 / 49.8 / 0 / 50.2'],
  [9, 2, 0, M, '100 / 10 / 0 / 90'],
  [10, 1, 0, M, '100 / 50 / 0 / 50'],
  [10, 1, 1, M, '50 / 25 / 0 / 25'],
  [10, 2, 0, M, '100 / 50 / 0 / 50'],
  [10, 2, 1, M, '57 / 25 / 7 / 25'],
  [11, 1, 0, M, '150 / 82.5 / 0 / 67.5'],
];

/** ourShareByLabel where 19 gives it: [scenario, case, account index, label, amount]. */
const BY_LABEL: [number, number, number, string, string][] = [
  [1, 1, 0, '0to8', '50'],
  [5, 1, 0, '0to8', '25'],
  [6, 1, 0, '0to8', '50'],
  [6, 2, 0, 'Echo8', '50'],
  [8, 3, 0, 'Echo8', '25'],
  [10, 1, 0, '0to8', '50'],
  [10, 1, 1, 'Echo8', '25'],
  [10, 2, 0, 'Echo8', '50'],
  [10, 2, 1, 'Echo8', '25'],
];

test('P1 rows of S01–S11: A / B / C / ours exact, discrepancy 0', async ({ page }) => {
  const errors = trackErrors(page);
  await openAs(page, '/');
  await settled(page);
  expectMoneyCalls(page, 1);
  for (const [nn, k, a, month, abco] of ROWS) await expectP1(page, account(nn, k, a), month, abco);
  for (const [nn, k, a, label, amount] of BY_LABEL)
    await expect(overviewRow(page, 'believe', account(nn, k, a), M).getByTestId(`by-label-${label}`).getByTestId('money')).toHaveAttribute('title', amount);
  // S08: the C breakdown by reason; S08/4: the no-split part (C `no_split` since D-175)
  await expect(overviewRow(page, 'believe', account(8, 1), M).getByTestId('c-reason-assumption').getByTestId('money')).toHaveAttribute('title', '23.375');
  await expect(overviewRow(page, 'believe', account(8, 4), M).locator('[data-col="noSplit"]').getByTestId('money')).toHaveAttribute('title', '100');
  // no totals row: the page shows rows only
  await expect(page.getByTestId('overview-table').locator('tfoot')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('P1 books (D-169): every Believe row sits in one book, the label of its file; ourShareByLabel stays by the string', async ({ page }) => {
  await openAs(page, '/');
  await settled(page);
  // account(0) of a case is loaded under 0to8, account(1) under Echo8: the string `Echo8` of S06/2, S08/3, S10/2 in a
  // file of account(0) books to 0to8 while its ours goes to `by-label-Echo8`
  for (const [nn, k, a, month] of ROWS) {
    const row = overviewRow(page, 'believe', account(nn, k, a), month);
    const book = a === 1 ? 'Echo8' : '0to8';
    await expect(row).toHaveAttribute('data-book', book);
    await expect(row.locator('[data-col="book"] [data-testid^="book-"]')).toHaveCount(1);
    await expect(row.getByTestId(`book-${book}`)).toBeVisible();
  }
  // every Believe row of the seed: one named book, never «без лейбла»
  const books = await page.locator('[data-testid^="overview-row-believe-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-book')));
  expect(books.length).toBeGreaterThan(0);
  expect(books.filter((b) => b === null || b === '' || b === '?' || b.includes(','))).toEqual([]);
});

test('P1 drill-down: the C cell of S10/2 opens the unknown_pair queue for that account and month', async ({ page }) => {
  await openAs(page, '/');
  await settled(page);
  const row = overviewRow(page, 'believe', account(10, 2, 1), M);
  await expect(row.getByTestId('c-reason-unknown_pair').getByTestId('money')).toHaveAttribute('title', '7');
  await row.getByTestId('c-reason-unknown_pair').getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/queue/unknown_pair\\?account=${account(10, 2, 1)}&month=${M}$`));
  await settled(page);
  const group = page.getByTestId('queue-group-pair-QZTST2710209|2710200000009');
  await expect(group).toBeVisible();
  await expect(group.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '7');
});

test('P1 links: B → tracks of the account and month, the account → its report lines, the strips → queue and signals', async ({ page }) => {
  await openAs(page, '/');
  await settled(page);
  const row = overviewRow(page, 'believe', account(1, 1), M);
  await expect(row.locator('[data-col="B"] a')).toHaveAttribute('href', `/tracks?account=${account(1, 1)}&month=${M}`);
  await expect(row.locator('[data-col="ours"] a').first()).toHaveAttribute('href', `/tracks?account=${account(1, 1)}&month=${M}`);
  await expect(row.getByRole('link', { name: account(1, 1) })).toHaveAttribute('href', `/sources/lines?account=${account(1, 1)}&month=${M}`);
  await expect(page.getByTestId('queue-chip-assumption')).toHaveAttribute('href', '/queue/assumption');
  await page.getByTestId('signal-chip-unfunded').click();
  await expect(page).toHaveURL(/\/signals\/unfunded$/);
});

test('P1 period filter is kept in the URL', async ({ page }) => {
  await openAs(page, '/?from=2026-04&to=2026-04');
  await settled(page);
  await expect(overviewRow(page, 'believe', account(6, 3), '2026-04')).toBeVisible();
  await expect(overviewRow(page, 'believe', account(1, 1), M)).toHaveCount(0);
});

// The KPI cards over the table (D-160): every headline is a field of `totals` of the same overview call (the page never
// sums); the account filter picks one account's entry; a card expands into the same metric by source and account.
const KPI = ['kpi-received', 'kpi-confirmed', 'kpi-waiting', 'kpi-ours'] as const;
const kpiValue = (page: Page, id: (typeof KPI)[number]) => page.getByTestId(id).getByTestId('money').first();

test('P1 KPI cards: the API totals, the identity check 0, one account by the filter, the breakdown by source and account', async ({ page }) => {
  const errors = trackErrors(page);
  const answered = page.waitForResponse((r) => r.url().includes('/api/v1/overview') && r.request().method() === 'GET');
  await openAs(page, '/');
  await settled(page);
  const { totals } = (await (await answered).json()) as {
    totals: { all: Record<string, string>; bySource: Record<'believe' | 'b17', Record<string, string>> };
  };
  expectMoneyCalls(page, 1);
  // the headline of every card is the exact total of the API; the check line says the rows add up
  await expect(kpiValue(page, 'kpi-received')).toHaveAttribute('title', totals.all.received ?? '');
  await expect(kpiValue(page, 'kpi-confirmed')).toHaveAttribute('title', totals.all.notOurs ?? '');
  await expect(kpiValue(page, 'kpi-waiting')).toHaveAttribute('title', totals.all.waiting ?? '');
  await expect(kpiValue(page, 'kpi-ours')).toHaveAttribute('title', totals.all.ourShare ?? '');
  await expect(page.getByTestId('kpi-ours-nosplit').getByTestId('money')).toHaveAttribute('title', totals.all.ourShareNoSplit ?? '');
  for (const id of KPI) {
    await expect(page.getByTestId(`${id}-check`)).toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId(`${id}-check`).getByTestId('money')).toHaveAttribute('title', '0');
  }
  // the account filter of the table selects the cards: S10/2, second account = 57 / 25 / 7 / 25
  await page.getByTestId('field-overview-account').fill(account(10, 2, 1));
  await expect(kpiValue(page, 'kpi-received')).toHaveAttribute('title', '57');
  await expect(kpiValue(page, 'kpi-confirmed')).toHaveAttribute('title', '25');
  await expect(kpiValue(page, 'kpi-waiting')).toHaveAttribute('title', '7');
  await expect(kpiValue(page, 'kpi-ours')).toHaveAttribute('title', '25');
  // a card expands into the breakdown of its metric: with the filter, the matching account only
  await page.getByTestId('kpi-waiting').click();
  await expect(page.getByTestId('kpi-waiting')).toHaveAttribute('data-active', 'true');
  const breakdown = page.getByTestId('kpi-breakdown');
  await expect(breakdown).toHaveAttribute('data-metric', 'waiting');
  await expect(breakdown.getByTestId(`kpi-breakdown-account-${account(10, 2, 1)}`).getByTestId('money')).toHaveAttribute('title', '7');
  await expect(breakdown.getByTestId('kpi-breakdown-believe')).toHaveCount(0);
  // several accounts match: no headline is invented, the breakdown lists them
  await page.getByTestId('field-overview-account').fill(account(10, 2).slice(0, -1));
  await expect(page.getByTestId('kpi-received-none')).toBeVisible();
  await expect(page.getByTestId('kpi-received-hint')).toBeVisible();
  await expect(breakdown.getByTestId(`kpi-breakdown-account-${account(10, 2, 0)}`).getByTestId('money')).toHaveAttribute('title', '0');
  await expect(breakdown.getByTestId(`kpi-breakdown-account-${account(10, 2, 1)}`).getByTestId('money')).toHaveAttribute('title', '7');
  // without the filter: Believe with its accounts, then B17, each the API's own sum
  await page.getByTestId('field-overview-account').fill('');
  await expect(breakdown.getByTestId('kpi-breakdown-believe').getByTestId('money')).toHaveAttribute('title', totals.bySource.believe.waiting ?? '');
  await expect(breakdown.getByTestId('kpi-breakdown-b17').getByTestId('money')).toHaveAttribute('title', totals.bySource.b17.waiting ?? '');
  await expect(breakdown.getByTestId(`kpi-breakdown-account-${account(10, 2, 1)}`).getByTestId('money')).toHaveAttribute('title', '7');
  // the chevron collapses it; the same money call served everything (R2)
  await page.getByTestId('kpi-waiting-toggle').click();
  await expect(page.getByTestId('kpi-breakdown')).toHaveCount(0);
  await expect(page.getByTestId('kpi-waiting')).toHaveAttribute('data-active', 'false');
  expectMoneyCalls(page, 1);
  expect(errors).toEqual([]);
});

// States of P1 (17 §8, 19 SS1–SS3 on the real page) with `page.route` mocks.
const zeroSums = { received: '0', notOurs: '0', waiting: '0', ourShare: '0', ourShareNoSplit: '0', discrepancy: '0' };
const emptyOverview = {
  calculatedAt: '2026-11-03T00:00:00.000Z',
  reconciliation: [],
  totals: { all: zeroSums, bySource: { believe: zeroSums, b17: zeroSums }, byAccount: [], byLabel: {}, byMonth: [] },
  queue: [],
  signals: [],
  files: { believe: 0, b17: 0 },
};

test('P1 empty: no files loaded -> the sentence and the link to the reports', async ({ page }) => {
  await page.route('**/api/v1/overview*', (route) => json(route, 200, emptyOverview));
  await openAs(page, '/');
  await expect(page.getByTestId('page-state-empty')).toContainText('отчёты не загружены');
  // the KPI cards show muted zeros over the empty state
  await expect(kpiValue(page, 'kpi-received')).toHaveAttribute('title', '0');
  await page.getByTestId('page-state-empty').getByRole('link').click();
  await expect(page).toHaveURL(/\/sources$/);
});

test('P1 long: a slow overview shows the recalculation panel, the shell stays usable', async ({ page }) => {
  await page.route('**/api/v1/overview*', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await json(route, 200, emptyOverview);
  });
  await openAs(page, '/');
  await expect(page.getByTestId('page-state-long')).toBeVisible();
  await expect(page.getByTestId('kpi-received-skeleton')).toBeVisible();
  await expect(page.getByTestId('recalc-indicator')).toBeVisible();
  await page.getByTestId('nav-questions').click();
  await expect(page.getByTestId('questions-page')).toBeVisible();
});

test('P1 error: the API code and message with a retry', async ({ page }) => {
  await page.route('**/api/v1/overview*', (route) => json(route, 500, apiError('internal', 'overview failed', 500)));
  await openAs(page, '/');
  await expect(page.getByTestId('error-code')).toHaveText('internal');
  await expect(page.getByTestId('error-message')).toHaveText('overview failed');
  await expect(page.getByTestId('action-retry')).toBeVisible();
});
