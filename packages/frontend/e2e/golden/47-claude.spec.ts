import { expect, test } from '@playwright/test';

// 47-claude «Подключить Claude» (D-179): the instruction names the address the page is open on and never the token.

test('the page gives the commands for this address, with a placeholder instead of the token', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.getByTestId('nav-claude').click();
  await expect(page).toHaveURL(/\/claude$/);
  const command = page.getByTestId('claude-code-command');
  await expect(command).toContainText(`${baseURL}/api/v1`);
  await expect(command).toContainText('Bearer ТОКЕН');
  const config = await page.getByTestId('claude-desktop-config').textContent();
  expect(JSON.parse(config ?? '')).toHaveProperty('mcpServers.erp.command', 'npx');
  await expect(page.getByTestId('claude-insecure')).toHaveCount(0);
});
