import { expect, test, type Locator, type Page } from '@playwright/test';
import { account, apiPost, choose, confirm, expectP1, isrc, openAs, pick, sc, settled, toastOk, upc } from '../helpers';

// P6 «Трек», tab Правила (19 §4: S13, S21, S25–S29; 17 §6): change a split from a date, buy-out, create / close a
// participation, the month-start rule (M52: the toast and the rules tab show the stored date), the backend refusals
// as toasts with their codes, the track note; the numbers after each action on P6 and on the P1 row; the second press
// of 19 §5 sent with `request`. Each scenario owns its data; this file is the only one acting on S25–S29.

test.describe.configure({ mode: 'serial' });

const money = (row: Locator, col: string) => row.locator(`[data-col="${col}"]`).getByTestId('money').first();
const monthRow = (page: Page, nn: number, k: number, month: string) =>
  page.getByTestId(`month-${account(nn, k)}-${upc(nn, k, 1)}-${month}`);

async function openTrack(page: Page, nn: number, k: number, tab = 'money') {
  await openAs(page, `/tracks/${isrc(nn, k, 1)}?tab=${tab}`);
  await settled(page);
  await expect(page.getByTestId('entity-card')).toBeVisible();
}
async function toTab(page: Page, tab: string) {
  await page.getByTestId(`tab-${tab}`).click();
  await settled(page);
}
/** A month of P6: allocations as `pseudonym amount` (sorted) and ours. */
async function expectMonth(page: Page, nn: number, k: number, month: string, allocs: string[], ours: string) {
  const row = monthRow(page, nn, k, month);
  await expect(money(row, 'ours')).toHaveAttribute('title', ours);
  const detail = page.getByTestId(`month-detail-${account(nn, k)}-${upc(nn, k, 1)}-${month}`);
  if (!(await detail.isVisible())) await row.getByTestId('action-expand-month').click();
  const seen = await detail.getByTestId('allocations').locator('tbody tr').evaluateAll((trs) =>
    trs.map((tr) => `${tr.getAttribute('data-pseudonym')} ${tr.querySelector('[data-col="amount"] [data-testid="money"]')?.getAttribute('title')}`),
  );
  expect(seen.sort()).toEqual([...allocs].sort());
}
async function p1(page: Page, nn: number, k: number, rows: [string, string][]) {
  await page.getByTestId('nav-overview').click();
  await settled(page);
  for (const [month, abco] of rows) await expectP1(page, account(nn, k), month, abco);
}
/** DocumentStep: pick an approved document by its title. */
async function existingDocument(page: Page, title: string) {
  const dialog = page.getByTestId('form-dialog');
  await choose(page, 'document-mode', 'выбрать утверждённый');
  await pick(page, 'document-existing', title);
  await expect(dialog.getByTestId('document-ready')).toContainText(title);
}
const toastCode = (page: Page, code: string) => expect(page.locator(`[data-testid="toast"][data-code="${code}"]`).first()).toBeVisible();

