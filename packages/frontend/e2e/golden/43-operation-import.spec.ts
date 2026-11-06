import { expect, test, type Page } from '@playwright/test';
import { apiPost, labelOf, openAs, toastOk } from '../helpers';

// S53 (19 §4, D-173 §1.5): the operation import P29 under 0to8 with a synthetic cash file. The preview classifies the rows
// (a payout without external_id, a return, an unknown owner: errors → the apply is closed); the corrected file creates
// two migrated payouts; the same file again is «уже есть» row by row (nothing to apply). The owner is created here (its
// own data, no income): nothing seeded changes.

test.describe.configure({ mode: 'serial' });

const HEADER = 'owner,pseudonym,date,amount,kind,channel,confirmation,document,external_id,scope,comment';
let ownerId = '';

const csv = (lines: string[]) => ({ name: 'cash-s53.csv', mimeType: 'text/csv', buffer: Buffer.from(`${[HEADER, ...lines].join('\n')}\n`) });
const good = () => [
  `${ownerId},,2026-04-01,10.00,payout,bank,,,CASH-531-1,,e2e`,
  `${ownerId},,2026-04-15,2.50,payout,bank,,,CASH-531-2,,e2e`,
];
const totals = (page: Page, col: string) => page.getByTestId('operation-import-totals').locator(`[data-col="${col}"] dd`);

async function preview(page: Page, file: ReturnType<typeof csv>) {
  await page.getByTestId('field-operation-import-file').setInputFiles(file);
  await expect(page.getByTestId('operation-import-upload-chosen')).toHaveText('cash-s53.csv');
  const answered = page.waitForResponse((r) => r.url().includes('/settlements/operations/import') && r.url().includes('dryRun=1'));
  await page.getByTestId('action-operation-import-preview').click();
  expect((await answered).status()).toBe(200);
  await expect(page.getByTestId('operation-import-preview')).toBeVisible();
}

test('S53 under «Все» the import is closed; P20 leads to P29', async ({ page, request }) => {
  const owner = await apiPost(request, '/owners', { name: 'Owner S53 e2e', kind: 'person', force: true });
  expect(owner.status).toBe(201);
  ownerId = (owner.body as { id: string }).id;
  await openAs(page, '/operations?label=');
  await page.getByTestId('action-import-operations').click();
  await expect(page).toHaveURL(/\/operations\/import/);
  await expect(page.getByTestId('upload-closed-reason')).toBeVisible();
  await expect(page.getByTestId('action-operation-import-preview')).toBeDisabled();
});

test('S53 preview of a file with errors: the classes per row, the apply closed with the reason', async ({ page }) => {
  await openAs(page, `/operations/import?label=${labelOf('0to8')}`);
  await expect(page.getByTestId('operation-import-label')).toHaveAttribute('data-label-id', labelOf('0to8'));
  await preview(
    page,
    csv([...good().slice(0, 1), `${ownerId},,2026-04-02,3.00,payout,bank,,,,,e2e`, `${ownerId},,2026-04-03,1.00,return,,,,X-1,,e2e`, `Nobody S53 e2e,,2026-04-04,1.00,payout,,,,CASH-531-9,,e2e`]),
  );
  await expect(totals(page, 'rows')).toHaveAttribute('data-value', '4');
  await expect(totals(page, 'create')).toHaveAttribute('data-value', '1');
  await expect(page.getByTestId('import-row-2')).toHaveAttribute('data-action', 'create');
  await expect(page.getByTestId('import-row-3')).toHaveAttribute('data-action', 'error');
  await expect(page.getByTestId('import-row-3').getByTestId('issue-external_ref_required')).toHaveAttribute('data-severity', 'error');
  await expect(page.getByTestId('import-row-4').getByTestId('issue-kind_not_importable')).toBeVisible();
  await expect(page.getByTestId('import-row-5').getByTestId('issue-owner_not_found')).toBeVisible();
  await expect(page.getByTestId('action-operation-import-apply')).toBeDisabled();
  await expect(page.getByTestId('import-blocked-reason')).toBeVisible();
});

test('S53 the corrected file: two payouts created (migrated, counted); the same file again is «уже есть»', async ({ page }) => {
  await openAs(page, `/operations/import?label=${labelOf('0to8')}`);
  await preview(page, csv(good()));
  await expect(totals(page, 'create')).toHaveAttribute('data-value', '2');
  await expect(totals(page, 'errors')).toHaveAttribute('data-value', '0');
  const applied = page.waitForResponse((r) => r.url().includes('/settlements/operations/import') && r.url().includes('dryRun=0'));
  await page.getByTestId('action-operation-import-apply').click();
  const res = await applied;
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { applied: boolean; result: { operationIds: string[] } };
  expect([body.applied, body.result.operationIds.length]).toEqual([true, 2]);
  await toastOk(page, 'Импорт применён: операций 2');
  await expect(page.getByTestId('operation-import-result')).toBeVisible();
  // the repeat: every row is already an active operation
  await preview(page, csv(good()));
  await expect(totals(page, 'unchanged')).toHaveAttribute('data-value', '2');
  await expect(totals(page, 'create')).toHaveAttribute('data-value', '0');
  await expect(page.getByTestId('import-row-2')).toHaveAttribute('data-action', 'unchanged');
  await expect(page.getByTestId('import-row-2').getByTestId('issue-unchanged')).toHaveAttribute('data-severity', 'info');
  await expect(page.getByTestId('action-operation-import-apply')).toBeDisabled();
  await expect(page.getByTestId('action-operation-import-apply').locator('..')).toContainText('применять нечего');
  // P20: the two payouts of the owner, migrated (counted at once): paid 12.50
  await openAs(page, `/operations?ownerId=${ownerId}&kind=payout&label=${labelOf('0to8')}`);
  await expect(page.locator('[data-testid^="operation-"][row-id]')).toHaveCount(2);
  await openAs(page, `/owners/${ownerId}?tab=balance&label=${labelOf('0to8')}`);
  await expect(page.getByTestId('balance-paid').getByTestId('money')).toHaveAttribute('title', '12.5');
});
