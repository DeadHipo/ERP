import { expect, test, type Page } from '@playwright/test';
import {
  account,
  apiPost,
  choose,
  confirm,
  expectMoneyCalls,
  expectOverview,
  expectOwner,
  expectP1,
  isrc,
  newDocument,
  openAs,
  openSignalList,
  overviewRow,
  pick,
  sc,
  seedKeys,
  settled,
  signalRow,
  toastOk,
  upc,
} from '../helpers';

// P2 «Очередь ожидания (C)» (19 §4: S12–S20, S32): each scenario is asserted before (P1 row, the owner's balance, the P21
// row where 19 gives one), the action through the UI, the group gone and the same places after; the second press of
// 19 §5 sent directly with the operator header. Each scenario owns its data; this file is the only one acting on
// S12–S19 and S32 and runs after 12-track, 13-splits, 14-documents and 15-publishing (19 §6: the file order), which
// assert the before states.

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
/** P6 of an ISRC: the exact amount of one pseudonym's allocation in the month of the (single) account. */
async function expectAlloc(page: Page, nn: number, k: number, pseudonym: string, amount: string) {
  await openAs(page, `/tracks/${isrc(nn, k, 1)}`);
  await settled(page);
  await page.getByTestId(`month-${account(nn, k)}-${upc(nn, k, 1)}-${M}`).getByTestId('action-expand-month').click();
  const detail = page.getByTestId(`month-detail-${account(nn, k)}-${upc(nn, k, 1)}-${M}`);
  await expect(detail.locator(`[data-pseudonym="${pseudonym}"] [data-col="amount"]`).getByTestId('money')).toHaveAttribute('title', amount);
}
/** The publishing lines of a P10 writer: `[title, amount, percent, category]`, exact strings; the owner's earned total. */
async function expectPublishing(page: Page, ownerId: string, lines: [string, string, string, string][]) {
  await openAs(page, `/owners/${ownerId}?tab=publishing`);
  await settled(page);
  const tab = page.getByTestId('publishing-tab');
  await expect(tab).toBeVisible();
  for (const [title, amount, percent, category] of lines) {
    const row = tab.locator('tr', { hasText: title });
    await expect(row.locator('td').nth(2).getByTestId('money'), `${title} amount`).toHaveAttribute('title', amount);
    await expect(row.locator('td').nth(3), `${title} percent`).toHaveText(`${percent} %`);
    await expect(row.locator('td').nth(4), `${title} category`).toHaveText(category);
  }
}
async function p1(page: Page, acct: string, month: string, abco: string, source: 'believe' | 'b17' = 'believe') {
  await page.getByTestId('nav-overview').click();
  await settled(page);
  await expectP1(page, acct, month, abco, source);
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
  await expectOverview(page, [[account(12, 1), M, '100 / 5 / 50 / 45']]);
  await expectOwner(page, k.owners.A ?? '', { earned: '0', payable: '0' });
  await openReason(page, 'split_unconfirmed');
  expectMoneyCalls(page, 1);
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
  await expectOwner(page, k.owners.A ?? '', { earned: '50', payable: '50' });
  // second press: the same document is a no-op, another one is refused
  expect((await apiPost(request, `/splits/${splitId}/confirm`, { documentId: docId })).status).toBe(200);
  const other = await apiPost(request, `/splits/${splitId}/confirm`, { documentId: k.documents.appendix });
  expect([other.status, other.code]).toEqual([409, 'split_document_set']);
});