test('S25 buy-out (G09): change from 2026-03-15 → A 25, then buy-out from 2026-05-10; dates floored to the month start', async ({ page, request }) => {
  const k = sc(25);
  const i = isrc(25, 1, 1);
  await openTrack(page, 25, 1);
  for (const m of ['2026-02', '2026-03', '2026-05']) await expectMonth(page, 25, 1, m, ['A-251 50'], '50');

  await toTab(page, 'rules');
  await page.getByTestId('action-change-split').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog).toContainText('первого числа месяца');
  await dialog.getByTestId('field-split-from').fill('2026-03-15');
  await expect(dialog.getByTestId('split-row-0')).toContainText('A-251');
  await dialog.getByTestId('field-split-percent-0').fill('25');
  await existingDocument(page, 'Appendix 251');
  await dialog.getByTestId('action-split-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('2020-01-01 → бессрочно: A-251 50 %');
  await expect(page.getByTestId('confirm-dialog')).toContainText('A-251 25 %');
  await confirm(page);
  await toastOk(page, 'Сплит изменён: новые строки с 2026-03-01 (начало округлено до 2026-03-01)');
  await settled(page);
  await expect(page.getByTestId('splits')).toContainText('2026-03-01 → бессрочно');
  await toTab(page, 'money');
  await expectMonth(page, 25, 1, '2026-02', ['A-251 50'], '50');
  await expectMonth(page, 25, 1, '2026-03', ['A-251 25'], '75');
  await expectMonth(page, 25, 1, '2026-05', ['A-251 25'], '75');
  // second press: an identical change is accepted (19 §8 open point 1), money unchanged
  const again = await apiPost(request, '/splits/change', {
    isrc: i,
    from: '2026-03-01',
    shares: [{ artistId: k.artists.A, percent: '25' }],
    documentId: k.documents.appendix,
  });
  expect(again.status).toBe(201);

  await toTab(page, 'rules');
  await page.getByTestId('action-buyout').click();
  await choose(page, 'buyout-seller', 'A-251');
  await dialog.getByTestId('field-buyout-from').fill('2026-05-10');
  await existingDocument(page, 'buyout 251');
  await dialog.getByTestId('action-buyout-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Продавец: A-251');
  await confirm(page);
  await toastOk(page, /Выкуп сохранён: затронуто сплитов \d+, с 2026-05-01 \(начало округлено до 2026-05-01\)/);
  await settled(page);
  await toTab(page, 'money');
  await expectMonth(page, 25, 1, '2026-02', ['A-251 50'], '50');
  await expectMonth(page, 25, 1, '2026-03', ['A-251 25'], '75');
  // the buy-out keeps the seller's row at 0 % and a 0 % row is not allocated
  await expectMonth(page, 25, 1, '2026-05', [], '100');
  await p1(page, 25, 1, [
    ['2026-02', '100 / 50 / 0 / 50'],
    ['2026-03', '100 / 25 / 0 / 75'],
    ['2026-05', '100 / 0 / 0 / 100'],
  ]);
  // second press: the seller is already 0 in every affected split, nothing changes
  const second = await apiPost(request, '/splits/buyout', {
    isrcs: [i],
    sellerArtistId: k.artists.A,
    effectiveFrom: '2026-05-01',
    documentId: k.documents.buyout,
  });
  expect([200, 201]).toContain(second.status);
  expect(second.body).toEqual([]);
});

