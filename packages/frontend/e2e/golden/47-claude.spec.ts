import { expect, test } from '@playwright/test';

// 47-claude «Подключить Claude» (D-179, D-180): the remote address and a placeholder instead of the token.

test('the page gives the remote connection, with a placeholder instead of the token', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-claude').click();
  await expect(page).toHaveURL(/\/claude$/);
  await expect(page.getByTestId('claude-url')).toContainText('/api/mcp');
  await expect(page.getByTestId('claude-code-command')).toContainText('--transport http');
  await expect(page.getByTestId('claude-code-command')).toContainText('Bearer ТОКЕН');
  await expect(page.getByTestId('claude-header')).toHaveText('Authorization: Bearer ТОКЕН');
});
