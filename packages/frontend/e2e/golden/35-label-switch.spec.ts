import { expect, test, type Page } from '@playwright/test';
import { apiPost, choose, expectMoneyCalls, isrc, openAs, openSignalList, sc, settled, signalRow, toastOk } from '../helpers';

// The label as a book (19 §4 S38, D-168): the switch of the header («0to8 / Echo8 / Все»), the owner under both labels
// (the books on P10, the view under a label), the payout under a label, the operation without a label in «Все» and on
// P21, the lists under a label (P9, P11, P5), the link with `?label=`. Acts (a payout, a label set): nothing reads S38 later.

test.describe.configure({ mode: 'serial' });

const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
const book = (page: Page, label: string, col: string) => page.getByTestId(`by-label-${label}`).locator(`[data-col="${col}"]`).getByTestId('money');
/** The switch is a select in the header; «Все» = `all`. */
async function switchTo(page: Page, option: string) {
  await choose(page, 'label', option);
  await settled(page);
}

let payoutId = '';

test('S38 under «Все»: the books of 0to8 and Echo8 add up to the owner; the payout button waits for a label', async ({ page }) => {
  const k = sc(38);
  await openAs(page, `/owners/${k.owners.A}?tab=balance`);
  await settled(page);
  expectMoneyCalls(page, 1);
  await expect(page.getByTestId('label-switch')).toHaveAttribute('data-label', '');
  await expect(page.getByTestId('balance-label')).toContainText('все лейбл');
  await expect(fact(page, 'earned')).toHaveAttribute('title', '80');
  await expect(fact(page, 'recouped')).toHaveAttribute('title', '50');
  await expect(fact(page, 'payable')).toHaveAttribute('title', '30');
  for (const [label, earned, recouped, payable] of [['0to8', '50', '40', '10'], ['Echo8', '30', '10', '20']] as const) {
    await expect(book(page, label, 'earned')).toHaveAttribute('title', earned);
    await expect(book(page, label, 'recouped')).toHaveAttribute('title', recouped);
    await expect(book(page, label, 'payable')).toHaveAttribute('title', payable);
  }
  await expect(page.getByTestId(`position-${k.extra['advance-unlabelled']}`)).toBeVisible();
  await expect(page.getByTestId(`position-${k.extra['advance-echo8']}`)).toBeVisible();
  await expect(page.getByTestId('action-pay')).toBeDisabled();
  await expect(page.getByTestId('payout-gate')).toContainText('выберите лейбл');
});

test('S38 the switch: under Echo8 the book of Echo8 alone, its advance only; the URL carries the label and a reload keeps it', async ({ page }) => {
  const k = sc(38);
  await openAs(page, `/owners/${k.owners.A}?tab=balance`);
  await settled(page);
  await switchTo(page, 'Echo8');
  await expect(page).toHaveURL(new RegExp(`label=${k.labels.Echo8}`));
  await expect(page.getByTestId('label-switch')).toHaveAttribute('data-label', k.labels.Echo8 ?? '');
  await expect(page.getByTestId('balance-tab')).toHaveAttribute('data-label', k.labels.Echo8 ?? '');
  await expect(page.getByTestId('balance-label')).toContainText('Echo8');
  await expect(fact(page, 'earned')).toHaveAttribute('title', '30');
  await expect(fact(page, 'recouped')).toHaveAttribute('title', '10');
  await expect(fact(page, 'payable')).toHaveAttribute('title', '20');
  await expect(page.getByTestId('by-label-Echo8')).toBeVisible();
  await expect(page.getByTestId('by-label-0to8')).toHaveCount(0);
  await expect(page.getByTestId(`position-${k.extra['advance-echo8']}`)).toBeVisible();
  await expect(page.getByTestId(`position-${k.extra['advance-unlabelled']}`)).toHaveCount(0);
  await expect(page.getByTestId('action-pay')).toBeEnabled();
  // the stored switch survives a reload without the parameter; a link with `?label=` wins over it
  await page.reload();
  await settled(page);
  await expect(fact(page, 'payable')).toHaveAttribute('title', '20');
  await page.goto(`/owners/${k.owners.A}?tab=balance&label=${k.labels['0to8']}`);
  await settled(page);
  await expect(page.getByTestId('label-switch')).toHaveAttribute('data-label', k.labels['0to8'] ?? '');
  await expect(fact(page, 'payable')).toHaveAttribute('title', '10');
  await expect(page.getByTestId('by-label-0to8')).toBeVisible();
  await expect(page.getByTestId(`position-${k.extra['advance-echo8']}`)).toHaveCount(0);
});

