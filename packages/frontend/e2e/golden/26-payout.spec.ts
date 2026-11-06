import { expect, test, type Page } from '@playwright/test';
import { account, apiPost, choose, expectOverview, labelOf, openAs, sc, settled, toastOk } from '../helpers';

// The payout (19 §4 S22: G27, G27b and the deferred flag): the gate of the balance, the Pay dialog, the operation
// deferred until its proof, the proof, the deferred toggle on P20, the snapshot; the second press per 19 §5. D-169 (R8):
// the payout under 0to8 pays the master and the publishing of 0to8 (S31/1 read before 27-operations acts on it, S18 W1
// paid here: no later spec reads S18).

test.describe.configure({ mode: 'serial' });

const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
async function expectTotals(page: Page, totals: Record<string, string>) {
  for (const [name, value] of Object.entries(totals)) await expect(fact(page, name), name).toHaveAttribute('title', value);
}
const gate = (page: Page, key: string) => page.getByTestId('payout-gate').getByTestId(`gate-${key}`);
/** The owner card under the label 0to8 (D-168: the button pays the book of the label; every unit of S22 is 0to8). */
async function openOwner(page: Page, ownerId: string, tab = 'balance') {
  await openAs(page, `/owners/${ownerId}?tab=${tab}&label=${labelOf('0to8')}`);
  await settled(page);
}
async function balanceTab(page: Page) {
  await page.getByTestId('tab-balance').click();
  await settled(page);
  await expect(page.getByTestId('balance-tab')).toBeVisible();
}
const opCol = (page: Page, opId: string, col: string) => page.getByTestId(`operation-${opId}`).locator(`[data-col="${col}"]`);

let payoutId = '';

