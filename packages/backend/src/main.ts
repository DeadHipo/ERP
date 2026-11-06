import { join, resolve } from 'node:path';
import { openFacade } from './facade';
import { createApp } from './api/app';
import { connectStores, resolveOrg, sourcesFor } from './connect-sources';

const root = resolve(import.meta.dirname, '..', '..', '..');
// Data directory: first CLI argument, ERP_DATA_DIR, or <repo>/data.
const dataDir = resolve(process.argv[2] ?? process.env.ERP_DATA_DIR ?? join(root, 'data'));
const port = Number(process.env.PORT ?? 3000);
const threshold = Number(process.env.PAYOUT_THRESHOLD_CENTS ?? 10000);

// The modules in PostgreSQL; the Believe sources: file registry in PostgreSQL, report lines in ClickHouse
// (settings from <repo>/.env). The data directory keeps only the original files and temporary uploads (D-121).
const stores = connectStores();
const closeSources = () => stores.close();

// Every request works in one organization until the login (D-170): ERP_DEFAULT_ORG, which must exist.
const found = await resolveOrg(stores, [process.env.ERP_DEFAULT_ORG]);
if (!found.ok) {
  console.error(`ERP_DEFAULT_ORG is required. ${found.message}`);
  await closeSources();
  process.exit(1);
}
const orgId = found.org.id;
const sources = sourcesFor(stores, orgId, dataDir);

const facade = openFacade({ db: stores.db, orgId, dataDir, payoutThresholdCents: threshold, sources });
const app = createApp(facade, {
  tmpDir: join(dataDir, 'tmp'),
  clientDist: join(root, 'packages', 'frontend', 'dist'),
});

const server = app.listen(port, () =>
  console.log(`ERP API on http://localhost:${port}/api/v1 (data: ${dataDir}, organization: ${found.org.name})`),
);

// server.close() alone waits for keep-alive sockets (Vite proxy, browser) and in-flight requests, so tsx watch had to
// force-kill every restart: drop the sockets, give the stores 2 s to close, and exit at once on a second signal.
let stopping = false;
function shutdown() {
  if (stopping) process.exit(1);
  stopping = true;
  setTimeout(() => process.exit(1), 2000).unref();
  server.close(() => {
    void closeSources().finally(() => process.exit(0));
  });
  server.closeAllConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
