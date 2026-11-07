import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Locator } from '@playwright/test';
import type { CaseKeys, SeedKeys } from '../../backend/scripts/e2e/keys';
import type { Page, Route } from '@playwright/test';
import type { Me } from '@erp/shared/api-responses';

/** U+00A0 / U+202F (grouping) and U+2212 (minus) as plain characters, so money text compares with ordinary strings. */
export const norm = (s: string | null): string =>
  (s ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\u2212/g, '-').trim();

export async function setOperator(page: Page, name: string): Promise<void> {
  await page.getByTestId('operator-field').fill(name);
}

export const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export const apiError = (code: string, message: string, statusCode: number) => ({
  error: { code, message, statusCode },
});

/** Collects console errors and uncaught page errors of a page (the smoke spec asserts there are none). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    // a 404 of a detail route with a made-up id is the page's error state, not a defect
    if (m.type() === 'error' && !/Failed to load resource.*404/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

// ---- the seeded golden screens (packages/backend/scripts/e2e: keys.ts names, seed.ts writes .seed-keys.json) ----


export { account, isrc, upc, pseudonym, ownerName } from '../../backend/scripts/e2e/keys';

/** The login of the session every spec runs under (D-170: the operator of a write is the login). */
export const OPERATOR = 'e2e-operator';

/** Where `global-setup.ts` keeps the session of `e2e-operator` (playwright.config.ts `use.storageState`). */
export const STORAGE_STATE = join(import.meta.dirname, '..', '..', '..', 'data', 'test-tmp', 'e2e-state.json');

/** The login part of the keys file, written by `seed.ts` (its `SeedAuthKeys`, D-170). */
type LoginKeys = {
  users: Record<'operator' | 'sysadmin' | 'b' | 'multi' | 'manager', { login: string; password: string }>;
  orgB: { id: string; name: string; labelId: string; labelName: string; ownerId: string; ownerName: string };
};

let cached: (SeedKeys & LoginKeys) | undefined;
/** The ids of the seed (written by `seed.ts` in `scripts/e2e/start.sh`); `E2E_KEYS` points to another keys file. */
export function seedKeys(): SeedKeys & LoginKeys {
  cached ??= JSON.parse(
    readFileSync(process.env.E2E_KEYS ?? join(import.meta.dirname, '.seed-keys.json'), 'utf8'),
  ) as SeedKeys & LoginKeys;
  return cached;
}
/** The users of the seed with their synthetic passwords (D-170). */
export const seedUsers = () => seedKeys().users;

