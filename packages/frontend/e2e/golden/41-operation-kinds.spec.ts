import { expect, test, type Page } from '@playwright/test';
import { apiPost, choose, confirm, labelOf, openAs, ownerName, sc, settled, toastOk } from '../helpers';

// S49-S51 (19 §4, D-173): the kinds of an operation through the owner's «Операция» dialog (a buyout counted by its proof
// and an adjustment in favour of the owner, S24/1), the forgiveness of a seeded advance from a P20 row (refused above the
// unrecouped part, then 4 of 10, S22/2), the relabel of an operation with a required reason and its audit (S24/1). No
// later spec reads S22/2 or S24/1 (24-owner and 26-payout read them before).

test.describe.configure({ mode: 'serial' });

const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
async function expectTotals(page: Page, totals: Record<string, string>) {
  for (const [name, value] of Object.entries(totals)) await expect(fact(page, name), name).toHaveAttribute('title', value);
}
async function openOwner(page: Page, ownerId: string, tab = 'balance') {
  await openAs(page, `/owners/${ownerId}?tab=${tab}&label=${labelOf('0to8')}`);
  await settled(page);
}
async function tab(page: Page, id: string) {
  await page.getByTestId(`tab-${id}`).click();
  await settled(page);
}
const row = (page: Page, opId: string) => page.getByTestId(`operation-${opId}`);

/** The basis document of the open dialog: created under the label of the operation and approved. */
async function basisDocument(page: Page, fileRef: string) {
  const dialog = page.getByTestId('form-dialog');
  await dialog.getByTestId('field-document-file').fill(fileRef);
  await dialog.getByTestId('action-document-create').click();
  await toastOk(page, 'Документ создан');
  await dialog.getByTestId('action-document-approve').click();
  await confirm(page);
  await expect(dialog.getByTestId('document-ready')).toBeVisible();
}

/** «Операция» of an owner-kind (D-173): kind, amount, date, label 0to8, the document, the comment; returns the new id. */
async function createOwnerOperation(page: Page, kind: string, amount: string, file: string, lines: string[], sign?: string): Promise<string> {
  await page.getByTestId('action-create-operation').click();
  const dialog = page.getByTestId('form-dialog');
  await choose(page, 'op-kind', kind);
  await expect(dialog.getByTestId('field-op-artist')).toHaveCount(0); // an owner kind names no pseudonym
  if (sign) await choose(page, 'op-sign', sign);
  await dialog.getByTestId('field-op-amount').fill(amount);
  await dialog.getByTestId('field-op-date').fill('2026-05-01');
  await choose(page, 'op-label', '0to8');
  await basisDocument(page, file);
  await dialog.getByTestId('field-op-comment').fill('e2e');
  await dialog.getByTestId('action-operation-submit').click();
  const box = page.getByTestId('confirm-dialog');
  for (const line of lines) await expect(box).toContainText(line);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/settlements/operations') && r.request().method() === 'POST');
  await confirm(page);
  const res = await created;
  expect(res.status()).toBe(201);
  await toastOk(page, 'Операция записана');
  return ((await res.json()) as { id: string }).id;
}

let buyout = '';

