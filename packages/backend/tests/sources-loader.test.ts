import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app';
import { BELIEVE_COLUMNS, createBelieveLoader } from '../src/modules/sources';
import { believeReport, writeReport, type Spec } from './helpers/believe-csv';
import { newFacade, TMP, tmpPath, writeBelieve, type TestFacade } from './helpers/fixtures';
import { createIsolatedSources } from './helpers/sources-stack';
import { clickhouseUp, postgresUp } from './helpers/stack';
import { testQuery } from './helpers/test-sources';
import { writer } from './helpers/writer';

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

// D-169: a Believe file is loaded under an own label; its account must be registered under that label. Every refusal
// happens before the module's serial load: no registry row, no ClickHouse rows, no audit row.
describe.runIf(postgresUp && clickhouseUp)('a Believe file is loaded under a label (D-169)', () => {
  const ACC1 = '1052428'; // registered under 0to8 by newFacade
  const ACC2 = '1055956'; // registered under Echo8 by newFacade
  const I1 = 'QZTST2600001';
  const UPC = '1234567890123';
  let seq = 0;
  const setup = async () => {
    const f = await newFacade();
    const tmpDir = join(TMP, `label-uploads-${++seq}`);
    return { f, app: createApp(f, { tmpDir }), tmpDir, zero: f.testLabels['0to8'], echo: f.testLabels.Echo8 };
  };
  const state = async (f: TestFacade) => ({
    files: (await f.modules.sources.listFiles()).length,
    rows: await testQuery<{ n: string }>((db) => `SELECT toString(count()) AS n FROM ${db}.rows`),
    audit: (await f.recentActions(500)).length,
  });

  it('refuses a file whose account is not registered (account_unregistered): registry, ClickHouse and audit unchanged', async () => {
    const { f, app, zero } = await setup();
    const before = await state(f);
    const file = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '10' }], { account: '2799101' });
    const res = await writer(app).post('/api/v1/sources/believe').query({ label: zero }).attach('file', file.path, file.fileName);
    expect([res.status, res.body.error.code, res.body.error.details]).toEqual([422, 'account_unregistered', { account: '2799101' }]);
    await expect(f.ingestBelieve(file, zero)).rejects.toMatchObject({ statusCode: 422, code: 'account_unregistered' });
    expect(await state(f)).toEqual(before);
  });

  it("refuses a file of another label's account", async () => {
    const { f, zero, echo } = await setup();
    const file = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '10' }], { account: ACC2 });
    await expect(f.ingestBelieve(file, zero)).rejects.toMatchObject({
      statusCode: 422,
      code: 'account_of_other_label',
      details: { account: ACC2, labelId: echo, labelName: 'Echo8' },
    });
    expect(await f.modules.sources.listFiles()).toEqual([]);
    expect((await f.ingestBelieve(file, echo)).status).toBe('loaded'); // under its own label it loads
  });

  it('stores label_id and uploaded_by', async () => {
    const { f, app, zero, echo } = await setup();
    const file = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '10' }], { account: ACC2 });
    const res = await writer(app, 'uploading operator')
      .post('/api/v1/sources/believe')
      .query({ label: echo })
      .attach('file', file.path, file.fileName);
    expect(res.status).toBe(201);
    expect([res.body.labelId, res.body.uploadedBy]).toEqual([echo, 'uploading operator']);
    const [stored] = await f.modules.sources.listFiles({ labelId: echo });
    expect([stored?.id, stored?.labelId, stored?.uploadedBy, stored?.status]).toEqual([res.body.id, echo, 'uploading operator', 'loaded']);
    expect(await f.modules.sources.listFiles({ labelId: zero })).toEqual([]);
    const files = await f.sourceFiles(echo);
    expect(files.believe.map((x) => [x.id, x.labelId])).toEqual([[res.body.id, echo]]);
    expect((await f.sourceFiles(zero)).believe).toEqual([]);
    // the lines under a label read only the files of that label
    expect((await f.sourceLines({ isrc: I1, labelId: zero })).items).toEqual([]);
    expect((await f.sourceLines({ isrc: I1, labelId: echo })).items.map((l) => l.fileId)).toEqual([res.body.id]);
  });

  it('the label is checked before the upload is received', async () => {
    const { f, app, tmpDir } = await setup();
    // a body that is not even multipart: were it read first, the answer would be a validation_error about the upload
    const send = (query: Record<string, string>) =>
      writer(app).post('/api/v1/sources/believe').query(query).set('Content-Type', 'text/plain').send('not a multipart body');
    const missing = await send({});
    expect([missing.status, missing.body.error.code]).toEqual([400, 'label_required']);
    const unknown = await send({ label: 'no-such-label' });
    expect([unknown.status, unknown.body.error.code]).toEqual([404, 'not_found']);
    const sub = await f.modules.labels.createLabel({ name: 'Sub Upload', kind: 'sublabel', ownLabelId: f.testLabels['0to8'] });
    const notOwn = await send({ label: sub.id });
    expect([notOwn.status, notOwn.body.error.code]).toEqual([400, 'label_not_own']);
    const b17 = await writer(app).post('/api/v1/publishing/b17').set('Content-Type', 'text/plain').send('not a multipart body');
    expect([b17.status, b17.body.error.code]).toEqual([400, 'label_required']);
    // nothing was received: the upload directory was never created
    expect(existsSync(tmpDir) ? readdirSync(tmpDir) : []).toEqual([]);
    // with the label the same body reaches the upload and fails there
    const received = await send({ label: f.testLabels['0to8'] });
    expect([received.status, received.body.error.code]).toEqual([400, 'validation_error']);
  });

  it('the account is checked before sha256 and duplicate_period', async () => {
    const { f, zero, echo } = await setup();
    const first = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '10' }], { account: ACC1 });
    await f.ingestBelieve(first, zero);
    // the very same file (same period, same sha256) under another label: the account answers first
    await expect(f.ingestBelieve(first, echo)).rejects.toMatchObject({ code: 'account_of_other_label' });
    // the same content as a file of an unregistered account: account_unregistered, not duplicate_file
    const copyName = '9599001_2799102_2026-07-01_2026-07-01.csv';
    const copy = tmpPath(copyName);
    writeFileSync(copy, readFileSync(first.path));
    await expect(f.ingestBelieve({ path: copy, fileName: copyName }, zero)).rejects.toMatchObject({ code: 'account_unregistered' });
    // under its own label the module's order follows: duplicate_period, then duplicate_file
    await expect(f.ingestBelieve(first, zero)).rejects.toMatchObject({ code: 'duplicate_period' });
    // a bad file name is refused before the account (validation_error)
    await expect(f.ingestBelieve({ path: copy, fileName: 'not-a-believe-name.csv' }, zero)).rejects.toMatchObject({ code: 'validation_error' });
    await expect(f.ingestBelieve(first, undefined)).rejects.toMatchObject({ code: 'label_required' });
    expect((await f.modules.sources.listFiles()).length).toBe(1);
  });

  it('an account with files is not removed (account_has_files)', async () => {
    const { f, zero, echo } = await setup();
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '10' }], { account: ACC1 }), zero);
    await expect(f.removeLabelAccount(zero, ACC1)).rejects.toMatchObject({
      statusCode: 409,
      code: 'account_has_files',
      details: { account: ACC1, files: 1 },
    });
    await expect(f.removeLabelAccount(echo, ACC1)).rejects.toMatchObject({ statusCode: 404 }); // not this label's account
    await expect(f.removeLabelAccount('no-such-label', ACC2)).rejects.toMatchObject({ statusCode: 404 });
    // an account without files is removed; its files are refused until it is registered again
    expect((await f.removeLabelAccount(echo, ACC2)).accounts).toEqual([]);
    const echoFile = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '5' }], { account: ACC2 });
    await expect(f.ingestBelieve(echoFile, echo)).rejects.toMatchObject({ code: 'account_unregistered' });
    await f.modules.labels.addAccount(echo, ACC2);
    expect((await f.ingestBelieve(echoFile, echo)).labelId).toBe(echo);
    expect((await f.listLabels()).find((l) => l.id === zero)?.accounts).toEqual([ACC1]);
  });
});
