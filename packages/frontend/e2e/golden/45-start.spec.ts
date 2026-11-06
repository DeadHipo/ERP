import { expect, test, type Page } from '@playwright/test';
import { apiPost, expectOwner, labelOf, openAs, toastOk } from '../helpers';

// S55 (19 §4, D-174): the opening balances P30 under 0to8 with a synthetic owner of its own (no income). The preview
// classifies the rows (an unknown pseudonym: an error → the apply is closed); the corrected file creates one start row;
// P10 shows the start as the balance; the row is deactivated with a reason and listed among the inactive. Nothing
// seeded changes.

test.describe.configure({ mode: 'serial' });

const HEADER = 'pseudonym;kind;master;publishing;missing;basis;document;operation_ref;comment';
const PSEUDONYM = 'S55 Start e2e';
let ownerId = '';
let artistId = '';

const csv = (lines: string[]) => ({ name: 'start-s55.csv', mimeType: 'text/csv', buffer: Buffer.from(`${[HEADER, ...lines].join('\n')}\n`) });
const good = () => [`${PSEUDONYM};start;12.5;0;;;;;e2e`];
const totals = (page: Page, col: string) => page.getByTestId('start-import-totals').locator(`[data-col="${col}"] dd`);

async function fillCut(page: Page) {
  await page.getByTestId('field-start-cutoff').fill('2026-06');
  await page.getByTestId('field-start-synced-at').fill('2026-07-01T00:00:00Z');
  await page.getByTestId('field-start-basis').fill('e2e snapshot');
}

async function preview(page: Page, file: ReturnType<typeof csv>) {
  await page.getByTestId('field-start-import-file').setInputFiles(file);
  await expect(page.getByTestId('start-import-upload-chosen')).toHaveText('start-s55.csv');
  const answered = page.waitForResponse((r) => r.url().includes('/settlements/start/import') && r.url().includes('dryRun=1'));
  await page.getByTestId('action-start-import-preview').click();
  expect((await answered).status()).toBe(200);
  await expect(page.getByTestId('start-import-preview')).toBeVisible();
}

test('S55 under «Все» the import is closed, the list shows every book; the sidebar leads to P30', async ({ page, request }) => {
  const owner = await apiPost(request, '/owners', { name: 'Owner S55 e2e', kind: 'person', force: true });
  expect(owner.status).toBe(201);
  ownerId = (owner.body as { id: string }).id;
  const artist = await apiPost(request, '/artists', { pseudonym: PSEUDONYM, ownerId, force: true });
  expect(artist.status).toBe(201);
  artistId = (artist.body as { id: string }).id;
  await openAs(page, '/operations?label=');
  await page.getByTestId('nav-start').click();
  await expect(page).toHaveURL(/\/operations\/start/);
  await expect(page.getByTestId('start-page')).toBeVisible();
  await expect(page.getByTestId('upload-closed-reason')).toBeVisible();
  await expect(page.getByTestId('action-start-import-preview')).toBeDisabled();
});

test('S55 preview of a file with an unknown pseudonym: the class on its row, the apply closed with the reason', async ({ page }) => {
  await openAs(page, `/operations/start?label=${labelOf('0to8')}`);
  await expect(page.getByTestId('start-import-label')).toHaveAttribute('data-label-id', labelOf('0to8'));
  await fillCut(page);
  await preview(page, csv([...good(), 'Nobody S55 e2e;start;1;0;;;;;e2e']));
  await expect(totals(page, 'rows')).toHaveAttribute('data-value', '2');
  await expect(totals(page, 'create')).toHaveAttribute('data-value', '1');
  await expect(totals(page, 'errors')).toHaveAttribute('data-value', '1');
  await expect(page.getByTestId('import-row-2')).toHaveAttribute('data-action', 'create');
  await expect(page.getByTestId('import-row-3')).toHaveAttribute('data-action', 'error');
  await expect(page.getByTestId('import-row-3').getByTestId('issue-pseudonym_not_found')).toHaveAttribute('data-severity', 'error');
  await expect(page.getByTestId('action-start-import-apply')).toBeDisabled();
  await expect(page.getByTestId('import-blocked-reason')).toBeVisible();
});

