import { join } from 'node:path';
import { clickHouseConfigFromEnv, createClickHouse } from './shared/clickhouse';
import { createPostgres, postgresConfigFromEnv } from './shared/postgres';
import { createDb } from './shared/pg-db';
import { orgScope } from './shared/org-scope';
import { createBelieveColumnar, createSourceFilesRegistry, createSourcesService } from './modules/sources';
import { createOrgsService, type Organization } from './orgs/service';

/** `CLICKHOUSE_DATABASE` (default `believe`) and its stage database `<name>_stage` (N20: an API on private stores uses them). */
export function clickHouseDatabaseNames(env: NodeJS.ProcessEnv = process.env) {
  const database = env.CLICKHOUSE_DATABASE || 'believe';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) throw new Error(`Invalid CLICKHOUSE_DATABASE "${database}"`);
  return { database, stageDatabase: `${database}_stage` };
}

function loadRootEnv() {
  try {
    process.loadEnvFile(join(import.meta.dirname, '..', '..', '..', '.env')); // does not override variables already set
  } catch {
    // no .env: the variables may come from the environment
  }
}

/**
 * Opens the stores with the settings of <repo>/.env or the environment (docker compose up -d): the PostgreSQL database
 * of the modules (`db`, D-121) and the ClickHouse client of the Believe lines (`columnar`), one of each per process.
 * They know no organization: `sourcesFor` and `openFacade` open an organization over them (D-170). The caller closes.
 */
export function connectStores(env: NodeJS.ProcessEnv = process.env) {
  loadRootEnv();
  const pg = createPostgres(postgresConfigFromEnv(env));
  const ch = createClickHouse(clickHouseConfigFromEnv(env));
  const clickhouseDatabase = clickHouseDatabaseNames(env);
  return {
    db: createDb(pg.pool),
    pool: pg.pool,
    columnar: createBelieveColumnar(ch, clickhouseDatabase),
    /** The ClickHouse databases the columnar reads and writes (`CLICKHOUSE_DATABASE`, default `believe`, and `<name>_stage`). */
    clickhouseDatabase,
    async close() {
      await Promise.allSettled([pg.close(), ch.close()]);
    },
  };
}

export type Stores = ReturnType<typeof connectStores>;

/** The directory of the original files of an organization: `<dataDir>/orgs/<orgId>/files/<kind>` (D-170). */
export function orgFilesDir(dataDir: string, orgId: string, kind: 'sources' | 'publishing'): string {
  return join(dataDir, 'orgs', orgId, 'files', kind);
}

/** The sources module of one organization over the shared stores: its registry rows, its files directory. */
export function sourcesFor(stores: Pick<Stores, 'pool' | 'columnar'>, orgId: string, dataDir: string) {
  return createSourcesService({
    registry: createSourceFilesRegistry(stores.pool, orgScope(orgId)),
    columnar: stores.columnar,
    storageDir: orgFilesDir(dataDir, orgId, 'sources'),
  });
}

/** The value of `--org <id>` or `--org=<id>` in argv, if any. */
export function orgArgument(argv: string[] = process.argv): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--org') return argv[i + 1];
    if (a.startsWith('--org=')) return a.slice('--org='.length);
  }
  return undefined;
}

/**
 * Removes `--org <id>` / `--org=<id>` from `process.argv` and returns the id: a script calls it before it reads its
 * positional arguments, so the flag may stand anywhere on the command line.
 */
export function takeOrgArgument(argv: string[] = process.argv): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--org') return argv.splice(i, 2)[1];
    if (a.startsWith('--org=')) return (argv.splice(i, 1)[0] as string).slice('--org='.length);
  }
  return undefined;
}

const describeOrgs = (orgs: Organization[]) =>
  orgs.length === 0
    ? '  (no organizations: create one with POST /orgs)'
    : orgs.map((o) => `  ${o.id}  ${o.name}`).join('\n');

/**
 * Resolves the organization of a process: `explicit` (the server's `ERP_DEFAULT_ORG`, a script's `--org`) → `ERP_ORG`
 * → `ERP_DEFAULT_ORG`. Unknown or missing: the message lists the organizations of the database.
 */
export async function resolveOrg(
  stores: Pick<Stores, 'db'>,
  candidates: (string | undefined)[],
): Promise<{ ok: true; org: Organization } | { ok: false; message: string }> {
  const orgs = createOrgsService(stores.db);
  const id = candidates.find((c) => c !== undefined && c.trim() !== '')?.trim();
  if (id === undefined) {
    return {
      ok: false,
      message: `No organization given (--org, ERP_ORG or ERP_DEFAULT_ORG). The organizations:\n${describeOrgs(await orgs.listOrganizations())}`,
    };
  }
  const org = await orgs.findOrganization(id);
  if (!org)
    return {
      ok: false,
      message: `Unknown organization "${id}". The organizations:\n${describeOrgs(await orgs.listOrganizations())}`,
    };
  return { ok: true, org };
}

/**
 * The stores and the sources of one organization for a script (D-170): the organization is `opts.org`, `--org`,
 * `ERP_ORG` or `ERP_DEFAULT_ORG`, in that order; none or an unknown one ends the process with 1 and the list of
 * organizations. Open the facade with `openFacade({ db, orgId, sources, dataDir, … })` of the result.
 */
export async function connectOrg(opts: { dataDir: string; org?: string; env?: NodeJS.ProcessEnv }) {
  const env = opts.env ?? process.env;
  const stores = connectStores(env);
  const found = await resolveOrg(stores, [opts.org, orgArgument(), env.ERP_ORG, env.ERP_DEFAULT_ORG]);
  if (!found.ok) {
    console.error(found.message);
    await stores.close();
    process.exit(1);
  }
  const orgId = found.org.id;
  return {
    ...stores,
    orgId,
    orgName: found.org.name,
    sources: sourcesFor(stores, orgId, opts.dataDir),
  };
}
