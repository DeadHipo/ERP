import { expect, test } from '@playwright/test';
import { account, apiError, expectP1, json, openAs, overviewRow, settled, trackErrors } from '../helpers';

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
  [8, 4, 0, M, '100 / 0 / 50 / 50'],
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
  for (const [nn, k, a, month, abco] of ROWS) await expectP1(page, account(nn, k, a), month, abco);
  for (const [nn, k, a, label, amount] of BY_LABEL)
    await expect(overviewRow(page, 'believe', account(nn, k, a), M).getByTestId(`by-label-${label}`).getByTestId('money')).toHaveAttribute('title', amount);
  // S08: the C breakdown by reason; S08/4: the no-split part of ours
  await expect(overviewRow(page, 'believe', account(8, 1), M).getByTestId('c-reason-assumption').getByTestId('money')).toHaveAttribute('title', '23.375');
  await expect(overviewRow(page, 'believe', account(8, 4), M).locator('[data-col="noSplit"]').getByTestId('money')).toHaveAttribute('title', '50');
  // no totals row: the page shows rows only
  await expect(page.getByTestId('overview-table').locator('tfoot')).toHaveCount(0);
  expect(errors).toEqual([]);
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

// States of P1 (17 §8, 19 SS1–SS3 on the real page) with `page.route` mocks.
const emptyOverview = { calculatedAt: '2026-11-03T00:00:00.000Z', reconciliation: [], queue: [], signals: [], files: { believe: 0, b17: 0 } };

test('P1 empty: no files loaded -> the sentence and the link to the reports', async ({ page }) => {
  await page.route('**/api/v1/overview*', (route) => json(route, 200, emptyOverview));
  await openAs(page, '/');
  await expect(page.getByTestId('page-state-empty')).toContainText('отчёты не загружены');
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
