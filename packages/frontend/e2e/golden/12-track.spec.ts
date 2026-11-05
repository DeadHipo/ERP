import { expect, test, type Locator, type Page } from '@playwright/test';
import { account, expectMoneyCalls, isrc, norm, openAs, sc, settled, upc } from '../helpers';

// P6 «Трек» (19 §4, read-only S01–S11 and the stable parts of S13 / S16): every month row of an ISRC, its allocations
// with the exact API strings in `title`, the label of record, the layer-by-layer table and the breakdown of a month.
// P5 «Треки» once: the summary row of an ISRC and its filters. This file runs before 20-queue (19 §6: the file order) and
// asserts the BEFORE state of S16 (the alias of «Mystery Records» is added by the queue spec).

const M = '2026-03';

async function openTrack(page: Page, i: string) {
  await openAs(page, `/tracks/${i}`);
  await settled(page);
  await expect(page.getByTestId('entity-card')).toBeVisible();
  expectMoneyCalls(page, 1);
}
const monthRow = (page: Page, acct: string, u: string, month = M) => page.getByTestId(`month-${acct}-${u}-${month}`);
/** Expands a month row and returns its detail panel. */
async function expand(page: Page, acct: string, u: string, month = M): Promise<Locator> {
  await monthRow(page, acct, u, month).getByTestId('action-expand-month').click();
  const detail = page.getByTestId(`month-detail-${acct}-${u}-${month}`);
  await expect(detail).toBeVisible();
  return detail;
}
const cell = (row: Locator, col: string) => row.locator(`[data-col="${col}"]`).getByTestId('money').first();
/** [pseudonym, exact amount, category, reason?] in the order of the API. */
type Alloc = [string, string, 'B' | 'C', string?];
async function expectAllocs(detail: Locator, allocs: Alloc[]) {
  const rows = detail.getByTestId('allocations').locator('tbody tr');
  await expect(rows).toHaveCount(allocs.length);
  // [pseudonym, amount, category, reason] of every row, compared as a sorted list (the API order is the unit's order)
  const seen = await rows.evaluateAll((trs) =>
    trs.map((tr) => {
      const chip = (col: string) => tr.querySelector(`[data-col="${col}"] [data-testid^="chip-"]`)?.getAttribute('data-testid')?.slice(5) ?? '';
      const amount = tr.querySelector('[data-col="amount"] [data-testid="money"]')?.getAttribute('title') ?? '';
      return [tr.getAttribute('data-pseudonym') ?? '', amount, chip('category'), chip('reason')].join(' ');
    }),
  );
  const expected = allocs.map(([pseud, amount, category, reason]) => [pseud, amount, category, reason ?? ''].join(' '));
  expect(seen.sort()).toEqual(expected.sort());
}
/** One month of a single-ISRC case (account 0, UPC j1): allocations and ours. */
async function expectMonth(page: Page, nn: number, k: number, allocs: Alloc[], ours: string, month = M) {
  const acct = account(nn, k);
  const u = upc(nn, k, 1);
  await expect(cell(monthRow(page, acct, u, month), 'ours')).toHaveAttribute('title', ours);
  const detail = await expand(page, acct, u, month);
  await expectAllocs(detail, allocs);
  return detail;
}

