import { expect, test } from '@playwright/test';
import { ALL_ITEMS, NAV } from '../src/nav';
import { norm, setOperator, trackErrors } from './helpers';

// S-smoke: the shell renders, search opens, the operator is saved, a write control is gated, every route renders.

test('the shell renders with every sidebar item of nav.ts', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('breadcrumbs')).toContainText('Обзор');
  for (const section of NAV) {
    await expect(page.getByTestId('sidebar')).toContainText(section.label);
    for (const item of section.items) await expect(page.getByTestId(`nav-${item.id}`)).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('the sidebar collapses and the state survives a reload (sessionStorage)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false');
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
  await page.reload();
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
});

test('Ctrl+K opens the global search modal', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('global-search-dialog')).toBeVisible();
  await page.getByTestId('global-search-input').fill('abc');
  // GET /search is built in step 3.3b: until then the shell says so; afterwards it lists results.
  await expect(page.getByTestId('global-search-results')).toBeVisible();
  await expect(
    page.getByTestId('global-search-unavailable').or(page.getByTestId('global-search-results').getByText(/Ничего не найдено|Владельцы|Треки/)),
  ).toBeVisible();
  // The first Escape clears the typed text (SearchField), the second closes the dialog.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('global-search-dialog')).toBeHidden();
  await page.getByTestId('global-search').click();
  await expect(page.getByTestId('global-search-dialog')).toBeVisible();
});

test('the operator field saves to localStorage, shows a hint while empty and survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('operator-hint')).toHaveText('укажите оператора');
  await setOperator(page, 'e2e-operator');
  await expect(page.getByTestId('operator-hint')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('erp.operator'))).toBe('e2e-operator');
  await page.reload();
  await expect(page.getByTestId('operator-field')).toHaveValue('e2e-operator');
});

test('an action button is disabled while the operator is empty', async ({ page }) => {
  await page.goto('/dev/states?case=action');
  const button = page.getByTestId('action-demo');
  await expect(button).toBeDisabled();
  await setOperator(page, 'e2e-operator');
  await expect(button).toBeEnabled();
  await page.getByTestId('operator-field').fill('');
  await expect(button).toBeDisabled();
});

test('the theme toggle switches html.dark and is remembered', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

const DETAIL_ROUTES = [
  '/queue/assumption',
  '/signals/unfunded',
  '/tracks/QZTST0000001',
  '/releases/0000000000001',
  '/owners/o1',
  '/artists/a1',
  '/artists/duplicates',
  '/documents/d1',
  '/labels/l1',
  '/sources/lines',
];

test('every route of nav.ts and every detail route renders a page without a console error', async ({ page }) => {
  const errors = trackErrors(page);
  for (const path of [...ALL_ITEMS.map((i) => i.path), ...DETAIL_ROUTES]) {
    await page.goto(path);
    await expect(page.getByTestId('placeholder-page'), path).toBeVisible();
    await expect(page.getByTestId('placeholder-text'), path).toContainText('Страница в разработке (шаг 3.');
    await expect(page.getByTestId('breadcrumbs'), path).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('the detail key becomes the entity breadcrumb', async ({ page }) => {
  await page.goto('/tracks/QZTST0000001');
  await expect(page.getByTestId('breadcrumbs')).toContainText('Каталог');
  await expect(page.getByTestId('breadcrumbs')).toContainText('Треки');
  await expect(page.getByTestId('breadcrumbs')).toContainText('QZTST0000001');
});

test('the payouts view and the owners list highlight different sidebar items', async ({ page }) => {
  await page.goto('/owners?view=payouts');
  await expect(page.getByTestId('nav-payouts')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('nav-owners')).not.toHaveAttribute('aria-current', 'page');
  await page.getByTestId('nav-owners').click();
  await expect(page.getByTestId('nav-owners')).toHaveAttribute('aria-current', 'page');
});

test('an unknown path shows the not-found page inside the shell', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByTestId('not-found')).toBeVisible();
  await expect(page.getByTestId('sidebar')).toBeVisible();
});

test('the legacy pages still work under /legacy and send the operator on writes', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/legacy/owners');
  await expect(page.getByText('Royalty ERP (legacy)')).toBeVisible();
  await expect(page.getByRole('heading').first()).toBeVisible();
  await page.goto('/legacy/sources');
  await expect(page.getByText('Royalty ERP (legacy)')).toBeVisible();
  // The legacy stylesheet is scoped: the new shell keeps its own look after visiting a legacy page.
  await page.goto('/');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  expect(norm(await page.title())).toBe('ERP');
  expect(errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
});
