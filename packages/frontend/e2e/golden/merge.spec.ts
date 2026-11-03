import { expect, test, type Page } from '@playwright/test';
import { account, apiPost, confirm, expectP1, openAs, pick, sc, settled, toastOk } from '../helpers';

// S33 (19 §4): merge the unconfirmed Owner Y-331 into the confirmed Owner X-331 from Y's card (P10 «Слить в другого
// владельца»); after it X earned 100 with pseudonyms A and B, Y is gone from P9 and its card says "объединён"; the
// second merge is refused 422 owner_merged; X's history shows the merge with the operator.

test.describe.configure({ mode: 'serial' });

const fact = (page: Page, name: string) => page.getByTestId(`balance-${name}`).getByTestId('money');
async function openOwner(page: Page, ownerId: string, tab = 'balance') {
  await openAs(page, `/owners/${ownerId}?tab=${tab}`);
  await settled(page);
}

test('S33 before: X earned 50 (A); Y earned 0, waiting 50 owner_unconfirmed (B); P1 200 / 50 / 50 / 100', async ({ page }) => {
  const k = sc(33);
  await openOwner(page, k.owners.X ?? '');
  await expect(fact(page, 'earned')).toHaveAttribute('title', '50');
  await expect(page.getByTestId('owner-pseudonyms')).toContainText('A-331');
  await expect(page.getByTestId('owner-pseudonyms')).not.toContainText('B-331');
  await openOwner(page, k.owners.Y ?? '');
  await expect(fact(page, 'earned')).toHaveAttribute('title', '0');
  await expect(fact(page, 'waiting')).toHaveAttribute('title', '50');
  const waiting = page.getByTestId('waiting-owner_unconfirmed');
  await expect(waiting.getByTestId('money')).toHaveAttribute('title', '50');
  await expect(waiting.getByRole('link')).toHaveAttribute('href', `/queue/owner_unconfirmed?ownerId=${k.owners.Y}`);
  await expect(page.getByTestId('owner-pseudonyms')).toContainText('B-331');
  await openAs(page, '/');
  await settled(page);
  await expectP1(page, account(33, 1), '2026-03', '200 / 50 / 50 / 100');
});

test('S33 merge Y into X through the dialog (from → into, pseudonyms, «необратимо») → the card of X', async ({ page, request }) => {
  const k = sc(33);
  const x = k.owners.X ?? '';
  const y = k.owners.Y ?? '';
  await openOwner(page, y);
  await page.getByTestId('action-merge').click();
  const dialog = page.getByTestId('form-dialog');
  await expect(dialog.getByTestId('action-merge-submit')).toBeDisabled();
  await pick(page, 'merge-into', 'Owner X-331');
  await dialog.getByTestId('field-merge-reason').fill('e2e: the same person');
  await dialog.getByTestId('action-merge-submit').click();
  const box = page.getByTestId('confirm-dialog');
  await expect(box).toContainText('Из: Owner Y-331');
  await expect(box).toContainText('В: Owner X-331');
  await expect(box).toContainText('Переходят псевдонимы: B-331');
  await expect(box).toContainText('необратимо');
  await confirm(page);
  await toastOk(page, 'Владелец слит в Owner X-331');
  await expect(page).toHaveURL(new RegExp(`/owners/${x}`));
  await settled(page);
  await expect(fact(page, 'earned')).toHaveAttribute('title', '100');
  await expect(fact(page, 'waiting')).toHaveAttribute('title', '0');
  await expect(page.getByTestId('owner-pseudonyms')).toContainText('A-331');
  await expect(page.getByTestId('owner-pseudonyms')).toContainText('B-331');
  const again = await apiPost(request, '/owners/merge', { fromId: y, intoId: x, reason: 'again' });
  expect([again.status, again.code]).toEqual([422, 'owner_merged']);
});

test('S33 after: Y says "объединён с X-331" and is gone from P9; X history has the merge by e2e-operator; P1 200 / 100 / 0 / 100', async ({ page }) => {
  const k = sc(33);
  const x = k.owners.X ?? '';
  const y = k.owners.Y ?? '';
  await openOwner(page, y);
  await expect(page.getByTestId('owner-merged')).toContainText('объединён с Owner X-331');
  await expect(page.getByTestId('action-merge')).toHaveCount(0);
  const grid = JSON.stringify({ f: { name: { filterType: 'text', type: 'contains', filter: '-331' } } });
  await openAs(page, `/owners?grid=${encodeURIComponent(grid)}`);
  await settled(page);
  await expect(page.getByTestId(`owner-${x}`)).toBeVisible();
  await expect(page.getByTestId(`owner-${y}`)).toHaveCount(0);
  await openOwner(page, x, 'history');
  const row = page.getByTestId('history-tab').locator('tr', { hasText: '/owners/merge' });
  await expect(row.locator('[data-col="operator"]')).toHaveText('e2e-operator');
  await openAs(page, '/');
  await settled(page);
  await expectP1(page, account(33, 1), '2026-03', '200 / 100 / 0 / 100');
});
