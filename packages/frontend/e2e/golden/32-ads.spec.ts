import { expect, test, type Page } from '@playwright/test';
import { confirm, isrc, openAs, sc, settled, toastOk } from '../helpers';

// Advertising (D-155…D-157) on S31/3, which no other spec changes: earned 80, paid 20, payable 60. An expense is taken
// off payable at once: 15 → 45; a pasted list of 5 → 40; the percent of the 15 to 0 → 55; its deactivation changes nothing more.

test.describe.configure({ mode: 'serial' });

const ISRC = isrc(31, 3, 1);
const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
async function expectBalance(page: Page, charged: string, payable: string) {
  await openAs(page, `/owners/${sc(31, 3).owners.A ?? ''}?tab=balance`);
  await settled(page);
  await expect(fact(page, 'adsCharged')).toHaveAttribute('title', charged);
  await expect(fact(page, 'payable')).toHaveAttribute('title', payable);
}

test('add one expense on the page: 15 at 100 % → charged 15, payable 45', async ({ page }) => {
  await openAs(page, '/ads');
  await settled(page);
  await page.getByTestId('action-create-ad').click();
  const dialog = page.getByTestId('form-dialog');
  await dialog.getByTestId('field-ad-isrc').fill(ISRC);
  await dialog.getByTestId('field-ad-month').fill('2026-01');
  await dialog.getByTestId('field-ad-amount').fill('15');
  await dialog.getByTestId('action-ad-create-submit').click();
  await confirm(page);
  await toastOk(page, /Записан расход/);
  await expectBalance(page, '15', '45');
});

test('a pasted list: a wrong line blocks the submit; fixed, 5 more → charged 20, payable 40', async ({ page }) => {
  await openAs(page, '/ads');
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
  await confirm(page);
  await toastOk(page, 'Записано: 1, пропущено: 0');
  await expectBalance(page, '20', '40');
});

test('the track tab lists both; the card shows who bears it; percent 0 → charged 5, payable 55; deactivated stays out of the calculation', async ({ page }) => {
  await openAs(page, `/tracks/${ISRC}?tab=ads`);
  await settled(page);
  const table = page.getByTestId('entity-ads-table');
  await expect(table.locator('tr[data-testid^="entity-ad-"]')).toHaveCount(2);
  await table.getByRole('link', { name: '2026-01' }).click();
  await expect(page.getByTestId('ad-page')).toBeVisible();
  await settled(page);
  await expect(page.getByTestId('ad-amount').getByTestId('money')).toHaveAttribute('title', '15.00');
  await expect(page.getByTestId('ad-parts').locator('tr[data-testid^="ad-part-"]')).toHaveCount(1);

  await page.getByTestId('action-ad-edit').click();
  await page.getByTestId('form-dialog').getByTestId('field-ad-edit-percent').fill('0');
  await page.getByTestId('action-ad-edit-submit').click();
  await confirm(page);
  await toastOk(page, 'Расход изменён');
  await expect(page.getByTestId('ad-percent')).toContainText('0 %');
  await expect(page.getByTestId('ad-audit')).toContainText('e2e-operator');
  const card = page.url();
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
});
