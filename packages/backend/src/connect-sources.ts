import { join } from 'node:path';
import { clickHouseConfigFromEnv, createClickHouse } from './shared/clickhouse';
import { createPostgres, postgresConfigFromEnv } from './shared/postgres';
import { createBelieveColumnar, createSourceFilesRegistry, createSourcesService } from './modules/sources';

/**
 * Opens the sources module (Believe) on PostgreSQL and ClickHouse with the settings of <repo>/.env or the environment
 * (docker compose up -d). The server and the scripts use it; the caller closes the connections.
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
    sources,
    async close() {
      await Promise.allSettled([pg.close(), ch.close()]);
    },
  };
}