test('S49 a buyout 15 (counted by its proof: buyouts 15, payable stays 20) and an adjustment −5 in favour of the owner (payable 25)', async ({ page }) => {
  const k = sc(24, 1);
  const ownerId = k.owners.A ?? '';
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '50', paid: '30', payable: '20', buyouts: '0', adjustments: '0' });
  await tab(page, 'operations');
  buyout = await createOwnerOperation(page, 'выкуп', '15', 'dummy://e2e-buyout-491.pdf', [
    'Вид: выкуп',
    'Сумма: 15,00',
    `Владелец: ${ownerName('A', 24, 1)}`,
    'Область книги: мастер',
  ]);
  await expect(row(page, buyout).locator('[data-col="kind"]')).toHaveAttribute('data-kind', 'buyout');
  // a buyout is counted by its payment proof; it never blocks the next payout
  await expect(page.getByTestId('operations-blocked')).toHaveCount(0);
  await row(page, buyout).getByTestId('action-proof').click();
  await page.getByTestId('field-proof-file').fill('dummy://e2e-buyout-proof-491.pdf');
  await page.getByTestId('form-dialog').getByTestId('action-proof-submit').click();
  await toastOk(page, 'Подтверждение приложено');
  await tab(page, 'balance');
  await expectTotals(page, { buyouts: '15', paid: '30', payable: '20' });
  await tab(page, 'operations');
  const adjustment = await createOwnerOperation(
    page,
    'корректировка',
    '5',
    'dummy://e2e-adjustment-491.pdf',
    ['Вид: корректировка', 'Сумма: -5,00'],
    'в пользу владельца (увеличивает к выплате)',
  );
  await expect(row(page, adjustment).locator('[data-col="kind"]')).toHaveAttribute('data-kind', 'adjustment');
  await tab(page, 'balance');
  await expectTotals(page, { buyouts: '15', adjustments: '5', payable: '25' });
  const master = page.getByTestId('balance-area-master');
  await expect(master.locator('[data-col="buyouts"]').getByTestId('money')).toHaveAttribute('title', '15');
  await expect(master.locator('[data-col="payable"]').getByTestId('money')).toHaveAttribute('title', '25');
  await expect(page.getByTestId('balance-area-publishing').locator('[data-col="payable"]').getByTestId('money')).toHaveAttribute('title', '0');
  // the book of the label carries the new fields too
  await expect(page.getByTestId('by-label-0to8').locator('[data-col="adjustments"]').getByTestId('money')).toHaveAttribute('title', '5');
  // the trail: both writes are in the owner's history
  await tab(page, 'history');
  await expect(page.locator('[data-route="POST /settlements/operations"]')).toHaveCount(2);
  // P20 filters by the stored kind
  await openAs(page, `/operations?ownerId=${ownerId}&kind=buyout&label=${labelOf('0to8')}`);
  await expect(page.locator('[data-testid^="operation-"][row-id]')).toHaveCount(1);
  await expect(row(page, buyout)).toBeVisible();
});

