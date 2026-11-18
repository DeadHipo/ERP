import { expect, test } from '@playwright/test';
import { apiPost, isrc, openAs, toastOk } from '../helpers';

// S59 (D-238): the metadata of a recording on P6 «Мета». The S01 k2 track gets its title with the version, the
// duration and the explicit mark; the header shows the version; a platform entry is added, changed and removed; the
// same entry twice is 409 platform_taken. The money never reads it: nothing seeded changes.

test.describe.configure({ mode: 'serial' });

const I = isrc(1, 2, 1);

test('S59 the metadata: set from the tab, the version in the header', async ({ page }) => {
  await openAs(page, `/tracks/${I}?tab=meta`);
  await expect(page.getByTestId('track-meta')).toContainText('Мета ещё не заполнена');
  await page.getByTestId('action-edit-meta').click();
  await page.getByTestId('field-meta-title').fill('S59 Song - Slowed');
  await page.getByTestId('field-meta-version').fill('Slowed');
  await page.getByTestId('field-meta-duration').fill('2:34');
  await page.getByTestId('action-meta-submit').click();
  await toastOk(page, 'Мета сохранена');
  await expect(page.getByTestId('meta-title')).toContainText('S59 Song - Slowed');
  await expect(page.getByTestId('meta-duration')).toContainText('2:34');
  await expect(page.getByTestId('track-version')).toHaveText('· Slowed');
  // a bad duration closes «Сохранить»
  await page.getByTestId('action-edit-meta').click();
  await page.getByTestId('field-meta-duration').fill('2:99');
  await expect(page.getByTestId('action-meta-submit')).toBeDisabled();
});

test('S59 a platform entry: added, the same twice is 409, changed, removed', async ({ page }) => {
  await openAs(page, `/tracks/${I}?tab=meta`);
  await page.getByTestId('action-add-platform').click();
  await page.getByTestId('field-platform-id').fill('s59-sp');
  await page.getByTestId('field-platform-url').fill('https://open.spotify.com/track/s59');
  await page.getByTestId('field-platform-duration').fill('2:34');
  await page.getByTestId('action-platform-submit').click();
  await toastOk(page, 'Площадка добавлена');
  const row = page.locator('[data-testid^="platform-"][data-platform="spotify"]');
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-col="duration"]')).toHaveText('2:34');
  const dup = await apiPost(page.request, `/tracks/${I}/platforms`, { platform: 'spotify', platformId: 's59-sp' });
  expect([dup.status, dup.code]).toEqual([409, 'platform_taken']);
  const id = ((await row.getAttribute('data-testid')) ?? '').replace('platform-', '');
  await page.getByTestId(`action-edit-platform-${id}`).click();
  await page.getByTestId('field-platform-title').fill('S59 Song - Slowed');
  await page.getByTestId('action-platform-submit').click();
  await toastOk(page, 'Площадка сохранена');
  await expect(row.locator('[data-col="title"]')).toHaveText('S59 Song - Slowed');
  await page.getByTestId(`action-remove-platform-${id}`).click();
  await page.getByTestId('confirm-dialog').getByTestId('confirm-dialog-ok').click();
  await toastOk(page, 'Запись площадки удалена');
  await expect(row).toHaveCount(0);
});
