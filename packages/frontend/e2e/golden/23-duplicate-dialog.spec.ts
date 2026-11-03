import { expect, test, type Page } from '@playwright/test';
import { openAs, sc, settled, toastOk } from '../helpers';

// S36 (19 §4): «Создать владельца» with the name of an existing owner → 409 possible_duplicate → the dialog lists
// Owner DUP-361; «тот же» opens its card and creates nothing; «новый» repeats with force → a second owner of that name.

test.describe.configure({ mode: 'serial' });

const NAME = 'Owner DUP-361';

async function openOwners(page: Page) {
  const grid = JSON.stringify({ f: { name: { filterType: 'text', type: 'contains', filter: 'DUP-361' } } });
  await openAs(page, `/owners?grid=${encodeURIComponent(grid)}`);
  await settled(page);
}
async function submitName(page: Page) {
  await page.getByTestId('action-create-owner').click();
  await page.getByTestId('field-owner-name').fill(NAME);
  await page.getByTestId('form-dialog').getByTestId('action-create-owner-submit').click();
  await expect(page.locator('[data-testid="toast"][data-code="possible_duplicate"]').first()).toBeVisible();
}
const rows = (page: Page) => page.locator('[data-testid^="owner-"][row-id]');

test('S36 «тот же» opens the existing owner and creates nothing', async ({ page }) => {
  const existing = sc(36).owners.DUP ?? '';
  await openOwners(page);
  await expect(rows(page)).toHaveCount(1);
  await submitName(page);
  const list = page.getByTestId('duplicate-dialog');
  await expect(list.getByTestId(`duplicate-${existing}`)).toContainText(NAME);
  await list.getByTestId(`duplicate-${existing}`).getByTestId('action-duplicate-same').click();
  await expect(page).toHaveURL(new RegExp(`/owners/${existing}$`));
  await expect(page.getByTestId('owner-name')).toHaveText(NAME);
  await openOwners(page);
  await expect(rows(page)).toHaveCount(1);
});

test('S36 «новый» repeats with force: a second owner of that name; P9 shows two', async ({ page }) => {
  const existing = sc(36).owners.DUP ?? '';
  await openOwners(page);
  await submitName(page);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/owners') && r.request().method() === 'POST' && r.status() === 201);
  await page.getByTestId('form-dialog').getByTestId('action-duplicate-new').click();
  const id = ((await (await created).json()) as { id: string }).id;
  await toastOk(page, `Владелец создан: ${NAME}`);
  expect(id).not.toBe(existing);
  await expect(page).toHaveURL(new RegExp(`/owners/${id}$`));
  await openOwners(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId(`owner-${existing}`)).toBeVisible();
  await expect(page.getByTestId(`owner-${id}`)).toBeVisible();
});
