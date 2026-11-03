import { defineConfig, devices } from '@playwright/test';

// One command from the repo root: `npm run e2e`. The web server script seeds the private stores (erp_e2e,
// believe_e2e), builds the client and serves it with the API on :3100 (no Vite). See CLAUDE.md of this package.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  globalTeardown: './e2e/teardown.ts',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bash scripts/e2e/start.sh',
    url: 'http://127.0.0.1:3100/api/v1/health',
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
