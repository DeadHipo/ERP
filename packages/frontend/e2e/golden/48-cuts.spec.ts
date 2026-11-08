import { expect, test } from '@playwright/test';
import { apiPost, choose, confirm, labelOf, openAs, toastOk } from '../helpers';

// S57 (D-198…D-200): the cuts P34 / P35 under 0to8 with a synthetic owner of its own. An adjustment of −10 (an
// approved basis) gives its pseudonym a position of +10; a cut on 2026-06-15 shows it; «Перенести» moves it past the
// cut (two adjustments with one new document): the position at the cut is 0, after it 10; the block «Срезы» of the owner page
// says so; the original adjustment is attributed to the cut from its row on P20; the cut with operations is not
// deleted. Nothing seeded changes but the cut itself.

test.describe.configure({ mode: 'serial' });

const PSEUDONYM = 'S57 Cut e2e';
let ownerId = '';
let artistId = '';
let adjustmentId = '';
let cutId = '';

/** P35 filtered to the S57 owner through the grid's URL filter (D-206: by pages the e2e book has more than 50 owners). */
const cutUrl = () =>
  `/operations/cuts/${cutId}?label=${labelOf('0to8')}&grid=${encodeURIComponent(JSON.stringify({ f: { owner: { filterType: 'text', type: 'contains', filter: 'Owner S57 e2e' } } }))}`;

test('S57 a cut of the book: created under the label, its position of the owner shown', async ({ page, request }) => {
  const zero = labelOf('0to8');
  const owner = await apiPost(request, '/owners', { name: 'Owner S57 e2e', kind: 'person', force: true });
  expect(owner.status).toBe(201);
  ownerId = (owner.body as { id: string }).id;
  const artist = await apiPost(request, '/artists', { pseudonym: PSEUDONYM, ownerId, force: true });
  expect(artist.status).toBe(201);
  artistId = (artist.body as { id: string }).id;
  const doc = await apiPost(request, '/documents', { kind: 'adjustment_basis', title: 'S57 basis', ownerId, fileRef: 'dummy://s57.pdf', requiresApproval: false, labelId: zero });
  expect(doc.status).toBe(201);
  const adj = await apiPost(request, '/settlements/operations', {
    kind: 'adjustment',
    direction: 'in',
    amount: '-10.00',
    ownerId,
    artistId,
    date: '2026-05-01',
    documentId: (doc.body as { id: string }).id,
    comment: 'S57 position',
    labelId: zero,
  });
  expect(adj.status).toBe(201);
  adjustmentId = (adj.body as { id: string }).id;

  await openAs(page, `/operations?label=${zero}`);
  await page.getByTestId('nav-cuts').click();
  await expect(page).toHaveURL(/\/operations\/cuts/);
  await expect(page.getByTestId('cuts-page')).toHaveAttribute('data-label-id', zero);
  await page.getByTestId('action-create-cut').click();
  await page.getByTestId('field-cut-name').fill('S57 срез');
  await page.getByTestId('field-cut-date').fill('2026-06-15');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/settlements/cuts') && r.request().method() === 'POST');
  await page.getByTestId('action-cut-submit').click();
  const res = await created;
  expect(res.status()).toBe(201);
  const cut = (await res.json()) as { id: string; masterTo: string };
  cutId = cut.id;
  expect(cut.masterTo).toBe('2026-06-01');
  await toastOk(page, 'Срез «S57 срез» создан');
  await expect(page.getByTestId(`cut-link-${cutId}`)).toBeVisible();
  await openAs(page, cutUrl());
  await expect(page.getByTestId('cut-page')).toHaveAttribute('data-cut-id', cutId);
  await expect(page.getByTestId(`cut-position-${ownerId}-${artistId}`).locator('[data-col="balance"]')).toHaveAttribute('data-value', '10');
});