test('S26 assignment (G13): from 2026-06-01 the row of A goes to A2; G17 read-only', async ({ page }) => {
  await openTrack(page, 26, 1);
  await expectMonth(page, 26, 1, '2026-05', ['A-261 50'], '50');
  await expectMonth(page, 26, 1, '2026-06', ['A-261 50'], '50');
  await toTab(page, 'rules');
  await page.getByTestId('action-change-split').click();
  const dialog = page.getByTestId('form-dialog');
  await dialog.getByTestId('field-split-from').fill('2026-06-01');
  await dialog.getByTestId('action-split-remove-row-0').click();
  await dialog.getByTestId('action-split-add-row').click();
  await pick(page, 'split-artist-0', 'A2-261');
  await dialog.getByTestId('field-split-percent-0').fill('50');
  await existingDocument(page, 'assignment 261');
  await dialog.getByTestId('action-split-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('A2-261 50 %');
  await confirm(page);
  await toastOk(page, 'Сплит изменён: новые строки с 2026-06-01');
  await settled(page);
  await toTab(page, 'money');
  await expectMonth(page, 26, 1, '2026-05', ['A-261 50'], '50');
  await expectMonth(page, 26, 1, '2026-06', ['A2-261 50'], '50');
  await p1(page, 26, 1, [
    ['2026-05', '100 / 50 / 0 / 50'],
    ['2026-06', '100 / 50 / 0 / 50'],
  ]);
  await openTrack(page, 26, 2);
  await expectMonth(page, 26, 2, '2026-05', ['A-262 50'], '50');
  await expectMonth(page, 26, 2, '2026-06', ['DU-262 100'], '0');
});

test('S27 close a participation (G14) at 2026-04-20: stored 2026-04-01; 03 keeps P 7.5, 04 has none', async ({ page, request }) => {
  const p = sc(27).participations.P ?? '';
  await openTrack(page, 27, 1);
  await expectMonth(page, 27, 1, '2026-03', ['A-271 50', 'P-271 7.5'], '42.5');
  await expectMonth(page, 27, 1, '2026-04', ['A-271 50', 'P-271 7.5'], '42.5');
  await toTab(page, 'rules');
  await page.getByTestId(`participation-${p}`).getByTestId('action-close-participation').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog).toContainText('первого числа месяца');
  await dialog.getByTestId('field-participation-close-at').fill('2026-04-20');
  await dialog.getByTestId('action-close-participation-submit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('P-271 15 %');
  await confirm(page);
  await toastOk(page, 'Участие закрыто с 2026-04-01 (начало округлено до 2026-04-01)');
  await settled(page);
  await expect(page.getByTestId(`participation-${p}`).locator('[data-col="period"]')).toHaveText('2026-01-01 → 2026-04-01');
  await toTab(page, 'money');
  await expectMonth(page, 27, 1, '2026-03', ['A-271 50', 'P-271 7.5'], '42.5');
  await expectMonth(page, 27, 1, '2026-04', ['A-271 50'], '50');
  await p1(page, 27, 1, [
    ['2026-03', '100 / 57.5 / 0 / 42.5'],
    ['2026-04', '100 / 50 / 0 / 50'],
  ]);
  // second press: closing at the same date changes nothing
  expect((await apiPost(request, `/participations/${p}/close`, { validTo: '2026-04-01' })).status).toBe(200);
});

test('S28 M52 (G25): a participation from 2026-03-15 is stored from 2026-03-01 (toast and rules tab)', async ({ page, request }) => {
  const k = sc(28);
  await openTrack(page, 28, 1);
  await expectMonth(page, 28, 1, '2026-03', ['A-281 50'], '50');
  await toTab(page, 'rules');
  await page.getByTestId('action-create-participation').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog).toContainText('первого числа месяца');
  await pick(page, 'participation-artist', 'P-281');
  await dialog.getByTestId('field-participation-percent').fill('15');
  await dialog.getByTestId('field-participation-from').fill('2026-03-15');
  await existingDocument(page, 'Appendix 281');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/participations') && r.request().method() === 'POST');
  await dialog.getByTestId('action-participation-submit').click();
  const id = ((await (await created).json()) as { id: string }).id;
  await toastOk(page, 'Участие создано с 2026-03-01 (начало округлено до 2026-03-01)');
  await settled(page);
  await expect(page.getByTestId(`participation-${id}`).locator('[data-col="period"]')).toHaveText('2026-03-01 → бессрочно');
  await toTab(page, 'money');
  await expectMonth(page, 28, 1, '2026-03', ['A-281 50', 'P-281 7.5'], '42.5');
  await p1(page, 28, 1, [['2026-03', '100 / 57.5 / 0 / 42.5']]);
  // second press: the same participation overlaps
  const again = await apiPost(request, '/participations', {
    isrc: isrc(28, 1, 1),
    artistId: k.artists.P,
    percent: '15',
    base: 'bucket',
    fundedFrom: 'label_share',
    validFrom: '2026-03-15',
    documentId: k.documents.appendix,
  });
  expect([again.status, again.code]).toEqual([409, 'participation_overlap']);
});

test('S28 the track note in the P6 header: set it, clear it; money unchanged', async ({ page }) => {
  await openTrack(page, 28, 1);
  await page.getByTestId('action-edit-note').click();
  await page.getByTestId('field-track-note').fill('производная вне разрешения');
  await page.getByTestId('action-note-save').click();
  await toastOk(page, 'Заметка сохранена');
  await settled(page);
  await expect(page.getByTestId('track-note')).toHaveText('производная вне разрешения');
  await page.getByTestId('action-edit-note').click();
  await page.getByTestId('field-track-note').fill('');
  await page.getByTestId('action-note-save').click();
  await toastOk(page, 'Заметка убрана');
  await settled(page);
  await expect(page.getByTestId('track-note')).toHaveText('без заметки');
  await expect(money(page.getByTestId('track-totals'), 'ours')).toHaveAttribute('title', '42.5');
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('track-history')).toContainText('e2e-operator');
});

