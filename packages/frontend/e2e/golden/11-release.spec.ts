import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectMoneyCalls, isrc, openAs, sc, settled, upc } from '../helpers';

// P7 «Релизы» and P8 «Релиз» (19 §4 S11, G24): one ISRC under two UPCs; each release shows its own share of the
// unit (UPC1 net 100, UPC2 net 50), track by track and month by month, exact strings in `title`.

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

test('S11 G24: UPC1 and UPC2 of one ISRC, tracks and months', async ({ page }) => {
  const i = isrc(11, 1, 1);
  for (const [u, net, B, ours] of [
    [upc(11, 1, 1), '100', '55', '45'],
    [upc(11, 1, 2), '50', '27.5', '22.5'],
  ] as const) {
    await openRelease(page, u);
    await expectRow(page.getByTestId(`release-track-${i}`), net, B, '0', ours);
    await expectRow(page.getByTestId(`release-month-${M}`), net, B, '0', ours);
    await expect(page.getByTestId('release-tracks').locator('tbody tr')).toHaveCount(1);
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
  await page.getByTestId(`release-track-${i}`).getByRole('link', { name: i }).click();
  await expect(page).toHaveURL(new RegExp(`/tracks/${i}$`));
  // the track card names the same pseudonyms as links (D-166)
  await settled(page);
  await expect(page.getByTestId('track-artists')).toHaveText('A-111, P-111');
  await page.getByTestId('track-artists').getByTestId(`artist-link-${sc(11, 1).artists.P}`).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/artists/${sc(11, 1).artists.P}`));
  await expect(page.getByTestId('artist-page-title')).toHaveText('P-111');
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
