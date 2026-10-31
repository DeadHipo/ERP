import { createClickHouse, clickHouseConfigFromEnv } from '../../src/shared/clickhouse';
import { createPostgres, postgresConfigFromEnv } from '../../src/shared/postgres';

// Tests of the PostgreSQL and ClickHouse wrappers need the compose stack (docker compose up -d) and .env in the repo root.
// Without them these tests are skipped with a message; REQUIRE_STACK=1 turns the skip into a failure (CI).
try {
  process.loadEnvFile(new URL('../../../../.env', import.meta.url));
} catch {
  // no .env: the variables may come from the environment
}

async function reachable(): Promise<{ postgres: boolean; clickhouse: boolean }> {
  const out = { postgres: false, clickhouse: false };
  try {
    const pg = createPostgres({ ...postgresConfigFromEnv(), max: 1 });
    await Promise.race([pg.pool.query('SELECT 1'), new Promise((_, rej) => setTimeout(rej, 3000))]);
    out.postgres = true;
    await pg.close();
  } catch {
    // unreachable or not configured
  }
  try {
    const ch = createClickHouse(clickHouseConfigFromEnv());
    out.clickhouse = (await ch.ping({ select: true })).success;
    await ch.close();
  } catch {
    // unreachable or not configured
  }
  return out;
}

export const stack = await reachable();
const required = process.env.REQUIRE_STACK === '1';
for (const [name, up] of Object.entries(stack)) {
  if (!up && !required)
    console.warn(
      `[tests] ${name} is not reachable: its integration tests are skipped (REQUIRE_STACK=1 fails instead)`,
    );
}
export const postgresUp = stack.postgres || required;
export const clickhouseUp = stack.clickhouse || required;
