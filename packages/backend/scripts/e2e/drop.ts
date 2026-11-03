/**
 * Drops the private stores of the e2e run: `tsx scripts/e2e/drop.ts <name>` removes PostgreSQL `erp_<name>` and
 * ClickHouse `believe_<name>` / `believe_<name>_stage`. Used by the Playwright global teardown (unless E2E_KEEP=1).
 * Never touches the development databases: the name must be a-z, 0-9, _ and not empty.
 */
import { join } from 'node:path';
import { clickHouseConfigFromEnv, createClickHouse } from '../../src/shared/clickhouse';
import { createPostgres, postgresConfigFromEnv } from '../../src/shared/postgres';

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '..', '..', '.env'));
} catch {
  // no .env: the variables may come from the environment
}

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('usage: tsx scripts/e2e/drop.ts <name>   (name: a-z, 0-9, _)');
  process.exit(1);
}

const admin = createPostgres({ ...postgresConfigFromEnv(), max: 1 });
const ch = createClickHouse(clickHouseConfigFromEnv());
try {
  await admin.pool.query(`DROP DATABASE IF EXISTS erp_${name} WITH (FORCE)`);
  await ch.command({ query: `DROP DATABASE IF EXISTS believe_${name} SYNC` });
  await ch.command({ query: `DROP DATABASE IF EXISTS believe_${name}_stage SYNC` });
  console.log(`dropped erp_${name}, believe_${name}, believe_${name}_stage`);
} finally {
  await admin.close();
  await ch.close();
}
