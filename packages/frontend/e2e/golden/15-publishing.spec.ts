import { expect, test } from '@playwright/test';
import { openAs, pick, sc, settled, toastOk } from '../helpers';

// P18 «Паблишинг» (19 §4 S18, S19): the writers table with their resolution, «Повторить сопоставление», and the terms of an
// owner by operation type. This file runs before 20-queue (19 §6: the file order), which maps the S19 holder: the
// writer is ambiguous here. The terms are added to an S18 owner for a type the statement does not use (a shared-data
// mutation listed in 19 §1), so no S18 number moves.

test.describe.configure({ mode: 'serial' });

test('P18 the S19 holder is listed as ambiguous with the map action', async ({ page }) => {
  await openAs(page, '/publishing');
  await expect(page.getByTestId('publishing-page')).toBeVisible();
  const row = page.locator('[data-testid^="writer-"][row-id]').filter({ hasText: sc(19).extra.holder ?? '' });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('resolution-ambiguous')).toHaveCount(1);
  await expect(row.getByTestId('action-map-writer')).toBeVisible();
});

test('P18 «Повторить сопоставление» answers with the counts', async ({ page }) => {
  await openAs(page, '/publishing');
  await page.getByTestId('action-resolve-writers').click();
  await toastOk(page, /Сопоставлено \d+, создано \d+, неоднозначных \d+, внешних \d+/);
  // the ambiguous holder stays ambiguous: the retry never invents a choice
  const row = page.locator('[data-testid^="writer-"][row-id]').filter({ hasText: sc(19).extra.holder ?? '' });
  await expect(row.getByTestId('resolution-ambiguous')).toBeVisible();
});

test('P18 the map dialog opens for a writer and offers an existing owner or a new one', async ({ page }) => {
  await openAs(page, '/publishing');
  const row = page.locator('[data-testid^="writer-"][row-id]').filter({ hasText: sc(19).extra.holder ?? '' });
  await row.getByTestId('action-map-writer').click();
  await expect(page.getByTestId('form-dialog')).toContainText(sc(19).extra.holder ?? '');
  await expect(page.getByTestId('field-writer-owner')).toBeVisible();
  await page.getByTestId('form-dialog-close').click();
});

test('P18 terms: a typed term of an S18 owner appears; the same start date again is 409 terms_overlap', async ({ page }) => {
  const owner = sc(18).owners.W1 ?? '';
  await openAs(page, '/publishing');
  await pick(page, 'terms-owner-pick', 'Owner W1-181');
  const list = page.getByTestId('terms-list');
  await expect(list).toBeVisible();
  await expect(list.locator('[data-col="percent"]').first()).toHaveText('50');
  const add = async () => {
    await page.getByTestId('action-set-terms').click();
    await page.getByTestId('field-terms-percent').fill('20');
    await page.getByTestId('field-terms-from').fill('2021-01-01');
    await page.getByTestId('field-terms-operation').fill('Print');
    await page.getByTestId('action-terms-submit').click();
  };
  await add();
  await toastOk(page, 'Условия паблишинга 20 % с 2021-01-01');
  await expect(list.locator('[data-col="operationType"]').filter({ hasText: 'Print' })).toHaveCount(1);
  await settled(page);
  await add();
  await expect(page.locator('[data-testid="toast"][data-code="terms_overlap"]').first()).toBeVisible();
  await page.getByTestId('form-dialog-close').click();
  // the owner card agrees
  await openAs(page, `/owners/${owner}?tab=publishing`);
  await expect(page.getByText('Print').first()).toBeVisible();
});
