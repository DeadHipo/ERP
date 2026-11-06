import { expect, test, type Page } from '@playwright/test';
import { apiPost, choose, confirm, isrc, labelOf, openAs, sc, settled, toastOk } from '../helpers';

// Advertising (D-155…D-157) on S31/3, which no other spec changes: earned 80, paid 20, payable 60. An expense is taken
// off payable at once: 15 → 45; a pasted list of 5 → 40; the percent of the 15 to 0 → 55; its deactivation changes nothing more.
// D-169: the label of a record is its payer: both are written under 0to8 (the book of the ISRC's income, account(0)); the
// 15 moved to the payer Echo8 is the one `adOutsideBook` row until P21 sets it back; under «Все» the create buttons are closed
// and the API refuses an item without a label (`label_required`).

test.describe.configure({ mode: 'serial' });

const ISRC = isrc(31, 3, 1);
const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
async function expectBalance(page: Page, charged: string, payable: string) {
  // under «Все» (`label=`: the switch stored by a page opened under 0to8 would show one book): the sum of the books
  await openAs(page, `/owners/${sc(31, 3).owners.A ?? ''}?tab=balance&label=`);
  await settled(page);
  await expect(fact(page, 'adsCharged')).toHaveAttribute('title', charged);
  await expect(fact(page, 'payable')).toHaveAttribute('title', payable);
}

test('under «Все» the create buttons are closed; the API refuses an item without a payer (label_required)', async ({ page }) => {
  await openAs(page, '/ads?label=');
  await settled(page);
  await expect(page.getByTestId('action-create-ad')).toBeDisabled();
  await expect(page.getByTestId('action-create-ads-batch')).toBeDisabled();
  await expect(page.getByTestId('ads-page')).toContainText('выберите лейбл');
  const refused = await apiPost(page.request, '/ads', { items: [{ isrc: ISRC, month: '2026-01', amount: '1' }] });
  expect(refused.status).toBe(400);
  expect(refused.code).toBe('label_required');
});

test('add one expense on the page under 0to8: 15 at 100 % → charged 15, payable 45', async ({ page }) => {
  await openAs(page, `/ads?label=${labelOf('0to8')}`);
  await settled(page);
  await page.getByTestId('action-create-ad').click();
  const dialog = page.getByTestId('form-dialog');
  await dialog.getByTestId('field-ad-isrc').fill(ISRC);
  await dialog.getByTestId('field-ad-month').fill('2026-01');
  await dialog.getByTestId('field-ad-amount').fill('15');
  await dialog.getByTestId('action-ad-create-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Плательщик: 0to8');
  await confirm(page);
  await toastOk(page, /Записан расход/);
  await expectBalance(page, '15', '45');
});

test('a pasted list: a wrong line blocks the submit; fixed, 5 more → charged 20, payable 40', async ({ page }) => {
  await openAs(page, `/ads?label=${labelOf('0to8')}`);
  await settled(page);
  await page.getByTestId('action-create-ads-batch').click();
  const dialog = page.getByTestId('form-dialog');
  const text = dialog.getByTestId('field-ad-batch');
  await text.fill(`${ISRC};2026-13;5`);
  await expect(dialog.getByTestId('ad-batch-row-1')).toContainText('неверный месяц');
  await expect(dialog.getByTestId('action-ad-batch-submit')).toBeDisabled();
  await text.fill(`${ISRC};2026-02;5;100;e2e-post-1;из списка`);
  await expect(dialog.getByTestId('ad-batch-counts')).toContainText('Готово к записи: 1');
  await dialog.getByTestId('action-ad-batch-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Плательщик: 0to8');
  await confirm(page);
  await toastOk(page, 'Записано: 1, пропущено: 0');
  await expectBalance(page, '20', '40');
});

test('the track tab lists both; the card shows who bears it; percent 0 and payer Echo8 → adOutsideBook, set back from P21; charged 5, payable 55; deactivated stays out of the calculation', async ({ page }) => {
  await openAs(page, `/tracks/${ISRC}?tab=ads`);
  await settled(page);
  const table = page.getByTestId('entity-ads-table');
  await expect(table.locator('tr[data-testid^="entity-ad-"]')).toHaveCount(2);
  await table.getByRole('link', { name: '2026-01' }).click();
  await expect(page.getByTestId('ad-page')).toBeVisible();
  await settled(page);
  await expect(page.getByTestId('ad-amount').getByTestId('money')).toHaveAttribute('title', '15.00');
  await expect(page.getByTestId('ad-parts').locator('tr[data-testid^="ad-part-"]')).toHaveCount(1);
  await expect(page.getByTestId('ad-label')).toContainText('0to8');
  await expect(page.getByTestId('ad-income-book')).toHaveCount(0);
  const card = page.url();
  const adId = new URL(card).pathname.split('/').pop() ?? '';

  await page.getByTestId('action-ad-edit').click();
  await page.getByTestId('form-dialog').getByTestId('field-ad-edit-percent').fill('0');
  await choose(page, 'ad-edit-label', 'Echo8');
  await page.getByTestId('action-ad-edit-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Плательщик: 0to8 → Echo8');
  await confirm(page);
  await toastOk(page, 'Расход изменён');
  await expect(page.getByTestId('ad-percent')).toContainText('0 %');
  await expect(page.getByTestId('ad-label')).toContainText('Echo8');
  await expect(page.getByTestId('ad-income-book')).toContainText('0to8');
  await expect(page.getByTestId('ad-audit')).toContainText('e2e-operator');

  // P21: the record paid by Echo8 on an ISRC whose income is in the 0to8 book; the row's action sets the payer back
  await openAs(page, '/signals/adOutsideBook');
  await settled(page);
  const row = page.getByTestId(`signal-row-adOutsideBook-${adId}`);
  await expect(row.locator('[data-col="payer"]')).toHaveText('Echo8');
  await expect(row.locator('[data-col="book"]')).toHaveText('0to8');
  await row.getByTestId('action-set-payer').click();
  await choose(page, 'ad-edit-label', '0to8');
  await page.getByTestId('action-ad-edit-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Плательщик: Echo8 → 0to8');
  await confirm(page);
  await toastOk(page, 'Расход изменён');
  await expect(row).toHaveCount(0);
  await expectBalance(page, '5', '55');

  await openAs(page, new URL(card).pathname);
  await settled(page);
  await page.getByTestId('action-ad-deactivate').click();
  await page.getByTestId('form-dialog').getByTestId('field-ad-deactivate-reason').fill('e2e');
  await page.getByTestId('action-ad-deactivate-submit').click();
  await confirm(page);
  await expect(page.getByTestId('ad-inactive')).toBeVisible();
  await expectBalance(page, '5', '55');
});

test('the list filters by ISRC and the summary has its total', async ({ page }) => {
  await openAs(page, `/ads?isrc=${ISRC}`);
  await settled(page);
  await expect(page.getByTestId('ads-count')).toContainText('Найдено записей: 1');
  await expect(page.getByTestId('ads-summary-total')).toBeVisible();
  // under 0to8 the list and the summary are the records it pays (D-169): the 5 of 2026-02 by the payer's name
  await openAs(page, `/ads?isrc=${ISRC}&label=${labelOf('0to8')}`);
  await settled(page);
  await expect(page.getByTestId('ads-count')).toContainText('Найдено записей: 1');
  await expect(page.getByTestId('ads-summary-2026-02-0to8')).toBeVisible();
  await expect(page.getByTestId('ads-list').locator('[data-col="payer"]').first()).toHaveAttribute('data-label-id', labelOf('0to8'));
});
