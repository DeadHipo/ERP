import { expect, test } from '@playwright/test';
import { apiError, json, norm, setOperator } from './helpers';

// SS1..SS7 of docs/agents/19_golden_screens.md plus the action controls, against `page.route` mocks, on the states
// fixture page /dev/states?case=<ss1..ss7|action> (the real pages arrive in steps 3.5..3.8).

const reconRow = (receivedA: string) => ({
  source: 'believe',
  account: '2799901',
  month: '2026-03',
  A_received: receivedA,
  B_notOurs: '0',
  C_waiting: '0',
  C_breakdown: {},
  ourShare: receivedA,
  ourShareByLabel: {},
  ourShareNoSplit: '0',
  discrepancy: '0',
  fileTotal: null,
  fileDiscrepancy: null,
  byLabel: {},
});

test('SS1: no files loaded -> the empty state with the upload link', async ({ page }) => {
  await page.route('**/api/v1/sources/files', (route) => json(route, 200, { believe: [], b17: [] }));
  await page.goto('/dev/states?case=ss1');
  await expect(page.getByTestId('page-state-empty')).toContainText('отчёты не загружены');
  await page.getByTestId('page-state-empty').getByRole('link').click();
  await expect(page).toHaveURL(/\/sources$/);
});

test('SS2: a slow money query -> the long state and the recalc indicator; the shell stays usable', async ({ page }) => {
  await page.route('**/api/v1/reconciliation*', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await json(route, 200, []);
  });
  await page.goto('/dev/states?case=ss2');
  await expect(page.getByTestId('page-state-long')).toContainText('идёт пересчёт, обычно 7–10 с');
  await expect(page.getByTestId('recalc-indicator')).toBeVisible();
  await page.getByTestId('nav-documents').click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByTestId('documents-page')).toBeVisible();
  await expect(page.getByTestId('recalc-indicator')).toBeHidden({ timeout: 10_000 });
});

test('SS3: a 500 -> the error state with code and message; retry refetches', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/v1/owners/o-ss3/balance*', (route) => {
    calls += 1;
    return json(route, 500, apiError('internal', 'balance failed', 500));
  });
  await page.goto('/dev/states?case=ss3');
  await expect(page.getByTestId('page-state-error')).toBeVisible();
  await expect(page.getByTestId('error-code')).toHaveText('internal');
  await expect(page.getByTestId('error-message')).toHaveText('balance failed');
  expect(calls).toBe(1);
  await page.getByTestId('action-retry').click();
  await expect.poll(() => calls).toBe(2);
});

test('SS4: a response of the wrong shape -> contract_mismatch', async ({ page }) => {
  await page.route('**/api/v1/tracks/QZTST0000001/explain*', (route) => json(route, 200, { isrc: 12345 }));
  await page.goto('/dev/states?case=ss4');
  await expect(page.getByTestId('page-state-error')).toBeVisible();
  await expect(page.getByTestId('error-code')).toHaveText('contract_mismatch');
  await expect(page.getByTestId('error-message')).toHaveText('ответ API не соответствует контракту');
});

test('SS5: after an action the money refetch is delayed -> old numbers stay with the stale badge', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/v1/reconciliation*', async (route) => {
    reads += 1;
    if (reads === 1) return json(route, 200, [reconRow('100.005')]);
    await new Promise((r) => setTimeout(r, 3000));
    return json(route, 200, [reconRow('200.5')]);
  });
  await page.route('**/api/v1/dev/echo', (route) => json(route, 200, { ok: true }));
  await page.goto('/dev/states?case=ss5');
  await setOperator(page, 'e2e-operator');
  const money = page.getByTestId('ss5-rows').getByTestId('money');
  await expect(money).toHaveAttribute('title', '100.005');
  expect(norm(await money.textContent())).toBe('100,01');
  await expect(page.getByTestId('stale-badge')).toBeHidden();

  await page.getByTestId('action-refresh').click();
  await expect(page.getByTestId('toast')).toHaveAttribute('data-code', 'ok');
  await expect(page.getByTestId('stale-badge')).toBeVisible();
  await expect(money).toHaveAttribute('title', '100.005'); // the old number is still there
  await expect(page.getByTestId('recalc-indicator')).toBeVisible();

  await expect(money).toHaveAttribute('title', '200.5');
  expect(norm(await money.textContent())).toBe('200,50');
  await expect(page.getByTestId('stale-badge')).toBeHidden();
});