test('S57 «Перенести»: the position at the cut is zero, after it the balance lives on', async ({ page }) => {
  await openAs(page, cutUrl());
  await page.getByTestId(`action-cut-transfer-${ownerId}-${artistId}`).click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('cut-transfer-line')).toContainText(PSEUDONYM);
  await dialog.getByTestId('field-document-file').fill('dummy://s57-transfer.pdf');
  await dialog.getByTestId('action-document-create').click();
  await toastOk(page, 'Документ создан');
  await dialog.getByTestId('action-document-approve').click();
  await confirm(page);
  await expect(dialog.getByTestId('document-ready')).toBeVisible();
  const moved = page.waitForResponse((r) => r.url().endsWith(`/settlements/cuts/${cutId}/transfer`));
  await dialog.getByTestId('action-cut-transfer-submit').click();
  expect((await moved).status()).toBe(201);
  await toastOk(page, 'перенесено за срез');
  // D-206: by pages every owner of the book is a row, its positions asked for the rows on the screen
  await expect(page.getByTestId('cut-page')).toHaveAttribute('data-mode', 'paged');
  await expect(page.getByTestId(`cut-position-${ownerId}-${artistId}`).locator('[data-col="balance"]')).toHaveAttribute('data-value', '0');
  // «Посчитать все»: one full state; a settled owner is not listed until «show all»
  await page.getByTestId('action-cut-compute-all').click();
  await expect(page.getByTestId('cut-page')).toHaveAttribute('data-mode', 'all');
  await expect(page.getByTestId('cut-totals')).toBeVisible();
  await expect(page.getByTestId(`cut-owner-${ownerId}`)).toHaveCount(0);
  await page.getByTestId('field-cut-show-all').check();
  await expect(page.getByTestId(`cut-position-${ownerId}-${artistId}`).locator('[data-col="balance"]')).toHaveAttribute('data-value', '0');

  // the block «Срезы» of the owner page (D-204): 0 at the cut, the transfer row attributed to it, 10 after the last cut
  await openAs(page, `/owners/${ownerId}?label=${labelOf('0to8')}`);
  await expect(page.getByTestId(`owner-cut-${cutId}`)).toBeVisible();
  await expect(page.getByTestId(`owner-cut-positions-${cutId}-${artistId}`)).toHaveAttribute('data-value', '0');
  await expect(page.getByTestId(`owner-cut-operations-${cutId}`).locator('[data-testid^="owner-cut-op-"]')).toHaveCount(1);
  // D-207: the transfer row names its origin beside its kind
  await expect(page.getByTestId(`owner-cut-operations-${cutId}`).locator('[data-origin="cut_transfer"]')).toHaveCount(1);
  // D-208: «На срез»: the balance of the owner at the cut (the position 0 there), the payout closed; back to now
  await choose(page, 'balance-cut', 'S57 срез · 2026-06-15');
  await expect(page.getByTestId('balance-at-cut')).toHaveAttribute('data-cut-id', cutId);
  await expect(page).toHaveURL(new RegExp(`cut=${cutId}`));
  await expect(page.getByTestId('action-pay')).toBeDisabled();
  await page.getByTestId('action-balance-now').click();
  await expect(page.getByTestId('balance-at-cut')).toHaveCount(0);
  await expect(page.getByTestId(`owner-cuts-after-positions-${labelOf('0to8')}-${artistId}`)).toHaveAttribute('data-value', '10');
});

test('S57 an operation attributed to the cut from its row; a cut with operations is not deleted', async ({ page }) => {
  await openAs(page, `/operations?label=${labelOf('0to8')}&ownerId=${ownerId}`);
  const row = page.getByTestId(`operation-${adjustmentId}`);
  await row.getByTestId(`action-op-cut-${adjustmentId}`).click();
  await choose(page, 'op-cut', 'S57 срез · 2026-06-15');
  await page.getByTestId('action-op-cut-submit').click();
  await toastOk(page, 'Срез операции сохранён');
  await expect(row.locator('[data-col="cut"]')).toHaveAttribute('data-cut-id', cutId);

  await openAs(page, `/operations/cuts?label=${labelOf('0to8')}`);
  await page.getByTestId(`action-cut-delete-${cutId}`).click();
  await page.getByTestId('confirm-dialog').getByTestId('confirm-dialog-ok').click();
  await expect(page.locator('[data-testid="toast"][data-code="cut_in_use"]').first()).toBeVisible();
  await expect(page.getByTestId(`cut-${cutId}`)).toBeVisible();
});
