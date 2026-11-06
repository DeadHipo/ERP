/**
 * Seeds the private stores of the e2e run (D-140): `tsx scripts/e2e/seed.ts <name>` drops and creates PostgreSQL
 * `erp_<name>` and ClickHouse `believe_<name>` (+ `_stage`) with all migrations, opens a facade on them and runs the
 * scenarios of `./scenarios` (S00 shared, S01..S37), then loads the one B17 statement they collected. The originals
 * are written under the API data directory (`data/test-tmp/e2e-data` for the name `e2e`, `e2e-data-<name>` otherwise),
 * the ids per scenario to `data/test-tmp/e2e-keys[-<name>].json` and, for `e2e`, to `packages/frontend/e2e/.seed-keys.json`.
 * Prints the store names and a summary table. Synthetic data only.
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFacade } from '../../src/facade';
import { createBelieveColumnar, createSourceFilesRegistry, createSourcesService } from '../../src/modules/sources';
import { createPrivateStores } from '../../src/shared/private-stores';
import { orgScope } from '../../src/shared/org-scope';
import { orgFilesDir } from '../../src/connect-sources';
import { B17_FILE_NAME, type SeedKeys } from './keys';
import { Seed } from './lib';
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
const testTmp = join(repoRoot, 'data', 'test-tmp');
const dataDir = join(testTmp, name === 'e2e' ? 'e2e-data' : `e2e-data-${name}`);
const tmpDir = join(dataDir, 'seed-tmp');
// a fresh run starts from empty originals (the stores are dropped below)
rmSync(join(dataDir, 'files'), { recursive: true, force: true });
rmSync(join(dataDir, 'orgs'), { recursive: true, force: true });
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const stores = await createPrivateStores(name, { dropFirst: true });
try {
  // the seed is made in the organization of the private stores (D-170); the API of the run opens it (ERP_DEFAULT_ORG)
  const sources = createSourcesService({
    registry: createSourceFilesRegistry(stores.pg.pool, orgScope(stores.orgId)),
    columnar: createBelieveColumnar(stores.ch, {
      database: stores.names.ch,
      stageDatabase: stores.names.chStage,
    }),
    // the same place the API (main.ts <dataDir>) keeps the originals
    storageDir: orgFilesDir(dataDir, stores.orgId, 'sources'),
  });
  const facade = openFacade({ db: stores.db, orgId: stores.orgId, dataDir, payoutThresholdCents: 0, sources });
  const seed = new Seed(facade, dataDir, tmpDir);
  for (const s of scenarios) {
    console.log(`scenario ${s.id}`);
    await s.run(facade, { names: stores.names, dataDir, seed });
  }
  console.log('loading the B17 statement');
  const b17 = await seed.loadB17();

  const keys: SeedKeys = {
    scenarios: seed.keys,
    shared: seed.shared,
    stores: stores.names,
    orgId: stores.orgId,
    dataDir,
    b17FileName: B17_FILE_NAME,
  };
  const keysPath = join(testTmp, name === 'e2e' ? 'e2e-keys.json' : `e2e-keys-${name}.json`);
  writeFileSync(keysPath, JSON.stringify(keys, null, 2));
  if (name === 'e2e') {
    const frontendCopy = join(repoRoot, 'packages', 'frontend', 'e2e', '.seed-keys.json');
    mkdirSync(join(repoRoot, 'packages', 'frontend', 'e2e'), { recursive: true });
    copyFileSync(keysPath, frontendCopy);
  }
  rmSync(tmpDir, { recursive: true, force: true });

  console.log('\nscenario  cases  files  units');
  let files = 0;
  let units = 0;
  for (const [id, st] of [...seed.stats].sort(([a], [b]) => a.localeCompare(b))) {
    const cases = Object.keys(seed.keys[id] ?? {}).length;
    console.log(`${id.padEnd(8)}  ${String(cases).padStart(5)}  ${String(st.files).padStart(5)}  ${String(st.units).padStart(5)}`);
    files += st.files;
    units += st.units;
  }
  console.log(`total            ${String(files).padStart(5)}  ${String(units).padStart(5)}   + B17: ${b17.lines} lines`);
  console.log(`keys: ${keysPath}`);
  console.log(
    `seeded: DB_DATABASE=${stores.names.pg} CLICKHOUSE_DATABASE=${stores.names.ch} (stage ${stores.names.chStage}) ERP_DEFAULT_ORG=${stores.orgId}`,
  );
} finally {
  await stores.close();
}
