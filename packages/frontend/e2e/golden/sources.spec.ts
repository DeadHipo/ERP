import { expect, test } from '@playwright/test';
import { account, expectP1, isrc, openAs, sc, settled, toastOk } from '../helpers';

// P19 «Отчёты» (19 §4 S34): the files tables, the Believe upload (the synthetic fixture is built here: one line
// QZTST2734101, UPC 2734100000001, net 100), 409 duplicate_period for the same file and duplicate_file for the same bytes
// under another account; the lines page with server paging, facets and the API totals.

test.describe.configure({ mode: 'serial' });

const COLUMNS = ['Reporting month', 'Sales Month', 'Platform', 'Country / Region', 'Label Name', 'Artist Name', 'Release title', 'Track title', 'UPC', 'ISRC', 'Release Catalog nb', 'Streaming Subscription Type', 'Release type', 'Sales Type', 'Quantity', 'Client Payment Currency', 'Unit Price', 'Mechanical Fee', 'Gross Revenue', 'Client share rate', 'Net Revenue'];
const q = (v: string) => `"${v}"`;
function fixture(acct: string): { name: string; buffer: Buffer } {
  const rec: Record<string, string> = {
    'Reporting month': '2026/03/01', 'Sales Month': '2026/03/01', Platform: 'Spotify', 'Country / Region': 'Brazil', 'Label Name': 'Test Label',
    'Artist Name': 'Synthetic Artist', 'Release title': 'Synthetic Release', 'Track title': 'Synthetic Track', UPC: '2734100000001', ISRC: isrc(34, 1, 1),
    'Release Catalog nb': 'CAT001', 'Streaming Subscription Type': 'Premium', 'Release type': 'Music Release', 'Sales Type': 'Stream', Quantity: '1',
    'Client Payment Currency': 'USD', 'Unit Price': '0.004', 'Mechanical Fee': '0', 'Gross Revenue': '100', 'Client share rate': '0.85', 'Net Revenue': '100',
  };
  const text = '﻿' + [COLUMNS.map(q).join(';'), COLUMNS.map((c) => q(rec[c] ?? '')).join(';')].join('\r\n') + '\r\n';
  return { name: `${acct === '2734100' ? '9900001' : '9900002'}_${acct}_2026-03-01_2026-03-01.csv`, buffer: Buffer.from(text, 'utf8') };
}
const ACCT = account(34, 1);

test('S34 before: the files table has no file of the account; the seeded files are listed', async ({ page }) => {
  expect(sc(34).extra.fixtureFile).toBe(fixture(ACCT).name);
  await openAs(page, '/sources');
  await expect(page.getByTestId('sources-page')).toBeVisible();
  await expect(page.locator('[data-testid^="source-file-"][row-id]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="source-file-"][row-id]').filter({ hasText: ACCT })).toHaveCount(0);
  // the B17 statement of the seed
  await expect(page.locator('[data-testid^="statement-"][row-id]').first()).toContainText('Publishing_Statement');
  await page.getByTestId('field-sources-q').fill(account(1, 1));
  const seeded = page.locator('[data-testid^="source-file-"][row-id]').filter({ hasText: account(1, 1) });
  await expect(seeded).toHaveCount(1);
  await expect(seeded.getByTestId('chip-loaded')).toBeVisible();
  await expect(seeded.locator('[data-col="net"]').getByTestId('money')).toHaveAttribute('title', '100');
});

test('S34 upload: loaded, one line; P1 2734100 / 2026-03 is 100 / 50 / 0 / 50; again: 409 duplicate_period', async ({ page }) => {
  await openAs(page, '/sources');
  const f = fixture(ACCT);
  await page.getByTestId('field-upload-believe').setInputFiles({ name: f.name, mimeType: 'text/csv', buffer: f.buffer });
  await page.getByTestId('action-upload-believe').click();
  await toastOk(page, 'Файл загружен');
  await page.getByTestId('field-sources-q').fill(ACCT);
  const row = page.locator('[data-testid^="source-file-"][row-id]').filter({ hasText: ACCT });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('chip-loaded')).toBeVisible();
  await expect(row.locator('[data-col="net"]').getByTestId('money')).toHaveAttribute('title', '100');
  await page.getByTestId('nav-overview').click();
  await settled(page);
  await expectP1(page, ACCT, '2026-03', '100 / 50 / 0 / 50');
  // the same file again
  await openAs(page, '/sources');
  await page.getByTestId('field-upload-believe').setInputFiles({ name: f.name, mimeType: 'text/csv', buffer: f.buffer });
  await page.getByTestId('action-upload-believe').click();
  await expect(page.locator('[data-testid="toast"][data-code="duplicate_period"]').first()).toBeVisible();
});

test('S34 the same bytes under another account: 409 duplicate_file', async ({ page }) => {
  await openAs(page, '/sources');
  const f = fixture(ACCT);
  await page.getByTestId('field-upload-believe').setInputFiles({ name: `9900002_${account(34, 1, 1)}_2026-03-01_2026-03-01.csv`, mimeType: 'text/csv', buffer: f.buffer });
  await page.getByTestId('action-upload-believe').click();
  await expect(page.locator('[data-testid="toast"][data-code="duplicate_file"]').first()).toBeVisible();
});

test('the lines page: an ISRC filter shows rows and the totals come from the API', async ({ page }) => {
  await openAs(page, `/sources/lines?isrc=${isrc(1, 1, 1)}`);
  await expect(page.getByTestId('source-lines-page')).toBeVisible();
  await expect(page.getByTestId('source-line-0')).toBeVisible();
  const totals = page.getByTestId('lines-totals');
  await expect(totals).toContainText('ключей 1');
  await expect(totals.locator('[data-col="net"]').getByTestId('money')).toHaveAttribute('title', '100');
  await expect(totals.getByTestId('total-quantity')).toHaveText('1');
  await expect(page.getByTestId('source-line-0').getByRole('link', { name: isrc(1, 1, 1) })).toHaveAttribute('href', `/tracks/${isrc(1, 1, 1)}`);
  await expect(page.getByTestId('lines-range')).toContainText('1–1 из 1');
  await expect(page.getByTestId('action-page-next')).toBeDisabled();
});

test('the lines page resolves account&month from the overview link into the files', async ({ page }) => {
  await openAs(page, `/sources/lines?account=${account(1, 1)}&month=2026-03`);
  await expect(page.getByTestId('source-line-0')).toBeVisible();
  await expect(page.getByTestId('files-chosen')).toContainText('1');
  await expect(page.getByTestId('lines-totals').locator('[data-col="net"]').getByTestId('money')).toHaveAttribute('title', '100');
});

test('the lines page: a facet filter and the slow hint for many files', async ({ page }) => {
  await openAs(page, `/sources/lines?isrc=${isrc(1, 1, 1)}`);
  await page.getByTestId('field-lines-platform').click();
  await page.getByRole('option', { name: 'Spotify', exact: true }).click();
  await page.getByTestId('action-show-lines').click();
  await expect(page).toHaveURL(/platform=Spotify/);
  await expect(page.getByTestId('source-line-0')).toBeVisible();
  await openAs(page, '/sources/lines');
  await expect(page.getByTestId('files-chosen')).toBeVisible();
  await page.getByTestId('action-files-all').click();
  await expect(page.getByTestId('slow-hint')).toBeVisible();
  await page.getByTestId('action-files-none').click();
  await expect(page.getByTestId('slow-hint')).toHaveCount(0);
});
