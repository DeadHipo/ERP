import { expect, test } from '@playwright/test';
import { apiPost, choose, expectMoneyCalls, isrc, labelOf, openAs, sc, settled, toastOk } from '../helpers';

// P13 «Документы» / P14 «Документ» (17 §3, 19 §4 S32): the filters in the URL, the row actions, what a document confirms
// and the money that waits for it. This file runs before 20-queue (19 §6: the file order), which approves the S32
// document: the S32 test asserts the state before the approval.

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

test('P14 the S32 document before its approval: what it confirms and the 5 waiting for it', async ({ page }) => {
  const k = sc(32);
  const doc = k.documents['unapproved-contract'] ?? '';
  await openAs(page, `/documents/${doc}`);
  await settled(page);
  expectMoneyCalls(page, 1);
  await expect(page.getByTestId('document-page')).toBeVisible();
  await expect(page.getByTestId(`participation-${k.participations.P}`)).toBeVisible();
  await expect(page.getByTestId('document-header').getByTestId('chip-approved')).toHaveCount(0);
  await expect(page.getByTestId('waiting-amount').getByTestId('money')).toHaveAttribute('title', '5');
  await page.getByTestId('action-approve').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('ждёт этого документа: 5,00');
  await page.getByTestId('confirm-dialog-cancel').click();
  // the approval itself belongs to 20-queue (S32)
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

// D-169 (S43 screen part): a document carries an own label or none («любой»); the list under a label shows the
// documents of that label and those without one; P14 changes the label (PATCH /documents/:id).
let labelled = '';

test('P13 create a document under 0to8: the label field defaults to the switch, the column shows 0to8', async ({ page }) => {
  await openAs(page, `/documents?q=Label spec doc&label=${labelOf('0to8')}`);
  await page.getByTestId('action-create-document').click();
  await page.getByTestId('field-document-title').fill('Label spec doc A');
  await expect(page.getByTestId('field-document-label')).toContainText('0to8');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/documents') && r.request().method() === 'POST');
  await page.getByTestId('action-create-document-submit').click();
  const body = (await (await created).json()) as { id: string; labelId: string | null };
  expect(body.labelId).toBe(labelOf('0to8'));
  labelled = body.id;
  await toastOk(page, 'Документ создан');
  const cell = page.getByTestId(`document-${labelled}`).getByTestId('document-label');
  await expect(cell).toHaveText('0to8');
  await expect(cell).toHaveAttribute('data-label-id', labelOf('0to8'));
});

test('P14 set the label to «любой», then to Echo8: the card shows each change', async ({ page }) => {
  await openAs(page, `/documents/${labelled}`);
  await settled(page);
  const label = page.getByTestId('document-header').getByTestId('document-label');
  await expect(label).toHaveText('0to8');
  await page.getByTestId('action-set-document-label').click();
  await choose(page, 'document-label', 'любой лейбл');
  await page.getByTestId('action-set-document-label-submit').click();
  await toastOk(page, 'Лейбл документа Label spec doc A: любой');
  await expect(label).toHaveText('любой');
  await expect(label).toHaveAttribute('data-label-id', '');
  await page.getByTestId('action-set-document-label').click();
  await choose(page, 'document-label', 'Echo8');
  await page.getByTestId('action-set-document-label-submit').click();
  await toastOk(page, 'Лейбл документа Label spec doc A: Echo8');
  await expect(label).toHaveText('Echo8');
});

test('P13 under a label: the documents of that label and those without one', async ({ page, request }) => {
  const b = await apiPost(request, '/documents', { kind: 'other', title: 'Label spec doc B', requiresApproval: true, labelId: labelOf('0to8') });
  const c = await apiPost(request, '/documents', { kind: 'other', title: 'Label spec doc C', requiresApproval: true });
  expect([b.status, c.status]).toEqual([201, 201]);
  const idB = (b.body as { id: string }).id;
  const idC = (c.body as { id: string }).id;
  const row = (id: string) => page.getByTestId(`document-${id}`);
  await openAs(page, `/documents?q=Label spec doc&label=${labelOf('0to8')}`);
  await expect(row(idB)).toBeVisible();
  await expect(row(idC).getByTestId('document-label')).toHaveText('любой');
  await expect(row(labelled)).toHaveCount(0);
  // the switch of the header moves the list
  await choose(page, 'label', 'Echo8');
  await expect(row(labelled).getByTestId('document-label')).toHaveText('Echo8');
  await expect(row(idC)).toBeVisible();
  await expect(row(idB)).toHaveCount(0);
  await choose(page, 'label', 'Все');
  await expect(row(idB)).toBeVisible();
  await expect(row(idC)).toBeVisible();
  await expect(row(labelled)).toBeVisible();
});
