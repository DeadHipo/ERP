import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { splitStatements } from './clickhouse-sql';
import { clickHouseConfigFromEnv, createClickHouse } from './clickhouse';
import { createPostgres, postgresConfigFromEnv } from './postgres';
import { createDb } from './pg-db';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');
const sql = (dir: string) =>
  readdirSync(join(MIGRATIONS, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, dir, f), 'utf8'));

/** Schemas whose tables `resetModules()` empties (every PostgreSQL module). */
const MODULE_SCHEMAS = ['owners', 'splits', 'labels', 'settlements', 'publishing', 'audit', 'ads'];

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
  for (const migration of sql('postgres')) await pg.pool.query(migration);
  for (const migration of sql('clickhouse')) {
    const renamed = migration.replace(/\bbelieve_stage\b/g, stageDatabase).replace(/\bbelieve\b/g, database);
    for (const statement of splitStatements(renamed)) await ch.command({ query: statement });
  }

  const db = createDb(pg.pool);
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
