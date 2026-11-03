import { expect, test } from '@playwright/test';
import { OPEN_QUESTIONS } from '@erp/shared/open-questions';
import { openAs, trackErrors } from '../helpers';

// P3 «Решения руководителя»: the 14 open items of 15 §3 with their decision ids; each link opens its page.

test('the 14 items with their ⚠ decision ids, each link navigates', async ({ page }) => {
  const errors = trackErrors(page);
  await openAs(page, '/questions');
  await expect(page.locator('[data-testid^="question-15.3."]')).toHaveCount(14);
  await expect(page.getByTestId('question-15.3.1').getByTestId('decision-D-083')).toHaveText('⚠ D-083');
  await expect(page.getByTestId('question-15.3.8').locator('[data-testid^="decision-"]')).toHaveCount(4);
  for (const q of OPEN_QUESTIONS) {
    await page.goto('/questions');
    await page.getByTestId(`question-${q.id}`).getByTestId('question-link').click();
    const [path, query] = q.link.split('?');
    await expect(page, q.id).toHaveURL(new RegExp(`${path?.replace(/\//g, '\\/')}${query ? `\\?${query}` : ''}$`));
    await expect(page.getByTestId('not-found'), q.id).toHaveCount(0);
  }
  expect(errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
});
