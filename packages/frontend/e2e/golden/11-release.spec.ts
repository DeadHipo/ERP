import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectMoneyCalls, isrc, labelOf, openAs, sc, settled, upc } from '../helpers';

// P7 «Релизы» and P8 «Релиз» (19 §4 S11, G24): one ISRC under two UPCs; each release shows its own share of the
// unit (UPC1 net 100, UPC2 net 50), track by track and month by month, exact strings in `title`. The name of the track
// row comes from the track directory (`POST /tracks/query`, D-250): the title without its version, the version.
// D-253: P8 stands on the money blocks: the money of the track rows and of the month rows are two answers of
// `POST /money/master/query` (grain `isrc`, grain `month`), each with its footer `totals`; the screen equals the API.

const M = '2026-03';
const money = (row: Locator, col: string) => row.locator(`[data-col="${col}"]`).getByTestId('money').first();

async function expectRow(row: Locator, net: string, B: string, C: string, ours: string) {
  await expect(row).toBeVisible();
  await expect(money(row, 'net')).toHaveAttribute('title', net);
  await expect(money(row, 'B')).toHaveAttribute('title', B);
  await expect(money(row, 'C')).toHaveAttribute('title', C);
  await expect(money(row, 'ours')).toHaveAttribute('title', ours);
}
async function openRelease(page: Page, u: string) {
  await openAs(page, `/releases/${u}`);
  await settled(page);
  await expect(page.getByTestId('release-upc')).toHaveText(u);
  // R2′ (D-253): `GET /releases/:upc` and one `POST /money/master/query` per block
  expectMoneyCalls(page, 3);
}

type Sums = { net: string; B: string; C: string; ours: string; cByReason: Record<string, string> };
type Rows = { rows: { isrc?: string; month?: string; sums: Sums }[]; totals: Sums };
/** The answer of `POST /money/master/query` for the release, asked as the page asks it (the label in the query only). */
async function masterRows(page: Page, u: string, grain: 'isrc' | 'month', label = ''): Promise<Rows> {
  const res = await page.request.post(`/api/v1/money/master/query${label ? `?label=${label}` : ''}`, { data: { scope: { kind: 'release', upc: u }, grain } });
  expect(res.status()).toBe(200);
  return (await res.json()) as Rows;
}
async function expectSums(row: Locator, sums: Sums) {
  await expectRow(row, sums.net, sums.B, sums.C, sums.ours);
  await expect(row.locator('[data-testid^="c-reason-"]')).toHaveCount(Object.keys(sums.cByReason).length);
  for (const [reason, amount] of Object.entries(sums.cByReason)) await expect(row.getByTestId(`c-reason-${reason}`).getByTestId('money')).toHaveAttribute('title', amount);
}
/** D-253 «screen = API»: every money cell of the two blocks is the field of the answer, and so are the footers. */
async function expectScreenIsApi(page: Page, u: string, label = '') {
  const [byTrack, byMonth] = [await masterRows(page, u, 'isrc', label), await masterRows(page, u, 'month', label)];
  expect(byTrack.rows.length).toBeGreaterThan(0);
  expect(byMonth.rows.length).toBeGreaterThan(0);
  for (const r of byTrack.rows) await expectSums(page.getByTestId(`release-track-${r.isrc ?? ''}`), r.sums);
  for (const r of byMonth.rows) await expectSums(page.getByTestId(`release-month-${r.month ?? ''}`), r.sums);
  await expect(page.getByTestId('release-months').locator('tbody tr')).toHaveCount(byMonth.rows.length);
  await expectSums(page.getByTestId('release-tracks-total'), byTrack.totals);
  await expectSums(page.getByTestId('release-months-total'), byMonth.totals);
  // the two answers are two groupings of the same units
  expect(byMonth.totals).toEqual(byTrack.totals);
}

/** D-250: the seed writes no meta; the title with its version is set by the test (a repeat changes nothing). */
async function setMeta(page: Page, i: string) {
  const meta = await page.request.patch('/api/v1/tracks/' + i + '/meta', { headers: { 'X-Operator': 'e2e-operator' }, data: { title: 'S11 Song - Slowed', version: 'Slowed' } });
  expect(meta.status()).toBe(200);
}