/** [scenario, case, allocations, ours] of 19 §4 (month 2026-03). */
const CASES: [string, number, number, Alloc[], string][] = [
  ['G01', 1, 1, [['A-011', '50', 'B']], '50'],
  ['G42', 1, 2, [['A-012', '50', 'B']], '50'],
  ['G02', 2, 1, [['A-021', '16.6', 'B'], ['B-021', '16.6', 'B'], ['C-021', '16.6', 'B']], '50.2'],
  ['G03a', 2, 2, [['A-022', '33.333333', 'B'], ['B-022', '16.666667', 'B']], '50'],
  ['G03c', 2, 3, [['A-023', '29.761905', 'B'], ['B-023', '10.119048', 'B'], ['C-023', '10.119047', 'B']], '50'],
  ['G06', 2, 4, [['RX-024', '66.6', 'B']], '33.4'],
  ['G07', 2, 5, [['LL-025', '25', 'B']], '75'],
  ['G03b', 3, 1, [['A-031', '12', 'B'], ['B-031', '12', 'B'], ['M1-031', '13', 'B'], ['M2-031', '13', 'B']], '50'],
  ['G04', 3, 2, [['R-032', '15', 'B'], ['A-032', '21.25', 'B'], ['B-032', '21.25', 'B']], '42.5'],
  ['G11', 3, 3, [['A-033', '50', 'B'], ['P-033', '7.5', 'B']], '42.5'],
  ['G12', 3, 4, [['A-034', '45', 'B'], ['E-034', '5', 'B']], '50'],
  ['G32', 3, 5, [['R-035', '15', 'B'], ['A-035', '85', 'B']], '0'],
  ['G35', 3, 6, [['A-036', '50', 'B'], ['P1-036', '5', 'B'], ['P2-036', '7.5', 'B']], '37.5'],
  ['G36', 3, 7, [['A-037', '25', 'B'], ['B-037', '25', 'B'], ['S-037', '15', 'B']], '35'],
  ['G37', 3, 8, [['A-038', '50', 'B'], ['P-038', '50', 'B']], '0'],
  ['G05a', 5, 1, [['A-051', '50', 'B'], ['NG', '25', 'B']], '25'],
  ['G05b', 5, 2, [['A-052', '70', 'B'], ['NG', '15', 'B']], '15'],
  ['G31', 5, 3, [['A-053', '100', 'B'], ['NG', '0', 'B']], '0'],
  ['G41', 5, 4, [['NG', '50', 'B']], '50'],
  ['G08a', 6, 1, [['A-061', '50', 'B']], '50'],
  ['G08b', 6, 2, [['A-062', '50', 'B']], '50'],
  ['G15', 7, 1, [['R-071', '-15', 'B'], ['A-071', '-21.25', 'B'], ['B-071', '-21.25', 'B'], ['NG', '-21.25', 'B']], '-21.25'],
  ['G16', 7, 2, [['R-072', '0', 'B'], ['A-072', '0', 'B'], ['B-072', '0', 'B'], ['NG', '0', 'B']], '0'],
  ['G20', 8, 3, [['A-083', '50', 'B'], ['QQ', '25', 'C', 'assumption']], '25'],
  ['G21', 8, 4, [['NG-084', '50', 'C', 'assumption']], '50'],
  ['G34', 9, 1, [['A-091', '12.266666666666', 'B'], ['B-091', '12.266666666667', 'B'], ['C-091', '12.266666666667', 'B'], ['M-091', '13', 'B']], '50.2'],
];

test('S01–S09 one month each: allocations and ours as entered, exact strings in title', async ({ page }) => {
  test.setTimeout(300_000);
  for (const [, nn, k, allocs, ours] of CASES) {
    await openTrack(page, isrc(nn, k, 1));
    await expectMonth(page, nn, k, allocs, ours);
  }
});

test('G03a and G34: the text is rounded half-up to cents, the exact string stays in title', async ({ page }) => {
  await openTrack(page, isrc(2, 2, 1));
  const d = await expand(page, account(2, 2), upc(2, 2, 1));
  const a = d.getByTestId('allocations').locator('[data-pseudonym="A-022"]');
  expect(norm(await cell(a, 'amount').textContent())).toBe('33,33');
  expect(norm(await cell(d.getByTestId('allocations').locator('[data-pseudonym="B-022"]'), 'amount').textContent())).toBe('16,67');
  await openTrack(page, isrc(9, 1, 1));
  const d9 = await expand(page, account(9, 1), upc(9, 1, 1));
  const b = cell(d9.getByTestId('allocations').locator('[data-pseudonym="B-091"]'), 'amount');
  await expect(b).toHaveAttribute('title', '12.266666666667');
  expect(norm(await b.textContent())).toBe('12,27');
});

test('G15 negative unit: red amounts with a minus; G16 zero unit: every allocation 0', async ({ page }) => {
  await openTrack(page, isrc(7, 1, 1));
  await expect(cell(page.getByTestId('track-totals'), 'net')).toHaveAttribute('title', '-100');
  await expect(cell(page.getByTestId('track-totals'), 'B')).toHaveAttribute('title', '-78.75');
  const d = await expand(page, account(7, 1), upc(7, 1, 1));
  const a = cell(d.getByTestId('allocations').locator('[data-pseudonym="A-071"]'), 'amount');
  expect(norm(await a.textContent())).toBe('-21,25');
  await expect(a).toHaveClass(/text-danger/);
  await openTrack(page, isrc(7, 2, 1));
  await expect(cell(page.getByTestId('track-totals'), 'ours')).toHaveAttribute('title', '0');
});

