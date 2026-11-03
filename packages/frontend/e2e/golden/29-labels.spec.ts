import { expect, test } from '@playwright/test';
import { account, apiPost, expectOwner, expectP1, openAs, openSignalList, sc, settled, signalRow, toastOk } from '../helpers';

// P17 «Лейблы» (19 §4 S37): close the label rule of «Close Label 37» at 2026-04-01 through the page; the month 04 loses the
// NG carve (ours 25 → 50), 03 stays. The second close at the same date is a 200 without change.

test.describe.configure({ mode: 'serial' });

const NAME = 'Close Label 37';

test('P17 the list and the card: kind, aliases, rule with recipient, percent, period, document status', async ({ page }) => {
  const k = sc(37);
  const id = k.labels[NAME] ?? '';
  await openAs(page, '/labels');
  const row = page.getByTestId(`label-${id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('сублейбл');
  await row.getByRole('link', { name: NAME }).click();
  await expect(page).toHaveURL(new RegExp(`/labels/${id}$`));
  await expect(page.getByTestId('label-kind')).toHaveText('сублейбл');
  await expect(page.getByTestId(`alias-${NAME}`)).toBeVisible();
  const rule = page.getByTestId(`label-rule-${k.labelRules[NAME]}`);
  await expect(rule).toContainText('NG-371');
  await expect(rule.locator('[data-col="percent"]')).toHaveText('50');
  await expect(rule.locator('[data-col="period"]')).toContainText('2020-01-01 → бессрочно');
  await expect(rule.getByTestId('chip-approved')).toBeVisible();
});

test('S37 close the rule at 2026-04-01: 04 loses the carve, 03 stays; the period shows the end', async ({ page, request }) => {
  const k = sc(37);
  const id = k.labels[NAME] ?? '';
  const ruleId = k.labelRules[NAME] ?? '';
  const acct = account(37, 1);
  await openAs(page, '/');
  await settled(page);
  await expectP1(page, acct, '2026-03', '100 / 75 / 0 / 25');
  await expectP1(page, acct, '2026-04', '100 / 75 / 0 / 25');
  await expectOwner(page, k.owners.NG ?? '', { earned: '50' });
  await openAs(page, `/signals/sublabelWithoutRule`);
  await settled(page);
  await expect(signalRow(page, 'sublabelWithoutRule', `${NAME}|2026-04`)).toHaveCount(0);
  await openAs(page, `/labels/${id}`);
  await page.getByTestId(`label-rule-${ruleId}`).getByTestId('action-close-rule').click();
  await page.getByTestId('field-close-at').fill('2026-04-01');
  await page.getByTestId('action-close-rule-submit').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('2026-04-01');
  await dialog.getByTestId('confirm-dialog-ok').click();
  await toastOk(page, 'Правило закрыто с 2026-04-01');
  await expect(page.getByTestId(`label-rule-${ruleId}`).locator('[data-col="period"]')).toContainText('2020-01-01 → 2026-04-01');
  await page.getByTestId('nav-overview').click();
  await settled(page);
  await expectP1(page, acct, '2026-04', '100 / 50 / 0 / 50');
  await expectP1(page, acct, '2026-03', '100 / 75 / 0 / 25');
  await expectOwner(page, k.owners.NG ?? '', { earned: '25' });
  await openSignalList(page, 'sublabelWithoutRule');
  await expect(signalRow(page, 'sublabelWithoutRule', `${NAME}|2026-04`).locator('[data-col="net"]').getByTestId('money')).toHaveAttribute('title', '100');
  // second press: the same date is a 200 and changes nothing
  const again = await apiPost(request, `/labels/rules/${ruleId}/close`, { validTo: '2026-04-01' });
  expect(again.status).toBe(200);
});

test('P17 add an alias; the same alias again is 409 alias_taken; create a sublabel', async ({ page }) => {
  const id = sc(37).labels[NAME] ?? '';
  await openAs(page, `/labels/${id}`);
  await page.getByTestId('action-add-alias').click();
  await page.getByTestId('field-label-alias').fill('Close Label 37 Alt');
  await page.getByTestId('action-alias-submit').click();
  await toastOk(page, 'Алиас «Close Label 37 Alt» добавлен');
  await expect(page.getByTestId('alias-Close Label 37 Alt')).toBeVisible();
  const dup = await apiPost(page.request, `/labels/${id}/aliases`, { alias: 'Close Label 37 Alt' });
  expect([dup.status, dup.code]).toEqual([409, 'alias_taken']);
  await openAs(page, '/labels');
  await page.getByTestId('action-create-label').click();
  await page.getByTestId('field-label-name').fill('Ref Spec Sublabel');
  await page.getByTestId('field-label-own').click();
  await page.getByRole('option', { name: '0to8', exact: true }).click();
  await page.getByTestId('action-create-label-submit').click();
  await toastOk(page, 'Лейбл создан: Ref Spec Sublabel');
  await expect(page.locator('[data-testid^="label-"][row-id]').filter({ hasText: 'Ref Spec Sublabel' })).toBeVisible();
});