test('S38 the payout under 0to8 pays the book (10.00) and carries the label; after the proof the 0to8 book is 0, Echo8 keeps 20', async ({ page, request }) => {
  const k = sc(38);
  const ownerId = k.owners.A ?? '';
  await openAs(page, `/owners/${ownerId}?tab=balance&label=${k.labels['0to8']}`);
  await settled(page);
  await page.getByTestId('action-pay').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('Лейбл: 0to8');
  await expect(dialog).toContainText('К выплате: 10,00 (будет отправлено 1000 центов)');
  const paid = page.waitForResponse((r) => r.url().includes(`/owners/${ownerId}/payouts`) && r.request().method() === 'POST');
  await dialog.getByTestId('confirm-dialog-ok').click();
  const body = (await (await paid).json()) as { id: string; amountCents: number; labelId: string };
  expect([body.amountCents, body.labelId]).toEqual([1000, k.labels['0to8']]);
  payoutId = body.id;
  await toastOk(page, 'Выплачено: 10,00');
  // without a label the API refuses a payout
  const noLabel = await apiPost(request, `/owners/${ownerId}/payouts`, {});
  expect([noLabel.status, noLabel.code]).toEqual([400, 'label_required']);
  const proof = await apiPost(request, `/settlements/operations/${payoutId}/proof`, { fileRef: 'dummy://e2e-proof-381.pdf' });
  expect(proof.status).toBe(200);
  await openAs(page, `/owners/${ownerId}?tab=balance&label=${k.labels['0to8']}`);
  await settled(page);
  await expect(fact(page, 'paid')).toHaveAttribute('title', '10');
  await expect(fact(page, 'payable')).toHaveAttribute('title', '0');
  await page.goto(`/owners/${ownerId}?tab=balance&label=`);
  await settled(page);
  await expect(fact(page, 'payable')).toHaveAttribute('title', '20');
  await expect(book(page, '0to8', 'paid')).toHaveAttribute('title', '10');
  await expect(book(page, 'Echo8', 'payable')).toHaveAttribute('title', '20');
  // P20: the operation carries the label; under Echo8 it is not listed, under «Все» every operation is
  await openAs(page, `/operations?ownerId=${ownerId}&label=${k.labels['0to8']}`);
  await expect(page.getByTestId(`operation-${payoutId}`).locator('[data-col="label"]')).toHaveText('0to8');
  await expect(page.getByTestId(`operation-${k.extra['advance-echo8']}`)).toHaveCount(0);
  await page.goto(`/operations?ownerId=${ownerId}&label=`);
  await expect(page.getByTestId(`operation-${k.extra['advance-echo8']}`).locator('[data-col="label"]')).toHaveText('Echo8');
  await expect(page.getByTestId(`operation-${k.extra['advance-unlabelled']}`).locator('[data-col="label"]')).toHaveText('без лейбла');
});

test('S38 P21 «Операции без лейбла»: the old advance, set to 0to8 from the row; the lists under a label: P9, P11, P5', async ({ page }) => {
  const k = sc(38);
  const old = k.extra['advance-unlabelled'] ?? '';
  await page.addInitScript(() => localStorage.setItem('erp.label', ''));
  await openSignalList(page, 'operationsWithoutLabel');
  const row = signalRow(page, 'operationsWithoutLabel', old);
  await expect(row).toBeVisible();
  await expect(row.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '40.00');
  await row.getByTestId('action-set-label').click();
  await choose(page, 'op-label', '0to8');
  await page.getByTestId('action-set-label-submit').click();
  await toastOk(page, 'Лейбл операции задан: 0to8');
  await settled(page);
  await expect(signalRow(page, 'operationsWithoutLabel', old)).toHaveCount(0);
  // the advance of 40 under 0to8 keeps taking the 0to8 income (its only income): the books are unchanged
  await openAs(page, `/owners/${k.owners.A}?tab=balance&label=`);
  await settled(page);
  await expect(book(page, '0to8', 'recouped')).toHaveAttribute('title', '40');
  await expect(page.getByTestId(`position-${old}`).locator('[data-col="remaining"]').getByTestId('money')).toHaveAttribute('title', '0');
  // P9 under Echo8 lists the owner (its row A on the Echo8 ISRC) with the book of Echo8
  await openAs(page, `/owners?label=${k.labels.Echo8}`);
  await settled(page);
  const ownerRow = page.getByTestId(`owner-${k.owners.A}`);
  await expect(ownerRow).toBeVisible();
  await expect(ownerRow.locator('[data-col="payable"]').getByTestId('money')).toHaveAttribute('title', '20');
  // P11 under Echo8: the pseudonym with its Echo8 book; P5 under Echo8: the Echo8 track only
  await openAs(page, `/artists?q=${k.names.A}&label=${k.labels.Echo8}`);
  await settled(page);
  const artistRow = page.getByTestId(`artist-${k.artists.A}`);
  await expect(artistRow.locator('[data-col="earned"]').getByTestId('money')).toHaveAttribute('title', '30');
  await openAs(page, `/tracks?q=${isrc(38, 1, 1).slice(0, 11)}&label=${k.labels.Echo8}`);
  await expect(page.getByTestId(`track-${isrc(38, 1, 2)}`)).toBeVisible();
  await expect(page.getByTestId(`track-${isrc(38, 1, 1)}`)).toHaveCount(0);
  await page.goto(`/tracks?q=${isrc(38, 1, 1).slice(0, 11)}&label=`);
  await expect(page.getByTestId(`track-${isrc(38, 1, 1)}`)).toBeVisible();
  await expect(page.getByTestId(`track-${isrc(38, 1, 2)}`)).toBeVisible();
});
