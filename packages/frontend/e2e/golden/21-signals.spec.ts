import { expect, test, type Page } from '@playwright/test';
import { account, apiPost, confirm, expectMoneyCalls, expectOverview, expectP1, isrc, openAs, pick, sc, settled, toastOk, upc } from '../helpers';

// P21 «Сигналы» (19 §4: S20, S21, S35 and the P21 rows of other scenarios): the lists with their counts, the rows by
// key, and the actions: register the track of a pair with ISRC, close and re-create an unfunded participation, set and
// clear a track note, assign the owner of a participant. Runs after 20-queue (S20 is asserted before there) and before
// 22-duplicates (the S30 candidate is still listed in isrcsWithoutSplit, 19 §6).

const M = '2026-03';
test.describe.configure({ mode: 'serial' });

const row = (page: Page, name: string, key: string) => page.getByTestId(`signal-row-${name}-${key}`);
async function openList(page: Page, name: string) {
  await openAs(page, `/signals/${name}`);
  await settled(page);
  expectMoneyCalls(page, 1);
}
const money = (page: Page, name: string, key: string, col: string) =>
  row(page, name, key).locator(`[data-col="${col}"]`).getByTestId('money');
async function p1(page: Page, acct: string, abco: string) {
  await page.getByTestId('nav-overview').click();
  await settled(page);
  await expectP1(page, acct, M, abco);
}

test('the index lists the 14 lists with their counts and links', async ({ page }) => {
  await openAs(page, '/signals');
  await settled(page);
  await expect(page.getByTestId('signals-index').locator('li')).toHaveCount(14);
  // D-169: every seed file is loaded under a label, so «Файлы Believe без лейбла» is empty
  await expect(page.getByTestId('signal-list-filesWithoutLabel').getByTestId('signal-count')).toHaveText('0');
  await page.getByTestId('signal-list-unfunded').getByRole('link').click();
  await expect(page).toHaveURL(/\/signals\/unfunded$/);
  await settled(page);
  await expect(page.getByTestId('signal-total')).toContainText('Записей');
});

test('rows of other scenarios: unfunded S03/8, isrcsWithoutSplit S08/4 and S30, assumptions S08', async ({ page }) => {
  await openList(page, 'unfunded');
  const g37 = `${isrc(3, 8, 1)}|${M}|`;
  await expect(page.locator(`[data-testid^="signal-row-unfunded-${g37}"]`).locator('[data-col="missing"]').getByTestId('money')).toHaveAttribute('title', '20');
  await openList(page, 'isrcsWithoutSplit');
  await expect(money(page, 'isrcsWithoutSplit', isrc(8, 4, 1), 'net')).toHaveAttribute('title', '100');
  await expect(money(page, 'isrcsWithoutSplit', isrc(30, 1, 1), 'net')).toHaveAttribute('title', '100');
  await openList(page, 'assumptions');
  const s081 = sc(8, 1);
  // q11 rows keyed by document: the participation's appendix (4.25) and the NG-081 rule's contract (19.125)
  await expect(money(page, 'assumptions', `${s081.documents.appendix}|q11`, 'amount')).toHaveAttribute('title', '4.25');
  await expect(money(page, 'assumptions', `${s081.documents['rule-contract:NoGhost Records 08a']}|q11`, 'amount')).toHaveAttribute('title', '19.125');
  await expect(row(page, 'assumptions', `${s081.documents['rule-contract:NoGhost Records 08a']}|q11`).getByTestId('read-only')).toContainText('⚠ Q11');
  // S08/4: the label rule without a split, basis r1, 50 (the only r1 row of the seed)
  const r1 = page.locator('[data-testid^="signal-row-assumptions-"][data-testid$="|r1"]');
  await expect(r1).toHaveCount(1);
  await expect(r1.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '50');
  await expect(r1.getByTestId('read-only')).toContainText('⚠ R1');
});

test('S20 unallocated: the pair with ISRC → register the track; the pair without ISRC stays read-only', async ({ page, request }) => {
  const i = isrc(20, 1, 9);
  const key = `${i}|2720100000009`;
  await openList(page, 'unallocated');
  await expect(money(page, 'unallocated', key, 'net')).toHaveAttribute('title', '7');
  await expect(row(page, 'unallocated', '|2720100000001').getByTestId('read-only')).toContainText('⚠ D-035');
  await row(page, 'unallocated', key).getByTestId('action-register-track').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('field-track-isrc')).toHaveValue(i);
  await expect(dialog.getByTestId('field-track-upc')).toHaveValue('2720100000009');
  await dialog.getByTestId('action-track-submit').click();
  await toastOk(page, `Трек зарегистрирован: ${i}`);
  await settled(page);
  await expect(row(page, 'unallocated', key)).toHaveCount(0);
  await openList(page, 'isrcsWithoutSplit');
  await expect(money(page, 'isrcsWithoutSplit', i, 'net')).toHaveAttribute('title', '7');
  await p1(page, account(20, 1), '9 / 0 / 2 / 7');
  await expect(page.getByTestId(`overview-row-believe-${account(20, 1)}-${M}`).locator('[data-col="noSplit"]').getByTestId('money')).toHaveAttribute('title', '7');
  // the queue group is gone too
  await openAs(page, '/queue/unknown_pair');
  await settled(page);
  await expect(page.getByTestId(`queue-group-pair-${key}`)).toHaveCount(0);
  // second press: the same ISRC + UPC is refused (19 §8 point 6: the code verified here)
  const again = await apiPost(request, '/tracks', { title: i, isrc: i, upc: '2720100000009' });
  expect([again.status, again.code]).toEqual([409, 'duplicate_track']);
});

