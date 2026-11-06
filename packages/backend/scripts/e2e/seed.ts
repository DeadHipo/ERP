/**
 * Seeds the private stores of the e2e run (D-140): `tsx scripts/e2e/seed.ts <name>` drops and creates PostgreSQL
 * `erp_<name>` and ClickHouse `believe_<name>` (+ `_stage`) with all migrations, opens a facade on them and runs the
 * scenarios of `./scenarios` (S00 shared, S01..S37), then loads the one B17 statement they collected. The originals
 * are written under the API data directory (`data/test-tmp/e2e-data` for the name `e2e`, `e2e-data-<name>` otherwise),
 * the ids per scenario to `data/test-tmp/e2e-keys[-<name>].json` and, for `e2e`, to `packages/frontend/e2e/.seed-keys.json`.
 * Prints the store names and a summary table. Synthetic data only.
 *
 * The login (D-170): the seed also creates the user `e2e-operator` of that organization, the system administrator
 * `e2e-sysadmin`, and organization B («Org B e2e») with one own label, one owner and its user `e2e-b`. The passwords are
 * random per run and written to the keys files only (`users`), with the ids of B (`orgB`); the e2e `globalSetup` signs in
 * with them. Nothing of B touches the numbers of A (`verify-seed.ts` is unchanged). D-171: `e2e-operator` and `e2e-b`
 * are `org_admin` members of A and B; `e2e-multi` is an `org_admin` of both (the login asks to choose the organization).
 */
/** The login part of the keys file (D-170); `packages/frontend/e2e/helpers.ts` reads it. */
export interface SeedAuthKeys {
  users: Record<'operator' | 'sysadmin' | 'b' | 'multi' | 'manager', { login: string; password: string }>;
  orgB: { id: string; name: string; labelId: string; labelName: string; ownerId: string; ownerName: string };
}
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFacade } from '../../src/facade';
import { createBelieveColumnar, createSourceFilesRegistry, createSourcesService } from '../../src/modules/sources';
import { createPrivateStores } from '../../src/shared/private-stores';
import { orgScope } from '../../src/shared/org-scope';
import { orgFilesDir } from '../../src/connect-sources';
import { createAuthService } from '../../src/auth/service';
import { createOrgsService } from '../../src/orgs/service';
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

  // the login (D-170): the users and the second organization B with its own label and owner
  console.log('creating the users and organization B');
  const password = () => `e2e-${randomBytes(12).toString('hex')}`;
  const users: SeedAuthKeys['users'] = {
    operator: { login: 'e2e-operator', password: password() },
    sysadmin: { login: 'e2e-sysadmin', password: password() },
    b: { login: 'e2e-b', password: password() },
    multi: { login: 'e2e-multi', password: password() },
    manager: { login: 'e2e-manager', password: password() },
  };
  const auth = createAuthService(stores.db);
  await auth.createUser({ ...users.operator, orgId: stores.orgId, role: 'org_admin', createdBy: 'e2e seed' });
  await auth.createUser({ ...users.sysadmin, system: true, createdBy: 'e2e seed' });
  const orgB = await createOrgsService(stores.db).createOrganization({ name: 'Org B e2e', createdBy: 'e2e seed' });
  await auth.createUser({ ...users.b, orgId: orgB.id, role: 'org_admin', createdBy: 'e2e seed' });
  await auth.createUser({ ...users.multi, orgId: stores.orgId, role: 'org_admin', createdBy: 'e2e seed' });
  // a label manager of A with the 0to8 label only (D-171): `label=A` 2xx, `label=B` 403, «Все» 400
  const label0to8 = seed.shared['label:0to8'];
  if (!label0to8) throw new Error('the seed has no label:0to8 key for the manager');
  await auth.createUser({ ...users.manager, orgId: stores.orgId, role: 'label_manager', labelIds: [label0to8], createdBy: 'e2e seed' });
  await auth.addMembership({ login: users.multi.login, orgId: orgB.id, role: 'org_admin', labelIds: [], createdBy: 'e2e seed' });
  const facadeB = openFacade({
    db: stores.db,
    orgId: orgB.id,
    dataDir,
    payoutThresholdCents: 0,
    sources: createSourcesService({
      registry: createSourceFilesRegistry(stores.pg.pool, orgScope(orgB.id)),
      columnar: createBelieveColumnar(stores.ch, { database: stores.names.ch, stageDatabase: stores.names.chStage }),
      storageDir: orgFilesDir(dataDir, orgB.id, 'sources'),
    }),
  });
  const labelB = await facadeB.modules.labels.createLabel({ name: 'Label B e2e', kind: 'own' });
  const ownerB = await facadeB.modules.owners.createOwner({ name: 'Owner B e2e', kind: 'person' });
  const authKeys: SeedAuthKeys = {
    users,
    orgB: { id: orgB.id, name: orgB.name, labelId: labelB.id, labelName: labelB.name, ownerId: ownerB.id, ownerName: ownerB.name },
  };

  const keys: SeedKeys & SeedAuthKeys = {
    ...authKeys,
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
