import { expect, test, type Page } from '@playwright/test';
import { apiPost, choose, confirm, isrc, openAs, sc, settled, toastOk } from '../helpers';

// S31 (19 §4; G43 (i)–(iii), G48, G49): advances with a scope created through the owner's «Аванс / вычет / кредит»
// dialog, their proof, the P20 needsProof filter; k4: deduction 10 → 40, credit −5 → 45, deactivate the deduction → 55,
// the payout 55 with its proof → 0, the return → 55. The second press of each action per 19 §5.

test.describe.configure({ mode: 'serial' });

const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
async function expectTotals(page: Page, totals: Record<string, string>) {
  for (const [name, value] of Object.entries(totals)) await expect(fact(page, name), name).toHaveAttribute('title', value);
}
async function openOwner(page: Page, ownerId: string, tab = 'balance') {
  await openAs(page, `/owners/${ownerId}?tab=${tab}`);
  await settled(page);
}
async function tab(page: Page, id: string) {
  await page.getByTestId(`tab-${id}`).click();
  await settled(page);
}
const row = (page: Page, opId: string) => page.getByTestId(`operation-${opId}`);
const position = (page: Page, opId: string, col: string) =>
  page.getByTestId(`position-${opId}`).locator(`[data-col="${col}"]`).getByTestId('money');

type OpInput = { direction?: 'in'; amount: string; date: string; scope?: string; isrcs?: string; file: string };

/** «Аванс / вычет / кредит» on the open Операции tab: the fields, the basis document (create + approve), the confirmation. */
async function createOperation(page: Page, input: OpInput, expectLines: string[]): Promise<string> {
  await page.getByTestId('action-create-operation').click();
  const dialog = page.getByTestId('form-dialog');
  if (input.direction === 'in') await choose(page, 'op-direction', 'к нам (удержание, зачисление)');
  await dialog.getByTestId('field-op-amount').fill(input.amount);
  await dialog.getByTestId('field-op-date').fill(input.date);
  if (input.scope) await choose(page, 'op-scope', input.scope);
  if (input.isrcs) await dialog.getByTestId('field-op-isrcs').fill(input.isrcs);
  await dialog.getByTestId('field-document-file').fill(input.file);
  await dialog.getByTestId('action-document-create').click();
  await toastOk(page, 'Документ создан');
  await dialog.getByTestId('action-document-approve').click();
  await confirm(page);
  await expect(dialog.getByTestId('document-ready')).toBeVisible();
  await dialog.getByTestId('field-op-comment').fill('e2e');
  await dialog.getByTestId('action-operation-submit').click();
  const box = page.getByTestId('confirm-dialog');
  for (const line of expectLines) await expect(box).toContainText(line);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/settlements/operations') && r.request().method() === 'POST');
  await confirm(page);
  const res = await created;
  expect(res.status()).toBe(201);
  await toastOk(page, 'Операция записана');
  await expect(dialog).toBeHidden();
  return ((await res.json()) as { id: string }).id;
}
async function attachProof(page: Page, opId: string, file: string) {
  await row(page, opId).getByTestId('action-proof').click();
  await page.getByTestId('field-proof-file').fill(file);
  await page.getByTestId('form-dialog').getByTestId('action-proof-submit').click();
  await toastOk(page, 'Подтверждение приложено');
  await expect(row(page, opId).locator('[data-col="proof"]')).toHaveAttribute('data-value', 'yes');
}
/** The advance of k1 (proved in the next test). */
let advance1 = '';
/** The body the dialog sent, for the second press. */
let lastBody: Record<string, unknown> = {};