test('S11 G24: UPC1 and UPC2 of one ISRC, tracks and months', async ({ page }) => {
  const i = isrc(11, 1, 1);
  await setMeta(page, i);
  for (const [u, net, B, ours] of [
    [upc(11, 1, 1), '100', '55', '45'],
    [upc(11, 1, 2), '50', '27.5', '22.5'],
  ] as const) {
    await openRelease(page, u);
    await expectRow(page.getByTestId(`release-track-${i}`), net, B, '0', ours);
    await expectRow(page.getByTestId(`release-month-${M}`), net, B, '0', ours);
    await expect(page.getByTestId('release-tracks').locator('tbody tr')).toHaveCount(1);
    // D-253: the footer of each block is `totals` of its answer; the screen equals the API
    await expectRow(page.getByTestId('release-tracks-total'), net, B, '0', ours);
    await expectRow(page.getByTestId('release-months-total'), net, B, '0', ours);
    await expectScreenIsApi(page, u);
    // D-250: the track row is named by the directory: the base title as the link to P6, the version under it
    await expect(page.getByTestId(`track-name-${i}`).getByRole('link')).toHaveText('S11 Song');
    await expect(page.getByTestId(`track-name-${i}`).getByRole('link')).toHaveAttribute('href', `/tracks/${i}`);
    await expect(page.getByTestId(`track-version-${i}`)).toHaveText('Slowed');
    // the directory is not a money request: still one read of the release and one per block (R2′)
    expectMoneyCalls(page, 3);
    await expect(page.getByTestId('breadcrumbs')).toContainText(u);
    // D-166: the pseudonyms of the release (the row of A, the participation of P) in the header and on the track row, links to P12
    const k = sc(11, 1);
    await expect(page.getByTestId('release-artists').getByTestId('artist-links')).toHaveText('A-111, P-111');
    await expect(page.getByTestId('release-artists').getByTestId(`artist-link-${k.artists.A}`).getByRole('link')).toHaveAttribute('href', `/artists/${k.artists.A}`);
    await expect(page.getByTestId(`release-track-${i}`).locator('[data-col="artists"]').getByTestId(`artist-link-${k.artists.P}`).getByRole('link')).toHaveAttribute(
      'href',
      `/artists/${k.artists.P}`,
    );
  }
  await page.getByTestId('track-name-' + i).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/tracks/${i}$`));
  // the track card names the same pseudonyms as links (D-166)
  await settled(page);
  await expect(page.getByTestId('track-artists')).toHaveText('A-111, P-111');
  await page.getByTestId('track-artists').getByTestId(`artist-link-${sc(11, 1).artists.P}`).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/artists/${sc(11, 1).artists.P}`));
  await expect(page.getByTestId('artist-page-title')).toHaveText('P-111');
});

test('S11 under a label: the label goes to the three reads of P8, the screen equals the API of the label', async ({ page }) => {
  const [i, u] = [isrc(11, 1, 1), upc(11, 1, 1)];
  // the book of S11: the own label whose answer has the rows of the release
  const books: string[] = [];
  for (const label of [labelOf('0to8'), labelOf('Echo8')]) if ((await masterRows(page, u, 'isrc', label)).rows.length > 0) books.push(label);
  expect(books).toHaveLength(1);
  const label = books[0] ?? '';
  const asked: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/v1/money/master/query' || url.pathname === `/api/v1/releases/${u}`) asked.push(`${r.method()} ${url.pathname}${url.search}`);
  });
  await openAs(page, `/releases/${u}?label=${label}`);
  await settled(page);
  await expect(page.getByTestId('release-upc')).toHaveText(u);
  expectMoneyCalls(page, 3);
  expect(asked.sort()).toEqual([`GET /api/v1/releases/${u}?label=${label}`, `POST /api/v1/money/master/query?label=${label}`, `POST /api/v1/money/master/query?label=${label}`]);
  await expectRow(page.getByTestId(`release-track-${i}`), '100', '55', '0', '45');
  await expectRow(page.getByTestId(`release-month-${M}`), '100', '55', '0', '45');
  await expectScreenIsApi(page, u, label);
});

test('P8: a track of the list without a money row shows 0 in the four cells, no reasons; the footer is the answer\'s', async ({ page }) => {
  const [i, u] = [isrc(11, 1, 1), upc(11, 1, 1)];
  // a registered track without units: in the list of `GET /releases/:upc` (zero sums, as the server gives them), in no money row
  const idle = 'QZTST2699901';
  await page.route(`**/api/v1/releases/${u}`, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { tracks: unknown[] };
    body.tracks.push({ isrc: idle, title: '', artists: [], meta: null, net: '0', B: '0', C: '0', ours: '0', cByReason: {} });
    await route.fulfill({ response: res, json: body });
  });
  await openRelease(page, u);
  const byTrack = await masterRows(page, u, 'isrc');
  expect(byTrack.rows.map((r) => r.isrc)).toEqual([i]);
  await expect(page.getByTestId('release-tracks').locator('tbody tr')).toHaveCount(2);
  const row = page.getByTestId(`release-track-${idle}`);
  await expectRow(row, '0', '0', '0', '0');
  await expect(row.locator('[data-testid^="c-reason-"]')).toHaveCount(0);
  // the directory does not know it: the fallback look
  await expect(row.getByTestId(`track-name-${idle}`).getByRole('link')).toHaveText(idle);
  // the money of the other row and the footer are untouched: the footer is `totals` of the answer
  await expectRow(page.getByTestId(`release-track-${i}`), '100', '55', '0', '45');
  await expectSums(page.getByTestId('release-tracks-total'), byTrack.totals);
  await expectRow(page.getByTestId('release-tracks-total'), '100', '55', '0', '45');
  await expectRow(page.getByTestId('release-months-total'), '100', '55', '0', '45');
});