test('G44: three carves on a pool of 10, A 0 and the shortfalls of the carves', async ({ page }) => {
  await openTrack(page, isrc(9, 2, 1));
  const d = await expectMonth(
    page,
    9,
    2,
    [['A-092', '0', 'B'], ['M1-092', '3.333333333334', 'B'], ['M2-092', '3.333333333333', 'B'], ['M3-092', '3.333333333333', 'B']],
    '90',
  );
  const shortfalls = d.locator('[data-testid^="shortfall-"]');
  await expect(shortfalls).toHaveCount(3);
  const missing = await shortfalls.getByTestId('money').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
  expect(missing.sort()).toEqual(['9.666666666666', '9.666666666667', '9.666666666667']);
});

test('G37: the carve shortfall of 20', async ({ page }) => {
  await openTrack(page, isrc(3, 8, 1));
  const d = await expand(page, account(3, 8), upc(3, 8, 1));
  await expect(d.locator('[data-testid^="shortfall-"]').getByTestId('money')).toHaveAttribute('title', '20');
});

test('G18: the C reasons with the ⚠ Q11 basis and the layer-by-layer table', async ({ page }) => {
  await openTrack(page, isrc(8, 1, 1));
  await expect(cell(page.getByTestId('track-totals'), 'C')).toHaveAttribute('title', '23.375');
  await expect(page.getByTestId('track-totals').getByTestId('c-reason-assumption').getByTestId('money')).toHaveAttribute('title', '23.375');
  const d = await expectMonth(
    page,
    8,
    1,
    [
      ['R-081', '15', 'B'],
      ['A-081', '14.75', 'B'],
      ['B-081', '14.75', 'B'],
      ['M-081', '13', 'B'],
      ['P-081', '4.25', 'C', 'assumption'],
      ['NG-081', '19.125', 'C', 'assumption'],
    ],
    '19.125',
  );
  await expect(d.getByTestId('allocations').locator('[data-pseudonym="NG-081"] [data-col="basis"]')).toHaveText('⚠ Q11');
  const row = monthRow(page, account(8, 1), upc(8, 1, 1));
  await expect(row.getByTestId('label-string')).toHaveText('NoGhost Records 08a');
  await expect(row.getByTestId('label-of-record')).toHaveText('0to8');
  await expect(row.getByTestId('sublabel')).toHaveText('NoGhost Records 08a');
  const layers = d.getByTestId('layers').locator('tbody tr');
  await expect(layers).toHaveCount(6);
  const layer = (name: string) => d.getByTestId(`layer-${name}`);
  const added = async (name: string) =>
    layer(name).locator('[data-col="added"] li').evaluateAll((els) =>
      els.map((e) => `${e.getAttribute('data-pseudonym')} ${e.querySelector('[data-testid="money"]')?.getAttribute('title')}`),
    );
  await expect(cell(layer('off-the-top'), 'scaledNet')).toHaveAttribute('title', '85');
  expect(await added('off-the-top')).toEqual(['R-081 15']);
  await expect(cell(layer('split'), 'labelShare')).toHaveAttribute('title', '42.5');
  expect(await added('split')).toEqual(['A-081 21.25', 'B-081 21.25']);
  await expect(cell(layer('carve'), 'labelShare')).toHaveAttribute('title', '19.125');
  expect(await added('carve')).toEqual(['A-081 14.75', 'B-081 14.75', 'M-081 13', 'P-081 4.25', 'NG-081 19.125']);
  expect(await added('categorise')).toEqual(['P-081 4.25', 'NG-081 19.125']);
  await expect(layer('categorise').locator('[data-col="added"]')).toContainText('(C)');
});

