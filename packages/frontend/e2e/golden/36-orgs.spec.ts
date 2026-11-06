import { expect, test, type APIRequestContext } from '@playwright/test';
import { choose, loginAs, seedKeys, seedUsers, toastOk } from '../helpers';

// 36-orgs «Граница арендатора» (D-170, 19 §6; no scenario of its own: the users and organization B of the seed): the login, organization B seen from its own user, the system administrator's
// pages P24/P25. Every test opens its own context without the session of e2e-operator. Organization A is never written
// to here; B gets one owner (its own scenario), C is created by the system administrator.

test.use({ storageState: { cookies: [], origins: [] } });

const keys = () => seedKeys();

/** The trail of one entity in the organization of the session (or of `X-Org` for the system administrator). */
async function auditOf(request: APIRequestContext, entityId: string, org?: string) {
  const res = await request.get(`/api/v1/audit?entityId=${encodeURIComponent(entityId)}`, {
    headers: org ? { 'X-Org': org } : {},
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: { operator: string; route: string; method: string }[] }).items;
}

test('without a session every page leads to the login, which returns to the page asked for', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login-page')).toBeVisible();

  // a wrong password is the Russian sentence of invalid_credentials
  await page.getByTestId('field-login').fill(seedUsers().operator.login);
  await page.getByTestId('field-password').fill('wrong-password');
  await page.getByTestId('action-login').click();
  await expect(page.getByTestId('login-error')).toHaveAttribute('data-code', 'invalid_credentials');
  await expect(page.getByTestId('login-error')).toHaveText('Неверный логин или пароль');

  // a deep link keeps its path in ?next=
  await page.goto('/owners');
  await expect(page).toHaveURL(/\/login\?next=%2Fowners$/);
  await page.getByTestId('field-login').fill(seedUsers().operator.login);
  await page.getByTestId('field-password').fill(seedUsers().operator.password);
  await page.getByTestId('action-login').click();
  await expect(page).toHaveURL(/\/owners$/);
  await expect(page.getByTestId('user-menu')).toHaveAttribute('data-login', seedUsers().operator.login);
});

