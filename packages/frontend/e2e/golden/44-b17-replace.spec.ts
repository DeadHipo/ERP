import { expect, test, type Page } from '@playwright/test';
import { choose, labelOf, openAs, seedKeys } from '../helpers';

// S54 (19 §4, D-173 §1.6): «Заменить» of a loaded B17 statement on P19. The e2e seed has one statement and no reusable
// xlsx writer for the frontend specs (the seed writes its workbook inside `lib.ts loadB17`), so the replacement itself
// (superseded + replacedBy, the lines kept, the quarters moved, the three 409 codes) is covered by
// `packages/backend/tests/b17-replace.test.ts`; here: the action on the seeded statement, the dialog closed under «Все»,
// and a file that is not a statement refused with nothing changed (the statement stays loaded, no «заменена» link).

test.describe.configure({ mode: 'serial' });

const seeded = (page: Page) => page.locator('[data-testid^="statement-"][row-id]').filter({ hasText: seedKeys().b17FileName });

test('S54 the seeded statement is loaded with «Заменить»; under «Все» the replacement upload is closed', async ({ page }) => {
  await openAs(page, `/sources?label=&q=${encodeURIComponent(seedKeys().b17FileName)}`);
  const row = seeded(page);
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('chip-loaded')).toBeVisible();
  await expect(row.locator('[data-testid^="statement-replaced-by-"]')).toHaveCount(0);
  await row.locator('[data-testid^="action-replace-statement-"]').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('replace-statement-note')).toContainText('Кварталы нового файла должны совпасть');
  await dialog.getByTestId('field-replace-statement-file').setInputFiles({ name: 'corrected.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(dialog.getByTestId('action-replace-statement-submit')).toBeDisabled();
  await expect(dialog.getByTestId('action-replace-statement-submit').locator('..')).toContainText('выберите лейбл');
});

test('S54 under 0to8 a file that is not a statement is refused; the statement stays loaded', async ({ page }) => {
  await openAs(page, `/sources?q=${encodeURIComponent(seedKeys().b17FileName)}`);
  await choose(page, 'label', '0to8');
  await expect(page.getByTestId('label-switch')).toHaveAttribute('data-label', labelOf('0to8'));
  const row = seeded(page);
  const id = ((await row.getAttribute('data-testid')) ?? '').replace('statement-', '');
  await row.getByTestId(`action-replace-statement-${id}`).click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('replace-statement-of')).toHaveAttribute('data-statement-id', id);
  await dialog.getByTestId('field-replace-statement-file').setInputFiles({ name: 'corrected.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a workbook') });
  const answered = page.waitForResponse((r) => r.url().includes(`/publishing/statements/${id}/replace`));
  await dialog.getByTestId('action-replace-statement-submit').click();
  expect((await answered).status()).toBeGreaterThanOrEqual(400);
  await expect(page.locator('[data-testid="toast"]:not([data-code="ok"])').first()).toBeVisible();
  await page.getByTestId('form-dialog-close').click();
  await expect(seeded(page).getByTestId('chip-loaded')).toBeVisible();
  await expect(seeded(page).locator('[data-testid^="statement-replaced-by-"]')).toHaveCount(0);
});
