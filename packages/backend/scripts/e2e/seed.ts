/**
 * Seeds the private stores of the e2e run (D-140): `tsx scripts/e2e/seed.ts <name>` drops and creates PostgreSQL
 * `erp_<name>` and ClickHouse `believe_<name>` (+ `_stage`) with all migrations, opens a facade on them and runs the
 * scenarios of `./scenarios`. Prints the store names; the API is then started with `DB_DATABASE=erp_<name>
 * CLICKHOUSE_DATABASE=believe_<name>`. Synthetic data only.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openFacade } from '../../src/facade';
import { createBelieveColumnar, createSourceFilesRegistry, createSourcesService } from '../../src/modules/sources';
import { createPrivateStores } from '../../src/shared/private-stores';
import { scenarios } from './scenarios';

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '..', '..', '.env'));
} catch {
  // no .env: the variables may come from the environment
}

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('usage: tsx scripts/e2e/seed.ts <name>   (name: a-z, 0-9, _)');
  process.exit(1);
}

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
const dataDir = join(repoRoot, 'data', 'test-tmp', `e2e-${name}`);
mkdirSync(dataDir, { recursive: true });

const stores = await createPrivateStores(name, { dropFirst: true });
try {
  const sources = createSourcesService({
    registry: createSourceFilesRegistry(stores.pg.pool),
    columnar: createBelieveColumnar(stores.ch, {
      database: stores.names.ch,
      stageDatabase: stores.names.chStage,
    }),
    storageDir: join(dataDir, 'sources'),
  });
  const facade = openFacade({ db: stores.db, dataDir, payoutThresholdCents: 0, sources });
  for (const s of scenarios) {
    console.log(`scenario ${s.id}`);
    await s.run(facade, { names: stores.names, dataDir });
  }
  console.log(`seeded: DB_DATABASE=${stores.names.pg} CLICKHOUSE_DATABASE=${stores.names.ch} (stage ${stores.names.chStage})`);
} finally {
  await stores.close();
}
