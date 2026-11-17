import { expect, test } from '@playwright/test';
import { account, apiPost, labelOf, openAs, toastOk } from '../helpers';

// P17 «Лейблы» (D-232: own labels only, their Believe strings and accounts; a sublabel is P36). The list and the card of
// 0to8; an alias added and refused the second time; a new own label; an account added and removed (D-169).

test.describe.configure({ mode: 'serial' });

test('P17 the list and the card of 0to8: its strings and accounts, no kind and no rules', async ({ page }) => {
  const id = labelOf('0to8');
  await openAs(page, '/labels');
  const row = page.getByTestId(`label-${id}`);
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: '0to8' }).click();
  await expect(page).toHaveURL(new RegExp(`/labels/${id}$`));
  await expect(page.getByTestId('alias-0to8')).toBeVisible();
  await expect(page.getByTestId('label-kind')).toHaveCount(0);
  await expect(page.locator('[data-testid^="label-rule-"]')).toHaveCount(0);
});

test('P17 add an alias; the same alias again is 409 alias_taken; create an own label', async ({ page }) => {
  const id = labelOf('0to8');
  await openAs(page, `/labels/${id}`);
  await page.getByTestId('action-add-alias').click();
  await page.getByTestId('field-label-alias').fill('Spec Alias 29');
  await page.getByTestId('action-alias-submit').click();
  await toastOk(page, 'Алиас «Spec Alias 29» добавлен');
  await expect(page.getByTestId('alias-Spec Alias 29')).toBeVisible();
  const dup = await apiPost(page.request, `/labels/${id}/aliases`, { alias: 'Spec Alias 29' });
  expect([dup.status, dup.code]).toEqual([409, 'alias_taken']);
  await openAs(page, '/labels');
  await page.getByTestId('action-create-label').click();
  await page.getByTestId('field-label-name').fill('Ref Spec Label');
  await page.getByTestId('action-create-label-submit').click();
  await toastOk(page, 'Лейбл создан: Ref Spec Label');
  await expect(page.locator('[data-testid^="label-"][row-id]').filter({ hasText: 'Ref Spec Label' })).toBeVisible();
});

test('P17 an account of 0to8: add it, then remove it through the confirmation (D-169)', async ({ page }) => {
  const id = labelOf('0to8');
  const acct = account(29, 9);
  await openAs(page, `/labels/${id}`);
  await expect(page.getByTestId(`account-${acct}`)).toHaveCount(0);
  await page.getByTestId('action-add-account').click();
  await page.getByTestId('field-label-account').fill(acct);
  await page.getByTestId('action-account-submit').click();
  await toastOk(page, `Счёт ${acct} добавлен к лейблу 0to8`);
  await expect(page.getByTestId(`account-${acct}`)).toBeVisible();
  await page.getByTestId(`action-remove-account-${acct}`).click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText(acct);
  await dialog.getByTestId('confirm-dialog-ok').click();
  await toastOk(page, `Счёт ${acct} снят с лейбла 0to8`);
  await expect(page.getByTestId(`account-${acct}`)).toHaveCount(0);
});
