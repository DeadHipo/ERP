import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectMoneyCalls, isrc, openAs, sc, settled, upc } from '../helpers';

// P7 «Релизы» and P8 «Релиз» (19 §4 S11, G24): one ISRC under two UPCs; each release shows its own share of the
// unit (UPC1 net 100, UPC2 net 50), track by track and month by month, exact strings in `title`. The name of the track
// row comes from the track directory (`POST /tracks/query`, D-250): the title without its version, the version.

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
  expectMoneyCalls(page, 1);
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
    // D-250: the track row is named by the directory: the base title as the link to P6, the version under it
    await expect(page.getByTestId(`track-name-${i}`).getByRole('link')).toHaveText('S11 Song');
    await expect(page.getByTestId(`track-name-${i}`).getByRole('link')).toHaveAttribute('href', `/tracks/${i}`);
    await expect(page.getByTestId(`track-version-${i}`)).toHaveText('Slowed');
    // the directory is not a money request: still one calculation for the page (R2)
    expectMoneyCalls(page, 1);
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