test('S13 assumption on a row → replace by a document from 2026-03 (the 05 group stays)', async ({ page, request }) => {
  const k = sc(13);
  const i = isrc(13, 1, 1);
  const splitId = k.splits[i]?.[0] ?? '';
  const q1 = signalRow(page, 'assumptions', `${k.documents.Q1}|document`);
  await expectOverview(page, [
    [account(13, 1), M, '100 / 30 / 20 / 50'],
    [account(13, 1), '2026-05', '100 / 7 / 20 / 73'],
  ]);
  await openSignalList(page, 'assumptions');
  await expect(q1.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '40');
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
  await openSignalList(page, 'assumptions');
  await expect(q1.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '20');
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
  await expectOverview(page, [[account(32, 1), M, '100 / 50 / 5 / 45']]);
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
  await expectOverview(page, [[account(14, 1), M, '100 / 0 / 50 / 50']]);
  await expectOwner(page, ownerId, { earned: '0', waiting: '50', payable: '0' });
  await expect(page.getByTestId('entity-card').getByTestId('chip-waiting_documents')).toBeVisible();
  await expect(page.getByTestId('payout-gate').getByTestId('gate-owner_not_confirmed')).toBeVisible();
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
  await expectOwner(page, ownerId, { earned: '50', waiting: '0', payable: '50' });
  await expect(page.getByTestId('entity-card').getByTestId('chip-confirmed')).toBeVisible();
  await expect(page.getByTestId('payout-gate').getByTestId('gate-allowed')).toBeVisible();
  const gate = (await (await request.get(`/api/v1/owners/${ownerId}/balance`)).json()) as { payout: { allowed: boolean; amountCents: number } };
  expect([gate.payout.allowed, gate.payout.amountCents]).toEqual([true, 5000]);
  const again = await apiPost(request, '/contracts', { ownerId, documentId: docId, artistIds: [k.artists.A] });
  expect(again.status).toBe(201);
});

test('S15 artist_without_owner → assign the owner', async ({ page, request }) => {
  const k = sc(15);
  const artistId = k.artists.A ?? '';
  await expectOverview(page, [[account(15, 1), M, '100 / 0 / 50 / 50']]);
  await openReason(page, 'artist_without_owner');
  await expectAmount(page, 'artist', artistId, '50');
  await group(page, 'artist', artistId).getByTestId('action-assign-owner').click();
  await pick(page, 'assign-owner', 'Owner A-151');
  await page.getByTestId('form-dialog').getByTestId('action-assign-submit').click();
  await toastOk(page, 'A-151 привязан');
  await expectGone(page, 'artist', artistId);
  await p1(page, account(15, 1), M, '100 / 50 / 0 / 50');
  await expectOwner(page, k.owners.A ?? '', { earned: '50', payable: '50' });
  expect((await apiPost(request, `/artists/${artistId}/owner`, { ownerId: k.owners.A })).status).toBe(200);
  const other = await apiPost(request, `/artists/${artistId}/owner`, { ownerId: sc(14).owners.A });
  expect([other.status, other.code]).toEqual([422, 'artist_owner_fixed']);
});

test('S16 label_unmapped → alias of 0to8', async ({ page, request }) => {
  await expectOverview(page, [[account(16, 1), M, '100 / 50 / 50 / 0']]);
  await expect(overviewRow(page, 'believe', account(16, 1), M).getByTestId('c-reason-label_unmapped').getByTestId('money')).toHaveAttribute('title', '50');
  await openSignalList(page, 'labelUnmapped');
  await expect(signalRow(page, 'labelUnmapped', 'Mystery Records').locator('[data-col="net"]').getByTestId('money')).toHaveAttribute('title', '100');
  await openReason(page, 'label_unmapped');
  await expectAmount(page, 'labelString', 'Mystery Records', '50');
  await group(page, 'labelString', 'Mystery Records').getByTestId('action-label-alias').click();
  await choose(page, 'alias-label', '0to8');
  await page.getByTestId('form-dialog').getByTestId('action-alias-submit').click();
  await toastOk(page, 'Алиас «Mystery Records» добавлен');
  await expectGone(page, 'labelString', 'Mystery Records');
  await p1(page, account(16, 1), M, '100 / 50 / 0 / 50');
  await expect(overviewRow(page, 'believe', account(16, 1), M).getByTestId('by-label-0to8').getByTestId('money')).toHaveAttribute('title', '50');
  await openSignalList(page, 'labelUnmapped');
  await expect(signalRow(page, 'labelUnmapped', 'Mystery Records')).toHaveCount(0);
  const again = await apiPost(request, `/labels/${seedKeys().shared['label:0to8']}/aliases`, { alias: 'Mystery Records' });
  expect([again.status, again.code]).toEqual([409, 'alias_taken']);
});

