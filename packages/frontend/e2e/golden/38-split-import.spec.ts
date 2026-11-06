import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { apiPost, choose, isrc, labelOf, openAs, toastOk } from '../helpers';

// P28 «Импорт сплитов» and the assumption (D-172, S44–S45 of 19): synthetic files built here on ISRCs of their own
// (QZTST27441xx, no report lines) and new pseudonyms. The bad file (110 %, a date not on the first, new pseudonyms) is
// blocked; the fixed file creates two splits, one new owner; the same file again is all «без изменений»; the P15 row
// of the new split takes one assumption document (`action-assume-<id>`), a second press is 422 nothing_to_assume.

test.describe.configure({ mode: 'serial' });

const I1 = isrc(44, 1, 1);
const I2 = isrc(44, 1, 2);
const HEADER = 'isrc,pseudonym,percent,from,to,owner,document,artist_id,note';
const csv = (name: string, rows: string[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(`${[HEADER, ...rows].join('\r\n')}\r\n`, 'utf8') });

const BAD = csv('split-import-bad.csv', [
  `${I1},Import Artist 38A,60,2026-01-15,,Import Owner 38A,,,`,
  `${I1},Import Artist 38B,50,2026-01-01,,,,,`,
]);
const GOOD = csv('split-import-good.csv', [
  `${I1},Import Artist 38A,60,2026-01-15,,Import Owner 38A,,,`,
  `${I1},Import Artist 38B,20,2026-01-01,,,,,`,
  `${I2},Import Artist 38A,100,2026-02-01,,Import Owner 38A,,,`,
]);

async function preview(page: Page, file: ReturnType<typeof csv>) {
  await page.getByTestId('field-split-import-file').setInputFiles(file);
  const answered = page.waitForResponse((r) => r.url().includes('/api/v1/splits/import') && r.url().includes('dryRun=1'));
  await page.getByTestId('action-split-import-preview').click();
  expect((await answered).status()).toBe(200);
  await expect(page.getByTestId('split-import-totals')).toBeVisible();
}
const total = (page: Page, col: string) => page.getByTestId('split-import-totals').locator(`[data-col="${col}"] dd`);

test('S44 P15 opens the import; under «Все» it is closed; the template is a csv of the shared columns', async ({ page }) => {
  await openAs(page, '/splits');
  await page.getByTestId('action-split-import').click();
  await expect(page).toHaveURL(/\/splits\/import/);
  await expect(page.getByTestId('split-import-page')).toBeVisible();
  await expect(page.getByTestId('upload-closed-reason')).toContainText('выберите лейбл');
  await page.getByTestId('field-split-import-file').setInputFiles(GOOD);
  await expect(page.getByTestId('action-split-import-preview')).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByTestId('action-split-import-template').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('split-import-template.csv');
});

test('S44 the bad file: 110 %, a floored date and new pseudonyms; the apply is closed with the reason', async ({ page }) => {
  await openAs(page, '/splits/import');
  await choose(page, 'label', '0to8');
  await expect(page.getByTestId('split-import-label')).toHaveAttribute('data-label-id', labelOf('0to8'));
  await preview(page, BAD);
  await expect(total(page, 'rows')).toHaveText('2');
  await expect(total(page, 'groups')).toHaveText('1');
  await expect(total(page, 'errors')).not.toHaveText('0');
  const first = page.getByTestId('import-row-2');
  await expect(first).toHaveAttribute('data-action', 'blocked');
  await expect(first).toHaveAttribute('data-group', `${I1}|2026-01-01`);
  await expect(first.getByTestId('issue-split_sum_above_100')).toHaveAttribute('data-severity', 'error');
  await expect(first.getByTestId('issue-date_floored')).toHaveAttribute('data-severity', 'info');
  await expect(first.getByTestId('issue-new_pseudonym')).toHaveAttribute('data-severity', 'warning');
  await expect(first.locator('[col-id="from"]')).toHaveText('2026-01-01');
  await expect(page.getByTestId('action-split-import-apply')).toBeDisabled();
  await expect(page.getByTestId('import-blocked-reason')).toBeVisible();
  // the show filter: errors only keeps both rows (the sum is an error of the group)
  await choose(page, 'import-show', 'с ошибками');
  await expect(page.locator('[data-testid^="import-row-"][row-id]')).toHaveCount(2);
});

test('S44 the fixed file: two splits created, one owner; P15 lists them; the same file again is unchanged', async ({ page }) => {
  await openAs(page, '/splits/import');
  await choose(page, 'label', '0to8');
  await preview(page, GOOD);
  await expect(total(page, 'errors')).toHaveText('0');
  await expect(total(page, 'create')).toHaveText('2');
  await expect(total(page, 'artistsNew')).toHaveText('2');
  await expect(total(page, 'ownersNew')).toHaveText('1');
  await expect(page.getByTestId('import-row-2')).toHaveAttribute('data-action', 'create');
  await expect(page.getByTestId('import-row-4')).toHaveAttribute('data-group', `${I2}|2026-02-01`);
  await expect(page.getByTestId('import-row-2').getByTestId('issue-our_share')).toContainText('20');
  await page.getByTestId('action-split-import-apply').click();
  await toastOk(page, 'Импорт применён');
  const result = page.getByTestId('split-import-result');
  await expect(result).toContainText('Создано и изменено сплитов: 2; новых псевдонимов: 2; новых владельцев: 1');
  await expect(result.getByTestId('link-import-splits')).toHaveCount(2);
  // P15 of the first ISRC: one split, the two pseudonyms, our share 20, no document
  await result.locator(`[data-isrc="${I1}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/splits\\?isrc=${I1}`));
  const row = page.locator('[data-testid^="split-"][row-id]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Import Artist 38A 60 %');
  await expect(row).toContainText('Import Artist 38B 20 %');
  // again: every group is unchanged, nothing to apply
  await openAs(page, '/splits/import');
  await choose(page, 'label', '0to8');
  await preview(page, GOOD);
  await expect(total(page, 'unchanged')).toHaveText('2');
  await expect(total(page, 'create')).toHaveText('0');
  await expect(page.getByTestId('action-split-import-apply')).toBeDisabled();
});

test('S45 the assumption of the imported split: one document; again 422 nothing_to_assume', async ({ page }) => {
  await openAs(page, `/splits?isrc=${I1}`);
  const row = page.locator('[data-testid^="split-"][row-id]');
  await expect(row).toHaveCount(1);
  await row.locator('[data-testid^="action-assume-"]').click();
  await expect(page.getByTestId('assume-preview')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('action-assume-submit')).toBeDisabled();
  await choose(page, 'assume-label', '0to8');
  await page.getByTestId('field-assume-reason').fill('import e2e');
  await page.getByTestId('action-assume-submit').click();
  await toastOk(page, 'Допущение принято: сплитов 1, пропущено 0');
  await expect(row.locator('[data-testid^="action-assume-"]')).toBeDisabled();
  const again = await apiPost(page.request, '/splits/assume', { labelId: labelOf('0to8'), isrcs: [I1], reason: 'import e2e' });
  expect(again.status).toBe(422);
  expect(again.code).toBe('nothing_to_assume');
});
