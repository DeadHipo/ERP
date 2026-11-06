import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// One command from the repo root: `npm run e2e`. The web server script seeds the private stores (erp_e2e,
// believe_e2e), builds the client and serves it with the API on :3100 (no Vite). See CLAUDE.md of this package.
// A private stand (CLAUDE.md, Tests): `E2E_BASE_URL=http://127.0.0.1:<port> E2E_KEYS=<keys file>` runs the specs against an API
// that was started by hand on stores seeded under another name; no web server and no teardown are started then.
const external = process.env.E2E_BASE_URL;
// the session of `e2e-operator` (D-170), written by e2e/global-setup.ts after the web server is up
const storageState = join(import.meta.dirname, '..', '..', 'data', 'test-tmp', 'e2e-state.json');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: external ? undefined : './e2e/teardown.ts',
  use: {
    baseURL: external ?? 'http://127.0.0.1:3100',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    storageState,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: external
    ? undefined
    : {
        command: 'bash scripts/e2e/start.sh',
        url: 'http://127.0.0.1:3100/api/v1/health',
        timeout: 300_000,
        reuseExistingServer: false,
      },
});
