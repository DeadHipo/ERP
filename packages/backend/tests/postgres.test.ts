import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPostgres, postgresConfigFromEnv } from '../src/shared/postgres';
import { postgresUp } from './helpers/stack';

describe.runIf(postgresUp)('postgres wrapper', () => {
  const pgdb = createPostgres(postgresConfigFromEnv());
  afterAll(() => pgdb.close());

  it('reads a date as text, not as a Date', async () => {
    const { rows } = await pgdb.pool.query("SELECT DATE '2026-07-01' AS d");
    expect(rows[0].d).toBe('2026-07-01');
  });

  it('reads timestamptz as ISO UTC text', async () => {
    const { rows } = await pgdb.pool.query("SELECT TIMESTAMPTZ '2026-07-01 12:00:00+03' AS t");
    expect(rows[0].t).toBe('2026-07-01T09:00:00.000Z');
  });

  it('keeps numeric and bigint exact, as text', async () => {
    const { rows } = await pgdb.pool.query(
      'SELECT 0.006989549999::numeric(38,12) AS n, 9007199254740993::bigint AS b, sum(x)::numeric AS s FROM (VALUES (0.1::numeric), (0.2::numeric)) v(x)',
    );
    expect(rows[0]).toEqual({ n: '0.006989549999', b: '9007199254740993', s: '0.3' });
  });

  it('works through drizzle', async () => {
    const res = await pgdb.db.execute(sql`SELECT 1 AS one`);
    expect(res.rows[0]).toEqual({ one: 1 });
  });

  it('has the migrated registry table', async () => {
    const { rows } = await pgdb.pool.query("SELECT to_regclass('source_files') IS NOT NULL AS ok");
    expect(rows[0].ok).toBe(true);
  });
});
