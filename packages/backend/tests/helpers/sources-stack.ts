import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { splitStatements } from '../../scripts/migrate-clickhouse';
import { clickHouseConfigFromEnv, createClickHouse } from '../../src/shared/clickhouse';
import { createPostgres, postgresConfigFromEnv } from '../../src/shared/postgres';
import { createDb } from '../../src/shared/pg-db';
import {
  createBelieveColumnar,
  createSourcesService,
  createSourceFilesRegistry,
} from '../../src/modules/sources';
import { TMP } from './tmp-root';
import './stack';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');
const sql = (dir: string) =>
  readdirSync(join(MIGRATIONS, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, dir, f), 'utf8'));

/**
 * A private PostgreSQL database and private ClickHouse databases with the real migrations applied, for one test file.
 * Nothing of the development data is touched. `close()` drops them.
 */
export async function createIsolatedSources() {
  const id = randomBytes(5).toString('hex');
  const pgName = `erp_t_${id}`;
  const database = `believe_t_${id}`;
  const stageDatabase = `believe_t_${id}_stage`;
  const storageDir = join(TMP, `sources-${id}`);
  mkdirSync(storageDir, { recursive: true });

  const pgConfig = postgresConfigFromEnv();
  const admin = createPostgres({ ...pgConfig, max: 1 });
  await admin.pool.query(`CREATE DATABASE ${pgName}`);
  const pg = createPostgres({ ...pgConfig, database: pgName, max: 4 });
  for (const migration of sql('postgres')) await pg.pool.query(migration);

  const ch = createClickHouse(clickHouseConfigFromEnv());
  for (const migration of sql('clickhouse')) {
    const renamed = migration.replace(/\bbelieve_stage\b/g, stageDatabase).replace(/\bbelieve\b/g, database);
    for (const statement of splitStatements(renamed)) await ch.command({ query: statement });
  }

  const registry = createSourceFilesRegistry(pg.pool);
  const columnar = createBelieveColumnar(ch, { database, stageDatabase });
  const service = createSourcesService({ registry, columnar, storageDir });

  const db = createDb(pg.pool);
  const moduleTables = (
    await pg.pool.query<{ t: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables
       WHERE schemaname IN ('owners', 'splits', 'labels', 'settlements', 'publishing')`,
    )
  ).rows.map((r) => r.t);

  return {
    pg,
    ch,
    db,
    registry,
    columnar,
    service,
    storageDir,
    database,
    stageDatabase,
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
    /** Empties every table of the modules owners, splits, labels, settlements and publishing. */
    async resetModules() {
      if (moduleTables.length > 0) await pg.pool.query(`TRUNCATE ${moduleTables.join(', ')}`);
    },
    async close() {
      await pg.close();
      await admin.pool.query(`DROP DATABASE IF EXISTS ${pgName} WITH (FORCE)`);
      await admin.close();
      await ch.command({ query: `DROP DATABASE IF EXISTS ${database} SYNC` });
      await ch.command({ query: `DROP DATABASE IF EXISTS ${stageDatabase} SYNC` });
      await ch.close();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}
