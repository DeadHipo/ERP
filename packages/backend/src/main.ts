import { join, resolve } from 'node:path';
import { createServerApp } from './api/server-app';
import { authConfigFromEnv, type AuthConfig } from './auth/middleware';
import { createAuthService } from './auth/service';
import { dummyHash } from './auth/password';
import { connectStores, resolveOrg } from './connect-sources';
import { createOrgFacades } from './orgs/facades';

const root = resolve(import.meta.dirname, '..', '..', '..');
// Data directory: first CLI argument, ERP_DATA_DIR, or <repo>/data.
const dataDir = resolve(process.argv[2] ?? process.env.ERP_DATA_DIR ?? join(root, 'data'));
const port = Number(process.env.PORT ?? 3000);
// D-175: the owner's default threshold is $50 (before: $100)
const threshold = Number(process.env.PAYOUT_THRESHOLD_CENTS ?? 5000);

// The modules in PostgreSQL; the Believe sources: file registry in PostgreSQL, report lines in ClickHouse
// (settings from <repo>/.env). The data directory keeps only the original files and temporary uploads (D-121).
const stores = connectStores();

// The login (D-170): AUTH_MODE=on by default (AUTH_SECRET of at least 32 bytes required); off only explicitly, and then
// every request works in ERP_DEFAULT_ORG, which must exist. SYSTEM_ADMIN_KEY is optional.
let config: AuthConfig;
try {
  config = authConfigFromEnv();
} catch (e) {
  console.error((e as Error).message);
  await stores.close();
  process.exit(1);
}
let modeNote = 'login on';
if (config.mode === 'off') {
  const found = await resolveOrg(stores, [config.defaultOrg]);
  if (!found.ok) {
    console.error(`AUTH_MODE=off needs ERP_DEFAULT_ORG. ${found.message}`);
    await stores.close();
    process.exit(1);
  }
  modeNote = `login off, organization: ${found.org.name}`;
}

// the dummy hash of an unknown login is computed now, not on the first login (its time would tell the login is unknown)
void dummyHash();

const orgs = createOrgFacades({ stores, dataDir, payoutThresholdCents: threshold });
const app = createServerApp({
  orgs,
  auth: { service: createAuthService(stores.db), config },
  clientDist: join(root, 'packages', 'frontend', 'dist'),
});

const server = app.listen(port, () =>
  console.log(`ERP API on http://localhost:${port}/api/v1 (data: ${dataDir}, ${modeNote})`),
);

// server.close() alone waits for keep-alive sockets (Vite proxy, browser) and in-flight requests, so tsx watch had to
// force-kill every restart: drop the sockets, give the stores 2 s to close, and exit at once on a second signal.
let stopping = false;
function shutdown() {
  if (stopping) process.exit(1);
  stopping = true;
  setTimeout(() => process.exit(1), 2000).unref();
  server.close(() => {
    void orgs.close().finally(() => process.exit(0));
  });
  server.closeAllConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
