import { expect, test, type Browser, type Page } from '@playwright/test';
import { choose, labelOf, loginAs, seedKeys, seedUsers, toastOk } from '../helpers';

// 37-roles «Пользователи и роли» (D-171, 19 §6; no scenario of its own: the users of the seed): the label manager of A
// (0to8 only), the user of two organizations (the second login step), and the organization's administrator on P26
// (a manager created, suspended; a support grant given and revoked). Every test opens its own context; e2e-operator
// writes only users and grants of A here.

test.use({ storageState: { cookies: [], origins: [] } });

const code = async (res: { json: () => Promise<unknown> }) => ((await res.json()) as { error?: { code?: string } }).error?.code;

/** A fresh context signed in through P23 as a login with its password. */
async function signIn(browser: Browser, login: string, password: string): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByTestId('field-login').fill(login);
  await page.getByTestId('field-password').fill(password);
  await page.getByTestId('action-login').click();
  await expect(page.getByTestId('user-menu')).toHaveAttribute('data-login', login);
  return page;
}

test('a label manager works under 0to8 only: no «Все», no overview, approve closed, foreign label refused', async ({ page }) => {
  const own = labelOf('0to8');
  const other = labelOf('Echo8');
  await loginAs(page, 'manager');
  // no overview: the home is the first page of the sidebar the manager may read
  await expect(page).toHaveURL(/\/signals/);
  await expect(page.getByTestId('nav-overview')).toHaveCount(0);
  await expect(page.getByTestId('nav-queue')).toHaveCount(0);
  await expect(page.getByTestId('nav-users')).toHaveCount(0);
  await expect(page.getByTestId('nav-payouts')).toBeVisible();
  await expect(page.getByTestId('nav-documents')).toBeVisible();

  // the switch: 0to8 only, never «Все»
  await expect(page.getByTestId('label-switch')).toHaveAttribute('data-label', own);
  await page.getByTestId('field-label').click();
  await expect(page.getByRole('option')).toHaveText(['0to8']);
  await page.keyboard.press('Escape');
  // a link under «Все» or under another label falls back to 0to8
  await page.goto(`/documents?label=${other}`);
  await expect(page.getByTestId('label-switch')).toHaveAttribute('data-label', own);
  await expect(page).toHaveURL(new RegExp(`label=${own}`));

  // a write under 0to8 succeeds (a document of 0to8), its approval is closed: «нет права»
  await page.goto('/documents?q=Roles doc e2e');
  await expect(page.getByTestId('label-switch')).toHaveAttribute('data-label', own);
  await page.getByTestId('action-create-document').click();
  await page.getByTestId('field-document-title').fill('Roles doc e2e');
  await page.getByTestId('field-document-file-ref').fill('dummy://roles-doc.pdf');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/documents') && r.request().method() === 'POST');
  await page.getByTestId('action-create-document-submit').click();
  const createdRes = await created;
  expect(createdRes.status()).toBe(201);
  const docId = ((await createdRes.json()) as { id: string }).id;
  await toastOk(page, 'Документ создан');
  const row = page.getByTestId(`document-${docId}`);
  await expect(row.getByTestId('action-approve')).toBeDisabled();
  await expect(row.getByTestId('action-approve').locator('..')).toContainText('нет права');
  // the labels are the organization's administrator's: P17 opens, its create button is closed
  await page.goto(`/labels?label=${own}`);
  await expect(page.getByTestId('action-create-label')).toBeDisabled();
  await expect(page.getByTestId('action-create-label').locator('..')).toContainText('нет права');

  // the API says the same, whatever the screen shows
  const headers = { 'X-Operator': seedUsers().manager.login };
  const approve = await page.request.post(`/api/v1/documents/${docId}/approve`, { data: { by: 'x' }, headers });
  expect([approve.status(), await code(approve)]).toEqual([403, 'forbidden']);
  const foreign = await page.request.post('/api/v1/documents', {
    data: { kind: 'other', title: 'Roles foreign e2e', requiresApproval: true, labelId: other },
    headers,
  });
  expect([foreign.status(), await code(foreign)]).toEqual([403, 'label_forbidden']);
  const foreignRead = await page.request.get(`/api/v1/owners?label=${other}`);
  expect([foreignRead.status(), await code(foreignRead)]).toEqual([403, 'label_forbidden']);
  const noLabel = await page.request.get('/api/v1/owners');
  expect([noLabel.status(), await code(noLabel)]).toEqual([400, 'label_required']);
  const overview = await page.request.get('/api/v1/overview');
  expect(overview.status()).toBe(403);
  expect((await page.request.get(`/api/v1/owners?label=${own}`)).status()).toBe(200);
});

