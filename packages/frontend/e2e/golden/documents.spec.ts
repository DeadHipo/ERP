import { expect, test } from '@playwright/test';
import { apiPost, isrc, openAs, sc, settled, toastOk } from '../helpers';

// P13 «Документы» / P14 «Документ» (17 §3, 19 §4 S32): the filters in the URL, the row actions, what a document confirms
// and the money that waits for it. This file runs before queue.spec (alphabetical), which approves the S32 document:
// the S32 assertions hold for both states.

test.describe.configure({ mode: 'serial' });

test('P13 the status and kind filters narrow the list; the owner filter is the URL', async ({ page }) => {
  const k = sc(32);
  const doc = k.documents['unapproved-contract'] ?? '';
  await openAs(page, '/documents?kind=assumption');
  await expect(page.getByTestId('documents-page')).toBeVisible();
  const rows = page.locator('[data-testid^="document-"][row-id]');
  await expect(rows.first()).toBeVisible();
  await expect(page.getByTestId('documents-count')).toContainText('Записей');
  await expect(rows.locator('[data-testid="chip-assumption"]').first()).toBeVisible();
  await expect(page.getByTestId(`document-${doc}`)).toHaveCount(0);
  // status + kind of the S32 document
  await openAs(page, '/documents?kind=contract&q=contract 321');
  await expect(page.getByTestId(`document-${doc}`)).toBeVisible();
  await openAs(page, `/documents?status=approved&kind=appendix`);
  await expect(page.getByTestId(`document-${sc(1).documents.appendix}`)).toBeVisible();
  await expect(page.getByTestId(`document-${sc(13).documents.Q1}`)).toHaveCount(0);
  await openAs(page, `/documents?ownerId=${sc(1).owners.A}`);
  await expect(page.getByTestId(`document-${sc(1).documents['contract:A']}`)).toBeVisible();
  await expect(page.getByTestId(`document-${doc}`)).toHaveCount(0);
});

test('P13 an assumption has no approve button: «допущение заменяется документом»', async ({ page }) => {
  const q1 = sc(13).documents.Q1 ?? '';
  await openAs(page, '/documents?kind=assumption');
  const row = page.getByTestId(`document-${q1}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId('action-approve')).toHaveCount(0);
  await expect(row.getByTestId('assumption-note')).toContainText('допущение заменяется документом');
});

test('P13 create a document, attach a file, approve it from the list', async ({ page }) => {
  await openAs(page, '/documents?q=Ref spec doc');
  await page.getByTestId('action-create-document').click();
  await page.getByTestId('field-document-title').fill('Ref spec doc');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/documents') && r.request().method() === 'POST');
  await page.getByTestId('action-create-document-submit').click();
  const id = ((await (await created).json()) as { id: string }).id;
  await toastOk(page, 'Документ создан');
  const row = page.getByTestId(`document-${id}`);
  await expect(row.getByTestId('chip-not_attached')).toBeVisible();
  // without a file the approve button is disabled with its reason
  await expect(row.getByTestId('action-approve')).toBeDisabled();
  await row.getByTestId('action-attach').click();
  await page.getByTestId('field-attach-file-ref').fill('dummy://ref-spec-doc.pdf');
  await page.getByTestId('action-attach-submit').click();
  await toastOk(page, 'Файл приложен');
  await expect(row.getByTestId('chip-not_approved')).toBeVisible();
  await row.getByTestId('action-approve').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('ждёт этого документа');
  await page.getByTestId('confirm-dialog-ok').click();
  await toastOk(page, 'Документ утверждён');
  await expect(row.getByTestId('chip-approved')).toBeVisible();
  await expect(row.getByTestId('action-approve')).toHaveCount(0);
});

test('P14 the S32 document: what it confirms and the money waiting for it (either side of the approval)', async ({ page, request }) => {
  const k = sc(32);
  const doc = k.documents['unapproved-contract'] ?? '';
  await openAs(page, `/documents/${doc}`);
  await settled(page);
  await expect(page.getByTestId('document-page')).toBeVisible();
  await expect(page.getByTestId(`participation-${k.participations.P}`)).toBeVisible();
  const approved = await page.getByTestId('document-header').getByTestId('chip-approved').count();
  // 19 §4 S32: before the approval 5 wait for this document, after it nothing
  await expect(page.getByTestId('waiting-amount').getByTestId('money')).toHaveAttribute('title', approved ? '0' : '5');
  if (!approved) {
    await page.getByTestId('action-approve').click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('ждёт этого документа: 5,00');
    await page.getByTestId('confirm-dialog-cancel').click();
  }
  // the approval itself belongs to queue.spec; the second press is sent only when it is already approved (200, first approval kept)
  if (approved) expect((await apiPost(request, `/documents/${doc}/approve`, { by: 'e2e-operator' })).status).toBe(200);
});

test('P14 an assumption document: the note, the wizard link, no approve', async ({ page }) => {
  const q1 = sc(13).documents.Q1 ?? '';
  await openAs(page, `/documents/${q1}`);
  await settled(page);
  await expect(page.getByTestId('assumption-note')).toContainText('допущение заменяется документом');
  await expect(page.getByTestId('action-approve')).toHaveCount(0);
  await expect(page.getByTestId('link-assumption-wizard')).toHaveAttribute('href', /\/queue\/assumption\?q=/);
});

test('P14 a document with splits lists them with links to the track', async ({ page }) => {
  const k = sc(1);
  await openAs(page, `/documents/${k.documents.appendix}`);
  await settled(page);
  const row = page.getByTestId(`split-${k.splits[isrc(1, 1, 1)]?.[0]}`);
  await expect(row).toContainText('A-011 50 %');
  await expect(row.getByRole('link', { name: isrc(1, 1, 1) })).toBeVisible();
});
