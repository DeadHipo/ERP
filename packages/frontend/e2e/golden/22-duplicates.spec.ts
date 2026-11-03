import { expect, test } from '@playwright/test';
import { apiPost, isrc, openAs, pick, sc, settled, toastOk } from '../helpers';

// P11 «Псевдонимы» / дубликаты (19 §4 S30): a pseudonym carried by two artists, one with an owner; assign the owner
// to the second through the UI; the candidate ISRC without a split stays listed (the numbers do not change).

test.describe.configure({ mode: 'serial' });

const OWNER = 'Owner DUP-301';

test('S30 the artists list filters by text and status, rows link to P12', async ({ page }) => {
  const k = sc(30);
  await openAs(page, '/artists?q=DUP-301');
  await expect(page.getByTestId('artists-page')).toBeVisible();
  await expect(page.getByTestId(`artist-${k.artists.DUP}`)).toBeVisible();
  await expect(page.getByTestId(`artist-${k.artists.DUP2}`)).toBeVisible();
  await expect(page.getByTestId('artists-count')).toContainText('2');
  await openAs(page, '/artists?q=DUP-301&status=no_owner');
  await expect(page.getByTestId(`artist-${k.artists.DUP2}`)).toBeVisible();
  await expect(page.getByTestId(`artist-${k.artists.DUP}`)).toHaveCount(0);
});

test('S30 the group shows two artists, one with an owner, and the candidate ISRC with its net', async ({ page }) => {
  const k = sc(30);
  await openAs(page, '/artists/duplicates');
  const group = page.locator('[data-testid^="duplicate-group-"]').filter({ has: page.getByTestId(`duplicate-artist-${k.artists.DUP}`) });
  await expect(group.locator('[data-testid^="duplicate-artist-"]')).toHaveCount(2);
  await expect(group.getByTestId(`duplicate-artist-${k.artists.DUP}`)).toContainText(OWNER);
  await expect(group.getByTestId(`duplicate-artist-${k.artists.DUP2}`)).toContainText('без владельца');
  const candidate = group.getByTestId(`candidate-${isrc(30, 1, 1)}`);
  await expect(candidate.getByTestId('money')).toHaveAttribute('title', '100');
  // the split dialog opens for the candidate (not submitted: S30's numbers belong to the signals spec)
  await candidate.getByTestId('action-create-split').click();
  await expect(page.getByTestId('form-dialog')).toContainText(isrc(30, 1, 1));
  await page.getByTestId('form-dialog-close').click();
});

test('S30 assign the owner to the second artist: the group shows it, the candidate stays; second press', async ({ page, request }) => {
  const k = sc(30);
  await openAs(page, '/artists/duplicates');
  const second = page.getByTestId(`duplicate-artist-${k.artists.DUP2}`);
  await second.getByTestId('action-assign-owner').click();
  await pick(page, 'assign-owner', OWNER);
  await page.getByTestId('action-assign-submit').click();
  await toastOk(page, 'привязан');
  await expect(second).toContainText(OWNER);
  await expect(second.getByTestId('action-assign-owner')).toHaveCount(0);
  await expect(page.getByTestId(`candidate-${isrc(30, 1, 1)}`)).toBeVisible();
  // P12 of the second artist shows the owner
  await openAs(page, `/artists/${k.artists.DUP2}`);
  await expect(page.getByTestId('artist-owner')).toContainText(OWNER);
  await expect(page.getByTestId('artist-header')).toBeVisible();
  // the second press: the same owner is idempotent, another owner is refused
  const same = await apiPost(request, `/artists/${k.artists.DUP2}/owner`, { ownerId: k.owners.DUP });
  expect(same.status).toBe(200);
  const other = await apiPost(request, `/artists/${k.artists.DUP2}/owner`, { ownerId: sc(1).owners.A });
  expect([other.status, other.code]).toEqual([422, 'artist_owner_fixed']);
});

test('P12 lists the split rows of an artist with a link to the track', async ({ page }) => {
  const k = sc(1);
  await openAs(page, `/artists/${k.artists.A}`);
  const row = page.getByTestId(`split-${k.splits[isrc(1, 1, 1)]?.[0]}`);
  await expect(row).toContainText('A-011 50 %');
  await expect(row.getByRole('link', { name: isrc(1, 1, 1) })).toBeVisible();
  await expect(page.getByTestId('artist-owner')).toContainText('Owner A-011');
  await settled(page);
});

test('creating a pseudonym that exists opens the duplicate dialog: «тот же» opens the artist', async ({ page }) => {
  const k = sc(30);
  await openAs(page, '/artists');
  await page.getByTestId('action-create-artist').click();
  await page.getByTestId('field-artist-pseudonym').fill('DUP-301');
  await page.getByTestId('action-create-artist-submit').click();
  await expect(page.locator('[data-testid="toast"][data-code="possible_duplicate"]').first()).toBeVisible();
  const dialog = page.getByTestId('duplicate-dialog');
  await expect(dialog.locator('[data-testid^="duplicate-"]')).not.toHaveCount(0);
  await dialog.getByTestId(`duplicate-${k.artists.DUP}`).getByTestId('action-duplicate-same').click();
  await expect(page).toHaveURL(new RegExp(`/artists/${k.artists.DUP}$`));
});