test('S50 forgive the seeded advance of S22/2: 20 is refused (unrecouped 10), 4 from 2026-05-01 → forgiven 4, remaining 6', async ({ page, request }) => {
  const k = sc(22, 2);
  const ownerId = k.owners.P ?? '';
  const advance = k.extra['advance-operation'] ?? '';
  await openAs(page, `/operations?ownerId=${ownerId}&label=${labelOf('0to8')}`);
  await expect(row(page, advance).locator('[data-col="kind"]')).toHaveAttribute('data-kind', 'advance');
  await row(page, advance).getByTestId(`action-forgive-${advance}`).click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('forgive-position').locator('[data-col="remaining"]').getByTestId('money')).toHaveAttribute('title', '10');
  await dialog.getByTestId('field-forgive-amount').fill('20');
  await dialog.getByTestId('field-forgive-date').fill('2026-05-01');
  const doc = dialog.getByTestId('field-forgive-document');
  await doc.getByTestId('field-document-file').fill('dummy://e2e-forgive-501.pdf');
  await doc.getByTestId('action-document-create').click();
  await toastOk(page, 'Документ создан');
  await doc.getByTestId('action-document-approve').click();
  await confirm(page);
  await expect(doc.getByTestId('document-ready')).toBeVisible();
  await dialog.getByTestId('field-forgive-comment').fill('e2e: the label forgives part of the advance');
  await dialog.getByTestId('action-forgive-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Прощается: 20,00 с 2026-05-01');
  await confirm(page);
  await expect(page.locator('[data-testid="toast"][data-code="forgiveness_exceeds"]').first()).toBeVisible();
  // the dialog stays: the amount is corrected
  let body: Record<string, unknown> = {};
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/operations/${advance}/forgive`)) body = r.postDataJSON() as Record<string, unknown>;
  });
  await dialog.getByTestId('field-forgive-amount').fill('4');
  await dialog.getByTestId('action-forgive-submit').click();
  const forgiven = page.waitForResponse((r) => r.url().endsWith(`/operations/${advance}/forgive`) && r.status() === 201);
  await confirm(page);
  const op = (await (await forgiven).json()) as { id: string; kind: string; amountCents: number };
  expect([op.kind, op.amountCents]).toEqual(['forgiveness', 400]);
  await toastOk(page, 'Аванс прощён: 4,00');
  await expect(row(page, op.id).locator('[data-col="kind"]')).toHaveAttribute('data-kind', 'forgiveness');
  // the balance: forgiven 4, the position waits for 6; payable does not move
  await openAs(page, `/owners/${ownerId}?tab=balance&label=${labelOf('0to8')}`);
  await settled(page);
  await expectTotals(page, { forgiven: '4', payable: '0' });
  const position = page.getByTestId(`position-${advance}`);
  await expect(position.locator('[data-col="forgiven"]').getByTestId('money')).toHaveAttribute('title', '4');
  await expect(position.locator('[data-col="remaining"]').getByTestId('money')).toHaveAttribute('title', '6');
  // second press: the same 4 again fits (6 left); 7 does not; the advance with a forgiveness cannot be deactivated
  const over = await apiPost(request, `/settlements/operations/${advance}/forgive`, { ...body, amount: '7' });
  expect([over.status, over.code]).toEqual([422, 'forgiveness_exceeds']);
  const deactivate = await apiPost(request, `/settlements/operations/${advance}/deactivate`, { reason: 'e2e' });
  expect([deactivate.status, deactivate.code]).toEqual([409, 'has_forgiveness']);
});

test('S51 relabel the buyout 0to8 → Echo8 with a reason: the source becomes «оператор», the audit keeps the reason and the old label', async ({ page, request }) => {
  const k = sc(24, 1);
  const ownerId = k.owners.A ?? '';
  await openAs(page, `/operations?ownerId=${ownerId}&label=`);
  await expect(row(page, buyout).locator('[data-col="label"]')).toHaveText('0to8');
  await row(page, buyout).getByTestId('action-relabel').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('op-label-current')).toContainText('0to8');
  await choose(page, 'op-label', 'Echo8');
  await expect(dialog.getByTestId('action-set-label-submit')).toBeDisabled(); // the reason is required
  await dialog.getByTestId('field-op-label-reason').fill('e2e: the buyout belongs to Echo8');
  await dialog.getByTestId('action-set-label-submit').click();
  await toastOk(page, 'Лейбл операции: 0to8 → Echo8');
  await expect(row(page, buyout).locator('[data-col="label"]')).toHaveText('Echo8');
  await expect(row(page, buyout).locator('[data-col="labelSource"]')).toHaveAttribute('data-value', 'operator');
  // the second press without a reason is refused
  const bare = await request.patch(`/api/v1/settlements/operations/${buyout}`, {
    data: { labelId: labelOf('0to8') },
    headers: { 'X-Operator': 'e2e-operator' },
  });
  expect(bare.status()).toBe(400);
  expect(((await bare.json()) as { error: { code: string } }).error.code).toBe('reason_required');
  // the audit row of the change: the route, the previous label
  const audit = (await (await request.get(`/api/v1/audit?entityId=${buyout}&limit=20`)).json()) as {
    items: { method: string; route: string; labelId: string | null; summary: { body?: Record<string, unknown> } }[];
  };
  const change = audit.items.find((i) => i.method === 'PATCH' && i.route === '/settlements/operations/:id');
  expect([change?.summary.body?.reason, change?.summary.body?.fromLabelId, change?.labelId]).toEqual([
    'e2e: the buyout belongs to Echo8',
    labelOf('0to8'),
    labelOf('Echo8'),
  ]);
  // the buyout left the book of 0to8: its payable is unchanged (a buyout is never in payable)
  await openOwner(page, ownerId);
  await expectTotals(page, { buyouts: '0', adjustments: '5', payable: '25' });
});
