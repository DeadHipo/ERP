import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { request, type FullConfig } from '@playwright/test';
import { STORAGE_STATE, seedUsers } from './helpers';

// The login is on (D-170): sign in once as `e2e-operator` and keep the session cookie in `storageState`; every spec's
// `page` and `request` fixture take it (playwright.config.ts `use.storageState`), so `openAs` and `apiPost` stay as they
// were. Specs that need another user (36-orgs) open their own contexts. Runs after the web server is up.
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('e2e: no baseURL');
  const { login, password } = seedUsers().operator;
  const context = await request.newContext({ baseURL });
  const res = await context.post('/api/v1/auth/login', { data: { login, password } });
  if (!res.ok()) throw new Error(`e2e: the login of ${login} failed: ${res.status()} ${await res.text()}`);
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  await context.storageState({ path: STORAGE_STATE });
  await context.dispose();
}
