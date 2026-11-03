import { expect, test, type Page } from '@playwright/test';
import { apiPost, openAs, sc, settled, toastOk } from '../helpers';

// The payout (19 §4 S22: G27, G27b and the deferred flag): the gate of the balance, the Pay dialog, the operation
// deferred until its proof, the proof, the deferred toggle on P20, the snapshot; the second press per 19 §5.

test.describe.configure({ mode: 'serial' });

const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
async function expectTotals(page: Page, totals: Record<string, string>) {
  for (const [name, value] of Object.entries(totals)) await expect(fact(page, name), name).toHaveAttribute('title', value);
}
const gate = (page: Page, key: string) => page.getByTestId('payout-gate').getByTestId(`gate-${key}`);
async function openOwner(page: Page, ownerId: string, tab = 'balance') {
  await openAs(page, `/owners/${ownerId}?tab=${tab}`);
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
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '15', recouped: '10', paid: '0', payable: '5', payableShown: '5' });
  const position = page.getByTestId(`position-${k.extra['advance-operation']}`);
  await expect(position.locator('[data-col="remaining"]').getByTestId('money')).toHaveAttribute('title', '0');
  await expect(gate(page, 'allowed')).toBeVisible();
  await page.getByTestId('action-pay').click();
  const dialog = page.getByTestId('confirm-dialog');
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
  const body = (await (await paid).json()) as { id: string; amountCents: number; deferred: boolean };
  expect([body.amountCents, body.deferred]).toEqual([500, true]);
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
  const again = await apiPost(request, `/owners/${ownerId}/payouts`);
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
  await expect(opCol(page, payoutId, 'meaning')).toContainText('выплата');
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
  const pay = await apiPost(request, `/owners/${ownerId}/payouts`);
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