test('S29 refusals (G23): double_participation (participation and split change), top_above_100; no report lines', async ({ page, request }) => {
  const k = sc(29);
  await openTrack(page, 29, 1);
  await expect(page.getByTestId('page-state-empty')).toContainText('Нет строк отчётов');
  await toTab(page, 'rules');
  const dialog = page.getByTestId('form-dialog');

  // a participation of a pseudonym that is a split row
  await page.getByTestId('action-create-participation').click();
  await pick(page, 'participation-artist', 'A-291');
  await dialog.getByTestId('field-participation-percent').fill('10');
  await choose(page, 'participation-base', 'от получено (net)');
  await choose(page, 'participation-funded', 'сверху');
  await dialog.getByTestId('field-participation-from').fill('2020-01-01');
  await dialog.getByTestId('action-participation-submit').click();
  await toastCode(page, 'double_participation');
  await dialog.getByTestId('form-dialog-close').click();

  // a split change that makes a participant a row
  await page.getByTestId('action-change-split').click();
  await dialog.getByTestId('field-split-from').fill('2026-06-01');
  await dialog.getByTestId('action-split-add-row').click();
  await pick(page, 'split-artist-1', 'P-291');
  await dialog.getByTestId('field-split-percent-1').fill('10');
  await existingDocument(page, 'Appendix 291');
  await dialog.getByTestId('action-split-submit').click();
  await page.getByTestId('confirm-dialog').getByTestId('confirm-dialog-ok').click();
  await toastCode(page, 'double_participation');
  await dialog.getByTestId('form-dialog-close').click();

  // a second top participation of 60 % goes above 100 %
  const body = {
    isrc: isrc(29, 1, 1),
    artistId: k.artists.R2,
    percent: '60',
    base: 'net',
    fundedFrom: 'top',
    validFrom: '2020-01-01',
    documentId: k.documents.appendix,
  };
  await page.getByTestId('action-create-participation').click();
  await pick(page, 'participation-artist', 'R2-291');
  await dialog.getByTestId('field-participation-percent').fill('60');
  await choose(page, 'participation-base', 'от получено (net)');
  await choose(page, 'participation-funded', 'сверху');
  await dialog.getByTestId('field-participation-from').fill('2020-01-01');
  await dialog.getByTestId('action-participation-submit').click();
  await toastCode(page, 'top_above_100');
  const direct = await apiPost(request, '/participations', body);
  expect(direct.code).toBe('top_above_100');
  expect([409, 422]).toContain(direct.status);
});

test('S21 (acted on in the signals spec): A 0, P 10, ours 90 in both states', async ({ page }) => {
  await openTrack(page, 21, 1);
  await expectMonth(page, 21, 1, '2026-03', ['A-211 0', 'P-211 10'], '90');
});

test('S13 assumption on a row: replace it by a document from 2026-03 through the change (if the queue spec has not)', async ({ page }) => {
  await openTrack(page, 13, 1);
  const lWaits = (await money(page.getByTestId('track-totals'), 'C').getAttribute('title')) === '40';
  if (lWaits) {
    await expectMonth(page, 13, 1, '2026-03', ['A-131 23', 'L-131 20', 'D-131 7'], '50');
    await toTab(page, 'rules');
    await page.getByTestId('action-change-split').click();
    const dialog = page.getByTestId('form-dialog');
    await dialog.getByTestId('field-split-from').fill('2026-03-01');
    // the prefilled rows are the newest (buy-out) split: A 0, L 20 with Q1, D 7 -> A 23, L 20 without Q1, D 7
    await expect(dialog.getByTestId('split-row-0')).toContainText('A-131');
    await dialog.getByTestId('field-split-percent-0').fill('23');
    await expect(dialog.getByTestId('split-row-1')).toContainText('L-131');
    await dialog.getByTestId('action-split-row-drop-document-1').click();
    await dialog.getByTestId('field-document-file').fill('dummy://e2e-appendix-131-rules.pdf');
    await dialog.getByTestId('action-document-create').click();
    await toastOk(page, 'Документ создан');
    await dialog.getByTestId('action-document-approve').click();
    await confirm(page);
    await expect(dialog.getByTestId('document-ready')).toBeVisible();
    await dialog.getByTestId('action-split-submit').click();
    await confirm(page);
    await toastOk(page, 'Сплит изменён: новые строки с 2026-03-01');
    await settled(page);
    await toTab(page, 'money');
  }
  await expectMonth(page, 13, 1, '2026-03', ['A-131 23', 'L-131 20', 'D-131 7'], '50');
  const d = page.getByTestId(`month-detail-${account(13, 1)}-${upc(13, 1, 1)}-2026-03`);
  await expect(d.getByTestId('allocations').locator('[data-col="category"] [data-testid="chip-C"]')).toHaveCount(0);
  await expectMonth(page, 13, 1, '2026-05', ['L-131 20', 'D-131 7'], '73');
  await p1(page, 13, 1, [
    ['2026-03', '100 / 50 / 0 / 50'],
    ['2026-05', '100 / 7 / 20 / 73'],
  ]);
});
