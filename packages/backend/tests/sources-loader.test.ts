import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BELIEVE_COLUMNS, createBelieveLoader } from '../src/modules/sources';
import { believeReport, writeReport, type Spec } from './helpers/believe-csv';
import { createIsolatedSources } from './helpers/sources-stack';
import { clickhouseUp, postgresUp } from './helpers/stack';

// Synthetic data only. Everything runs in a private PostgreSQL database and private ClickHouse databases.
const ACCOUNT_A = '9999001';
const ACCOUNT_B = '9999002';

describe.runIf(postgresUp && clickhouseUp)('Believe loader (PostgreSQL registry + ClickHouse rows)', () => {
  let iso: Awaited<ReturnType<typeof createIsolatedSources>>;
  let dir: string;
  let loader: ReturnType<typeof createBelieveLoader>;

  beforeAll(async () => {
    iso = await createIsolatedSources();
    dir = join(iso.storageDir, 'in');
    mkdirSync(dir, { recursive: true });
    loader = createBelieveLoader({
      registry: iso.registry,
      columnar: iso.columnar,
      storageDir: join(iso.storageDir, 'kept'),
    });
  });
  afterAll(() => iso.close());

  const file = (account: string, month: string, content: string) => writeReport(dir, account, month, content);
  const report = (rows: Spec[], month = '2026-07', opts: Parameters<typeof believeReport>[1] = {}) =>
    believeReport(rows, { month, ...opts });
  const rowsOf = async <T>(query: string, params?: Record<string, unknown>): Promise<T[]> =>
    (await iso.ch.query({ query, query_params: params, format: 'JSONEachRow' })).json<T>();
  const filesOf = async (account: string) =>
    (
      await iso.pg.pool.query<{ status: string }>(
        'SELECT status FROM source_files WHERE account = $1 ORDER BY created_at',
        [account],
      )
    ).rows.map((r) => r.status);
  const stageTables = async () =>
    (
      await rowsOf<{ n: string }>(
        'SELECT toString(count()) AS n FROM system.tables WHERE database = {db:String}',
        { db: iso.stageDatabase },
      )
    )[0]?.n;

  it('loads a report as it is and lets the views sum equal keys', async () => {
    const rows: Spec[] = [
      { quantity: '1', unitPrice: '0.005337719293', gross: '0.005337719293', net: '0.004537061398' },
      { quantity: '2', unitPrice: '0.004', gross: '0.008', net: '0.0068' },
      { quantity: '-1', unitPrice: '0.001', gross: '-0.001', net: '-0.00085' },
      {
        isrc: 'xx-tst-26-00002',
        subscription: '',
        gross: '123456789.123456789012',
        net: '100000000.000000000001',
      },
    ];
    const rec = await loader.ingestBelieve(file(ACCOUNT_A, '2026-07', report(rows)));
    expect(rec).toMatchObject({
      status: 'loaded',
      account: ACCOUNT_A,
      reportingMonth: '2026-07',
      lineCount: 4,
      uploadedBy: 'operator',
    });
    expect(rec.netTotal).toBe('100000000.010487061399');
    expect(rec.grossTotal).toBe('123456789.135794508305');
    expect(rec.sha256).toMatch(/^[0-9a-f]{64}$/);

    // every line is stored, nothing merged, ISRC normalized, an empty subscription type is kept empty
    expect(await iso.columnar.fileRows(rec.id)).toBe('4');
    const stored = await rowsOf<{ isrc: string; sub: string }>(
      `SELECT isrc, streaming_subscription_type AS sub FROM ${iso.database}.rows WHERE file_id = {id:UUID} AND isrc = {isrc:String}`,
      { id: rec.id, isrc: 'XXTST2600002' },
    );
    expect(stored).toEqual([{ isrc: 'XXTST2600002', sub: '' }]);

    // the views sum the three lines of the first key into one record
    const lines = await rowsOf<{ quantity: string; merged_lines: string; net_revenue: string }>(
      `SELECT toString(quantity) AS quantity, toString(merged_lines) AS merged_lines, toString(net_revenue) AS net_revenue FROM ${iso.database}.lines WHERE file_id = {id:UUID} AND isrc = {isrc:String}`,
      { id: rec.id, isrc: 'XXTST2600001' },
    );
    expect(lines).toEqual([{ quantity: '2', merged_lines: '3', net_revenue: '0.010487061398' }]);
    const [totals] = await rowsOf<{ line_count: string; key_count: string; net_revenue: string }>(
      `SELECT toString(line_count) AS line_count, toString(key_count) AS key_count, toString(net_revenue) AS net_revenue FROM ${iso.database}.file_totals WHERE file_id = {id:UUID}`,
      { id: rec.id },
    );
    expect(totals).toEqual({ line_count: '4', key_count: '2', net_revenue: '100000000.010487061399' });

    expect((await iso.registry.loaded()).map((r) => r.id)).toContain(rec.id);
    expect(await stageTables()).toBe('0'); // the stage table is gone
  });

  it('keeps the units_by_label projection in every attached part and answers the units view from it (D-122, D-124)', async () => {
    const rows: Spec[] = [
      { isrc: 'QZTST2600011', net: '1.5' },
      { isrc: 'QZTST2600011', net: '2.25', platform: 'Other' },
      { isrc: 'QZTST2600012', net: '-0.000000000001' },
    ];
    const rec = await loader.ingestBelieve(file('9999003', '2026-08', report(rows, '2026-08')));
    // the stage table was created AS rows, so the part arrived with its projection already built
    const parts = await rowsOf<{ name: string; projections: string[] }>(
      `SELECT name, projections FROM system.parts WHERE database = {db:String} AND table = 'rows' AND active AND position(partition, {id:String}) > 0`,
      { db: iso.database, id: rec.id },
    );
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) expect(p.projections).toContain('units_by_label');

    const query = `SELECT isrc, toString(net_revenue) AS net FROM ${iso.database}.units WHERE file_id IN {ids:Array(UUID)} `;
    const plan = (await rowsOf<{ explain: string }>(`EXPLAIN ${query}`, { ids: [rec.id] }))
      .map((r) => r.explain)
      .join('\n');
    expect(plan).toContain('ReadFromMergeTree (units_by_label)');
    // the projection gives exactly what the raw lines give
    const byIsrc = (a: { isrc: string }, b: { isrc: string }) => a.isrc.localeCompare(b.isrc);
    const viaProjection = (await rowsOf<{ isrc: string; net: string }>(query, { ids: [rec.id] })).sort(byIsrc);
    const viaRows = (
      await rowsOf<{ isrc: string; net: string }>(`${query} SETTINGS optimize_use_projections = 0`, {
        ids: [rec.id],
      })
    ).sort(byIsrc);
    expect(viaProjection).toEqual([
      { isrc: 'QZTST2600011', net: '3.75' },
      { isrc: 'QZTST2600012', net: '-0.000000000001' },
    ]);
    expect(viaRows).toEqual(viaProjection);
    const units = await iso.columnar.units([rec.id]);
    expect(units.map((u) => [u.isrc, u.reportingMonth, u.net])).toEqual([
      ['QZTST2600011', '2026-08', '3.75'],
      ['QZTST2600012', '2026-08', '-0.000000000001'],
    ]);
  });

  it('gives two units for one ISRC/UPC/month with different label strings (D-124)', async () => {
    const rows: Spec[] = [
      { isrc: 'QZTST2600021', net: '1', labelName: 'Label One' },
      { isrc: 'QZTST2600021', net: '2', labelName: 'Label Two' },
      { isrc: 'QZTST2600021', net: '4', labelName: 'Label Two', platform: 'Other' },
    ];
    const rec = await loader.ingestBelieve(file('9999004', '2026-09', report(rows, '2026-09')));
    const units = await iso.columnar.units([rec.id]);
    expect(units.map((u) => [u.isrc, u.labelName, u.net])).toEqual([
      ['QZTST2600021', 'Label One', '1'],
      ['QZTST2600021', 'Label Two', '6'],
    ]);
  });

  it('refuses a second file for the same account and month, and the same file again', async () => {
    const other = file(ACCOUNT_A, '2026-07', report([{ isrc: 'XX-TST-26-00009' }]));
    await expect(loader.ingestBelieve(other)).rejects.toMatchObject({
      statusCode: 409,
      code: 'duplicate_period',
    });

    const first = file(ACCOUNT_B, '2026-07', report([{ isrc: 'XX-TST-26-00010' }]));
    const rec = await loader.ingestBelieve(first); // another account, same month: accepted
    expect(rec.account).toBe(ACCOUNT_B);
    // identical bytes under another name: the sha256 stops it
    const renamed = file(ACCOUNT_B, '2026-08', report([{ isrc: 'XX-TST-26-00010' }], '2026-08'));
    await expect(
      loader.ingestBelieve({ path: first.path, fileName: renamed.fileName }),
    ).rejects.toMatchObject({
      code: 'duplicate_file',
    });
    expect(await filesOf(ACCOUNT_A)).toEqual(['loaded']); // nothing was added by the refusals
    expect(await filesOf(ACCOUNT_B)).toEqual(['loaded']);
  });

  it.each([
    [
      'a row of another month',
      (m: string) => report([{}, { reportingMonth: '2025/01/01' }], m),
      /differs from the file month/,
    ],
    ['a currency other than USD', (m: string) => report([{ currency: 'EUR' }], m), /only USD/],
    [
      'an amount with more than 12 decimals',
      (m: string) => report([{ net: '0.1234567890123' }], m),
      /more than 12 decimals/,
    ],
    ['an amount that is not a number', (m: string) => report([{ gross: 'abc' }], m), /Gross Revenue/],
    ['a bad quantity', (m: string) => report([{ quantity: '1.5' }], m), /Quantity/],
    ['a row with an extra field', (m: string) => report([{}], m, { extraField: true }), /fields, header has/],
    [
      'a header without the Net Revenue column',
      (m: string) => report([{}], m, { header: BELIEVE_COLUMNS.filter((c) => c !== 'Net Revenue') }),
      /missing columns/,
    ],
    ['a header and no lines', (m: string) => report([], m), /no lines/],
    ['an empty file', () => '', /empty/],
  ])('rejects %s and leaves nothing behind', async (_name, build, message) => {
    const month = '2026-09';
    const before = await filesOf(ACCOUNT_A);
    await expect(loader.ingestBelieve(file(ACCOUNT_A, month, build(month)))).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(message),
    });
    const after = await filesOf(ACCOUNT_A);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[after.length - 1]).toBe('failed'); // recorded as failed, so it does not block the month
    expect(await stageTables()).toBe('0');
  });

  it('accepts a corrected file for a month whose earlier attempts failed', async () => {
    const rec = await loader.ingestBelieve(file(ACCOUNT_A, '2026-09', report([{}], '2026-09')));
    expect(rec.status).toBe('loaded');
    expect((await filesOf(ACCOUNT_A)).filter((s) => s === 'loaded')).toHaveLength(2); // 2026-07 and 2026-09
  });

  it('writes in batches (several inserts, one in flight) without losing a line', async () => {
    const small = createBelieveLoader({
      registry: iso.registry,
      columnar: iso.columnar,
      storageDir: join(iso.storageDir, 'kept'),
      batchRows: 2,
    });
    const rows = Array.from({ length: 7 }, (_, i) => ({
      isrc: `XX-TST-26-1000${i}`,
      gross: '0.1',
      net: '0.085',
    }));
    const rec = await small.ingestBelieve(file(ACCOUNT_A, '2026-10', report(rows, '2026-10')));
    expect(rec).toMatchObject({ lineCount: 7, netTotal: '0.595', grossTotal: '0.7' });
    expect(await iso.columnar.fileRows(rec.id)).toBe('7');
  });

  it('rolls the partition back and marks the file failed when the registry cannot confirm the load', async () => {
    const broken = createBelieveLoader({
      registry: { ...iso.registry, markLoaded: () => Promise.reject(new Error('postgres went away')) },
      columnar: iso.columnar,
      storageDir: join(iso.storageDir, 'kept'),
    });
    const f = file(ACCOUNT_A, '2026-11', report([{}], '2026-11'));
    await expect(broken.ingestBelieve(f)).rejects.toThrow('postgres went away');
    const [r] = (await iso.registry.list()).filter(
      (x) => x.account === ACCOUNT_A && x.reportingMonth === '2026-11',
    );
    expect(r?.status).toBe('failed');
    expect(await iso.columnar.fileRows(r?.id as string)).toBe('0'); // not visible in believe.rows
    expect(await stageTables()).toBe('0');
    expect((await loader.ingestBelieve(f)).status).toBe('loaded'); // and the same file can be loaded again
  });

  it('stops before attaching when the stage table does not match what was read', async () => {
    const lossy = createBelieveLoader({
      registry: iso.registry,
      columnar: {
        ...iso.columnar,
        stageTotals: async (id) => ({ ...(await iso.columnar.stageTotals(id)), lines: '1' }),
      },
      storageDir: join(iso.storageDir, 'kept'),
    });
    const f = file(ACCOUNT_A, '2026-12', report([{}, { isrc: 'XX-TST-26-00077' }], '2026-12'));
    await expect(lossy.ingestBelieve(f)).rejects.toThrow(/Control check failed/);
    const [r] = (await iso.registry.list()).filter(
      (x) => x.account === ACCOUNT_A && x.reportingMonth === '2026-12',
    );
    expect(r?.status).toBe('failed');
    expect(await iso.columnar.fileRows(r?.id as string)).toBe('0');
    expect(await stageTables()).toBe('0');
  });
});
