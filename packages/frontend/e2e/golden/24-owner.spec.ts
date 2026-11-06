import { expect, test, type Page } from '@playwright/test';
import { account, apiPost, choose, expectMoneyCalls, expectOverview, isrc, labelOf, openAs, sc, settled, toastOk } from '../helpers';

// P10 Владелец and P9 Владельцы, read-only scenarios and the G39 change made through the API (19 §4: S24, S23).
// The merge (S33) is 25-merge, the duplicate dialog (S36) 23-duplicate-dialog, the payout (S22) 26-payout. Runs after
// 23-duplicate-dialog (the S36 owner is confirmed here).

test.describe.configure({ mode: 'serial' });

const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
/** The owner card under the label 0to8 (D-168: the payout button works under a label; every seeded unit here is 0to8). */
async function openOwner(page: Page, ownerId: string, tab = 'balance') {
  await openAs(page, `/owners/${ownerId}?tab=${tab}&label=${labelOf('0to8')}`);
  await settled(page);
  expectMoneyCalls(page, 1);
  await expect(page.getByTestId('balance-tab')).toBeVisible();
}
async function expectTotals(page: Page, totals: Record<string, string>) {
  for (const [name, value] of Object.entries(totals)) await expect(fact(page, name), name).toHaveAttribute('title', value);
}
/** P9 filtered to one owner name through the grid's URL filter state. */
async function openOwners(page: Page, name: string, view?: 'payouts') {
  const grid = JSON.stringify({ f: { name: { filterType: 'text', type: 'contains', filter: name } } });
  // D-163: the owners list comes without money; the money of the visible rows is one payables call of their ids
  const asked = view ? null : page.waitForRequest((r) => r.url().includes('/api/v1/owners/payables?'));
  await openAs(page, `/owners?${view ? `view=${view}&` : ''}grid=${encodeURIComponent(grid)}`);
  if (asked) expect(new URL((await asked).url()).searchParams.get('ids')).toBeTruthy();
  await settled(page);
  expectMoneyCalls(page, 1);
}
const cell = (page: Page, ownerId: string, col: string) =>
  page.getByTestId(`owner-${ownerId}`).locator(`[data-col="${col}"]`).getByTestId('money');

test('S24/1 G28: paid 30, payable 20; gate allowed (2000 cents); P4 lists the owner', async ({ page }) => {
  const ownerId = sc(24, 1).owners.A ?? '';
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '50', paid: '30', payable: '20', payableShown: '20', recouped: '0' });
  await expect(page.getByTestId('payable-negative')).toHaveCount(0);
  await expect(page.getByTestId('payout-gate').getByTestId('gate-allowed')).toBeVisible();
  await expect(page.getByTestId('action-pay')).toBeEnabled();
  await page.getByTestId('action-pay').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('будет отправлено 2000 центов');
  await page.getByTestId('confirm-dialog-cancel').click();
  await openOwners(page, 'A-241', 'payouts');
  await expect(page.getByTestId('payouts-header')).toHaveText('Кандидаты на выплату');
  await expect(cell(page, ownerId, 'payableShown')).toHaveAttribute('title', '20');
  await expect(page.getByTestId(`owner-${ownerId}`).getByTestId('gate-allowed')).toBeVisible();
});

test('S24/2 G28: payable -20 is shown as 0 with the warning; gate nothing_to_pay; not a payout candidate', async ({ page, request }) => {
  const ownerId = sc(24, 2).owners.A ?? '';
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '50', paid: '70', payable: '-20', payableShown: '0' });
  await expect(page.getByTestId('payable-negative').getByTestId('money')).toHaveAttribute('title', '-20');
  await expect(page.getByTestId('payout-gate').getByTestId('gate-nothing_to_pay')).toBeVisible();
  await expect(page.getByTestId('action-pay')).toBeDisabled();
  await expect(page.getByTestId('payout-gate')).toContainText('нечего выплачивать');
  const again = await apiPost(request, `/owners/${ownerId}/payouts`, { labelId: labelOf('0to8') });
  expect([again.status, again.code]).toEqual([422, 'nothing_to_pay']);
  await openOwners(page, 'A-242');
  await expect(cell(page, ownerId, 'payableShown')).toHaveAttribute('title', '0');
  await expect(cell(page, ownerId, 'payable')).toHaveAttribute('title', '-20');
  await openOwners(page, 'A-242', 'payouts');
  await expect(page.getByTestId('payouts-header')).toBeVisible();
  await expect(page.getByTestId('data-grid')).toBeVisible();
  await expect(page.getByTestId(`owner-${ownerId}`)).toHaveCount(0);
});

