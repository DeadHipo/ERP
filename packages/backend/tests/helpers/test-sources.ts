import type { SourcesService } from '../../src/modules/sources';

// The sources (PostgreSQL + ClickHouse) for the tests that build a facade. One private pair of databases per test
// file, created on first use and dropped after the file. Every facade starts from empty sources: its first call to the
// sources resets them. Two facades of one test that must see the same sources share one `testSources()` value.

type Stack = Awaited<ReturnType<typeof import('./sources-stack').createIsolatedSources>>;
let stackPromise: Promise<Stack> | undefined;

async function stack(): Promise<Stack> {
  stackPromise ??= (async () => {
    const { createIsolatedSources } = await import('./sources-stack');
    const { postgresUp, clickhouseUp } = await import('./stack');
    if (!postgresUp || !clickhouseUp)
      throw new Error(
        'PostgreSQL and ClickHouse are required for this test: run `docker compose up -d` in the repo root',
      );
    return createIsolatedSources();
  })();
  return stackPromise;
}

/** Closes the databases of this test file (registered for every file in tests/setup.ts). */
export async function closeTestSources(): Promise<void> {
  if (!stackPromise) return;
  const s = await stackPromise.catch(() => undefined);
  stackPromise = undefined;
  await s?.close();
}

/** The sources service of the test stack; the sources are emptied before its first use. */
export function testSources(): SourcesService {
  let ready: Promise<SourcesService> | undefined;
  const service = () =>
    (ready ??= (async () => {
      const s = await stack();
      await s.reset();
      return s.service;
    })());
  return new Proxy({} as SourcesService, {
    get:
      (_t, name: string) =>
      async (...args: unknown[]) =>
        ((await service()) as unknown as Record<string, (...a: unknown[]) => unknown>)[name]?.(...args),
  });
}

/** Direct access to the test databases (to look at what a loaded file left in ClickHouse or the registry). */
export async function testStack(): Promise<Stack> {
  return stack();
}

/**
 * A query against the ClickHouse views of the test stack, `db` being the database name:
 * testQuery((db) => `SELECT toString(count()) AS n FROM ${db}.lines`).
 */
export async function testQuery<T>(query: (db: string) => string): Promise<T[]> {
  const s = await stack();
  return (await s.ch.query({ query: query(s.database), format: 'JSONEachRow' })).json<T>();
}

/** Line and key counts of one loaded file, as the `file_totals` view gives them (exact integer text). */
export async function testFileTotals(fileId: string): Promise<{ lines: string; keys: string }> {
  const [r] = await testQuery<{ lines: string; keys: string }>(
    (db) =>
      `SELECT toString(line_count) AS lines, toString(key_count) AS keys FROM ${db}.file_totals WHERE file_id = '${fileId}'`,
  );
  return r ?? { lines: '0', keys: '0' };
}
