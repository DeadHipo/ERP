import { join } from 'node:path';
import { clickHouseConfigFromEnv, createClickHouse } from './shared/clickhouse';
import { createPostgres, postgresConfigFromEnv } from './shared/postgres';
import { createDb } from './shared/pg-db';
import { createBelieveColumnar, createSourceFilesRegistry, createSourcesService } from './modules/sources';

/** `CLICKHOUSE_DATABASE` (default `believe`) and its stage database `<name>_stage` (N20: an API on private stores uses them). */
export function clickHouseDatabaseNames(env: NodeJS.ProcessEnv = process.env) {
  const database = env.CLICKHOUSE_DATABASE || 'believe';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) throw new Error(`Invalid CLICKHOUSE_DATABASE "${database}"`);
  return { database, stageDatabase: `${database}_stage` };
}

/**
 * Opens the stores with the settings of <repo>/.env or the environment (docker compose up -d): the PostgreSQL database
 * of the modules (`db`, D-121) and the sources module (Believe: registry in PostgreSQL, lines in ClickHouse). The server
 * and the scripts use it; the caller closes the connections.
 */
export function connectSources(storageDir: string, env: NodeJS.ProcessEnv = process.env) {
  try {
    process.loadEnvFile(join(import.meta.dirname, '..', '..', '..', '.env')); // does not override variables already set
  } catch {
    // no .env: the variables may come from the environment
  }
  const pg = createPostgres(postgresConfigFromEnv(env));
  const ch = createClickHouse(clickHouseConfigFromEnv(env));
  const clickhouseDatabase = clickHouseDatabaseNames(env);
  const sources = createSourcesService({
    registry: createSourceFilesRegistry(pg.pool),
    columnar: createBelieveColumnar(ch, clickhouseDatabase),
    storageDir,
  });
  return {
    db: createDb(pg.pool),
    sources,
    /** The ClickHouse databases the columnar reads and writes (`CLICKHOUSE_DATABASE`, default `believe`, and `<name>_stage`). */
    clickhouseDatabase,
    async close() {
      await Promise.allSettled([pg.close(), ch.close()]);
    },
  };
}