test('S17 label_unmapped → sublabel of 0to8 with a rule 50 → NG-171', async ({ page, request }) => {
  await expectOverview(page, [[account(17, 1), M, '100 / 50 / 50 / 0']]);
  await openSignalList(page, 'labelUnmapped');
  await expect(signalRow(page, 'labelUnmapped', 'Mystery Records B').locator('[data-col="net"]').getByTestId('money')).toHaveAttribute('title', '100');
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
  await openSignalList(page, 'labelUnmapped');
  await expect(signalRow(page, 'labelUnmapped', 'Mystery Records B')).toHaveCount(0);
  // P17 shows the new rule, P6 the carve of NG-171
  await openAs(page, `/labels/${labelId}`);
  const rule = page.locator('[data-testid^="label-rule-"]');
  await expect(rule).toHaveCount(1);
  await expect(rule).toContainText('NG-171');
  await expect(rule.locator('[data-col="percent"]')).toHaveText('50');
  await expectAlloc(page, 17, 1, 'NG-171', '25');
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
  const [w1, w2] = [k.owners.W1 ?? '', k.owners.W2 ?? ''];
  await expectOverview(page, [['b17', M, '400 / 170 / 50 / 180']], 'b17');
  // G26a-c: the publishing lines per writer (amount / percent / category) and the earned total
  await expectPublishing(page, w1, [['T-A-181', '25', '50', 'B'], ['T-B-181', '25', '50', 'B'], ['T-C-181', '50', '50', 'B']]);
  await expectOwner(page, w1, { earned: '100' });
  await expectPublishing(page, w2, [['T-A-181', '45', '90', 'B'], ['T-B-181', '25', '50', 'B']]);
  await expectOwner(page, w2, { earned: '70' });
  await expectPublishing(page, ownerId, [['T-D-181', '50', '50', 'C']]);
  await expectOwner(page, ownerId, { earned: '0', waiting: '50' });
  // earnedPublishing is not on the card: the API carries it (17 N1 balance), the screen shows the same earned
  const earnedPublishing = async (id: string) =>
    ((await (await request.get(`/api/v1/owners/${id}/balance`)).json()) as { period: { earnedPublishing: string } }).period.earnedPublishing;
  expect([await earnedPublishing(w1), await earnedPublishing(w2)]).toEqual(['100', '70']);
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
  await expectPublishing(page, ownerId, [['T-D-181', '50', '50', 'B']]);
  await expectOwner(page, ownerId, { earned: '50', waiting: '0', payable: '50' });
  await expectOwner(page, w1, { earned: '100' });
  await expectOwner(page, w2, { earned: '70' });
  const again = await apiPost(request, '/publishing/terms', {
    ownerId,
    percent: '50',
    validFrom: '2020-01-01',
    documentId: k.documents['contract:W3'],
  });
  expect([again.status, again.code]).toEqual([409, 'terms_overlap']);
});

test('S19 writer_unmapped → map the ambiguous holder to W4a', async ({ page, request }) => {
  const w4a = sc(19).owners.W4a ?? '';
  await expectOverview(page, [['b17', '2025-12', '100 / 0 / 100 / 0']], 'b17');
  await openSignalList(page, 'ambiguousWriters');
  await expect(signalRow(page, 'ambiguousWriters', 'holder w4')).toContainText('HOLDER W4');
  await expectOwner(page, w4a, { earned: '0' });
  await openReason(page, 'writer_unmapped');
  await expectAmount(page, 'writer', 'HOLDER W4', '100');
  await group(page, 'writer', 'HOLDER W4').getByTestId('action-map-writer').click();
  await pick(page, 'writer-owner', 'Owner W4a-191');
  await page.getByTestId('form-dialog').getByTestId('action-writer-submit').click();
  await toastOk(page, 'Автор связан');
  await expectGone(page, 'writer', 'HOLDER W4');
  await p1(page, 'b17', '2025-12', '100 / 50 / 0 / 50', 'b17');
  await openSignalList(page, 'ambiguousWriters');
  await expect(signalRow(page, 'ambiguousWriters', 'holder w4')).toHaveCount(0);
  await expectOwner(page, w4a, { earned: '50' });
  // second press (19 §8 point 6, verified here): the same owner again is accepted
  const again = await apiPost(request, `/publishing/writers/${encodeURIComponent('holder w4')}/map`, { ownerId: sc(19).owners.W4a });
  expect(again.status).toBe(200);
});

test('S20 perimeter: unknown_pair offers the track, no_isrc is read-only (⚠ D-035)', async ({ page }) => {
  await expectOverview(page, [[account(20, 1), M, '9 / 0 / 9 / 0']]);
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