test('SS6: 26,000 rows are paged on the client and a row of page 3 is addressable by [row-id]', async ({ page }) => {
  await page.goto('/dev/states?case=ss6');
  await expect(page.locator('[row-id="T00001"]')).toBeVisible();
  const first = page.locator('[row-id="T00001"]').getByTestId('money');
  await expect(first).toHaveAttribute('title', '1.016');
  expect(norm(await first.textContent())).toBe('1,02');
  await expect(page.locator('[row-id="T00101"]')).toHaveCount(0);

  const next = page.getByRole('button', { name: 'Следующая страница' });
  await next.click();
  await next.click();
  await expect(page.locator('[row-id="T00101"]')).toBeVisible();
  await expect(page.locator('[row-id="T00001"]')).toHaveCount(0);
  // The Russian pager text.
  await expect(page.locator('.ag-paging-panel')).toContainText('из');
  // Page-size selector offers 50 / 100 / 500.
  await expect(page.locator('.ag-paging-page-size')).toBeVisible();
});

test('SS6b: sort and filter live in the URL and are restored on reload', async ({ page }) => {
  await page.goto('/dev/states?case=ss6');
  await page.locator('.ag-header-cell[col-id="isrc"]').click();
  await page.locator('.ag-header-cell[col-id="isrc"]').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('g')).toContain('"isrc","desc"');
  await page.reload();
  await expect(page.locator('.ag-header-cell[col-id="isrc"]')).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('[row-id="T26000"]')).toBeVisible();
});

test('SS7: the picker shows at most 10 matches per typed query, never the 2,100 owners', async ({ page }) => {
  const owners = Array.from({ length: 2100 }, (_, i) => ({
    id: `own-${i + 1}`,
    name: `Owner ${String(i + 1).padStart(4, '0')}`,
    status: 'confirmed',
    kind: 'person',
  }));
  const requests: string[] = [];
  await page.route('**/api/v1/search*', (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    // A greedy mock: it returns up to 50 matches, the picker must still cap the list at 10.
    const owner = owners.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 50);
    return json(route, 200, { owners: owner, artists: [], tracks: [], documents: [], labels: [] });
  });
  await page.goto('/dev/states?case=ss7');
  const input = page.getByTestId('field-owner');
  await input.click();
  await input.fill('Owner 00');
  const options = page.getByRole('option', { name: /^Owner \d{4}$/ });
  await expect(options.first()).toBeVisible();
  expect(await options.count()).toBeLessThanOrEqual(10);
  expect(await options.count()).toBeGreaterThan(1);
  expect(requests.join(' | ')).toContain('kinds=owners');

  await input.fill('Owner 2100');
  await expect(options).toHaveCount(1);
  await options.first().click();
  await expect(page.getByTestId('ss7-picked')).toHaveText('own-2100');
});

test('actions: confirm dialog, one request on a double click, success and error toasts', async ({ page }) => {
  let calls = 0;
  let mode: 'ok' | 'conflict' = 'ok';
  await page.route('**/api/v1/dev/echo', async (route) => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 600));
    if (mode === 'ok') return json(route, 200, { ok: true });
    return json(route, 409, apiError('rule_overlap', 'a rule is already in force', 409));
  });
  await page.goto('/dev/states?case=action');
  await setOperator(page, 'e2e-operator');
  await page.getByTestId('action-demo').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('confirm-dialog')).toContainText('e2e-operator');
  await expect(page.getByTestId('confirm-dialog')).toContainText('Будет отправлен один запрос');
  await page.getByTestId('confirm-dialog-ok').dblclick();
  await expect(page.getByTestId('toast')).toHaveAttribute('data-code', 'ok');
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
  expect(calls).toBe(1);

  mode = 'conflict';
  await page.getByTestId('action-demo').click();
  await page.getByTestId('confirm-dialog-ok').click();
  const error = page.getByTestId('toast').and(page.locator('[data-code="rule_overlap"]'));
  await expect(error).toContainText('a rule is already in force');
  expect(calls).toBe(2);

  // Cancel closes without a request.
  await page.getByTestId('action-demo').click();
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
  expect(calls).toBe(2);
});

test('the X-Operator header is sent URI-encoded on writes', async ({ page }) => {
  let header: string | undefined;
  await page.route('**/api/v1/dev/echo', (route) => {
    header = route.request().headers()['x-operator'];
    return json(route, 200, { ok: true });
  });
  await page.goto('/dev/states?case=action');
  await setOperator(page, 'Оператор Тест');
  await page.getByTestId('action-demo').click();
  await page.getByTestId('confirm-dialog-ok').click();
  await expect(page.getByTestId('toast')).toBeVisible();
  expect(header).toBe(encodeURIComponent('Оператор Тест'));
});

test('status chips carry chip-<value> hooks and Russian labels', async ({ page }) => {
  await page.goto('/dev/states?case=action');
  await expect(page.getByTestId('chip-approved')).toHaveText('утверждён');
  await expect(page.getByTestId('chip-assumption')).toContainText('допущение');
  await expect(page.getByTestId('chip-waiting_documents')).toHaveText('ждёт документов');
});
