// Moves the four module databases of a data directory from SQLite into PostgreSQL (D-121):
//   <dir>/owners.sqlite, splits.sqlite, settlements.sqlite, publishing.sqlite -> schemas owners, splits, settlements,
//   publishing of the database in <repo>/.env (DB_*). The migrations must be applied first (npm run migrate:pg).
//
// The SQLite files are only read. Every module is copied in one transaction and checked afterwards: row counts per
// table and control sums (money, percents) must be equal, otherwise the transaction is rolled back.
// A module whose PostgreSQL tables are not empty is refused, unless --replace is given (then they are emptied first).
//
// Usage: npx tsx packages/backend/scripts/migrate-sqlite-to-pg.ts <dataDir> [--replace] [--only owners,splits,...]
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createPostgres, postgresConfigFromEnv } from '../src/shared/postgres';

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '..', '.env'));
} catch {
  // no .env: the variables may come from the environment
}

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error(
    'usage: migrate-sqlite-to-pg.ts <dataDir> [--replace] [--only owners,splits,settlements,publishing]',
  );
  process.exit(2);
}
const dataDir = resolve(dir);
const replace = args.includes('--replace');
const onlyArg = args[args.indexOf('--only') + 1];
const only = args.includes('--only') && onlyArg ? new Set(onlyArg.split(',')) : null;

/** Tables of each module in foreign-key order, and the control sums compared after the copy. */
const MODULES: { module: string; tables: string[]; sums: { table: string; expr: string }[] }[] = [
  {
    module: 'owners',
    tables: [
      'owners',
      'owner_aliases',
      'artists',
      'tracks',
      'artist_tracks',
      'documents',
      'contracts',
      'contract_artists',
      'merges',
    ],
    sums: [],
  },
  {
    module: 'splits',
    tables: ['splits', 'split_shares'],
    sums: [{ table: 'split_shares', expr: 'percent' }],
  },
  {
    module: 'settlements',
    tables: ['operations', 'payout_snapshots'],
    sums: [{ table: 'operations', expr: 'amount_cents' }],
  },
  {
    module: 'publishing',
    tables: ['pub_statements', 'pub_statement_periods', 'pub_lines', 'pub_writers', 'pub_terms'],
    sums: [
      { table: 'pub_lines', expr: 'payable_pico' },
      { table: 'pub_terms', expr: 'percent' },
    ],
  },
];

/** At most this many parameters per INSERT (PostgreSQL allows 65535). */
const MAX_PARAMS = 30_000;

const pg = createPostgres({ ...postgresConfigFromEnv(), max: 2 });

/** A SQLite value as PostgreSQL text input: exact integers (bigint) as text, 0/1 booleans as PostgreSQL accepts them. */
const toPg = (v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v);

async function copyModule(m: (typeof MODULES)[number]): Promise<void> {
  const file = join(dataDir, `${m.module}.sqlite`);
  if (!existsSync(file)) {
    console.log(`${m.module}: no ${file}, skipped`);
    return;
  }
  const lite = new DatabaseSync(file, { readOnly: true });
  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    // the same lock as every write of the application (src/shared/pg-db.ts)
    await client.query('SELECT pg_advisory_xact_lock(72011301)');
    for (const t of m.tables) {
      const n = (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${m.module}.${t}`))
        .rows[0]?.n;
      if (n !== '0') {
        if (!replace) throw new Error(`${m.module}.${t} is not empty (${n} rows): use --replace`);
      }
    }
    if (replace) await client.query(`TRUNCATE ${m.tables.map((t) => `${m.module}.${t}`).join(', ')}`);

    for (const t of m.tables) {
      const columns = (
        await client.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [m.module, t],
        )
      ).rows.map((r) => r.column_name);
      if (columns.length === 0) throw new Error(`${m.module}.${t} does not exist: run the migrations first`);
      const liteColumns = new Set(
        (lite.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name),
      );
      const missing = columns.filter((c) => !liteColumns.has(c));
      if (missing.length > 0) throw new Error(`${t}: SQLite has no column(s) ${missing.join(', ')}`);
      const extra = [...liteColumns].filter((c) => !columns.includes(c));
      if (extra.length > 0) throw new Error(`${t}: PostgreSQL has no column(s) ${extra.join(', ')}`);

      const select = lite.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM ${t}`);
      select.setReadBigInts(true);
      const perBatch = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
      let batch: unknown[][] = [];
      let copied = 0;
      const flush = async () => {
        if (batch.length === 0) return;
        const values: unknown[] = [];
        const rows = batch.map((row) => {
          const ph = row.map((v) => {
            values.push(toPg(v));
            return `$${values.length}`;
          });
          return `(${ph.join(', ')})`;
        });
        await client.query(
          `INSERT INTO ${m.module}.${t} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${rows.join(', ')}`,
          values,
        );
        copied += batch.length;
        batch = [];
      };
      for (const row of select.iterate() as Iterable<Record<string, unknown>>) {
        batch.push(columns.map((c) => row[c]));
        if (batch.length >= perBatch) await flush();
      }
      await flush();

      const liteCount = (lite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
      const pgCount = (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${m.module}.${t}`))
        .rows[0]?.n;
      if (String(liteCount) !== pgCount || copied !== liteCount)
        throw new Error(`${t}: ${liteCount} rows in SQLite, ${pgCount} in PostgreSQL`);
      console.log(`${m.module}.${t}: ${pgCount} rows`);
    }

    for (const s of m.sums) {
      // SQLite sums integers exactly; percents are summed as decimals on both sides and compared as numbers
      const liteSum = lite.prepare(`SELECT COALESCE(SUM(${s.expr}), 0) AS v FROM ${s.table}`);
      liteSum.setReadBigInts(true);
      const lv = String((liteSum.get() as { v: unknown }).v);
      const pv = (
        await client.query<{ v: string; eq: boolean }>(
          `SELECT COALESCE(SUM(${s.expr}), 0)::text AS v, COALESCE(SUM(${s.expr}), 0) = $1::numeric AS eq
           FROM ${m.module}.${s.table}`,
          [lv],
        )
      ).rows[0];
      if (!pv?.eq) throw new Error(`${s.table}.${s.expr}: sum ${lv} in SQLite, ${pv?.v} in PostgreSQL`);
      console.log(`${m.module}.${s.table}: sum(${s.expr}) = ${pv.v} on both sides`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    lite.close();
  }
}

try {
  console.log(`source: ${dataDir}`);
  for (const m of MODULES) {
    if (only && !only.has(m.module)) continue;
    const started = Date.now();
    await copyModule(m);
    console.log(`${m.module}: done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
} catch (e) {
  console.error(`migrate-sqlite-to-pg failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pg.close();
}