test('a user of two organizations chooses one at the login and works in it', async ({ page }) => {
  const { orgB } = seedKeys();
  const { login, password } = seedUsers().multi;
  await page.goto('/login');
  await page.getByTestId('field-login').fill(login);
  await page.getByTestId('field-password').fill(password);
  await page.getByTestId('action-login').click();
  // the second step: the organizations of the user, no error shown
  await expect(page.getByTestId('login-org-step')).toBeVisible();
  await expect(page.getByTestId('login-error')).toHaveCount(0);
  await choose(page, 'login-org', `${orgB.name} · администратор`);
  await page.getByTestId('action-login-org').click();
  await expect(page.getByTestId('user-menu')).toHaveAttribute('data-login', login);
  await expect(page.getByTestId('user-org')).toHaveAttribute('data-org-id', orgB.id);
  await page.goto(`/owners/${orgB.ownerId}`);
  await expect(page.getByTestId('owner-page-title')).toHaveText(orgB.ownerName);
});

test('the organization administrator creates a manager, suspends it (its session ends), grants and revokes support', async ({ page, browser }) => {
  await loginAs(page, 'operator', '/users');
  await expect(page.getByTestId('users-page')).toBeVisible();
  await expect(page.getByTestId(`user-${seedUsers().manager.login}`)).toBeVisible();

  // a label manager with 0to8
  await page.getByTestId('action-create-user').click();
  await page.getByTestId('field-user-login').fill('e2e-roles-mgr');
  await page.getByTestId('field-user-password').fill('e2e-roles-synthetic-pass');
  await choose(page, 'user-role', 'менеджер лейбла');
  await expect(page.getByTestId('action-create-user-submit')).toBeDisabled();
  await page.getByTestId(`field-user-label-${labelOf('0to8')}`).check();
  await page.getByTestId('action-create-user-submit').click();
  await toastOk(page, 'Создан пользователь e2e-roles-mgr');
  const row = page.getByTestId('user-e2e-roles-mgr');
  await expect(row.locator('[col-id="role"]')).toHaveText('менеджер лейбла');
  await expect(row.locator('[col-id="labels"]')).toHaveText('0to8');

  // the new manager signs in
  const mgr = await signIn(browser, 'e2e-roles-mgr', 'e2e-roles-synthetic-pass');
  await expect(mgr.getByTestId('label-switch')).toHaveAttribute('data-label', labelOf('0to8'));
  expect((await mgr.request.get('/api/v1/auth/me')).status()).toBe(200);

  // suspended: its session ends at once
  await row.getByTestId('action-edit-user').click();
  await choose(page, 'user-active', 'приостановлен');
  await page.getByTestId('action-edit-user-submit').click();
  await toastOk(page, 'Пользователь e2e-roles-mgr изменён');
  await expect(row.locator('[col-id="active"]')).toHaveText('нет');
  const after = await mgr.request.get('/api/v1/auth/me');
  expect([after.status(), await code(after)]).toEqual([401, 'unauthenticated']);
  await mgr.context().close();

  // support: a read-only grant to the system administrator, then revoked
  await page.getByTestId('tab-support').click();
  await page.getByTestId('action-grant-support').click();
  await page.getByTestId('field-support-login').fill(seedUsers().sysadmin.login);
  const granted = page.waitForResponse((r) => r.url().endsWith('/api/v1/support') && r.request().method() === 'POST');
  await page.getByTestId('action-grant-support-submit').click();
  const grantId = ((await (await granted).json()) as { id: string }).id;
  await toastOk(page, `Доступ поддержки выдан ${seedUsers().sysadmin.login}`);
  const grant = page.getByTestId(`support-${grantId}`);
  await expect(grant.locator('[col-id="state"] [data-state]')).toHaveAttribute('data-state', 'active');
  await expect(grant.locator('[col-id="write"]')).toHaveText('нет');
  await grant.getByTestId('action-revoke-support').click();
  await toastOk(page, 'Доступ поддержки отозван');
  await expect(grant.locator('[col-id="state"] [data-state]')).toHaveAttribute('data-state', 'revoked');
  await expect(grant.getByTestId('action-revoke-support')).toHaveCount(0);
});
