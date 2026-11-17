import { expect, test } from '@playwright/test';
import { labelOf, openAs, overviewRow, sc, settled } from '../helpers';

// Publishing of the seed (19 §4 S18, S19, S31; D-234: the report summaries of v2, one file per quarter, loaded under
// 0to8, every holder linked to its owner by the seed; the old page P18 is gone). D-169 (R8): every B17 line sits in the
// book 0to8 (P1, P19, P10), never in «без лейбла».

test.describe.configure({ mode: 'serial' });

test('D-169 the B17 lines sit in the book of their statement (0to8): P1, P19, P10 W1 under «Все», 0to8 and Echo8', async ({ page }) => {
  // P1: the b17 rows of S19 (4Q25), S18 (1Q26) and S31 (2Q26) are in the book 0to8; the label table has no «без лейбла»
  await openAs(page, '/?label=');
  await settled(page);
  for (const month of ['2025-12', '2026-03', '2026-06']) {
    const row = overviewRow(page, 'b17', 'b17', month);
    await expect(row).toHaveAttribute('data-book', '0to8');
    await expect(row.getByTestId('book-0to8')).toBeVisible();
  }
  await expect(page.getByTestId('overview-label-0to8')).toBeVisible();
  await expect(page.getByTestId('overview-label-?')).toHaveCount(0);
  // P19: the report files carry the label 0to8 (one per quarter)
  await openAs(page, '/sources?label=');
  const statements = page.locator('[data-testid^="statement-"][row-id]').filter({ hasText: 'Publishing_Statement' });
  await expect(statements).toHaveCount(3);
  for (const label of await statements.getByTestId('statement-label').allTextContents()) expect(label).toBe('0to8');
  // P10 W1 (publishing only: its row T-A of 100 at its term 50 %, earned 50): under «Все» one book, 0to8, and no «?»
  const owner = sc(18).owners.W1 ?? '';
  const fact = (name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
  await openAs(page, `/owners/${owner}?tab=balance&label=`);
  await settled(page);
  await expect(fact('earned')).toHaveAttribute('title', '50');
  await expect(page.getByTestId('by-label-0to8').locator('[data-col="earned"]').getByTestId('money')).toHaveAttribute('title', '50');
  await expect(page.getByTestId('by-label-?')).toHaveCount(0);
  // under 0to8 the publishing is the book of the label: earned 50, the one line T-A on the Паблишинг tab
  await openAs(page, `/owners/${owner}?tab=balance&label=${labelOf('0to8')}`);
  await settled(page);
  await expect(fact('earned')).toHaveAttribute('title', '50');
  await expect(fact('payable')).toHaveAttribute('title', '50');
  await page.getByTestId('tab-publishing').click();
  await expect(page.getByTestId('publishing-line')).toHaveCount(1);
  // under Echo8 nothing: no statement of Echo8
  await openAs(page, `/owners/${owner}?tab=balance&label=${labelOf('Echo8')}`);
  await settled(page);
  await expect(fact('earned')).toHaveAttribute('title', '0');
  await page.getByTestId('tab-publishing').click();
  await expect(page.getByTestId('publishing-line')).toHaveCount(0);
});
