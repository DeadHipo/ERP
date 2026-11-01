import { join } from 'node:path';
import { clickHouseConfigFromEnv, createClickHouse } from './shared/clickhouse';
import { createPostgres, postgresConfigFromEnv } from './shared/postgres';
import { createDb } from './shared/pg-db';
import { createBelieveColumnar, createSourceFilesRegistry, createSourcesService } from './modules/sources';

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
  const sources = createSourcesService({
    registry: createSourceFilesRegistry(pg.pool),
    columnar: createBelieveColumnar(ch),
    storageDir,
  });
  return {
    db: createDb(pg.pool),
    sources,
    async close() {
      await Promise.allSettled([pg.close(), ch.close()]);
    },
  };
}