test('G18b: the artist-share carve inside A', async ({ page }) => {
  await openTrack(page, isrc(8, 2, 1));
  const d = await expand(page, account(8, 2), upc(8, 2, 1));
  const amount = (ps: string) => cell(d.getByTestId('allocations').locator(`[data-pseudonym="${ps}"]`), 'amount');
  await expect(amount('E-082')).toHaveAttribute('title', '1.475');
  expect(norm(await amount('E-082').textContent())).toBe('1,48');
  await expect(amount('A-082')).toHaveAttribute('title', '13.275');
});

test('G38: the label string decides per month; G08a/G08b: the label of record', async ({ page }) => {
  await openTrack(page, isrc(6, 3, 1));
  const acct = account(6, 3);
  const u = upc(6, 3, 1);
  await expect(monthRow(page, acct, u, M).getByTestId('label-string')).toHaveText('NoGhost Records');
  await expect(monthRow(page, acct, u, '2026-04').getByTestId('label-string')).toHaveText('Test Label');
  await expectMonth(page, 6, 3, [['A-063', '50', 'B'], ['NG', '25', 'B']], '25', M);
  await expectMonth(page, 6, 3, [['A-063', '50', 'B']], '50', '2026-04');
  await openTrack(page, isrc(6, 1, 1));
  await expect(monthRow(page, account(6, 1), upc(6, 1, 1)).getByTestId('label-string')).toHaveText('Ahh Music');
  await expect(monthRow(page, account(6, 1), upc(6, 1, 1)).getByTestId('label-of-record')).toHaveText('0to8');
  await openTrack(page, isrc(6, 2, 1));
  await expect(monthRow(page, account(6, 2), upc(6, 2, 1)).getByTestId('label-of-record')).toHaveText('Echo8');
});

test('G45, G46, G47: two months each', async ({ page }) => {
  await openTrack(page, isrc(4, 1, 1));
  await expectMonth(page, 4, 1, [['A-041', '50', 'B']], '50', '2026-01');
  await expectMonth(page, 4, 1, [['A-041', '35', 'B'], ['S-041', '15', 'B']], '50', M);
  await openTrack(page, isrc(4, 2, 1));
  for (const month of ['2026-01', M]) {
    const d = await expand(page, account(4, 2), upc(4, 2, 1), month);
    const m1 = d.getByTestId('allocations').locator('[data-pseudonym="M1-042"]');
    await expect(m1).toHaveCount(2);
    for (const n of [0, 1]) await expect(cell(m1.nth(n), 'amount')).toHaveAttribute('title', '4.165');
    expect(norm(await cell(m1.nth(0), 'amount').textContent())).toBe('4,17');
    await expect(cell(d.getByTestId('allocations').locator('[data-pseudonym="A-042"]'), 'amount')).toHaveAttribute('title', '16.67');
  }
  await openTrack(page, isrc(4, 3, 1));
  await expectMonth(page, 4, 3, [['A-043', '25', 'B'], ['B-043', '25', 'B']], '50', '2026-01');
  await expectMonth(page, 4, 3, [['A-043', '17.5', 'B'], ['B-043', '17.5', 'B'], ['S-043', '15', 'B']], '50', '2026-02');
});

test('G10a (S13 month 05, untouched by the queue action): L 20 C assumption, D 7 B, ours 73', async ({ page }) => {
  await openTrack(page, isrc(13, 1, 1));
  const d = await expectMonth(page, 13, 1, [['L-131', '20', 'C', 'assumption'], ['D-131', '7', 'B']], '73', '2026-05');
  await expect(d.getByTestId('allocations').locator('[data-pseudonym="L-131"] [data-col="basis"]')).toHaveText('документ');
});

test('G08c (S16, before the alias of the queue spec): the label share of an unmapped string waits in C', async ({ page }) => {
  const i = isrc(16, 1, 1);
  await openTrack(page, i);
  const row = monthRow(page, account(16, 1), upc(16, 1, 1));
  await expect(row.getByTestId('label-string')).toHaveText('Mystery Records');
  await expect(cell(row, 'labelShare')).toHaveAttribute('title', '50');
  await expect(cell(row, 'ours')).toHaveAttribute('title', '0');
  await expect(row.locator('[data-col="ours"]').getByTestId('chip-label_unmapped')).toBeVisible();
  await expect(page.getByTestId('track-totals').getByTestId('c-reason-label_unmapped').getByTestId('money')).toHaveAttribute('title', '50');
  const d = await expand(page, account(16, 1), upc(16, 1, 1));
  await expectAllocs(d, [['A-161', '50', 'B']]);
});

