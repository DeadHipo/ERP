import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renameBelieveDatabases, splitStatements } from './clickhouse-sql';
import { clickHouseConfigFromEnv, createClickHouse } from './clickhouse';
import { createPostgres, postgresConfigFromEnv } from './postgres';
import { createDb } from './pg-db';
import { createOrgsService } from '../orgs/service';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');
const files = (dir: string) =>
  readdirSync(join(MIGRATIONS, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(MIGRATIONS, dir, f), 'utf8') }));
const sql = (dir: string) => files(dir).map((f) => f.text);

/** The PostgreSQL migrations in order: version, name and the checksum `migrate-postgres.sh` records (sha256 without `\r`). */
export function postgresMigrations() {
  return files('postgres').map(({ file, text }) => {
    const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!m) throw new Error(`${file} does not match NNNN_name.sql`);
    return {
      version: Number.parseInt(m[1] as string, 10),
      name: m[2] as string,
      checksum: createHash('sha256').update(text.replace(/\r/g, '')).digest('hex'),
      text,
    };
  });
}

/**
 * Schemas whose tables `resetModules()` empties (every PostgreSQL module). Not `orgs` and `auth` (D-170): the test
 * organization and its users outlive a reset.
 */
const MODULE_SCHEMAS = ['owners', 'splits', 'labels', 'settlements', 'publishing', 'pubv2', 'links', 'audit', 'ads'];

/**
 * A private PostgreSQL database `erp_<name>` and private ClickHouse databases `believe_<name>` and `believe_<name>_stage`
 * with the real migrations applied (D-140). Tests use a random name per file; the e2e uses a fixed one. The development
 * data is never touched. `dropFirst` removes databases with these names first. `drop()` removes them and closes the
 * connections; `close()` only closes the connections.
 */
export async function createPrivateStores(name: string, opts: { dropFirst?: boolean } = {}) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Invalid private store name "${name}" (a-z, 0-9, _)`);
  const pgName = `erp_${name}`;
  const database = `believe_${name}`;
  const stageDatabase = `believe_${name}_stage`;

  const pgConfig = postgresConfigFromEnv();
  const admin = createPostgres({ ...pgConfig, max: 1 });
  const ch = createClickHouse(clickHouseConfigFromEnv());

  const dropDatabases = async () => {
    await admin.pool.query(`DROP DATABASE IF EXISTS ${pgName} WITH (FORCE)`);
    await ch.command({ query: `DROP DATABASE IF EXISTS ${database} SYNC` });
    await ch.command({ query: `DROP DATABASE IF EXISTS ${stageDatabase} SYNC` });
  };

  if (opts.dropFirst) await dropDatabases();
  await admin.pool.query(`CREATE DATABASE ${pgName}`);
  const pg = createPostgres({ ...pgConfig, database: pgName, max: 4 });
  // as scripts/migrate-postgres.sh: every migration and its schema_migrations row
  await pg.pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const m of postgresMigrations()) {
    await pg.pool.query(m.text);
    await pg.pool.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
      m.version,
      m.name,
      m.checksum,
    ]);
  }
  for (const migration of sql('clickhouse')) {
    const renamed = renameBelieveDatabases(migration, database);
    for (const statement of splitStatements(renamed)) await ch.command({ query: statement });
  }

  const db = createDb(pg.pool);
  // the organization of the private stores (D-170): the id comes from the service, as for every organization
  const org = await createOrgsService(db).createOrganization({ name: `Test organization ${name}`, createdBy: 'tests' });
  const moduleTables = (
    await pg.pool.query<{ t: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE schemaname = ANY($1)`,
      [MODULE_SCHEMAS],
    )
  ).rows.map((r) => r.t);

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await pg.close();
    await admin.close();
    await ch.close();
  };

  return {
    pg,
    ch,
    db,
    names: { pg: pgName, ch: database, chStage: stageDatabase },
    /** The organization created with the stores; `resetModules()` keeps it. */
    orgId: org.id,
    /** Empties the sources: no files, no rows, no stage tables. */
    async reset() {
      await ch.command({ query: `TRUNCATE TABLE ${database}.rows` });
      const stages = await (
        await ch.query({
          query: 'SELECT name FROM system.tables WHERE database = {db:String}',
          query_params: { db: stageDatabase },
          format: 'JSONEachRow',
        })
      ).json<{ name: string }>();
      for (const t of stages) await ch.command({ query: `DROP TABLE IF EXISTS ${stageDatabase}.${t.name}` });
      await pg.pool.query('DELETE FROM source_files');
    },
    /** Empties every table of the PostgreSQL modules. */
    async resetModules() {
      if (moduleTables.length > 0) await pg.pool.query(`TRUNCATE ${moduleTables.join(', ')}`);
      // the grouped B17 lines (D-164) are derived from the emptied tables: rebuild them, or a later facade sees them
      await pg.pool.query('REFRESH MATERIALIZED VIEW publishing.pub_lines_by_key');
    },
    /** Drops the databases and closes the connections. */
    async drop() {
      if (closed) throw new Error('The private stores are already closed');
      await pg.close();
      await dropDatabases();
      closed = true;
      await admin.close();
      await ch.close();
    },
    close,
  };
}

export type PrivateStores = Awaited<ReturnType<typeof createPrivateStores>>;
