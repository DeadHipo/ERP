import { expect, test } from '@playwright/test';
import { account, apiPost, choose, isrc, labelOf, openAs, toastOk, upc } from '../helpers';

// The label history of an ISRC and the release registry (D-172, S47–S48 of 19). S47: an ISRC of its own (QZTST2747101,
// no report lines): no history; the operator sets 0to8 from 2026-01-15 (floored to 2026-01-01), then replaces it with
// Echo8 from the same month (one row); the same again is 409 catalog_same_label; P6 names Echo8 as the catalog label and
// P5 «Только каталог лейбла» lists the ISRC with it. S48: one synthetic report of 0to8 (account 2748100, UPC
// 2748100000001, one ISRC, its track registered), then the Believe release export of 0to8 with that UPC and «# of track» 2: inserted, then
// unchanged; P7 under 0to8 marks it registered, the registry view shows isrcsInUnits 1, P8 the registry row and the
// missing track.

test.describe.configure({ mode: 'serial' });

const I = isrc(47, 1, 1);
const UPC = upc(48, 1, 1);
const ACCT = account(48, 1);

test('S47 the label history: set, replace, same label refused; P6 and P5 show the catalog label', async ({ page }) => {
  await openAs(page, `/tracks/${I}`);
  await expect(page.getByTestId('track-catalog-label')).toHaveText('—');
  await page.getByTestId('action-track-labels').click();
  const dialog = page.getByTestId('track-labels');
  await expect(dialog.getByTestId('page-state-empty')).toBeVisible();
  await dialog.getByTestId('action-set-track-label').click();
  await choose(page, 'track-label', '0to8');
  await page.getByTestId('field-track-label-from').fill('2026-01-15');
  await page.getByTestId('action-set-track-label-submit').click();
  await toastOk(page, 'Лейбл каталога сохранён');
  const row = dialog.getByTestId('track-label-2026-01-01');
  await expect(row).toHaveAttribute('data-source', 'operator');
  await expect(row).toHaveAttribute('data-label-id', labelOf('0to8'));
  // the replacement from the same month: the one row changes its label
  await dialog.getByTestId('action-replace-track-label-2026-01-01').click();
  await choose(page, 'track-label', 'Echo8');
  await page.getByTestId('action-set-track-label-submit').click();
  await toastOk(page, 'Лейбл каталога сохранён');
  await expect(row).toHaveAttribute('data-label-id', labelOf('Echo8'));
  await expect(dialog.locator('[data-testid^="track-label-2"]')).toHaveCount(1);
  const same = await apiPost(page.request, `/tracks/${I}/label`, { labelId: labelOf('Echo8'), from: '2026-01-01' });
  expect(same.status).toBe(409);
  expect(same.code).toBe('catalog_same_label');
  await page.getByTestId('form-dialog-close').click();
  await expect(page.getByTestId('track-catalog-label')).toContainText('Echo8');
  await expect(page.getByTestId('track-catalog-label')).toHaveAttribute('data-label-id', labelOf('Echo8'));
  // P5: the catalog of the labels (an ISRC known only from its interval), its catalog label column
  await openAs(page, '/tracks');
  await page.getByTestId('action-catalog-current').click();
  await expect(page).toHaveURL(/catalog=current/);
  const track = page.getByTestId(`track-${I}`);
  await page.getByTestId('field-tracks-q').fill(I);
  await expect(track.locator('[data-col="catalogLabel"]')).toHaveText('Echo8');
  await expect(track.locator('[data-col="catalogLabel"]')).toHaveAttribute('data-label-id', labelOf('Echo8'));
});

const HEADER = '"Release Title";Version;Artist;Label;"Release date / Hour / Time zone";"# of track";UPC;"Cat. #";"# of territories";"# of stores"';
const EXPORT = {
  name: 'release_export_e2e.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(`\ufeff${HEADER}\r\n"Synthetic Release";;"Synthetic Artist";"Test Label";"2026-03-01<br />00:00:00";2;"UPC : ${UPC}";;1;1\r\n`, 'utf8'),
};

