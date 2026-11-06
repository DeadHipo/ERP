import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { believeReport, writeReport } from './helpers/believe-csv';
import { createIsolatedSources } from './helpers/sources-stack';
import { clickhouseUp, postgresUp } from './helpers/stack';

const A = '9999001';
const B = '9999002';
const I1 = 'XXTST2600001';
const I2 = 'XXTST2600002';
const I3 = 'XXTST2600003';
const pico = (s: string) => BigInt(s.replace('.', '').padEnd(13, '0').slice(0, 13));

describe.runIf(postgresUp && clickhouseUp)('sources service on PostgreSQL + ClickHouse', () => {
  let iso: Awaited<ReturnType<typeof createIsolatedSources>>;
  let dir: string;
  beforeAll(async () => {
    iso = await createIsolatedSources();
    dir = join(iso.storageDir, 'in');
    mkdirSync(dir, { recursive: true });
  });
  afterAll(() => iso.close());

  const unitsKey = (u: { account: string; isrc: string; reportingMonth: string; salesMonth: string }) =>
    `${u.account} ${u.isrc} ${u.reportingMonth} ${u.salesMonth}`;

  it('gives nothing while no file is loaded', async () => {
    const s = iso.service;
    expect(await s.units()).toEqual([]);
    expect(await s.breakdown(I1)).toEqual([]);
    expect((await s.pairAttributes()).size).toBe(0);
    expect(await s.activeFiles()).toEqual([]);
    expect(await s.listFiles()).toEqual([]);
  });

  it('loads files and gives units with the account, equal keys summed, amounts as pico', async () => {
    const s = iso.service;
    await s.ingestBelieve(
      writeReport(
        dir,
        A,
        '2026-07',
        believeReport(
          [
            { isrc: 'XX-TST-26-00001', net: '0.1', artist: 'Artist A', track: 'Track One' },
            { isrc: 'XX-TST-26-00001', net: '0.2', artist: 'Artist A', track: 'Track One' }, // same key: summed
            {
              isrc: 'XX-TST-26-00001',
              platform: 'Apple Music',
              country: 'Poland',
              subscription: '',
              salesMonth: '2026/05/01',
              net: '0.5',
              artist: 'Artist A',
            },
            {
              isrc: 'XX-TST-26-00002',
              upc: '3617380000002',
              salesMonth: '2026/07/01',
              net: '1',
              artist: 'Artist A2',
            },
          ],
          { month: '2026-07' },
        ),
      ),
    );
    await s.ingestBelieve({
      ...writeReport(
        dir,
        B,
        '2026-08',
        believeReport(
          [
            { isrc: 'XX-TST-26-00001', salesMonth: '2026/07/01', net: '0.3', artist: 'Artist B' },
            { isrc: 'XX-TST-26-00003', upc: '3617380000003', net: '2', artist: 'Artist B3' },
          ],
          { month: '2026-08' },
        ),
      ),
      labelId: 'label-b', // opaque text for the module (D-169)
    });
    const units = await s.units();
    expect(units.map((u) => ({ ...u }))).toEqual(
      expect.arrayContaining([
        {
          source: 'believe',
          account: A,
          isrc: I1,
          upc: '3617380000001',
          reportingMonth: '2026-07',
          salesMonth: '2026-06',
          labelName: 'Test Label',
          labelId: null,
          netPico: pico('0.3'),
        },
        {
          source: 'believe',
          account: A,
          isrc: I1,
          upc: '3617380000001',
          reportingMonth: '2026-07',
          salesMonth: '2026-05',
          labelName: 'Test Label',
          labelId: null,
          netPico: pico('0.5'),
        },
        {
          source: 'believe',
          account: A,
          isrc: I2,
          upc: '3617380000002',
          reportingMonth: '2026-07',
          salesMonth: '2026-07',
          labelName: 'Test Label',
          labelId: null,
          netPico: pico('1'),
        },
        {
          source: 'believe',
          account: B,
          isrc: I1,
          upc: '3617380000001',
          reportingMonth: '2026-08',
          salesMonth: '2026-07',
          labelName: 'Test Label',
          labelId: 'label-b',
          netPico: pico('0.3'),
        },
        {
          source: 'believe',
          account: B,
          isrc: I3,
          upc: '3617380000003',
          reportingMonth: '2026-08',
          salesMonth: '2026-06',
          labelName: 'Test Label',
          labelId: 'label-b',
          netPico: pico('2'),
        },
      ]),
    );
    expect(units).toHaveLength(5);
    expect(units.every((u) => typeof u.netPico === 'bigint')).toBe(true);
  });

  it('the label of a file (D-169): the units carry it, a snapshot narrows to the files of labels, a file without one is marked once', async () => {
    const s = iso.service;
    expect((await s.snapshot({ labelIds: ['label-b'] })).units.map(unitsKey).sort()).toEqual([
      `${B} ${I1} 2026-08 2026-07`,
      `${B} ${I3} 2026-08 2026-06`,
    ]);
    expect((await s.snapshot({ labelIds: [] })).units).toEqual([]);
    // the files of the answer stay all the files in force (D-161)
    expect((await s.snapshot({ labelIds: ['label-b'] })).files).toHaveLength(2);
    expect([...(await s.netByUpc({ labelIds: ['label-b'] })).keys()].sort()).toEqual(['3617380000001', '3617380000003']);
    const files = await s.filesOfLabel('label-b');
    expect(files.map((f) => f.account)).toEqual([B]);
    expect(await s.isrcsOfFiles(files.map((f) => f.id))).toEqual([I1, I3].sort());
    expect(await s.isrcsOfFiles([])).toEqual([]);
    // D-172: the distinct ISRCs of every UPC in the files (the completeness of a registry release)
    const byUpc = await s.isrcsOfUpcs(files.map((f) => f.id));
    expect(byUpc.map((x) => x.upc)).toEqual(['3617380000001', '3617380000003']);
    expect(byUpc.flatMap((x) => x.isrcs).sort()).toEqual([I1, I3].sort());
    expect(await s.isrcsOfUpcs(files.map((f) => f.id), ['3617380000003'])).toEqual([{ upc: '3617380000003', isrcs: [I3] }]);
    expect([await s.isrcsOfUpcs([]), await s.isrcsOfUpcs(files.map((f) => f.id), [])]).toEqual([[], []]);
    const fileA = (await s.listFiles()).find((f) => f.account === A) as { id: string };
    expect(await s.assignFileLabel(files[0]?.id as string, 'label-x')).toBe(false); // a label is never changed
    expect(await s.assignFileLabel(fileA.id, 'label-a')).toBe(true);
    expect(await s.assignFileLabel(fileA.id, 'label-x')).toBe(false);
    expect((await s.units({ labelIds: ['label-a'] })).every((u) => u.account === A && u.labelId === 'label-a')).toBe(true);
    // back as it was for the tests below
    await iso.pg.pool.query(`UPDATE source_files SET label_id = NULL WHERE id = $1`, [fileA.id]);
  });

  it('filters units by report month and by sales month', async () => {
    const s = iso.service;
    expect((await s.units({ from: '2026-08' })).map(unitsKey).sort()).toEqual([
      `${B} ${I1} 2026-08 2026-07`,
      `${B} ${I3} 2026-08 2026-06`,
    ]);
    expect((await s.units({ to: '2026-07', basis: 'report' })).every((u) => u.account === A)).toBe(true);
    // by sales month: July sales are the unit of ISRC 2 (file A) and ISRC 1 (file B)
    expect((await s.units({ from: '2026-07', to: '2026-07', basis: 'sales' })).map(unitsKey).sort()).toEqual([
      `${A} ${I2} 2026-07 2026-07`,
      `${B} ${I1} 2026-08 2026-07`,
    ]);
    expect(await s.units({ from: '2027-01' })).toEqual([]);
  });

  it('lists files, active files and one file; an unknown id is a 404', async () => {
    const s = iso.service;
    const files = await s.listFiles();
    expect(files.map((f) => `${f.account} ${f.reportingMonth} ${f.status}`)).toEqual([
      `${B} 2026-08 loaded`,
      `${A} 2026-07 loaded`,
    ]);
    const active = await s.activeFiles();
    expect(active.map((f) => f.reportingMonth).sort()).toEqual(['2026-07', '2026-08']);
    expect(active[0]).toMatchObject({
      id: expect.any(String),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      fileName: expect.stringContaining('.csv'),
    });
    expect((await s.getFile(files[0]?.id as string)).id).toBe(files[0]?.id);
    await expect(s.getFile('11111111-1111-1111-1111-111111111111')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('explains one ISRC per month, platform, country and type', async () => {
    const rows = await iso.service.breakdown(I1);
    expect(rows).toEqual([
      {
        reportingMonth: '2026-07',
        salesMonth: '2026-05',
        platform: 'Apple Music',
        country: 'Poland',
        subscriptionType: '',
        salesType: 'Stream',
        upc: '3617380000001',
        net: '0.5',
        quantity: 1,
      },
      {
        reportingMonth: '2026-07',
        salesMonth: '2026-06',
        platform: 'Spotify',
        country: 'Latvia',
        subscriptionType: 'Premium',
        salesType: 'Stream',
        upc: '3617380000001',
        net: '0.3',
        quantity: 2,
      },
      {
        reportingMonth: '2026-08',
        salesMonth: '2026-07',
        platform: 'Spotify',
        country: 'Latvia',
        subscriptionType: 'Premium',
        salesType: 'Stream',
        upc: '3617380000001',
        net: '0.3',
        quantity: 1,
      },
    ]);
    expect(await iso.service.breakdown('XXNOSUCH0000')).toEqual([]);
  });

  it('takes the names of a pair from its latest report month', async () => {
    const names = await iso.service.pairAttributes();
    expect(names.get(`${I1}|3617380000001`)).toMatchObject({ artistName: 'Artist B' }); // August beats July
    expect(names.get(`${I2}|3617380000002`)).toMatchObject({ artistName: 'Artist A2' });
    expect(names.size).toBe(3);
  });

  it('ignores a file that is not loaded, even though its rows are in ClickHouse', async () => {
    const s = iso.service;
    const rec = await s.ingestBelieve(
      writeReport(
        dir,
        A,
        '2026-09',
        believeReport([{ isrc: 'XX-TST-26-00001', net: '99', artist: 'Artist C' }], { month: '2026-09' }),
      ),
    );
    expect((await s.units()).some((u) => u.reportingMonth === '2026-09')).toBe(true);
    // the registry stops vouching for the file (as during a failed load or a replacement)
    await iso.pg.pool.query("UPDATE source_files SET status = 'superseded' WHERE id = $1", [rec.id]);
    expect(await iso.columnar.fileRows(rec.id)).toBe('1'); // its row is still in ClickHouse
    expect((await s.units()).some((u) => u.reportingMonth === '2026-09')).toBe(false);
    expect((await s.breakdown(I1)).some((b) => b.reportingMonth === '2026-09')).toBe(false);
    expect((await s.pairAttributes()).get(`${I1}|3617380000001`)).toMatchObject({ artistName: 'Artist B' });
    expect((await s.activeFiles()).some((f) => f.id === rec.id)).toBe(false);
    expect((await s.listFiles()).find((f) => f.id === rec.id)?.status).toBe('superseded');
  });

  describe('lines of the chosen report files', () => {
    const idOf = async (account: string) =>
      (await iso.service.listFiles()).find((f) => f.account === account && f.status === 'loaded')
        ?.id as string;
    const keys = (r: { items: { isrc: string; platform: string; salesMonth: string }[] }) =>
      r.items.map((l) => `${l.isrc} ${l.platform} ${l.salesMonth}`);

    it('without files reads the newest report month; the totals cover everything that matches', async () => {
      const r = await iso.service.lines();
      expect(r.files.map((f) => [f.account, f.reportingMonth])).toEqual([[B, '2026-08']]);
      expect(keys(r)).toEqual([`${I3} Spotify 2026-06`, `${I1} Spotify 2026-07`]); // by net, largest first
      expect(r.total).toEqual({ keys: '2', quantity: '2', gross: '0.008', net: '2.3', mergedLines: '2' });
      expect(r).toMatchObject({ limit: 100, offset: 0, sort: 'net', dir: 'desc' });
    });

    it('sums equal keys, keeps their count, and shows the account and the names of the pair', async () => {
      const r = await iso.service.lines({ fileIds: [await idOf(A)] });
      expect(r.items.map((l) => [l.isrc, l.net, l.quantity, l.mergedLines])).toEqual([
        [I2, '1', '1', '1'],
        [I1, '0.5', '1', '1'],
        [I1, '0.3', '2', '2'], // the two lines of one key
      ]);
      expect(r.items[0]).toMatchObject({
        account: A,
        reportingMonth: '2026-07',
        artistName: 'Artist A2',
        releaseType: 'Music Release',
        salesType: 'Stream',
        currency: 'USD',
      });
      expect(r.items[2]).toMatchObject({
        artistName: 'Artist A',
        trackTitle: 'Test Track', // the name of the latest report month (August) wins
        platform: 'Spotify',
        country: 'Latvia',
        subscriptionType: 'Premium',
      });
    });

    it('an ISRC (any spelling) without files reads all loaded files', async () => {
      const r = await iso.service.lines({ isrc: 'xx-tst-26-00001' });
      expect(r.files).toHaveLength(2);
      expect(r.items.map((l) => [l.account, l.reportingMonth])).toEqual(
        expect.arrayContaining([
          [A, '2026-07'],
          [B, '2026-08'],
        ]),
      );
      expect(r.total.keys).toBe('3');
      expect((await iso.service.lines({ isrc: 'XXNOSUCH0000' })).total).toEqual({
        keys: '0',
        quantity: '0',
        gross: '0',
        net: '0',
        mergedLines: '0',
      });
    });

    it('filters by platform, empty subscription type, sales months and UPC', async () => {
      const both = [await idOf(A), await idOf(B)];
      expect(keys(await iso.service.lines({ fileIds: both, platform: 'Apple Music' }))).toEqual([
        `${I1} Apple Music 2026-05`,
      ]);
      expect(keys(await iso.service.lines({ fileIds: both, subscriptionType: '(none)' }))).toEqual([
        `${I1} Apple Music 2026-05`,
      ]);
      expect(
        keys(await iso.service.lines({ fileIds: both, subscriptionType: 'Premium', country: 'Poland' })),
      ).toEqual([]);
      const july = await iso.service.lines({ fileIds: both, salesFrom: '2026-07', salesTo: '2026-07' });
      expect(july.items.map((l) => [l.account, l.isrc]).sort()).toEqual([
        [A, I2],
        [B, I1],
      ]);
      expect(keys(await iso.service.lines({ fileIds: both, upc: '3617380000003' }))).toEqual([
        `${I3} Spotify 2026-06`,
      ]);
    });

    it('sorts and pages; the totals do not depend on the page', async () => {
      const f = [await idOf(A)];
      const asc = await iso.service.lines({ fileIds: f, sort: 'net', dir: 'asc', limit: 2, offset: 1 });
      expect(asc.items.map((l) => l.net)).toEqual(['0.5', '1']);
      expect(asc.total).toMatchObject({ keys: '3', net: '1.8' });
      const byIsrc = await iso.service.lines({ fileIds: f, sort: 'isrc', dir: 'asc', limit: 1 });
      expect(byIsrc.items[0]?.isrc).toBe(I1);
      expect((await iso.service.lines({ fileIds: f, offset: 3 })).items).toEqual([]);
    });

    it('refuses a file that is not loaded, a bad page size and a bad month', async () => {
      const gone = (await iso.service.listFiles()).find((x) => x.status === 'superseded')?.id as string;
      await expect(iso.service.lines({ fileIds: [gone] })).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('Not a loaded'),
      });
      await expect(
        iso.service.lines({ fileIds: ['11111111-1111-1111-1111-111111111111'] }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(iso.service.lines({ limit: 0 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(iso.service.lines({ limit: 1001 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(iso.service.lines({ offset: -1 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(iso.service.lines({ salesFrom: '2026-13' })).rejects.toThrow(/month/i);
    });

    it('gives the values the filters can take in the chosen files', async () => {
      const both = [await idOf(A), await idOf(B)];
      const f = await iso.service.linesFacets(both);
      expect(f).toMatchObject({
        platforms: ['Apple Music', 'Spotify'],
        countries: ['Latvia', 'Poland'],
        subscriptionTypes: ['(none)', 'Premium'],
        salesTypes: ['Stream'],
        releaseTypes: ['Music Release'],
      });
      expect(f.files).toHaveLength(2);
      expect((await iso.service.linesFacets()).platforms).toEqual(['Spotify']); // the newest month only
    });
  });
});
