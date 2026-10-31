import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
// Decimal from money.ts: the application sets its precision to 40 digits (plain decimal.js keeps only 20)
import { Decimal } from '../src/shared/money';
import { clickHouseConfigFromEnv, createClickHouse } from '../src/shared/clickhouse';
import { clickhouseUp } from './helpers/stack';

describe.runIf(clickhouseUp)('clickhouse wrapper', () => {
  const ch = createClickHouse(clickHouseConfigFromEnv());
  const table = `believe_stage.wrapper_test_${randomUUID().replaceAll('-', '')}`;
  afterAll(async () => {
    await ch.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await ch.close();
  });

  const rows = async <T>(query: string, query_params?: Record<string, unknown>): Promise<T[]> =>
    (await ch.query({ query, query_params, format: 'JSONEachRow' })).json<T>();

  it('answers a ping', async () => {
    expect((await ch.ping({ select: true })).success).toBe(true);
  });

  it('returns Decimal and Int64/Int128 as exact text, not as rounded numbers', async () => {
    const [r] = await rows<{ d: unknown; i: unknown; big: unknown }>(
      "SELECT toDecimal128('0.006989549999', 12) AS d, toInt64(9007199254740993) AS i, toInt128('170141183460469231731687303715884105727') AS big",
    );
    expect(r).toEqual({
      d: '0.006989549999',
      i: '9007199254740993',
      big: '170141183460469231731687303715884105727',
    });
  });

  it('round-trips money through an insert and sums it without overflow', async () => {
    await ch.command({ query: `CREATE TABLE ${table} (n Decimal(38, 12), q Int64) ENGINE = Memory` });
    const values = ['0.006989549999', '0.000001477385', '-0.000000000001', '123456789.123456789012'];
    await ch.insert({
      table,
      format: 'JSONEachRow',
      values: values.map((n) => ({ n, q: '9000000000000000000' })),
    });
    const [r] = await rows<{ total_n: string; total_q: string }>(
      `SELECT sum(n) AS total_n, sum(toInt128(q)) AS total_q FROM ${table}`,
    );
    expect(new Decimal(r?.total_n ?? 'x').equals(values.reduce((a, v) => a.plus(v), new Decimal(0)))).toBe(
      true,
    );
    // 4 x 9e18 is above the Int64 maximum (9.22e18): the Int128 sum is exact
    expect(r?.total_q).toBe('36000000000000000000');
  });

  it('binds query parameters instead of pasting text', async () => {
    const tricky = "x' OR '1'='1";
    const [r] = await rows<{ v: string }>('SELECT {v:String} AS v', { v: tricky });
    expect(r?.v).toBe(tricky);
  });

  it('has the migrated believe schema', async () => {
    const [r] = await rows<{ n: string }>(
      "SELECT count() AS n FROM system.tables WHERE database = 'believe' AND name IN ('rows', 'units', 'lines', 'file_totals')",
    );
    expect(r?.n).toBe('4');
  });
});