/** Signs in through the login page (P23) in a page of its own context. */
export async function loginAs(page: Page, user: 'operator' | 'sysadmin' | 'b' | 'manager', next = '/'): Promise<void> {
  const { login, password } = seedUsers()[user];
  await page.goto(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  await page.getByTestId('field-login').fill(login);
  await page.getByTestId('field-password').fill(password);
  await page.getByTestId('action-login').click();
  await expect(page.getByTestId('user-menu')).toHaveAttribute('data-login', login);
}

/**
 * A `GET /auth/me` answer for a `page.route` mock, in the shape of `meSchema` (D-171). The default is the login off
 * (`authMode: 'off'`, role `local`, every own label): the states fixture keeps the operator field. With the login on the
 * user is `login`, a member of the organization with `role` (a system administrator: role `system`, no membership).
 */
export function meMock(
  o: {
    authMode?: 'on' | 'off';
    role?: Me['role'];
    login?: string;
    org?: { id: string; name: string } | null;
    labels?: { id: string; name: string }[];
  } = {},
): Me {
  const authMode = o.authMode ?? 'off';
  const org = o.org === undefined ? { id: 'org-e2e', name: 'Test organization e2e' } : o.org;
  const role = o.role ?? (authMode === 'off' ? 'local' : 'org_admin');
  const member = org && (role === 'org_admin' || role === 'label_manager');
  return {
    authMode,
    user: authMode === 'off' ? null : { id: 'user-e2e', login: o.login ?? OPERATOR, isSystemAdmin: role === 'system' },
    org,
    role,
    labels: o.labels ?? [],
    publishingSource: 'v1',
    allLabels: role !== 'label_manager',
    memberships: member ? [{ orgId: org.id, orgName: org.name, role }] : [],
    support: null,
    abilities: [],
  };
}
/** The id of a shared own label (`0to8`, `Echo8`), D-168: the payouts and operations of the specs are made under 0to8. */
export const labelOf = (name: '0to8' | 'Echo8'): string => seedKeys().shared[`label:${name}`] ?? '';
/** Keys of scenario `nn`, case `k`. */
export function sc(nn: number, k = 1): CaseKeys {
  const c = seedKeys().scenarios[`S${String(nn).padStart(2, '0')}`]?.[`k${k}`];
  if (!c) throw new Error(`no seed keys for S${nn}/k${k}`);
  return c;
}

/** The money endpoints of 17 §7 (every one runs a recalculation): R2 allows one request per page load. */
const MONEY_PATH =
  /^\/api\/v1\/(overview|reconciliation|signals|queue\/[^/]+|owners\/payables|owners\/[^/]+\/balance|artists\/balances|artists\/[^/]+\/balance|tracks\/summary|tracks\/[^/]+\/money|releases\/[^/]+|documents\/[^/]+\/uses)$/;
const moneyCalls = new WeakMap<Page, string[]>();

/** Opens a page with the operator set (19 §1: `e2e-operator` before every spec). Restarts the money request count. */
export async function openAs(page: Page, path: string): Promise<void> {
  if (!moneyCalls.has(page)) {
    const calls: string[] = [];
    moneyCalls.set(page, calls);
    page.on('request', (r) => {
      if (r.method() === 'GET' && MONEY_PATH.test(new URL(r.url()).pathname)) calls.push(new URL(r.url()).pathname);
    });
  }
  await page.addInitScript((name) => localStorage.setItem('erp.operator', name), OPERATOR);
  moneyCalls.get(page)!.length = 0;
  await page.goto(path);
}

/** R2 (17 §1): after `openAs` + `settled`, the page asked the money endpoints exactly `n` times (its one calculation). */
export function expectMoneyCalls(page: Page, n: number): void {
  expect(moneyCalls.get(page) ?? [], 'money requests since openAs').toHaveLength(n);
}

/**
 * Every money page waits for the recalculation to finish (19 §5.5). The shell renders nothing before `GET /auth/me`
 * answers (D-170), so the page (and its money request) must be there first: otherwise the indicator is «hidden» only
 * because nothing is mounted yet. One frame more lets the page's queries start (their fetch begins in an effect).
 */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByTestId('page')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  await expect(page.getByTestId('recalc-indicator')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('stale-badge')).toHaveCount(0, { timeout: 20_000 });
}

/** The exact decimal string of the first `money` inside a locator. */
export async function moneyOf(cell: Locator): Promise<string | null> {
  return cell.getByTestId('money').first().getAttribute('title');
}

export const overviewRow = (page: Page, source: 'believe' | 'b17', acct: string, month: string) =>
  page.getByTestId(`overview-row-${source}-${acct}-${month}`);

/** A P1 row as `A / B / C / ours` exact strings (19 §1 notation). */
export async function expectP1(page: Page, acct: string, month: string, abco: string, source: 'believe' | 'b17' = 'believe') {
  const row = overviewRow(page, source, acct, month);
  await expect(row).toBeVisible();
  const [A, B, C, ours] = abco.split(' / ');
  await expect(row.locator('[data-col="A"]').getByTestId('money').first()).toHaveAttribute('title', A ?? '');
  await expect(row.locator('[data-col="B"]').getByTestId('money').first()).toHaveAttribute('title', B ?? '');
  await expect(row.locator('[data-col="C"]').getByTestId('money').first()).toHaveAttribute('title', C ?? '');
  await expect(row.locator('[data-col="ours"]').getByTestId('money').first()).toHaveAttribute('title', ours ?? '');
  await expect(row.locator('[data-col="discrepancy"]').getByTestId('money')).toHaveAttribute('title', '0');
}

