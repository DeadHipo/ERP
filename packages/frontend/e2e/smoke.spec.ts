import { expect, test } from '@playwright/test';
import type { Me } from '@erp/shared/api-responses';
import { ALL_ITEMS, NAV, ORG_NAV, navFor } from '../src/nav';
import { meMock, OPERATOR, json, seedKeys, setOperator, trackErrors } from './helpers';

// S-smoke: the shell renders, search opens, the user menu names the session (the operator = the login, D-170), a write
// control is gated (login off), every route renders.

test('the shell renders with every sidebar item of nav.ts the session may read (D-171)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByTestId('breadcrumbs')).toContainText('Обзор');
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as Me;
  expect(me.role).toBe('org_admin');
  const sections = navFor({ isSystemAdmin: false, inOrg: true }, me);
  // the organization's administrator reads every page: the operator's sections and «Организация»
  expect(sections.map((s) => s.id)).toEqual([...NAV.map((s) => s.id), ORG_NAV.id]);
  for (const section of sections) {
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
  // the shortcut listens once the shell is up (after GET /auth/me)
  await expect(page.getByTestId('global-search')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('global-search-dialog')).toBeVisible();
  await page.getByTestId('global-search-input').fill('abc');
  await expect(page.getByTestId('global-search-results')).toBeVisible();
  await expect(page.getByTestId('global-search-results').getByText(/Ничего не найдено|Владельцы|Треки|Псевдонимы|Документы|Лейблы/).first()).toBeVisible();
  // The first Escape clears the typed text (SearchField), the second closes the dialog.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('global-search-dialog')).toBeHidden();
  await page.getByTestId('global-search').click();
  await expect(page.getByTestId('global-search-dialog')).toBeVisible();
});

test('the user menu names the login and the organization; the operator of writes is the login', async ({ page }) => {
  await page.goto('/');
  const menu = page.getByTestId('user-menu');
  await expect(menu).toHaveAttribute('data-login', OPERATOR);
  await expect(page.getByTestId('user-login')).toHaveText(OPERATOR);
  await expect(page.getByTestId('user-org')).toHaveAttribute('data-org-id', seedKeys().orgId);
  await expect(page.getByTestId('action-logout')).toBeVisible();
  await expect(page.getByTestId('operator-field')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('erp.operator'))).toBe(OPERATOR);
  // the system section is the system administrator's only
  await expect(page.getByTestId('nav-system-orgs')).toHaveCount(0);
});

test('with the login off the operator field is back, saves to localStorage and gates an action button', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => json(route, 200, meMock()));
  await page.addInitScript(() => localStorage.setItem('erp.operator', ''));
  await page.goto('/dev/states?case=action');
  await expect(page.getByTestId('user-menu')).toHaveCount(0);
  await expect(page.getByTestId('operator-hint')).toHaveText('укажите оператора');
  const button = page.getByTestId('action-demo');
  await expect(button).toBeDisabled();
  await setOperator(page, 'e2e-operator');
  await expect(page.getByTestId('operator-hint')).toBeHidden();
  await expect(button).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('erp.operator'))).toBe('e2e-operator');
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
  '/ads/a1',
  '/labels/l1',
  '/publishing-v2/s1',
  '/sources/lines',
];

/** Routes with a known root hook; every other page is found by the `<name>-page` suffix. */
const BUILT: Record<string, string> = {
  '/': 'overview-page',
  '/queue': 'queue-page',
  '/queue/assumption': 'queue-page',
  '/signals': 'signals-page',
  '/signals/unfunded': 'signals-page',
  '/questions': 'questions-page',
};

test('every route of nav.ts and every detail route renders a page without a console error', async ({ page }) => {
  const errors = trackErrors(page);
  for (const path of [...ALL_ITEMS.map((i) => i.path), ...ORG_NAV.items.map((i) => i.path), ...DETAIL_ROUTES]) {
    await page.goto(path);
    const built = BUILT[path.split('?')[0] ?? path];
    if (built) await expect(page.getByTestId(built), path).toBeVisible();
    else {
      // every page carries a root hook `<name>-page`
      await expect(
        page.locator('[data-testid$="-page"]').first(),
        path,
      ).toBeVisible();
    }
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