test('S31/1 (i) advance 40, scope publishing: unproved → payable 80, pending and blocking; second advance refused', async ({ page, request }) => {
  const k = sc(31, 1);
  const ownerId = k.owners.A ?? '';
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '80', payable: '80' });
  await tab(page, 'operations');
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v1/settlements/operations')) lastBody = r.postDataJSON() as Record<string, unknown>;
  });
  const adv = await createOperation(
    page,
    { amount: '40', date: '2026-01-01', scope: 'паблишинг', file: 'dummy://e2e-advance-311.pdf' },
    ['Направление: от нас (аванс)', 'Сумма: 40,00', 'Псевдоним: A-311', 'Область: паблишинг', 'Основание:'],
  );
  advance1 = adv;
  await expect(row(page, adv).locator('[data-col="meaning"]')).toContainText('аванс');
  await expect(row(page, adv).locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '40.00');
  await expect(page.getByTestId('operations-blocked')).toBeVisible();
  await tab(page, 'balance');
  await expectTotals(page, { recouped: '0', payable: '80' });
  await expect(page.getByTestId(`pending-${adv}`)).toBeVisible();
  await expect(page.getByTestId(`blocking-${adv}`)).toBeVisible();
  // second press: the same body is refused while the first advance has no proof
  const again = await apiPost(request, '/settlements/operations', lastBody);
  expect([again.status, again.code]).toEqual([422, 'payout_blocked']);
  // P20: the needsProof filter keeps the advance
  await openAs(page, `/operations?ownerId=${ownerId}`);
  await expect(row(page, adv)).toBeVisible();
  await page.getByTestId('filter-needs-proof').click();
  await expect(page).toHaveURL(/needsProof=true/);
  await expect(page.getByTestId('filter-needs-proof')).toBeChecked();
  await expect(row(page, adv)).toBeVisible();
});

test('S31/1 (i) after the proof: recouped 30, remaining 10, payable 50; needsProof no longer lists it', async ({ page }) => {
  const k = sc(31, 1);
  const ownerId = k.owners.A ?? '';
  await openOwner(page, ownerId, 'operations');
  const adv = advance1;
  await attachProof(page, adv, 'dummy://e2e-proof-311.pdf');
  await tab(page, 'balance');
  await expectTotals(page, { recouped: '30', payable: '50' });
  await expect(position(page, adv, 'remaining')).toHaveAttribute('title', '10');
  await expect(page.getByTestId('blocking-payouts')).toHaveCount(0);
  await openAs(page, `/operations?ownerId=${ownerId}&needsProof=true`);
  await expect(page.getByTestId('page-state-empty')).toBeVisible();
});

test('S31/2 (ii) advance 40, scope isrcs [the track without income]: payable 80; after proof recouped 0, remaining 40', async ({ page }) => {
  const k = sc(31, 2);
  await openOwner(page, k.owners.A ?? '', 'operations');
  const adv = await createOperation(
    page,
    { amount: '40', date: '2026-01-01', scope: 'выбранные ISRC', isrcs: isrc(31, 2, 2), file: 'dummy://e2e-advance-312.pdf' },
    [`Область: выбранные ISRC: ${isrc(31, 2, 2)}`],
  );
  await tab(page, 'balance');
  await expectTotals(page, { payable: '80' });
  await tab(page, 'operations');
  await attachProof(page, adv, 'dummy://e2e-proof-312.pdf');
  await tab(page, 'balance');
  await expectTotals(page, { recouped: '0', payable: '80' });
  await expect(position(page, adv, 'remaining')).toHaveAttribute('title', '40');
});

test('S31/3 (iii) read-only: the migration payout 20 → paid 20, payable 60', async ({ page }) => {
  await openOwner(page, sc(31, 3).owners.A ?? '');
  await expectTotals(page, { earned: '80', paid: '20', payable: '60' });
});

let deduction = '';
let deductionBody: Record<string, unknown> = {};

test('S31/4 deduction 10 → recouped 10, payable 40; credit −5 → credits 5, payable 45', async ({ page }) => {
  const ownerId = sc(31, 4).owners.A ?? '';
  await openOwner(page, ownerId);
  await expectTotals(page, { earned: '50', payable: '50' });
  await tab(page, 'operations');
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v1/settlements/operations')) lastBody = r.postDataJSON() as Record<string, unknown>;
  });
  deduction = await createOperation(
    page,
    { direction: 'in', amount: '10', date: '2026-03-01', file: 'dummy://e2e-adjustment-314a.pdf' },
    ['Направление: к нам', 'Сумма: 10,00', 'Область: без области'],
  );
  deductionBody = lastBody;
  await expect(row(page, deduction).locator('[data-col="meaning"]')).toContainText('удержание');
  await tab(page, 'balance');
  await expectTotals(page, { recouped: '10', payable: '40' });
  await tab(page, 'operations');
  const credit = await createOperation(
    page,
    { direction: 'in', amount: '-5', date: '2026-03-01', file: 'dummy://e2e-adjustment-314b.pdf' },
    ['Сумма: -5,00'],
  );
  await expect(row(page, credit).locator('[data-col="meaning"]')).toContainText('зачисление');
  await tab(page, 'balance');
  await expectTotals(page, { credits: '5', payable: '45' });
});

