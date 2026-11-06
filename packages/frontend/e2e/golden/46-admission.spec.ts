import { expect, test, type Page } from '@playwright/test';
import { apiPost, labelOf, openAs, OPERATOR, settled, toastOk } from '../helpers';

// S56 (19 §4, D-176): the admission of P10 with a synthetic owner of its own (a contract, a start of 12.5 under 0to8, no
// income). Before any payee row the gate is «allowed»; the first payee of the organization turns the checks on: the
// first payout needs an answer for its amount; a hold closes the payout and its release opens it; the threshold of the
// contract wins over the default; a deactivated payee is «no payee». The seed's own scenarios paid before this file.

test.describe.configure({ mode: 'serial' });

const PSEUDONYM = 'S56 Admit e2e';
let ownerId = '';

const gate = (page: Page) => page.getByTestId('admission-gate');
async function openAdmission(page: Page) {
  await openAs(page, `/owners/${ownerId}?tab=admission&label=${labelOf('0to8')}`);
  await settled(page);
  await expect(page.getByTestId('admission-tab')).toBeVisible();
}
async function reason(page: Page, text: string) {
  await page.getByTestId('field-admission-reason').fill(text);
  await page.getByTestId('action-admission-reason-submit').click();
}

test('S56 an owner with a contract and a start: the gate is allowed while the organization has no payee', async ({ page, request }) => {
  const owner = await apiPost(request, '/owners', { name: 'Owner S56 e2e', kind: 'person', force: true });
  expect(owner.status).toBe(201);
  ownerId = (owner.body as { id: string }).id;
  const artist = await apiPost(request, '/artists', { pseudonym: PSEUDONYM, ownerId, force: true });
  expect(artist.status).toBe(201);
  const doc = await apiPost(request, '/documents', { kind: 'contract', title: 'Contract S56 e2e', fileRef: 'dummy://s56.pdf', ownerId, requiresApproval: true });
  expect(doc.status).toBe(201);
  expect((await apiPost(request, `/documents/${(doc.body as { id: string }).id}/approve`, {})).status).toBe(200);
  const contract = await apiPost(request, '/contracts', { ownerId, documentId: (doc.body as { id: string }).id, artistIds: [(artist.body as { id: string }).id] });
  expect(contract.status).toBe(201);
  const start = await request.post(`/api/v1/settlements/start/import?label=${labelOf('0to8')}&cutoff=2026-06&syncedAt=2026-07-01T00:00:00Z&dryRun=0&basis=e2e`, {
    headers: { 'X-Operator': OPERATOR },
    multipart: { file: { name: 'start-s56.csv', mimeType: 'text/csv', buffer: Buffer.from(`pseudonym;master\n${PSEUDONYM};12.5\n`) } },
  });
  expect(start.status()).toBe(201);
  await openAdmission(page);
  await expect(page.getByTestId('admission-tab')).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('admission-inactive')).toBeVisible();
  await expect(gate(page)).toHaveAttribute('data-reason', '');
  await expect(page.getByTestId('payee-none')).toBeVisible();
  await expect(page.getByTestId('holds-none')).toBeVisible();
});

test('S56 the first payee turns the admission on: the first payout needs an answer; an answer for the amount opens the gate', async ({ page }) => {
  await openAdmission(page);
  await page.getByTestId('action-set-payee').click();
  await page.getByTestId('field-payee-ref').fill('e2e-56');
  await page.getByTestId('field-payee-basis').fill('e2e');
  await page.getByTestId('action-payee-submit').click();
  await toastOk(page, 'Получатель задан');
  await settled(page);
  await expect(page.getByTestId('admission-tab')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-testid^="payee-"][data-channel]')).toHaveAttribute('data-channel', 'tipalti');
  await expect(gate(page)).toHaveAttribute('data-reason', 'needs_answer');
  // the answer dialog pre-fills the amount of the gate (12.5)
  await page.getByTestId('action-create-answer').click();
  await expect(page.getByTestId('field-answer-due')).toHaveValue('12.50');
  await page.getByTestId('field-answer-why').fill('first payout checked');
  await page.getByTestId('field-answer-by').fill('e2e');
  await page.getByTestId('action-answer-submit').click();
  await toastOk(page, 'Ответ записан');
  await settled(page);
  await expect(gate(page)).toHaveAttribute('data-reason', '');
  await expect(page.locator('[data-testid^="answer-"][data-due="1250"]')).toHaveAttribute('data-active', 'true');
});

test('S56 a hold closes the payout, its release opens it; P9 and P10 show the same reason', async ({ page }) => {
  await openAdmission(page);
  await page.getByTestId('action-create-hold').click();
  await page.getByTestId('field-hold-reason').fill('the artist asked to wait');
  await page.getByTestId('action-hold-submit').click();
  await toastOk(page, 'Холд поставлен');
  await settled(page);
  await expect(gate(page)).toHaveAttribute('data-reason', 'hold');
  const hold = page.locator('[data-testid^="hold-"][data-status="active"]').first();
  await expect(hold).toHaveAttribute('data-kind', 'decision');
  await openAs(page, `/owners/${ownerId}?tab=balance&label=${labelOf('0to8')}`);
  await settled(page);
  await expect(page.getByTestId('payout-gate').locator('[data-reason]')).toHaveAttribute('data-reason', 'hold');
  await openAdmission(page);
  const id = ((await page.locator('[data-testid^="hold-"][data-status="active"]').first().getAttribute('data-testid')) ?? '').replace('hold-', '');
  await page.getByTestId(`action-release-hold-${id}`).click();
  await reason(page, 'the artist came back');
  await toastOk(page, 'Холд снят');
  await settled(page);
  await expect(page.getByTestId(`hold-${id}`)).toHaveAttribute('data-status', 'released');
  await expect(gate(page)).toHaveAttribute('data-reason', '');
});

test('S56 the threshold of the contract: 2000 cents closes the gate (below_threshold), empty opens it; a deactivated payee is no_payee', async ({ page }) => {
  await openAdmission(page);
  await page.getByTestId('action-set-threshold').click();
  await page.getByTestId('field-threshold-cents').fill('2000');
  await page.getByTestId('action-threshold-submit').click();
  await toastOk(page, 'Порог договора задан');
  await settled(page);
  await expect(page.getByTestId('admission-threshold-value')).toHaveAttribute('data-cents', '2000');
  await expect(gate(page)).toHaveAttribute('data-reason', 'below_threshold');
  await page.getByTestId('action-set-threshold').click();
  await page.getByTestId('field-threshold-cents').fill('');
  await page.getByTestId('action-threshold-submit').click();
  await toastOk(page, 'Порог договора задан');
  await settled(page);
  await expect(gate(page)).toHaveAttribute('data-reason', '');
  await page.getByTestId('action-deactivate-payee').click();
  await reason(page, 'left the channel');
  await toastOk(page, 'Получатель отключён');
  await settled(page);
  await expect(page.getByTestId('payee-none')).toBeVisible();
  await expect(gate(page)).toHaveAttribute('data-reason', 'no_payee');
});