test('S21 unfunded → close the participation at 2026-03 and re-create it at 10 %', async ({ page, request }) => {
  const k = sc(21);
  const p = k.participations.P ?? '';
  const key = `${isrc(21, 1, 1)}|${M}|${p}|${M}`;
  await openList(page, 'unfunded');
  await expect(money(page, 'unfunded', key, 'missing')).toHaveAttribute('title', '10');
  await expect(row(page, 'unfunded', key)).toContainText('корзины не хватает');
  await row(page, 'unfunded', key).getByTestId('action-recreate-participation').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('field-participation-percent')).toHaveValue('20');
  await dialog.getByTestId('field-participation-percent').fill('10');
  await expect(dialog.getByTestId('field-participation-from')).toHaveValue(M);
  await dialog.getByTestId('action-participation-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('2026-03-01');
  await confirm(page);
  await toastOk(page, 'Участие закрыто с 2026-03-01');
  await settled(page);
  await expect(page.locator(`[data-testid^="signal-row-unfunded-${isrc(21, 1, 1)}|"]`)).toHaveCount(0);
  await p1(page, account(21, 1), '100 / 10 / 0 / 90');
  // second press: closing at the same date changes nothing; the same participation again overlaps
  expect((await apiPost(request, `/participations/${p}/close`, { validTo: '2026-03-01' })).status).toBe(200);
  const again = await apiPost(request, '/participations', {
    isrc: isrc(21, 1, 1),
    artistId: k.artists.P,
    percent: '10',
    base: 'net',
    fundedFrom: 'artist_pool',
    validFrom: '2026-03-01',
    documentId: k.documents.appendix,
  });
  expect([again.status, again.code]).toEqual([409, 'participation_overlap']);
});

test('S35/1 sublabel without a rule and a rule recipient that is a row; S35/2 two rows of one owner', async ({ page }) => {
  await openList(page, 'sublabelWithoutRule');
  await expect(money(page, 'sublabelWithoutRule', `Ghost Label 35|${M}`, 'net')).toHaveAttribute('title', '140');
  await expect(row(page, 'sublabelWithoutRule', `Ghost Label 35|${M}`).getByTestId('action-set-rule')).toBeVisible();
  await openList(page, 'ruleRecipientIsRow');
  const r = row(page, 'ruleRecipientIsRow', `${isrc(35, 1, 1)}|2026-06`);
  await expect(r).toContainText('R-351');
  await expect(r.getByRole('link', { name: 'Правила трека' })).toHaveAttribute('href', `/tracks/${isrc(35, 1, 1)}?tab=rules`);
  await expect(r.getByTestId('action-close-rule')).toBeVisible();
  await openList(page, 'twoRowsOneOwner');
  const two = row(page, 'twoRowsOneOwner', `${isrc(35, 2, 1)}|${M}`);
  await expect(two).toContainText('A-352, A2-352');
  await expect(two).toContainText('только информация');
});

test('S35/3 a track note: set it (the row appears), clear it (the row goes); money unchanged', async ({ page }) => {
  const i = isrc(35, 3, 1);
  await openList(page, 'tracksWithNote');
  await expect(row(page, 'tracksWithNote', i)).toHaveCount(0);
  await page.getByTestId('action-add-note').click();
  await pick(page, 'note-track', `${i} · ${i}`, i);
  await page.getByTestId('form-dialog').getByTestId('field-note-text').fill('производная вне разрешения');
  await page.getByTestId('form-dialog').getByTestId('action-note-submit').click();
  await toastOk(page, 'Заметка сохранена');
  await settled(page);
  await expect(row(page, 'tracksWithNote', i)).toContainText('производная вне разрешения');
  await row(page, 'tracksWithNote', i).getByTestId('action-clear-note').click();
  await page.getByTestId('form-dialog').getByTestId('action-note-submit').click();
  await toastOk(page, 'Заметка убрана');
  await settled(page);
  await expect(row(page, 'tracksWithNote', i)).toHaveCount(0);
  await p1(page, account(35, 3), '100 / 50 / 0 / 50');
});

test('S35/4 a participant without an owner → assign Owner P-354', async ({ page }) => {
  const k = sc(35, 4);
  const key = k.participations.P ?? '';
  await expectOverview(page, [[account(35, 4), M, '100 / 50 / 5 / 45']]);
  await openList(page, 'participantsWithoutOwner');
  await expect(money(page, 'participantsWithoutOwner', key, 'amount')).toHaveAttribute('title', '5');
  await expect(row(page, 'participantsWithoutOwner', key)).toContainText('P-354');
  await row(page, 'participantsWithoutOwner', key).getByTestId('action-assign-owner').click();
  await pick(page, 'assign-owner', 'Owner P-354');
  await page.getByTestId('form-dialog').getByTestId('action-assign-submit').click();
  await toastOk(page, 'P-354 привязан');
  await settled(page);
  await expect(row(page, 'participantsWithoutOwner', key)).toHaveCount(0);
  await p1(page, account(35, 4), '100 / 55 / 0 / 45');
  // P6: the participant P-354 is paid (B) now
  await openAs(page, `/tracks/${isrc(35, 4, 1)}`);
  await settled(page);
  await page.getByTestId(`month-${account(35, 4)}-${upc(35, 4, 1)}-${M}`).getByTestId('action-expand-month').click();
  await expect(
    page.getByTestId(`month-detail-${account(35, 4)}-${upc(35, 4, 1)}-${M}`).locator('[data-pseudonym="P-354"] [data-col="amount"]').getByTestId('money'),
  ).toHaveAttribute('title', '5');
});
