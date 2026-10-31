import { join, resolve } from 'node:path';
import { openFacade } from './facade';
import { createApp } from './api/app';
import { connectSources } from './connect-sources';

const root = resolve(import.meta.dirname, '..', '..', '..');
// Data directory: first CLI argument, ERP_DATA_DIR, or <repo>/data.
const dataDir = resolve(process.argv[2] ?? process.env.ERP_DATA_DIR ?? join(root, 'data'));
const port = Number(process.env.PORT ?? 3000);
const threshold = Number(process.env.PAYOUT_THRESHOLD_CENTS ?? 10000);

// The Believe sources: file registry in PostgreSQL, report lines in ClickHouse (settings from <repo>/.env).
const { sources, close: closeSources } = connectSources(join(dataDir, 'files', 'sources'));

const facade = openFacade({ dataDir, payoutThresholdCents: threshold, sources });
const app = createApp(facade, {
  tmpDir: join(dataDir, 'tmp'),
  clientDist: join(root, 'packages', 'frontend', 'dist'),
});

const server = app.listen(port, () =>
  console.log(`ERP API on http://localhost:${port}/api/v1 (data: ${dataDir})`),
);

function shutdown() {
  server.close(async () => {
    facade.close();
    await closeSources();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