test('P8: a failed block shows its own error with a retry; the header and the other block stay', async ({ page }) => {
  const [i, u] = [isrc(11, 1, 1), upc(11, 1, 1)];
  let fail = true;
  await page.route('**/api/v1/money/master/query*', async (route) => {
    const grain = (route.request().postDataJSON() as { grain: string }).grain;
    if (fail && grain === 'month') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'mocked', statusCode: 500 } }) });
    else await route.continue();
  });
  await openAs(page, `/releases/${u}`);
  await settled(page);
  await expect(page.getByTestId('release-upc')).toHaveText(u);
  await expectRow(page.getByTestId(`release-track-${i}`), '100', '55', '0', '45');
  await expect(page.getByTestId('release-months')).toHaveCount(0);
  await expect(page.getByTestId('page-state-error')).toHaveCount(1);
  await expect(page.getByTestId('error-code')).toHaveText('internal');
  fail = false;
  await page.getByTestId('action-retry').click();
  await expectRow(page.getByTestId(`release-month-${M}`), '100', '55', '0', '45');
  await expect(page.getByTestId('page-state-error')).toHaveCount(0);
});

test('S11 on P5: the shown row is named by the directory, one query for the rows on the screen', async ({ page }) => {
  const i = isrc(11, 1, 1);
  await setMeta(page, i);
  const queries: string[][] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/tracks/query') queries.push((r.postDataJSON() as { isrcs: string[] }).isrcs);
  });
  await openAs(page, `/tracks?q=${i}`);
  await settled(page);
  const row = page.getByTestId(`track-${i}`);
  await expect(row.getByTestId(`track-name-${i}`).getByRole('link')).toHaveText('S11 Song');
  await expect(row.getByTestId(`track-version-${i}`)).toHaveText('Slowed');
  // only the shown row is asked (as its money, D-162), and the directory is not a money request (R2)
  expect(queries).toEqual([[i]]);
  expectMoneyCalls(page, 1);
});

test('P8: a failed track directory shows the fallback look (the ISRC, «—»), the money stays', async ({ page }) => {
  const i = isrc(11, 1, 1);
  await page.route('**/api/v1/tracks/query', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'mocked' } }) }));
  await openRelease(page, upc(11, 1, 1));
  const row = page.getByTestId(`release-track-${i}`);
  await expect(row.getByTestId(`track-name-${i}`).getByRole('link')).toHaveText(i);
  await expect(row.getByTestId(`track-version-${i}`)).toHaveCount(0);
  await expect(row.locator('[data-col="artists"]').getByTestId('artist-links')).toHaveAttribute('data-empty', 'true');
  await expectRow(row, '100', '55', '0', '45');
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('P7: the list has both UPCs with their net; the search is kept in the URL and opens the release', async ({ page }) => {
  await openAs(page, '/releases?q=27111');
  await settled(page);
  await expect(page.getByTestId('field-releases-q')).toHaveValue('27111');
  for (const [u, net] of [
    [upc(11, 1, 1), '100'],
    [upc(11, 1, 2), '50'],
  ] as const) {
    const row = page.getByTestId(`release-${u}`);
    await expect(money(row, 'net')).toHaveAttribute('title', net);
    // D-166: the pseudonyms over the tracks of the UPC, links to P12
    await expect(row.getByTestId('artist-links')).toHaveText('A-111, P-111');
    await expect(row.getByTestId(`artist-link-${sc(11, 1).artists.A}`).getByRole('link')).toHaveAttribute('href', `/artists/${sc(11, 1).artists.A}`);
  }
  // the search finds a release by a pseudonym of its tracks
  await page.getByTestId('field-releases-q').fill('P-111');
  await expect(page).toHaveURL(/q=P-111/);
  await expect(page.getByTestId(`release-${upc(11, 1, 1)}`)).toBeVisible();
  await expect(page.getByTestId(`release-${upc(11, 1, 2)}`)).toBeVisible();
  await page.getByTestId('field-releases-q').fill(upc(11, 1, 2));
  await expect(page).toHaveURL(new RegExp(`q=${upc(11, 1, 2)}`));
  await expect(page.getByTestId(`release-${upc(11, 1, 1)}`)).toHaveCount(0);
  await page.getByTestId(`release-${upc(11, 1, 2)}`).getByRole('link', { name: upc(11, 1, 2) }).click();
  await expect(page).toHaveURL(new RegExp(`/releases/${upc(11, 1, 2)}$`));
  await settled(page);
  await expect(page.getByTestId('release-upc')).toHaveText(upc(11, 1, 2));
});

test('P8: an unknown UPC shows the API error with its code', async ({ page }) => {
  await openAs(page, '/releases/0000000000001');
  await expect(page.getByTestId('page-state-error')).toBeVisible();
  await expect(page.getByTestId('error-code')).toHaveText('not_found');
});