test('an unknown pair (S10/2 QZTST2710209): no allocation, the label share is C unknown_pair', async ({ page }) => {
  await openTrack(page, isrc(10, 2, 9));
  const row = monthRow(page, account(10, 2, 1), upc(10, 2, 9));
  await expect(cell(row, 'net')).toHaveAttribute('title', '7');
  await expect(row.locator('[data-col="ours"]').getByTestId('chip-unknown_pair')).toBeVisible();
  await expect(row.locator('[data-col="status"] [data-value]')).toHaveAttribute('data-value', 'unknown_pair');
});

test('G24 on P6: one ISRC under two UPCs, a month row per UPC; the breakdown loads the platform rows of a month', async ({ page }) => {
  const i = isrc(11, 1, 1);
  let calls = 0;
  page.on('request', (r) => {
    if (r.url().includes(`/tracks/${i}/breakdown/`)) calls += 1;
  });
  await openTrack(page, i);
  await expect(cell(page.getByTestId('track-totals'), 'ours')).toHaveAttribute('title', '67.5');
  await expectMonth(page, 11, 1, [['A-111', '50', 'B'], ['P-111', '5', 'B']], '45');
  const acct = account(11, 1);
  await expect(cell(monthRow(page, acct, upc(11, 1, 2)), 'ours')).toHaveAttribute('title', '22.5');
  const d = page.getByTestId(`month-detail-${acct}-${upc(11, 1, 1)}-${M}`);
  await d.getByTestId('action-breakdown').click();
  const rows = d.getByTestId('breakdown').getByTestId('breakdown-row');
  await expect(rows).toHaveCount(1);
  await expect(cell(rows.first(), 'net')).toHaveAttribute('title', '100');
  await expect(rows.first().locator('[data-col="platform"]')).not.toBeEmpty();
  const d2 = await expand(page, acct, upc(11, 1, 2));
  await d2.getByTestId('action-breakdown').click();
  await expect(cell(d2.getByTestId('breakdown').getByTestId('breakdown-row').first(), 'net')).toHaveAttribute('title', '50');
  expect(calls).toBe(1); // one call per report month, shared by the two UPC rows
});

test('the card: header, tabs in the URL, documents, the lines link; the breadcrumb shows the ISRC', async ({ page }) => {
  const k = sc(11);
  const i = isrc(11, 1, 1);
  await openTrack(page, i);
  await expect(page.getByTestId('track-isrc')).toHaveText(i);
  await expect(page.getByTestId('breadcrumbs')).toContainText(i);
  await page.getByTestId('tab-rules').click();
  await expect(page).toHaveURL(/tab=rules/);
  await expect(page.getByTestId(`split-${k.splits[i]?.[0] ?? ''}`)).toContainText('A-111');
  await expect(page.getByTestId(`participation-${k.participations.P ?? ''}`)).toContainText('P-111');
  await page.getByTestId('tab-documents').click();
  await expect(page.getByTestId(`document-${k.documents.appendix ?? ''}`)).toContainText('Appendix 111');
  await page.getByTestId('tab-lines').click();
  await expect(page.getByTestId('track-lines-link')).toHaveAttribute('href', `/sources/lines?isrc=${i}`);
  await page.reload();
  await expect(page.getByTestId('track-lines-link')).toBeVisible();
});

