import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Locator } from '@playwright/test';
import type { CaseKeys, SeedKeys } from '../../backend/scripts/e2e/keys';
import type { Page, Route } from '@playwright/test';

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
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

// ---- the seeded golden screens (packages/backend/scripts/e2e: keys.ts names, seed.ts writes .seed-keys.json) ----


export { account, isrc, upc, pseudonym, ownerName } from '../../backend/scripts/e2e/keys';

export const OPERATOR = 'e2e-operator';

let cached: SeedKeys | undefined;
/** The ids of the seed (written by `seed.ts` in `scripts/e2e/start.sh`); `E2E_KEYS` points to another keys file. */
export function seedKeys(): SeedKeys {
  cached ??= JSON.parse(
    readFileSync(process.env.E2E_KEYS ?? join(import.meta.dirname, '.seed-keys.json'), 'utf8'),
  ) as SeedKeys;
  return cached;
}
/** Keys of scenario `nn`, case `k`. */
export function sc(nn: number, k = 1): CaseKeys {
  const c = seedKeys().scenarios[`S${String(nn).padStart(2, '0')}`]?.[`k${k}`];
  if (!c) throw new Error(`no seed keys for S${nn}/k${k}`);
  return c;
}

/** Opens a page with the operator set (19 §1: `e2e-operator` before every spec). */
export async function openAs(page: Page, path: string): Promise<void> {
  await page.addInitScript((name) => localStorage.setItem('erp.operator', name), OPERATOR);
  await page.goto(path);
}

/** Every money page waits for the recalculation to finish (19 §5.5). */
export async function settled(page: Page): Promise<void> {
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