test('S31/4 deactivate the deduction («необратимо») → recouped 0, payable 55; the second deactivation is refused', async ({ page, request }) => {
  const ownerId = sc(31, 4).owners.A ?? '';
  await openOwner(page, ownerId, 'operations');
  await row(page, deduction).getByTestId('action-deactivate').click();
  await page.getByTestId('field-deactivate-reason').fill('e2e: entered by mistake');
  await page.getByTestId('form-dialog').getByTestId('action-deactivate-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('необратимо');
  await expect(page.getByTestId('confirm-dialog')).toContainText('удержание 10,00 от 2026-03-01');
  await confirm(page);
  await toastOk(page, 'Операция отменена');
  await expect(row(page, deduction).locator('[data-col="active"]')).toHaveAttribute('data-value', 'false');
  await tab(page, 'balance');
  await expectTotals(page, { recouped: '0', credits: '5', payable: '55' });
  const again = await apiPost(request, `/settlements/operations/${deduction}/deactivate`, { reason: 'again' });
  expect(again.status).toBe(409);
});

let payout = '';

test('S31/4 pay 55 (5500 cents) and attach the proof → paid 55, payable 0', async ({ page }) => {
  const ownerId = sc(31, 4).owners.A ?? '';
  await openOwner(page, ownerId);
  await page.getByTestId('action-pay').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('будет отправлено 5500 центов');
  const paid = page.waitForResponse((r) => r.url().endsWith(`/owners/${ownerId}/payouts`) && r.request().method() === 'POST');
  await confirm(page);
  payout = ((await (await paid).json()) as { id: string }).id;
  await toastOk(page, 'Выплачено: 55,00');
  await tab(page, 'operations');
  await attachProof(page, payout, 'dummy://e2e-proof-314.pdf');
  // the snapshot stored with the button payout
  await row(page, payout).getByTestId('action-snapshot').click();
  await expect(page.getByTestId('snapshot').getByTestId('snapshot-amount').getByTestId('money')).toHaveAttribute('title', '55.00');
  await expect(page.getByTestId('snapshot').getByTestId('snapshot-payable').getByTestId('money')).toHaveAttribute('title', '55');
  await page.getByTestId('form-dialog-close').click();
  await tab(page, 'balance');
  await expectTotals(page, { paid: '55', payable: '0' });
});

test('S31/4 return the payout («необратимо») → a return of -55.00, returns 55, payable 55; the second return is refused', async ({ page, request }) => {
  const ownerId = sc(31, 4).owners.A ?? '';
  await openOwner(page, ownerId, 'operations');
  await row(page, payout).getByTestId('action-return').click();
  await page.getByTestId('field-return-file').fill('dummy://e2e-return-314.pdf');
  await page.getByTestId('field-return-comment').fill('e2e: the transfer came back');
  const date = await page.getByTestId('field-return-date').inputValue();
  await page.getByTestId('form-dialog').getByTestId('action-return-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Возврат выплаты 55,00');
  await expect(page.getByTestId('confirm-dialog')).toContainText('необратимо');
  const returned = page.waitForResponse((r) => r.url().endsWith(`/operations/${payout}/return`));
  await confirm(page);
  const ret = (await (await returned).json()) as { id: string; amountCents: number; meaning: string; date: string };
  expect([ret.amountCents, ret.meaning, ret.date]).toEqual([-5500, 'return', date]);
  await toastOk(page, 'Возврат записан: -55,00');
  await expect(row(page, ret.id).locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '-55.00');
  await expect(row(page, ret.id).locator('[data-col="meaning"]')).toContainText('возврат');
  await tab(page, 'balance');
  await expectTotals(page, { paid: '55', returns: '55', payable: '55' });
  const again = await apiPost(request, `/settlements/operations/${payout}/return`, {
    fileRef: 'dummy://again.pdf',
    date,
    comment: 'again',
  });
  expect(again.status).toBe(400);
});

test('S31/4 second press of the deduction: 201, a second operation (two deductions in P20)', async ({ page, request }) => {
  const ownerId = sc(31, 4).owners.A ?? '';
  const again = await apiPost(request, '/settlements/operations', deductionBody);
  expect(again.status).toBe(201);
  await openAs(page, `/operations?ownerId=${ownerId}&meaning=deduction`);
  await expect(page.locator('[data-testid^="operation-"][row-id]')).toHaveCount(2);
});