test('P5 «Треки»: the summary row of an ISRC, the quick filters in the URL, the account and month scope', async ({ page }) => {
  const i = isrc(11, 1, 1);
  // D-162: the rows come without money (the catalog), the money of the visible rows is one summary call of their ISRCs
  const asked = page.waitForRequest((r) => r.url().includes('/api/v1/tracks/summary?'));
  await openAs(page, `/tracks?q=${i}`);
  // the rows (the catalog) come first, the money of the visible row a moment later: wait for that call, then settle
  expect(new URL((await asked).url()).searchParams.get('isrcs')).toBe(i);
  await settled(page);
  expectMoneyCalls(page, 1);
  await expect(page.getByTestId('tracks-visible-money')).toBeVisible();
  const row = page.getByTestId(`track-${i}`);
  await expect(row).toBeVisible();
  await expect(row.locator('[data-col="net"] [data-testid="money"]')).toHaveAttribute('title', '150');
  await expect(row.locator('[data-col="B"] [data-testid="money"]')).toHaveAttribute('title', '82.5');
  await expect(row.locator('[data-col="ours"] [data-testid="money"]')).toHaveAttribute('title', '67.5');
  await expect(row.getByTestId('chip-has-split-yes')).toBeVisible();
  // D-166: «Артисты» are the pseudonyms of the registry (the split row of A, the participation of P), each a link to P12
  const k11 = sc(11, 1);
  await expect(row.getByTestId('artist-links')).toHaveText(`A-111, P-111`);
  await expect(row.getByTestId(`artist-link-${k11.artists.A}`).getByRole('link')).toHaveAttribute('href', `/artists/${k11.artists.A}`);
  await expect(row.getByTestId(`artist-link-${k11.artists.P}`).getByRole('link')).toHaveAttribute('href', `/artists/${k11.artists.P}`);
  await page.getByTestId(`artist-link-${k11.artists.A}`).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/artists/${k11.artists.A}`));
  await expect(page.getByTestId('artist-page-title')).toHaveText('A-111');
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/tracks\\?q=${i}`));
  await expect(page.getByTestId(`track-${i}`).getByTestId('artist-links')).toHaveText('A-111, P-111');
  await page.getByTestId('field-tracks-q').fill(isrc(8, 4, 1));
  await expect(page).toHaveURL(/q=QZTST2708401/);
  await expect(page.getByTestId(`track-${isrc(8, 4, 1)}`).getByTestId('chip-has-split-no')).toBeVisible();
  // an ISRC without a row, participation or registry link: the artist string of the report, text with the hint, no link
  const bare = page.getByTestId(`track-${isrc(8, 4, 1)}`).getByTestId('artist-links');
  await expect(bare.getByTestId('artist-unregistered')).toHaveText('Synthetic Artist');
  await expect(bare.getByTestId('artist-unregistered')).toHaveAttribute('title', /Нет в реестре/);
  await expect(bare.getByRole('link')).toHaveCount(0);
  // the new visible row gets its money by a second call of its own ISRC; the full calculation is one click away
  await expect(page.getByTestId(`track-${isrc(8, 4, 1)}`).locator('[data-col="ours"] [data-testid="money"]')).toHaveAttribute('title', '50');
  await page.getByTestId('action-compute-all').click();
  await settled(page);
  await expect(page.getByTestId('tracks-all-money')).toBeVisible();
  await expect(page.getByTestId(`track-${isrc(8, 4, 1)}`).locator('[data-col="ours"] [data-testid="money"]')).toHaveAttribute('title', '50');
  await page.getByTestId('action-visible-only').click();
  await expect(page.getByTestId('tracks-visible-money')).toBeVisible();
  await page.getByTestId(`track-${isrc(8, 4, 1)}`).getByRole('link', { name: isrc(8, 4, 1) }).click();
  await expect(page).toHaveURL(new RegExp(`/tracks/${isrc(8, 4, 1)}$`));
  // the B cell of an overview row opens the summary of its account and month
  await openAs(page, `/tracks?account=${account(10, 1, 1)}&month=${M}`);
  await settled(page);
  await expect(page.getByTestId('tracks-scope')).toBeVisible();
  await expect(page.getByTestId('tracks-count')).toHaveText('Строк: 1');
  await expect(page.getByTestId(`track-${isrc(10, 1, 2)}`).locator('[data-col="B"] [data-testid="money"]')).toHaveAttribute('title', '25');
  // the quick search finds a track by its pseudonym (D-166)
  await openAs(page, '/tracks?q=P-111');
  await expect(page.getByTestId(`track-${i}`)).toBeVisible();
  await expect(page.getByTestId('tracks-count')).toHaveText('Строк: 1');
});

test('P7 and P8 are reachable from the card: the UPC link opens the release', async ({ page }) => {
  await openTrack(page, isrc(1, 1, 1));
  await page.getByTestId('entity-card').getByRole('link', { name: upc(1, 1, 1) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/releases/${upc(1, 1, 1)}$`));
  await expect(page.getByTestId('release-upc')).toHaveText(upc(1, 1, 1));
});
