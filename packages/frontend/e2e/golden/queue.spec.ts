import { expect, test, type Page } from '@playwright/test';
import { account, apiPost, choose, confirm, expectP1, isrc, openAs, pick, sc, seedKeys, settled, toastOk } from '../helpers';

// P2 «Очередь ожидания (C)» (19 §4: S12–S20, S32): each group before, the action through the UI, the group gone and
// the P1 row after; the second press of 19 §5 sent directly with the operator header. Each scenario owns its data.

const M = '2026-03';
test.describe.configure({ mode: 'serial' });

async function openReason(page: Page, reason: string) {
  await openAs(page, `/queue/${reason}`);
  await settled(page);
}
const group = (page: Page, kind: string, id: string) => page.getByTestId(`queue-group-${kind}-${id}`);
async function expectAmount(page: Page, kind: string, id: string, amount: string) {
  await expect(group(page, kind, id).locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', amount);
}
/** After an action: the stale badge clears and the group is gone. */
async function expectGone(page: Page, kind: string, id: string) {
  await settled(page);
  await expect(group(page, kind, id)).toHaveCount(0);
}
async function p1(page: Page, acct: string, month: string, abco: string, source: 'believe' | 'b17' = 'believe') {
  await page.getByTestId('nav-overview').click();
  await settled(page);
  await expectP1(page, acct, month, abco, source);
}
/** The document part of a dialog: create with a file reference, approve (confirmation); returns the new document id. */
async function newDocument(page: Page, fileRef: string, waiting?: string): Promise<string> {
  const dialog = page.getByTestId('form-dialog');
  await dialog.getByTestId('field-document-file').fill(fileRef);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/documents') && r.request().method() === 'POST');
  await dialog.getByTestId('action-document-create').click();
  const id = ((await (await created).json()) as { id: string }).id;
  await toastOk(page, 'Документ создан');
  await dialog.getByTestId('action-document-approve').click();
  // the approve dialog states the money waiting for this very document (N13, 19 §1)
  await expect(page.getByTestId('confirm-dialog')).toContainText(`ждёт этого документа: ${waiting ?? ''}`);
  await confirm(page);
  await toastOk(page, 'Документ утверждён');
  await expect(dialog.getByTestId('document-ready')).toBeVisible();
  return id;
}

test('the summary lists every reason with its action sentence and links to the groups', async ({ page }) => {
  await openAs(page, '/queue');
  await settled(page);
  const row = page.getByTestId('queue-reason-split_unconfirmed');
  await expect(row).toContainText('строка сплита без утверждённого документа');
  await expect(row).toContainText('подтвердите им сплит');
  await row.getByRole('link').click();
  await expect(page).toHaveURL(/\/queue\/split_unconfirmed$/);
});

test('S12 split_unconfirmed → create and approve a document, confirm the split', async ({ page, request }) => {
  const k = sc(12);
  const i = isrc(12, 1, 1);
  const splitId = k.splits[i]?.[0] ?? '';
  await openReason(page, 'split_unconfirmed');
  await expectAmount(page, 'split', splitId, '50');
  await expect(group(page, 'split', splitId)).toContainText('2026-03 – 2026-03');
  await group(page, 'split', splitId).getByTestId('action-confirm-split').click();
  const docId = await newDocument(page, 'dummy://e2e-appendix-121.pdf', '0,00');
  await page.getByTestId('form-dialog').getByTestId('action-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText(i);
  await confirm(page);
  await toastOk(page, `Сплит ${i} подтверждён`);
  await expectGone(page, 'split', splitId);
  await p1(page, account(12, 1), M, '100 / 55 / 0 / 45');
  // second press: the same document is a no-op, another one is refused
  expect((await apiPost(request, `/splits/${splitId}/confirm`, { documentId: docId })).status).toBe(200);
  const other = await apiPost(request, `/splits/${splitId}/confirm`, { documentId: k.documents.appendix });
  expect([other.status, other.code]).toEqual([409, 'split_document_set']);
});

test('S13 assumption on a row → replace by a document from 2026-03 (the 05 group stays)', async ({ page, request }) => {
  const k = sc(13);
  const i = isrc(13, 1, 1);
  const splitId = k.splits[i]?.[0] ?? '';
  await openReason(page, 'assumption');
  await expectAmount(page, 'split', splitId, '20');
  await group(page, 'split', splitId).getByTestId('action-replace-assumption').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('replace-what')).toContainText('[допущение]');
  await expect(dialog.getByTestId('field-replace-from')).toHaveValue('2026-03');
  await newDocument(page, 'dummy://e2e-appendix-131.pdf');
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/v1/splits/change'));
  await dialog.getByTestId('action-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('2026-03-01');
  await confirm(page);
  const body = (await sent).postDataJSON() as unknown;
  await toastOk(page, `Сплит ${i} изменён с 2026-03-01`);
  await expectGone(page, 'split', splitId);
  // the buy-out split (from 2026-05) keeps its own group of 20
  await expect(page.locator('[data-testid^="queue-group-split-"]').filter({ hasText: i })).toHaveCount(1);
  await p1(page, account(13, 1), M, '100 / 50 / 0 / 50');
  await expectP1(page, account(13, 1), '2026-05', '100 / 7 / 20 / 73');
  // the assumption document itself is never approved
  const forced = await apiPost(request, `/documents/${k.documents.Q1}/approve`, { by: 'e2e-operator' });
  expect([forced.status, forced.code]).toEqual([422, 'assumption_not_approvable']);
  // second press: an identical change is accepted (19 §8 open point 1)
  expect((await apiPost(request, '/splits/change', body)).status).toBe(201);
});

test('S08 Q11 and R1 groups are read-only with the decision', async ({ page }) => {
  await openReason(page, 'assumption');
  const q11 = group(page, 'labelRule', sc(8, 1).labelRules['NoGhost Records 08a'] ?? '');
  await expect(q11.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '19.125');
  await expect(q11.getByTestId('read-only')).toContainText('⚠ Q11');
  await expect(q11.getByTestId('action-replace-assumption')).toHaveCount(0);
  const p = group(page, 'participation', sc(8, 1).participations.P ?? '');
  await expect(p.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '4.25');
  const r1 = group(page, 'labelRule', sc(8, 4).labelRules['NoGhost Records 08d'] ?? '');
  await expect(r1.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '50');
  await expect(r1.getByTestId('read-only')).toContainText('⚠ R1');
});

test('S32 rule_unconfirmed → approve the rule document', async ({ page, request }) => {
  const k = sc(32);
  const id = k.participations.P ?? '';
  await openReason(page, 'rule_unconfirmed');
  await expectAmount(page, 'participation', id, '5');
  await group(page, 'participation', id).getByTestId('action-approve').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('ждёт этого документа: 5,00');
  await expect(page.getByTestId('confirm-dialog')).toContainText('участий 1');
  await confirm(page);
  await toastOk(page, 'Документ утверждён');
  await expectGone(page, 'participation', id);
  await p1(page, account(32, 1), M, '100 / 55 / 0 / 45');
  const again = await apiPost(request, `/documents/${k.documents['unapproved-contract']}/approve`, { by: 'e2e-operator' });
  expect(again.status).toBe(200);
});

test('S14 owner_unconfirmed → contract with a new approved document', async ({ page, request }) => {
  const k = sc(14);
  const ownerId = k.owners.A ?? '';
  await openReason(page, 'owner_unconfirmed');
  await expectAmount(page, 'owner', ownerId, '50');
  await group(page, 'owner', ownerId).getByTestId('action-create-contract').click();
  const docId = await newDocument(page, 'dummy://e2e-contract-141.pdf');
  await page.getByTestId('form-dialog').getByTestId('action-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('владелец становится подтверждённым');
  await confirm(page);
  await toastOk(page, 'Договор создан');
  await expectGone(page, 'owner', ownerId);
  await p1(page, account(14, 1), M, '100 / 50 / 0 / 50');
  const again = await apiPost(request, '/contracts', { ownerId, documentId: docId, artistIds: [k.artists.A] });
  expect(again.status).toBe(201);
});

test('owner_unconfirmed: the merge dialog asks for the target and the reason (not sent here: S33 belongs to P10)', async ({ page }) => {
  const ownerId = sc(33).owners.Y ?? '';
  await openReason(page, 'owner_unconfirmed');
  await group(page, 'owner', ownerId).getByTestId('action-merge').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('action-merge-submit')).toBeDisabled();
  await pick(page, 'merge-into', 'Owner X-331');
  await dialog.getByTestId('field-merge-reason').fill('e2e');
  await expect(dialog.getByTestId('action-merge-submit')).toBeEnabled();
  await dialog.getByTestId('form-dialog-close').click();
  await expect(dialog).toBeHidden();
});

test('S15 artist_without_owner → assign the owner', async ({ page, request }) => {
  const k = sc(15);
  const artistId = k.artists.A ?? '';
  await openReason(page, 'artist_without_owner');
  await expectAmount(page, 'artist', artistId, '50');
  await group(page, 'artist', artistId).getByTestId('action-assign-owner').click();
  await pick(page, 'assign-owner', 'Owner A-151');
  await page.getByTestId('form-dialog').getByTestId('action-assign-submit').click();
  await toastOk(page, 'A-151 привязан');
  await expectGone(page, 'artist', artistId);
  await p1(page, account(15, 1), M, '100 / 50 / 0 / 50');
  expect((await apiPost(request, `/artists/${artistId}/owner`, { ownerId: k.owners.A })).status).toBe(200);
  const other = await apiPost(request, `/artists/${artistId}/owner`, { ownerId: sc(14).owners.A });
  expect([other.status, other.code]).toEqual([422, 'artist_owner_fixed']);
});

test('S16 label_unmapped → alias of 0to8', async ({ page, request }) => {
  await openReason(page, 'label_unmapped');
  await expectAmount(page, 'labelString', 'Mystery Records', '50');
  await group(page, 'labelString', 'Mystery Records').getByTestId('action-label-alias').click();
  await choose(page, 'alias-label', '0to8');
  await page.getByTestId('form-dialog').getByTestId('action-alias-submit').click();
  await toastOk(page, 'Алиас «Mystery Records» добавлен');
  await expectGone(page, 'labelString', 'Mystery Records');
  await p1(page, account(16, 1), M, '100 / 50 / 0 / 50');
  const again = await apiPost(request, `/labels/${seedKeys().shared['label:0to8']}/aliases`, { alias: 'Mystery Records' });
  expect([again.status, again.code]).toEqual([409, 'alias_taken']);
});

test('S17 label_unmapped → sublabel of 0to8 with a rule 50 → NG-171', async ({ page, request }) => {
  await openReason(page, 'label_unmapped');
  await expectAmount(page, 'labelString', 'Mystery Records B', '50');
  await group(page, 'labelString', 'Mystery Records B').getByTestId('action-sublabel-rule').click();
  const dialog = page.getByTestId('form-dialog');
  await choose(page, 'sublabel-own', '0to8');
  await expect(dialog.getByTestId('field-sublabel-name')).toHaveValue('Mystery Records B');
  await pick(page, 'rule-recipient', 'NG-171');
  await dialog.getByTestId('field-rule-from').fill('2020-01');
  await pick(page, 'rule-document', 'Contract Company NG-171');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/labels') && r.request().method() === 'POST');
  await dialog.getByTestId('action-sublabel-submit').click();
  const labelId = ((await (await created).json()) as { id: string }).id;
  await toastOk(page, 'Сублейбл создан');
  await expectGone(page, 'labelString', 'Mystery Records B');
  await p1(page, account(17, 1), M, '100 / 75 / 0 / 25');
  const again = await apiPost(request, `/labels/${labelId}/rules`, {
    percent: '50',
    recipientArtistId: sc(17).artists.NG,
    validFrom: '2020-01-01',
  });
  expect([again.status, again.code]).toEqual([409, 'rule_overlap']);
});

test('S18 publishing_terms_unconfirmed → terms of W3 from 2020-01-01', async ({ page, request }) => {
  const k = sc(18);
  const ownerId = k.owners.W3 ?? '';
  await openReason(page, 'publishing_terms_unconfirmed');
  await expectAmount(page, 'ownerTerms', ownerId, '50');
  await group(page, 'ownerTerms', ownerId).getByTestId('action-publishing-terms').click();
  const dialog = page.getByTestId('form-dialog');
  await dialog.getByTestId('field-terms-percent').fill('50');
  await dialog.getByTestId('field-terms-from').fill('2020-01-01');
  await pick(page, 'terms-document', 'Contract Owner W3-181');
  await dialog.getByTestId('action-terms-submit').click();
  await toastOk(page, 'Условия паблишинга 50 % с 2020-01-01');
  await expectGone(page, 'ownerTerms', ownerId);
  await p1(page, 'b17', M, '400 / 220 / 0 / 180', 'b17');
  const again = await apiPost(request, '/publishing/terms', {
    ownerId,
    percent: '50',
    validFrom: '2020-01-01',
    documentId: k.documents['contract:W3'],
  });
  expect([again.status, again.code]).toEqual([409, 'terms_overlap']);
});

test('S19 writer_unmapped → map the ambiguous holder to W4a', async ({ page, request }) => {
  await openReason(page, 'writer_unmapped');
  await expectAmount(page, 'writer', 'HOLDER W4', '100');
  await group(page, 'writer', 'HOLDER W4').getByTestId('action-map-writer').click();
  await pick(page, 'writer-owner', 'Owner W4a-191');
  await page.getByTestId('form-dialog').getByTestId('action-writer-submit').click();
  await toastOk(page, 'Автор связан');
  await expectGone(page, 'writer', 'HOLDER W4');
  await p1(page, 'b17', '2025-12', '100 / 50 / 0 / 50', 'b17');
  // second press (19 §8 point 6, verified here): the same owner again is accepted
  const again = await apiPost(request, `/publishing/writers/${encodeURIComponent('holder w4')}/map`, { ownerId: sc(19).owners.W4a });
  expect(again.status).toBe(200);
});

test('S20 perimeter: unknown_pair offers the track, no_isrc is read-only (⚠ D-035)', async ({ page }) => {
  await openReason(page, 'unknown_pair');
  const pair = `${isrc(20, 1, 9)}|2720100000009`;
  await expectAmount(page, 'pair', pair, '7');
  await expect(group(page, 'pair', pair).getByTestId('action-register-track')).toBeVisible();
  await openReason(page, 'no_isrc');
  const row = group(page, 'pair', '|2720100000001');
  await expect(row.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '2');
  await expect(row.getByTestId('read-only')).toContainText('⚠ D-035');
  // the action itself runs from P21 «Сигналы» (unallocated), signals.spec.ts
});