test('S22/1 before: earned 15, recouped 10, remaining 0, payable 5; Pay → the dialog → the payout is recorded', async ({ page, request }) => {
  const k = sc(22, 1);
  const ownerId = k.owners.P ?? '';
  await expectOverview(page, [
    [account(22, 1), '2026-03', '100 / 57.5 / 0 / 42.5'],
    [account(22, 1), '2026-04', '100 / 57.5 / 0 / 42.5'],
    [account(22, 2), '2026-03', '100 / 57.5 / 0 / 42.5'],
    [account(22, 2), '2026-04', '-100 / -57.5 / 0 / -42.5'],
  ]);
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '15', recouped: '10', paid: '0', payable: '5', payableShown: '5' });
  const position = page.getByTestId(`position-${k.extra['advance-operation']}`);
  await expect(position.locator('[data-col="remaining"]').getByTestId('money')).toHaveAttribute('title', '0');
  await expect(gate(page, 'allowed')).toBeVisible();
  await page.getByTestId('action-pay').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('Лейбл: 0to8');
  await expect(dialog).toContainText('Область: мастер; к выплате в области 5,00'); // D-173: master by default
  await expect(dialog).toContainText('К выплате: 5,00 (будет отправлено 500 центов)');
  await expect(dialog).toContainText('Заработано 15,00 − удержано 10,00 − выплачено 0,00');
  await expect(dialog).toContainText('P-221: заработано 15,00, удержано 10,00');
  await expect(dialog).toContainText('снимок будет сохранён');
  await expect(dialog).toContainText('e2e-operator');
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/owners/${ownerId}/payouts`)) posts += 1;
  });
  const paid = page.waitForResponse((r) => r.url().endsWith(`/owners/${ownerId}/payouts`) && r.request().method() === 'POST');
  // a double click sends one request (the button is disabled while it is in flight)
  await dialog.getByTestId('confirm-dialog-ok').dblclick();
  const body = (await (await paid).json()) as { id: string; amountCents: number; deferred: boolean; labelId: string };
  expect([body.amountCents, body.deferred, body.labelId]).toEqual([500, true, labelOf('0to8')]);
  payoutId = body.id;
  await toastOk(page, 'Выплачено: 5,00');
  expect(posts).toBe(1);
  // after: an unproved payout is not counted; it blocks the next one
  await settled(page);
  await expectTotals(page, { paid: '0', payable: '5' });
  await expect(gate(page, 'payout_blocked')).toBeVisible();
  await expect(page.getByTestId(`blocking-${payoutId}`)).toBeVisible();
  await expect(page.getByTestId(`pending-${payoutId}`)).toBeVisible();
  await expect(page.getByTestId('action-pay')).toBeDisabled();
  await expect(page.getByTestId('payout-gate')).toContainText('есть выплата без подтверждения');
  const again = await apiPost(request, `/owners/${ownerId}/payouts`, { labelId: labelOf('0to8') });
  expect([again.status, again.code]).toEqual([422, 'payout_blocked']);
  // P4: the owner is a candidate blocked by one payout
  const grid = JSON.stringify({ f: { name: { filterType: 'text', type: 'contains', filter: 'P-221' } } });
  await openAs(page, `/owners?view=payouts&grid=${encodeURIComponent(grid)}`);
  await settled(page);
  const row = page.getByTestId(`owner-${ownerId}`);
  await expect(row.getByTestId('gate-payout_blocked')).toBeVisible();
  await expect(row.locator('[data-col="blocking"]')).toHaveText('1');
});

test('S22/1 the operation: payout 5.00, deferred, no proof; the Операции tab says new payouts are blocked; snapshot', async ({ page }) => {
  const k = sc(22, 1);
  await openOwner(page, k.owners.P ?? '', 'operations');
  await expect(page.getByTestId('operations-blocked')).toBeVisible();
  await expect(opCol(page, payoutId, 'kind')).toContainText('выплата');
  await expect(opCol(page, payoutId, 'amount').getByTestId('money')).toHaveAttribute('title', '5.00');
  await expect(opCol(page, payoutId, 'deferred')).toHaveAttribute('data-value', 'true');
  await expect(opCol(page, payoutId, 'proof')).toHaveAttribute('data-value', 'no');
  await page.getByTestId(`operation-${payoutId}`).getByTestId('action-snapshot').click();
  const snap = page.getByTestId('snapshot');
  await expect(snap.getByTestId('snapshot-amount').getByTestId('money')).toHaveAttribute('title', '5.00');
  await expect(snap.getByTestId('snapshot-payable').getByTestId('money')).toHaveAttribute('title', '5');
  await expect(snap.getByTestId(`snapshot-artist-${k.artists.P}`).locator('[data-col="earned"]').getByTestId('money')).toHaveAttribute('title', '15');
  await page.getByTestId('form-dialog-close').click();
});

test('S22/1 attach the proof: paid 5, payable 0, gate nothing_to_pay; the second proof is refused', async ({ page, request }) => {
  const ownerId = sc(22, 1).owners.P ?? '';
  await openOwner(page, ownerId, 'operations');
  await page.getByTestId(`operation-${payoutId}`).getByTestId('action-proof').click();
  await page.getByTestId('field-proof-file').fill('dummy://e2e-proof-221.pdf');
  await page.getByTestId('form-dialog').getByTestId('action-proof-submit').click();
  await toastOk(page, 'Подтверждение приложено');
  await expect(opCol(page, payoutId, 'proof')).toHaveAttribute('data-value', 'yes');
  await expect(opCol(page, payoutId, 'deferred')).toHaveAttribute('data-value', 'false');
  await balanceTab(page);
  await expectTotals(page, { paid: '5', payable: '0' });
  await expect(gate(page, 'nothing_to_pay')).toBeVisible();
  await expect(page.getByTestId('blocking-payouts')).toHaveCount(0);
  const proof = await apiPost(request, `/settlements/operations/${payoutId}/proof`, { fileRef: 'dummy://again.pdf' });
  expect(proof.status).toBe(400);
});

test('S22/1 deferred on P20: still counted but blocks; unset: nothing_to_pay; the same value twice is a no-op', async ({ page, request }) => {
  const ownerId = sc(22, 1).owners.P ?? '';
  await openAs(page, `/operations?ownerId=${ownerId}`);
  await expect(page.getByTestId('operations-page')).toBeVisible();
  await page.getByTestId(`operation-${payoutId}`).getByTestId('action-deferred').click();
  await toastOk(page, 'Отложено: да');
  await expect(opCol(page, payoutId, 'deferred')).toHaveAttribute('data-value', 'true');
  const same = await apiPost(request, `/settlements/operations/${payoutId}/deferred`, { deferred: true });
  expect([same.status, (same.body as { deferred?: boolean } | undefined)?.deferred]).toEqual([200, true]);
  await openOwner(page, ownerId);
  await expectTotals(page, { paid: '5', payable: '0' });
  await expect(gate(page, 'payout_blocked')).toBeVisible();
  await expect(page.getByTestId(`blocking-${payoutId}`)).toBeVisible();
  await openAs(page, `/operations?ownerId=${ownerId}`);
  await page.getByTestId(`operation-${payoutId}`).getByTestId('action-deferred').click();
  await toastOk(page, 'Отложено: нет');
  await expect(opCol(page, payoutId, 'deferred')).toHaveAttribute('data-value', 'false');
  await openOwner(page, ownerId);
  await expect(gate(page, 'nothing_to_pay')).toBeVisible();
  await expect(page.getByTestId('blocking-payouts')).toHaveCount(0);
  const pay = await apiPost(request, `/owners/${ownerId}/payouts`, { labelId: labelOf('0to8') });
  expect([pay.status, pay.code]).toEqual([422, 'nothing_to_pay']);
});

test('S22/2 G27b read-only: earned 0, recouped 0, remaining 10, payable 0; the button is disabled', async ({ page }) => {
  const k = sc(22, 2);
  await openOwner(page, k.owners.P ?? '');
  await expectTotals(page, { earned: '0', recouped: '0', payable: '0' });
  const position = page.getByTestId(`position-${k.extra['advance-operation']}`);
  await expect(position.locator('[data-col="remaining"]').getByTestId('money')).toHaveAttribute('title', '10');
  await expect(gate(page, 'nothing_to_pay')).toBeVisible();
  await expect(page.getByTestId('action-pay')).toBeDisabled();
});

// S43 (G56, D-169): a contract opens the label of its document; a document without a label opens every label. Not
// seeded: the case is built here by API on an owner of its own (a pseudonym, no income), so no seeded owner changes.
test('S43 a 0to8 contract does not open Echo8 («нет договора с этим лейблом»); without a label it opens both', async ({ page, request }) => {
  const owner = await apiPost(request, '/owners', { name: 'Owner S43 e2e', kind: 'person', force: true });
  const ownerId = (owner.body as { id: string }).id;
  const artist = await apiPost(request, '/artists', { pseudonym: 'P-431', ownerId, force: true });
  const doc = await apiPost(request, '/documents', {
    kind: 'contract',
    title: 'Contract S43 0to8',
    fileRef: 'dummy://s43-contract.pdf',
    ownerId,
    requiresApproval: true,
    labelId: labelOf('0to8'),
  });
  const docId = (doc.body as { id: string }).id;
  const approved = await apiPost(request, `/documents/${docId}/approve`, { by: 'e2e-operator' });
  const contract = await apiPost(request, '/contracts', { ownerId, documentId: docId, artistIds: [(artist.body as { id: string }).id] });
  expect([owner.status, artist.status, doc.status, approved.status, contract.status]).toEqual([201, 201, 201, 200, 201]);
  const openUnder = async (label: '0to8' | 'Echo8') => {
    await openAs(page, `/owners/${ownerId}?tab=balance&label=${labelOf(label)}`);
    await settled(page);
  };
  // under Echo8: refused, with the caption of the gate; the API says the same
  await openUnder('Echo8');
  await expect(gate(page, 'no_contract_for_label')).toBeVisible();
  await expect(page.getByTestId('payout-gate')).toContainText('нет договора с этим лейблом');
  await expect(page.getByTestId('action-pay')).toBeDisabled();
  const refused = await apiPost(request, `/owners/${ownerId}/payouts`, { labelId: labelOf('Echo8') });
  expect([refused.status, refused.code]).toEqual([422, 'no_contract_for_label']);
  // under 0to8 the contract opens the owner: only nothing to pay is left
  await openUnder('0to8');
  await expect(gate(page, 'nothing_to_pay')).toBeVisible();
  // the document loses its label on P14: it opens both labels
  await openAs(page, `/documents/${docId}`);
  await settled(page);
  await page.getByTestId('action-set-document-label').click();
  await choose(page, 'document-label', 'любой лейбл');
  await page.getByTestId('action-set-document-label-submit').click();
  await toastOk(page, 'Лейбл документа Contract S43 0to8: любой');
  await openUnder('Echo8');
  await expect(gate(page, 'nothing_to_pay')).toBeVisible();
  await expect(page.getByTestId('payout-gate')).not.toContainText('нет договора с этим лейблом');
  await openUnder('0to8');
  await expect(gate(page, 'nothing_to_pay')).toBeVisible();
  const echo = await apiPost(request, `/owners/${ownerId}/payouts`, { labelId: labelOf('Echo8') });
  expect([echo.status, echo.code]).toEqual([422, 'nothing_to_pay']);
});

// D-169 (R8): the B17 statement of the seed is loaded under 0to8, so the publishing of an owner is the book 0to8. D-173
// (FIX-8): the payout pays one area, master by default; «мастер и паблишинг» pays the whole book. S31/1 (master 50 +
// publishing 30) is only read here: 27-operations acts on it.
test('S31/1 under 0to8 the Pay dialog: master 50,00 by default, the whole book 80,00 with «мастер и паблишинг»; cancelled', async ({ page }) => {
  const ownerId = sc(31, 1).owners.A ?? '';
  await openAs(page, `/owners/${ownerId}?tab=balance&label=`);
  await settled(page);
  await expect(page.getByTestId('by-label-0to8').locator('[data-col="earned"]').getByTestId('money')).toHaveAttribute('title', '80');
  await expect(page.getByTestId('by-label-?')).toHaveCount(0);
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '80', recouped: '0', paid: '0', payable: '80' });
  await page.getByTestId('tab-publishing').click();
  await expect(page.getByTestId('publishing-line')).toHaveCount(1);
  await expect(page.getByTestId('publishing-line').locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '30');
  await balanceTab(page);
  await page.getByTestId('action-pay').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('Лейбл: 0to8');
  await expect(dialog).toContainText('К выплате: 50,00 (будет отправлено 5000 центов)');
  await expect(page.getByTestId('balance-area-master').locator('[data-col="payable"]').getByTestId('money')).toHaveAttribute('title', '50');
  await choose(page, 'pay-area', 'мастер и паблишинг');
  await expect(dialog).toContainText('К выплате: 80,00 (будет отправлено 8000 центов)');
  await expect(dialog).toContainText('Заработано 80,00 − удержано 0,00 − выплачено 0,00');
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
});

test('S18 W1 (publishing only) under 0to8: master has nothing to pay; the area «паблишинг» pays 100.00; Echo8 has nothing to pay', async ({ page, request }) => {
  const ownerId = sc(18).owners.W1 ?? '';
  const echo = await apiPost(request, `/owners/${ownerId}/payouts`, { labelId: labelOf('Echo8') });
  expect([echo.status, echo.code]).toEqual([422, 'nothing_to_pay']);
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '100', payable: '100' });
  await expect(gate(page, 'allowed')).toBeVisible();
  await page.getByTestId('action-pay').click();
  const dialog = page.getByTestId('confirm-dialog');
  // D-173: the master area (the default) of a publishing-only owner has nothing: the OK is closed with the gate's reason
  await expect(dialog.getByTestId('confirm-dialog-blocked')).toContainText('нечего выплачивать');
  await expect(dialog.getByTestId('confirm-dialog-ok')).toBeDisabled();
  await choose(page, 'pay-area', 'паблишинг');
  await expect(dialog).toContainText('К выплате: 100,00 (будет отправлено 10000 центов)');
  await expect(dialog.getByTestId('confirm-dialog-blocked')).toHaveCount(0);
  const paid = page.waitForResponse((r) => r.url().endsWith(`/owners/${ownerId}/payouts`) && r.request().method() === 'POST');
  await dialog.getByTestId('confirm-dialog-ok').click();
  const body = (await (await paid).json()) as { id: string; amountCents: number; labelId: string };
  expect([body.amountCents, body.labelId]).toEqual([10000, labelOf('0to8')]);
  await toastOk(page, 'Выплачено: 100,00');
  const proof = await apiPost(request, `/settlements/operations/${body.id}/proof`, { fileRef: 'dummy://e2e-proof-181.pdf' });
  expect(proof.status).toBe(200);
  await openOwner(page, ownerId);
  await expectTotals(page, { paid: '100', payable: '0' });
  await openAs(page, `/owners/${ownerId}?tab=balance&label=`);
  await settled(page);
  await expect(page.getByTestId('by-label-0to8').locator('[data-col="paid"]').getByTestId('money')).toHaveAttribute('title', '100');
  await expect(page.getByTestId('by-label-?')).toHaveCount(0);
});
