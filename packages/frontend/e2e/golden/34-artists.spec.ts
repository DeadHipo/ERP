import { expect, test, type Page } from '@playwright/test';
import { expectMoneyCalls, openAs, sc, settled } from '../helpers';

// P11 «Псевдонимы» as a table (D-167): the rows without money from `GET /artists`, the money of the rows on the screen
// from one `GET /artists/balances?ids=` (the union reach of the visible pseudonyms). Read on S24/1 (A-241: a split of
// 50, the owner's migration payout carries no pseudonym) and S23 (NG-231: the sublabel recipient, earned 25, the
// advance of 50 recouped by 25). Reads only; the actors of these scenarios ran before (24, 33).

const cell = (row: ReturnType<Page['getByTestId']>, col: string) => row.locator(`[data-col="${col}"]`);
async function expectMoney(row: ReturnType<Page['getByTestId']>, values: Record<string, string>) {
  for (const [col, value] of Object.entries(values)) await expect(cell(row, col).getByTestId('money'), col).toHaveAttribute('title', value);
}

test('S24/1 A-241: the row names the owner (a link), its tracks, rules and contracts; the money of the visible rows arrives in one call', async ({ page }) => {
  const k = sc(24, 1);
  await openAs(page, '/artists?q=A-241');
  await expect(page.getByTestId('artists-grid')).toBeVisible();
  await expect(page.getByTestId('artists-visible-money')).toBeVisible();
  const row = page.getByTestId(`artist-${k.artists.A}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId('artists-count')).toContainText('1');
  await expect(page.getByTestId(`artist-pseudonym-${k.artists.A}`).getByRole('link')).toHaveAttribute('href', `/artists/${k.artists.A}`);
  const owner = page.getByTestId(`artist-owner-${k.artists.A}`);
  await expect(owner.getByRole('link')).toHaveAttribute('href', `/owners/${k.owners.A}`);
  await expect(owner).toContainText('Owner A-241');
  await expect(row.getByTestId('chip-confirmed')).toBeVisible();
  await expect(cell(row, 'tracks')).toHaveText('1');
  await expect(cell(row, 'splitRows')).toHaveText('1');
  await expect(cell(row, 'participations')).toHaveText('0');
  await expect(cell(row, 'contracts')).toHaveText('1');
  await expect(cell(row, 'undocumented')).toHaveText('0');
  await settled(page);
  await expect(row.getByTestId('money-pending')).toHaveCount(0);
  await expectMoney(row, { earned: '50', waiting: '0', recouped: '0', adsCharged: '0', paid: '0', remaining: '50' });
  expectMoneyCalls(page, 1);
});

test('S23 NG-231: the sublabel recipient earned 25 and recouped 25 of its advance, so nothing is left; the search finds a pseudonym by its owner', async ({ page }) => {
  const k = sc(23);
  await openAs(page, '/artists?q=NG-231');
  const row = page.getByTestId(`artist-${k.artists.NG}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`artist-owner-${k.artists.NG}`).getByRole('link')).toHaveAttribute('href', `/owners/${k.owners.NG}`);
  await expect(cell(row, 'splitRows')).toHaveText('0');
  await settled(page);
  await expectMoney(row, { earned: '25', recouped: '25', remaining: '0' });
  expectMoneyCalls(page, 1);
  // the search matches the owner's name too
  const a = sc(24, 1);
  await openAs(page, '/artists?q=Owner A-241');
  await expect(page.getByTestId(`artist-${a.artists.A}`)).toBeVisible();
  await expect(page.getByTestId('artists-count')).toContainText('1');
});

test('the links open the pseudonym (P12) and the owner (P10); «Посчитать все» is one calculation of every pseudonym', async ({ page }) => {
  const k = sc(24, 1);
  await openAs(page, '/artists?q=A-241');
  await page.getByTestId(`artist-pseudonym-${k.artists.A}`).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/artists/${k.artists.A}`));
  await expect(page.getByTestId('artist-page-title')).toHaveText('A-241');
  await page.goBack();
  await expect(page.getByTestId(`artist-${k.artists.A}`)).toBeVisible();
  await page.getByTestId(`artist-owner-${k.artists.A}`).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/owners/${k.owners.A}`));
  await expect(page.getByTestId('owner-page-title')).toHaveText('Owner A-241');
  await openAs(page, '/artists?q=A-241&all=1');
  await expect(page.getByTestId('artists-all-money')).toBeVisible();
  await settled(page);
  await expectMoney(page.getByTestId(`artist-${k.artists.A}`), { earned: '50', remaining: '50' });
  expectMoneyCalls(page, 1);
  await page.getByTestId('action-visible-only').click();
  await expect(page.getByTestId('artists-visible-money')).toBeVisible();
});
