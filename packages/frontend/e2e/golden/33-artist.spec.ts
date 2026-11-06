import { expect, test, type Page } from '@playwright/test';
import { apiPost, expectMoneyCalls, isrc, labelOf, openAs, sc, settled } from '../helpers';

// P12 Псевдоним (D-165): the money of one pseudonym from its reach, read on S24/1 (A: split 50, the owner's migration
// payout carries no pseudonym) and S23 (NG: the sublabel recipient with an advance), then the advertising charged to a
// pseudonym on S24/2 (this spec is the actor of S24/2: an expense of 10 on its ISRC; 24-owner read its before state).

test.describe.configure({ mode: 'serial' });

const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
async function openArtist(page: Page, artistId: string, tab = 'balance') {
  await openAs(page, `/artists/${artistId}?tab=${tab}`);
  await settled(page);
  expectMoneyCalls(page, 1);
  await expect(page.getByTestId('artist-page-title')).toBeVisible();
}
async function expectTotals(page: Page, totals: Record<string, string>) {
  for (const [name, value] of Object.entries(totals)) await expect(fact(page, name), name).toHaveAttribute('title', value);
}

test('S24/1 A: earned 50 of net 100, nothing recouped, charged or paid by pseudonym; the owner is a link', async ({ page }) => {
  const k = sc(24, 1);
  await openArtist(page, k.artists.A ?? '');
  await expect(page.getByTestId('artist-page-title')).toHaveText('A-241');
  await expect(page.getByTestId('artist-owner').getByRole('link')).toHaveAttribute('href', `/owners/${k.owners.A}`);
  await expect(page.getByTestId('artist-headline').getByTestId('money')).toHaveAttribute('title', '50');
  await expectTotals(page, { earned: '50', waiting: '0', recouped: '0', unrecouped: '0', adsCharged: '0', paid: '0', received: '100', periodEarned: '50' });
  await expect(page.getByTestId('waiting-by-reason')).toContainText('ничего не ждёт');
  await expect(page.getByTestId('by-label-0to8').locator('[data-col="earned"]').getByTestId('money')).toHaveAttribute('title', '50');
  const track = page.getByTestId(`balance-track-${isrc(24, 1, 1)}`);
  await expect(track.locator('[data-col="net"]').getByTestId('money')).toHaveAttribute('title', '100');
  await expect(track.locator('[data-col="earned"]').getByTestId('money')).toHaveAttribute('title', '50');
  await expect(track.getByRole('link')).toHaveAttribute('href', `/tracks/${isrc(24, 1, 1)}`);
  await expect(page.getByTestId('positions')).toContainText('нет');
  await expect(page.getByTestId('balance-ads')).toContainText('рекламы нет');
});

test('S24/1 A: the tabs — the split row with its document, the contract, operations, history; the period narrows the per-period fields', async ({ page }) => {
  const k = sc(24, 1);
  await openArtist(page, k.artists.A ?? '', 'rules');
  await expect(page.getByTestId(`artist-track-${isrc(24, 1, 1)}`)).toBeVisible();
  const split = page.getByTestId(`split-${k.splits[isrc(24, 1, 1)]?.[0]}`);
  await expect(split).toContainText('A-241 50 %');
  await expect(split.getByTestId('chip-approved')).toBeVisible();
  await expect(page.getByTestId('artist-participations')).toContainText('Участий нет');
  await expect(page.getByTestId('artist-label-rules')).toContainText('Таких правил нет');
  await page.getByTestId('tab-documents').click();
  await expect(page).toHaveURL(/tab=documents/);
  await expect(page.getByTestId(`document-${k.documents['contract:A']}`)).toContainText('утверждён');
  await expect(page.getByTestId('documents-tab').locator('tr[data-testid^="contract-"]')).toHaveCount(1);
  await page.getByTestId('tab-operations').click();
  await expect(page.getByTestId('operations-tab')).toContainText('Операций нет');
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-tab')).toBeVisible();
  // the period: April has no unit of this ISRC, so the per-period fields are 0 and the totals stay
  await openAs(page, `/artists/${k.artists.A}?tab=balance&from=2026-04&to=2026-04`);
  await settled(page);
  expectMoneyCalls(page, 1);
  await expectTotals(page, { earned: '50', periodEarned: '0', received: '0' });
  await expect(page.getByTestId('balance-tracks')).toContainText('нет');
});