test('S24/3 G39: a retroactive top participation R 15 turns payable 0 into -7.5 (shown 0, warning)', async ({ page, request }) => {
  const k = sc(24, 3);
  const ownerId = k.owners.A ?? '';
  await expectOverview(page, [[account(24, 3), '2026-03', '100 / 50 / 0 / 50']]);
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '50', paid: '50', payable: '0', payableShown: '0' });
  await expect(page.getByTestId('payable-negative')).toHaveCount(0);
  await expect(page.getByTestId('payout-gate').getByTestId('gate-nothing_to_pay')).toBeVisible();
  const created = await apiPost(request, '/participations', {
    isrc: isrc(24, 3, 1),
    artistId: k.artists.R,
    percent: '15',
    base: 'net',
    fundedFrom: 'top',
    validFrom: '2026-01-01',
    documentId: k.documents.appendix,
  });
  expect(created.status).toBe(201);
  await page.reload();
  await settled(page);
  await expectTotals(page, { earned: '42.5', paid: '50', payable: '-7.5', payableShown: '0' });
  await expect(page.getByTestId('payable-negative').getByTestId('money')).toHaveAttribute('title', '-7.5');
  await expect(page.getByTestId('payout-gate').getByTestId('gate-nothing_to_pay')).toBeVisible();
  await expect(page.getByTestId(`balance-track-${k.artists.A}-${isrc(24, 3, 1)}`).locator('[data-col="earned"]').getByTestId('money')).toHaveAttribute('title', '42.5');
  await expectOverview(page, [[account(24, 3), '2026-03', '100 / 57.5 / 0 / 42.5']]);
});

test('S23 G29: the sublabel recipient NG-231 earned 25, recouped 25, position remaining 25, payable 0', async ({ page }) => {
  const k = sc(23);
  const ownerId = k.owners.NG ?? '';
  await expectOverview(page, [[account(23, 1), '2026-03', '100 / 75 / 0 / 25']]);
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '25', recouped: '25', payable: '0' });
  const position = page.getByTestId(`position-${k.extra['advance-operation']}`);
  await expect(position.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '50');
  await expect(position.locator('[data-col="recouped"]').getByTestId('money')).toHaveAttribute('title', '25');
  await expect(position.locator('[data-col="remaining"]').getByTestId('money')).toHaveAttribute('title', '25');
  await expect(page.getByTestId('payout-gate').getByTestId('gate-nothing_to_pay')).toBeVisible();
  // the per-label table and the pseudonym rows come from the same response
  await expect(page.getByTestId('by-label-0to8').locator('[data-col="earned"]').getByTestId('money')).toHaveAttribute('title', '25');
  await expect(page.getByTestId(`balance-artist-${k.artists.NG}`).locator('[data-col="recouped"]').getByTestId('money')).toHaveAttribute('title', '25');
});

test('the tabs: pseudonyms and tracks link to their cards, documents list the contract, history and publishing render', async ({ page }) => {
  const k = sc(24, 1);
  const ownerId = k.owners.A ?? '';
  await openOwner(page, ownerId);
  // per pseudonym and ISRC: the ISRC links to the track card
  await expect(page.getByTestId(`balance-track-${k.artists.A}-${isrc(24, 1, 1)}`).getByRole('link')).toHaveAttribute('href', `/tracks/${isrc(24, 1, 1)}`);
  await page.getByTestId('tab-artists').click();
  await expect(page).toHaveURL(/tab=artists/);
  await expect(page.getByTestId(`artist-${k.artists.A}`)).toContainText('A-241');
  await page.getByTestId('tab-documents').click();
  await expect(page.getByTestId(`document-${k.documents['contract:A']}`)).toContainText('утверждён');
  await page.getByTestId('tab-publishing').click();
  await expect(page.getByTestId('publishing-tab')).toBeVisible();
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-tab')).toBeVisible();
  await page.getByTestId('tab-operations').click();
  await expect(page.getByTestId(`operation-${k.extra['migration-operations']}`).locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '30.00');
});

test('Документы и договоры: a contract with a new approved document confirms Owner DUP-361 (S36 owner, no money)', async ({ page, request }) => {
  const k = sc(36);
  const ownerId = k.owners.DUP ?? '';
  await openAs(page, `/owners/${ownerId}?tab=documents`);
  await expect(page.getByTestId('entity-card').getByTestId('chip-waiting_documents')).toBeVisible();
  await page.getByTestId('action-create-contract').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId(`contract-artist-${k.artists.A}`)).toBeChecked();
  await expect(dialog.getByTestId('action-contract-submit')).toBeDisabled();
  await choose(page, 'document-step-label', 'любой лейбл'); // under «Все» the step asks the label (D-169)
  await dialog.getByTestId('field-document-file').fill('dummy://e2e-contract-361.pdf');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/documents') && r.request().method() === 'POST');
  await dialog.getByTestId('action-document-create').click();
  const docId = ((await (await created).json()) as { id: string }).id;
  await dialog.getByTestId('action-document-approve').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('ждёт этого документа: 0,00');
  await page.getByTestId('confirm-dialog').getByTestId('confirm-dialog-ok').click();
  await expect(dialog.getByTestId('document-ready')).toBeVisible();
  await dialog.getByTestId('action-contract-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('владелец становится подтверждённым');
  await expect(page.getByTestId('confirm-dialog')).toContainText('A-361');
  await page.getByTestId('confirm-dialog').getByTestId('confirm-dialog-ok').click();
  await toastOk(page, 'Договор создан');
  await expect(page.getByTestId('entity-card').getByTestId('chip-confirmed')).toBeVisible();
  await expect(page.getByTestId(`document-${docId}`)).toContainText('утверждён');
  await expect(page.getByTestId('documents-tab').locator('tr[data-testid^="contract-"]').filter({ hasText: 'A-361' })).toHaveCount(1);
  // second press: the same contract again is accepted as a second row (19 §5)
  const again = await apiPost(request, '/contracts', { ownerId, documentId: docId, artistIds: [k.artists.A] });
  expect(again.status).toBe(201);
});