test('S55 the corrected file creates the start; P10 shows it as the balance; the same file again is «уже есть»', async ({ page }) => {
  await openAs(page, `/operations/start?label=${labelOf('0to8')}`);
  await fillCut(page);
  await preview(page, csv(good()));
  await expect(totals(page, 'create')).toHaveAttribute('data-value', '1');
  await expect(totals(page, 'starts')).toHaveAttribute('data-value', '1');
  const applied = page.waitForResponse((r) => r.url().includes('/settlements/start/import') && r.url().includes('dryRun=0'));
  await page.getByTestId('action-start-import-apply').click();
  const res = await applied;
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { applied: boolean; result: { ids: string[] } };
  expect([body.applied, body.result.ids.length]).toEqual([true, 1]);
  await toastOk(page, 'Старт применён: строк 1');
  await expect(page.getByTestId('start-import-result')).toBeVisible();
  // the list of the book: one active start row of the pseudonym
  const row = page.getByTestId(`start-row-${body.result.ids[0] as string}`);
  await expect(row).toHaveAttribute('data-kind', 'start');
  await expect(row).toHaveAttribute('data-artist-id', artistId);
  await expect(page.getByTestId('start-totals').locator('[data-col="starts"] dd')).toHaveAttribute('data-value', '1');
  // the repeat: the row is already there
  await fillCut(page);
  await preview(page, csv(good()));
  await expect(totals(page, 'unchanged')).toHaveAttribute('data-value', '1');
  await expect(page.getByTestId('import-row-2').getByTestId('issue-unchanged')).toHaveAttribute('data-severity', 'info');
  await expect(page.getByTestId('action-start-import-apply')).toBeDisabled();
  // P10: the start is the balance (no income, no operations); the cut of the book is shown
  await expectOwner(page, ownerId, { start: '12.5', earned: '0', payable: '12.5' });
  await expect(page.getByTestId('start-cut-0to8')).toHaveAttribute('data-cutoff', '2026-06');
  await expect(page.getByTestId('start-rows').getByTestId(`start-row-${body.result.ids[0] as string}`)).toBeVisible();
  await expect(page.getByTestId('by-label-0to8').locator('[data-col="start"]').getByTestId('money')).toHaveAttribute('title', '12.5');
});

test('S55 a row is deactivated with a reason: it leaves the active list and shows among the inactive; P10 drops the start', async ({ page }) => {
  await openAs(page, `/operations/start?label=${labelOf('0to8')}`);
  const row = page.locator(`[data-testid^="start-row-"][data-artist-id="${artistId}"]`).first();
  await expect(row).toBeVisible();
  const id = ((await row.getAttribute('data-testid')) ?? '').replace('start-row-', '');
  await page.getByTestId(`action-start-deactivate-${id}`).click();
  await expect(page.getByTestId('start-deactivate-row')).toContainText(PSEUDONYM);
  await page.getByTestId('field-start-deactivate-reason').fill('e2e rollback');
  const answered = page.waitForResponse((r) => r.url().includes(`/settlements/start/${id}/deactivate`));
  await page.getByTestId('action-start-deactivate-submit').click();
  expect((await answered).status()).toBe(200);
  await toastOk(page, 'Строка старта отключена');
  await expect(page.getByTestId(`start-row-${id}`)).toHaveCount(0);
  await page.getByTestId('field-start-show-inactive').check();
  await expect(page.getByTestId(`start-row-${id}`)).toHaveAttribute('data-active', 'false');
  await expectOwner(page, ownerId, { earned: '0', payable: '0' });
  await expect(page.getByTestId('balance-start')).toHaveCount(0);
});
