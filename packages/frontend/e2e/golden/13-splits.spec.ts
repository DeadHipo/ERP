import { expect, test } from '@playwright/test';
import { isrc, openAs, sc } from '../helpers';

// P15 «Сплиты» / P16 «Участия» (17 §3): server paging in the URL with `total`, the isrc / artist / status filters,
// the rows with their document status. Reads only: every scenario's actions belong to the queue / rules specs; this
// file runs before 20-queue (19 §6), so the S12 split is still unconfirmed here.

test('P15 the S01 split row: period, shares, document status, our share', async ({ page }) => {
  const k = sc(1);
  const id = k.splits[isrc(1, 1, 1)]?.[0] ?? '';
  await openAs(page, `/splits?isrc=${isrc(1, 1, 1)}`);
  await expect(page.getByTestId('splits-page')).toBeVisible();
  const row = page.getByTestId(`split-${id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('A-011 50 %');
  await expect(row.getByTestId('chip-approved')).toBeVisible();
  await expect(row.locator('[data-col="ourShare"]').getByTestId('money')).toHaveAttribute('title', '50');
  await expect(page.getByTestId('splits-total')).toContainText('Всего сплитов: 1');
  await expect(row.getByRole('link', { name: isrc(1, 1, 1) })).toBeVisible();
});

test('P15 the artist filter keeps only the rows of that pseudonym', async ({ page }) => {
  const k = sc(1);
  await openAs(page, `/splits?artistId=${k.artists.A}`);
  await expect(page.getByTestId(`split-${k.splits[isrc(1, 1, 1)]?.[0]}`)).toBeVisible();
  await expect(page.getByTestId('splits-total')).toContainText('Всего сплитов: 1');
});

test('P15 server paging: limit and offset in the URL, the range follows the total', async ({ page, request }) => {
  const all = (await (await request.get('/api/v1/splits?limit=5000')).json()) as { total: number; items: unknown[] };
  expect(all.total).toBeGreaterThan(5);
  await openAs(page, '/splits?limit=50');
  await expect(page.getByTestId('splits-total')).toContainText(`Всего сплитов: ${all.total}`);
  await expect(page.getByTestId('page-range')).toContainText('Показано: 1–50');
  await expect(page.getByTestId('action-page-prev')).toBeDisabled();
  if (all.total > 50) {
    await page.getByTestId('action-page-next').click();
    await expect(page).toHaveURL(/offset=50/);
    await expect(page.getByTestId('page-range')).toContainText('Показано: 51–');
  } else {
    await expect(page.getByTestId('action-page-next')).toBeDisabled();
  }
});

test('P15 the unconfirmed filter lists only rows without an approved document (S12 is listed: 20-queue confirms it later)', async ({ page, request }) => {
  const un = (await (await request.get('/api/v1/splits?status=unconfirmed&limit=5000')).json()) as { total: number };
  expect(un.total).toBeGreaterThan(0);
  await openAs(page, '/splits?status=unconfirmed&limit=500');
  await expect(page.getByTestId('splits-total')).toContainText(`Всего сплитов: ${un.total}`);
  await expect(page.locator('[data-testid^="split-"][row-id] [data-testid="chip-approved"]')).toHaveCount(0);
  await expect(page.getByTestId(`split-${sc(12).splits[isrc(12, 1, 1)]?.[0]}`)).toHaveCount(1);
});

test('P16 the participations list: base, funding, period, document status', async ({ page }) => {
  const k = sc(32);
  await openAs(page, `/participations?isrc=${isrc(32, 1, 1)}`);
  await expect(page.getByTestId('participations-page')).toBeVisible();
  const row = page.getByTestId(`participation-${k.participations.P}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('P-321');
  await expect(row).toContainText('10');
  await expect(page.getByTestId('participations-total')).toContainText('Всего участий: 1');
  await expect(row.getByTestId('action-close-participation')).toBeVisible();
});