test('S23 NG: the sublabel recipient earned 25 (the carve), recouped 25 of the advance of 50, 25 remain; the rule is listed', async ({ page }) => {
  const k = sc(23);
  await openArtist(page, k.artists.NG ?? '');
  await expectTotals(page, { earned: '25', recouped: '25', unrecouped: '25', recoupedFromMaster: '25', paid: '0' });
  const position = page.getByTestId(`position-${k.extra['advance-operation']}`);
  await expect(position.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '50');
  await expect(position.locator('[data-col="recouped"]').getByTestId('money')).toHaveAttribute('title', '25');
  await expect(position.locator('[data-col="remaining"]').getByTestId('money')).toHaveAttribute('title', '25');
  await expect(page.getByTestId('by-label-0to8').locator('[data-col="earned"]').getByTestId('money')).toHaveAttribute('title', '25');
  await page.getByTestId('tab-rules').click();
  const rule = page.getByTestId(`label-rule-${k.labelRules['NoGhost Records 23']}`);
  await expect(rule).toContainText('50 %');
  await expect(rule.getByRole('link').first()).toHaveAttribute('href', `/labels/${k.labels['NoGhost Records 23']}`);
  await expect(page.getByTestId('artist-splits')).toContainText('Строк сплитов нет');
});

test('the owner page links to the pseudonym; the splits list and the document card link pseudonyms', async ({ page }) => {
  const k = sc(24, 1);
  await openAs(page, `/owners/${k.owners.A}?tab=balance`);
  await settled(page);
  await page.getByTestId(`balance-artist-${k.artists.A}`).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/artists/${k.artists.A}`));
  await expect(page.getByTestId('artist-page-title')).toHaveText('A-241');
  await openAs(page, `/documents/${k.documents.appendix}`);
  await settled(page);
  await expect(page.getByTestId(`split-${k.splits[isrc(24, 1, 1)]?.[0]}`).getByRole('link', { name: 'A-241' })).toHaveAttribute('href', `/artists/${k.artists.A}`);
});

test('S24/2 A (actor): an expense of 10 on its ISRC is charged to the pseudonym at once and shows on both cards', async ({ page, request }) => {
  const k = sc(24, 2);
  const created = await apiPost(request, '/ads', { items: [{ isrc: isrc(24, 2, 1), month: '2026-03', amount: '10', comment: 'e2e artist ad', labelId: labelOf('0to8') }] });
  expect(created.status).toBe(201);
  const adId = (created.body as { created: { id: string }[] }).created[0]?.id ?? '';
  await openArtist(page, k.artists.A ?? '');
  await expectTotals(page, { earned: '50', adsCharged: '10' });
  const charge = page.getByTestId(`ad-position-${adId}-artist`);
  await expect(charge.locator('[data-col="amount"]').getByTestId('money')).toHaveAttribute('title', '10');
  await expect(charge.getByRole('link').first()).toHaveAttribute('href', `/ads/${adId}`);
  await page.getByTestId('tab-ads').click();
  await expect(page.getByTestId(`entity-ad-${adId}`)).toBeVisible();
  // the owner: earned 50 − paid 70 − advertising 10 = −30 (shown 0)
  await openAs(page, `/owners/${k.owners.A}?tab=balance`);
  await settled(page);
  await expect(fact(page, 'adsCharged')).toHaveAttribute('title', '10');
  await expect(fact(page, 'payable')).toHaveAttribute('title', '-30');
});