/** Types `query` (default: the option text) into an EntityPicker and chooses the option with exactly this text. */
export async function pick(page: Page, name: string, option: string, query = option): Promise<void> {
  await page.getByTestId(`field-${name}`).fill(query);
  await page.getByTestId(`picker-list-${name}`).getByRole('option', { name: option, exact: true }).click();
}

/** Chooses an option of a SelectField. */
export async function choose(page: Page, name: string, option: string): Promise<void> {
  await page.getByTestId(`field-${name}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Waits for a success toast whose text contains `text`. */
export async function toastOk(page: Page, text?: string | RegExp): Promise<void> {
  const toast = page.locator('[data-testid="toast"][data-code="ok"]');
  await expect(text ? toast.filter({ hasText: text }).first() : toast.first()).toBeVisible();
}

/** Confirms the open ConfirmDialog. */
export async function confirm(page: Page): Promise<void> {
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('confirm-dialog-ok').click();
  await expect(dialog).toBeHidden();
}

/** A write sent directly (the second press of 19 §5.6), with the operator header. */
export async function apiPost(request: APIRequestContext, path: string, body: unknown = {}) {
  const res = await request.post(`/api/v1${path}`, { data: body, headers: { 'X-Operator': OPERATOR } });
  const json = (await res.json().catch(() => undefined)) as { error?: { code?: string } } | undefined;
  return { status: res.status(), code: json?.error?.code, body: json };
}

/** The balance facts of an owner card (P10 Баланс): `{ earned: '50', payable: '50' }` as exact strings in `title`. */
export async function expectOwner(page: Page, ownerId: string, totals: Record<string, string>): Promise<void> {
  await openAs(page, `/owners/${ownerId}?tab=balance`);
  await settled(page);
  await expect(page.getByTestId('balance-tab')).toBeVisible();
  for (const [name, value] of Object.entries(totals))
    await expect(page.getByTestId(`balance-${name}`).getByTestId('money'), `${name} of ${ownerId}`).toHaveAttribute('title', value);
}

/** A P1 row read from the overview page: opens P1, waits, asserts `A / B / C / ours` of every `[account, month, abco]`. */
export async function expectOverview(
  page: Page,
  rows: [acct: string, month: string, abco: string][],
  source: 'believe' | 'b17' = 'believe',
): Promise<void> {
  await openAs(page, '/');
  await settled(page);
  for (const [acct, month, abco] of rows) await expectP1(page, acct, month, abco, source);
}

/** A P21 row (`signal-row-<list>-<key>`) of a list page. */
export async function openSignalList(page: Page, name: string): Promise<void> {
  await openAs(page, `/signals/${name}`);
  await settled(page);
}
export const signalRow = (page: Page, name: string, key: string) => page.getByTestId(`signal-row-${name}-${key}`);

/**
 * The document part of an action dialog: a new document with a file reference, then its approval (the confirmation states
 * the money waiting for this very document, N13). Called under «Все» only (the step asks the label there). Returns the new document id.
 */
export async function newDocument(page: Page, fileRef: string, waiting?: string): Promise<string> {
  const dialog = page.getByTestId('form-dialog');
  // under «Все» the step asks for the label of the document (D-169): the queue documents of the seed are «любой лейбл»
  await choose(page, 'document-step-label', 'любой лейбл');
  await dialog.getByTestId('field-document-file').fill(fileRef);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/documents') && r.request().method() === 'POST');
  await dialog.getByTestId('action-document-create').click();
  const id = ((await (await created).json()) as { id: string }).id;
  await toastOk(page, 'Документ создан');
  await dialog.getByTestId('action-document-approve').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText(`ждёт этого документа: ${waiting ?? ''}`);
  await confirm(page);
  await toastOk(page, 'Документ утверждён');
  await expect(dialog.getByTestId('document-ready')).toBeVisible();
  return id;
}