const COLUMNS = ['Reporting month', 'Sales Month', 'Platform', 'Country / Region', 'Label Name', 'Artist Name', 'Release title', 'Track title', 'UPC', 'ISRC', 'Release Catalog nb', 'Streaming Subscription Type', 'Release type', 'Sales Type', 'Quantity', 'Client Payment Currency', 'Unit Price', 'Mechanical Fee', 'Gross Revenue', 'Client share rate', 'Net Revenue'];
const q = (v: string) => `"${v}"`;
function report(): { name: string; mimeType: string; buffer: Buffer } {
  const rec: Record<string, string> = {
    'Reporting month': '2026/03/01', 'Sales Month': '2026/03/01', Platform: 'Spotify', 'Country / Region': 'Brazil', 'Label Name': 'Test Label',
    'Artist Name': 'Registry Artist', 'Release title': 'Synthetic Release', 'Track title': 'Registry Track', UPC, ISRC: isrc(48, 1, 1),
    'Release Catalog nb': 'CAT048', 'Streaming Subscription Type': 'Premium', 'Release type': 'Music Release', 'Sales Type': 'Stream', Quantity: '1',
    'Client Payment Currency': 'USD', 'Unit Price': '0.004', 'Mechanical Fee': '0', 'Gross Revenue': '10', 'Client share rate': '0.85', 'Net Revenue': '10',
  };
  const text = '\ufeff' + [COLUMNS.map(q).join(';'), COLUMNS.map((c) => q(rec[c] ?? '')).join(';')].join('\r\n') + '\r\n';
  return { name: `9900048_${ACCT}_2026-03-01_2026-03-01.csv`, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') };
}

test('S48 the release registry of 0to8: import, again unchanged; P7, the registry view, P8', async ({ page }) => {
  expect((await apiPost(page.request, `/labels/${labelOf('0to8')}/accounts`, { account: ACCT })).status).toBe(201);
  await openAs(page, `/sources?label=${labelOf('0to8')}`);
  await page.getByTestId('field-upload-believe').setInputFiles(report());
  await page.getByTestId('action-upload-believe').click();
  await toastOk(page, 'Файл загружен');
  // P7 lists the UPCs of registered tracks
  expect((await apiPost(page.request, '/tracks', { title: 'Registry Track', isrc: isrc(48, 1, 1), upc: UPC })).status).toBe(201);
  await openAs(page, '/releases');
  await page.getByTestId('action-import-releases').click();
  await choose(page, 'releases-label', '0to8');
  // D-195: step 1 previews the export, nothing written; step 2 applies the checked changes
  await page.getByTestId('field-releases-file').setInputFiles(EXPORT);
  await page.getByTestId('action-releases-preview').click();
  await toastOk(page, 'Сравнено');
  const totals = page.getByTestId('release-preview-totals');
  await expect(totals.locator('[data-col="rows"] dd')).toHaveText('1');
  await expect(totals.locator('[data-col="create"] dd')).toHaveText('1');
  await expect(page.getByTestId(`release-item-2`)).toHaveAttribute('data-action', 'create');
  await expect(page.getByTestId(`release-accept-${UPC}`)).toBeChecked();
  await page.getByTestId('action-releases-apply').click();
  await toastOk(page, 'Реестр обновлён');
  await expect(page.getByTestId('release-apply-result').locator('[data-col="created"] dd')).toHaveText('1');
  await page.getByTestId('field-releases-file').setInputFiles(EXPORT);
  await page.getByTestId('action-releases-preview').click();
  await expect(totals.locator('[data-col="unchanged"] dd')).toHaveText('1');
  await expect(page.getByTestId('action-releases-apply')).toBeDisabled();
  await page.getByTestId('form-dialog-close').click();
  // P7 under 0to8: the UPC of the files is registered
  await openAs(page, `/releases?q=${UPC}&label=${labelOf('0to8')}`);
  const release = page.getByTestId(`release-${UPC}`);
  await expect(release.locator('[data-col="registered"]')).toHaveAttribute('data-value', 'true');
  await expect(release.locator('[data-col="registryTrackCount"]')).toHaveText('2');
  await openAs(page, `/releases?view=registry&label=${labelOf('0to8')}`);
  const reg = page.getByTestId(`registry-${labelOf('0to8')}-${UPC}`);
  await expect(reg.locator('[data-col="isrcsInUnits"]')).toHaveText('1');
  await expect(reg.locator('[data-col="trackCount"]')).toHaveText('2');
  await openAs(page, `/releases/${UPC}?label=${labelOf('0to8')}`);
  const row = page.getByTestId(`release-registry-${labelOf('0to8')}`);
  await expect(row).toContainText('Synthetic Release');
  await expect(row.getByTestId('release-incomplete')).toContainText('1 из 2');
});