test('the system administrator lists the organizations, creates C and its user, and works in C', async ({ page, browser }) => {
  const { orgB, orgId } = keys();
  await loginAs(page, 'sysadmin');
  // no organization chosen: only the system pages
  await expect(page).toHaveURL(/\/system\/orgs$/);
  await expect(page.getByTestId('nav-system-orgs')).toBeVisible();
  await expect(page.getByTestId('nav-overview')).toHaveCount(0);
  await expect(page.getByTestId('label-switch')).toHaveCount(0);

  const rowA = page.getByTestId(`org-${orgId}`);
  const rowB = page.getByTestId(`org-${orgB.id}`);
  await expect(rowA).toBeVisible();
  // D-171: e2e-multi is a member of A and of B besides their own users
  await expect(rowA.locator('[data-col="users"]')).toHaveText('3');
  await expect(rowB).toContainText(orgB.name);
  for (const [col, n] of [['labels', '1'], ['files', '0'], ['statements', '0'], ['owners', '1'], ['users', '2']] as const)
    await expect(rowB.locator(`[data-col="${col}"]`), col).toHaveText(n);

  // create organization C
  await page.getByTestId('action-create-org').click();
  await page.getByTestId('field-org-name').fill('Org C e2e');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/orgs') && r.request().method() === 'POST');
  await page.getByTestId('action-create-org-submit').click();
  const orgC = ((await (await created).json()) as { id: string }).id;
  await toastOk(page, 'Создана организация Org C e2e');
  await expect(page.getByTestId(`org-${orgC}`)).toBeVisible();

  // its user
  await page.getByTestId(`org-link-${orgC}`).click();
  await expect(page.getByTestId('org-page')).toHaveAttribute('data-org-id', orgC);
  await expect(page.getByTestId('org-counts')).toContainText('пользователей: 0');
  await page.getByTestId('action-create-user').click();
  await page.getByTestId('field-user-login').fill('e2e-c');
  await page.getByTestId('field-user-password').fill('e2e-c-synthetic-pass');
  // a label manager needs own labels of C, a read inside C: without a support grant the system administrator cannot
  // read them (D-171); an administrator of the organization needs none
  await choose(page, 'user-role', 'менеджер лейбла');
  await expect(page.getByTestId('user-labels-unavailable')).toHaveText('Нужен доступ поддержки от администратора организации');
  await expect(page.getByTestId('action-create-user-submit')).toBeDisabled();
  await choose(page, 'user-role', 'администратор организации');
  await page.getByTestId('action-create-user-submit').click();
  await toastOk(page, 'Создан пользователь e2e-c');
  const userC = page.getByTestId('org-user-e2e-c');
  await expect(userC).toBeVisible();
  await expect(userC.locator('[col-id="role"]')).toHaveText('администратор организации');
  await expect(userC.locator('[col-id="active"]')).toHaveText('да');

  // «Работать в организации» is closed until the administrator of C grants support (D-171)
  await expect(page.getByTestId('org-support')).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('action-work-in-org')).toBeDisabled();
  await expect(page.getByTestId('org-page')).toContainText('Нужен доступ поддержки от администратора организации');
  // the API says the same: no organization read without a grant
  const refused = await page.request.get('/api/v1/labels', { headers: { 'X-Org': orgC } });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('support_required');

  // the new user of C sees an empty overview and grants support to the system administrator for an hour, with writes
  const c = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const cPage = await c.newPage();
  await cPage.goto('/login');
  await cPage.getByTestId('field-login').fill('e2e-c');
  await cPage.getByTestId('field-password').fill('e2e-c-synthetic-pass');
  await cPage.getByTestId('action-login').click();
  await expect(cPage.getByTestId('user-org')).toContainText('Org C e2e');
  await expect(cPage.getByTestId('overview-page').getByTestId('page-state-empty')).toBeVisible();
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const grant = await cPage.request.post('/api/v1/support', {
    data: { login: seedUsers().sysadmin.login, expiresAt, write: true },
    headers: { 'X-Operator': 'e2e-c' },
  });
  expect(grant.status()).toBe(201);
  const grantId = ((await grant.json()) as { id: string }).id;
  expect((await auditOf(cPage.request, grantId)).map((a) => `${a.operator} ${a.method} ${a.route}`)).toEqual(['e2e-c POST /support']);
  await c.close();

  // now the system administrator works in C as support: the shell is C's, C has no labels
  await page.reload();
  await expect(page.getByTestId('org-support')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('org-support')).toContainText('с записью');
  await page.getByTestId('action-work-in-org').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('user-org')).toHaveAttribute('data-org-id', orgC);
  await expect(page.getByTestId('user-org')).toContainText('Org C e2e');
  await expect(page.getByTestId('user-org')).toContainText('поддержка');
  await expect(page.getByTestId('support-banner')).toHaveAttribute('data-write', 'true');
  await page.goto('/labels');
  await expect(page.getByTestId('labels-page').getByTestId('page-state-empty')).toBeVisible();

  // the writes of the system administrator and the enter are in the audit of C under their login
  const trail = await auditOf(page.request, orgC, orgC);
  expect(trail.map((a) => `${a.operator} ${a.method} ${a.route}`).sort()).toEqual([
    'e2e-sysadmin POST /orgs',
    'e2e-sysadmin POST /orgs/:id/support/enter',
    'e2e-sysadmin POST /orgs/:id/users',
  ]);

  await page.getByTestId('action-leave-org').click();
  await expect(page).toHaveURL(/\/system\/orgs$/);
});

test('a user of B sees only B: its label, not the owners of A, not the system pages; its writes carry its login', async ({ page }) => {
  const { orgB } = keys();
  await loginAs(page, 'b');
  await expect(page.getByTestId('user-org')).toHaveAttribute('data-org-id', orgB.id);
  await expect(page.getByTestId('user-org')).toContainText(orgB.name);
  await expect(page.getByTestId('nav-system-orgs')).toHaveCount(0);

  // the label switch offers B's own label and «Все» only
  await page.getByTestId('field-label').click();
  await expect(page.getByRole('option')).toHaveText(['Все', orgB.labelName]);
  await page.keyboard.press('Escape');

  // B's owner opens; an owner of A is «not found», exactly like an unknown id
  await page.goto(`/owners/${orgB.ownerId}`);
  await expect(page.getByTestId('owner-page-title')).toHaveText(orgB.ownerName);
  await page.goto(`/owners/${keys().shared['owner:0to8'] ?? ''}`);
  await expect(page.getByTestId('error-code')).toHaveText('not_found');
  await page.goto('/system/orgs');
  await expect(page.getByTestId('error-code')).toHaveText('forbidden');

  // the operator of a write is the login of the session, whatever X-Operator says
  const res = await page.request.post('/api/v1/owners', {
    data: { name: 'Owner B2 e2e', kind: 'person' },
    headers: { 'X-Operator': 'someone-else' },
  });
  expect(res.status()).toBe(201);
  const ownerId = ((await res.json()) as { id: string }).id;
  expect((await auditOf(page.request, ownerId)).map((a) => a.operator)).toEqual([seedUsers().b.login]);

  // «Выйти» ends the session
  await page.getByTestId('action-logout').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/owners');
  await expect(page).toHaveURL(/\/login\?next=%2Fowners$/);
});
