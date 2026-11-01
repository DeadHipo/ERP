import { describe, expect, it } from 'vitest';
import { createWriteStream, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseCsv, parseBelieveFileName, BELIEVE_COLUMNS } from '../src/modules/sources';
import { believeCsv, newFacade, tmpPath, writeBelieve } from './helpers/fixtures';
import { testFileTotals } from './helpers/test-sources';

const ISRC = 'QZTST2600001';
const UPC = '1234567890123';

describe('streaming CSV parser', () => {
  it('handles quotes, escaped quotes, delimiters and newlines inside quotes, BOM and CRLF', async () => {
    const text = '﻿"a";"b"\r\n"x;1";"he said ""hi"""\r\n"multi\nline";plain\n';
    const rows: string[][] = [];
    for await (const r of parseCsv(
      Readable.from([Buffer.from(text.slice(0, 7)), Buffer.from(text.slice(7))]),
    ))
      rows.push(r);
    expect(rows).toEqual([
      ['a', 'b'],
      ['x;1', 'he said "hi"'],
      ['multi\nline', 'plain'],
    ]);
  });
});

describe('Believe file name', () => {
  it('takes account and reporting month from the name; tolerates browser copies', async () => {
    expect(parseBelieveFileName('2102409_1052428_2026-07-01_2026-07-01.csv.zip')).toEqual({
      reportId: '2102409',
      account: '1052428',
      reportingMonth: '2026-07',
    });
    expect(parseBelieveFileName('1953164_1052428_2026-02-01_2026-02-01.csv (2).zip').reportingMonth).toBe(
      '2026-02',
    );
    expect(() => parseBelieveFileName('report.csv')).toThrow(/pattern/);
  });
});

describe('Believe loading (README 5: line key, summing, duplicates, sha256)', () => {
  it('sums lines with the same key; names are not part of the key', async () => {
    const f = await newFacade();
    const file = writeBelieve('2026-07', [
      { isrc: 'qz-tst-26-00001', upc: UPC, net: '0.100000000001', quantity: 2, artistName: 'Name A' },
      { isrc: ISRC, upc: UPC, net: '0.2', quantity: 3, artistName: 'Name B (different)' },
      { isrc: ISRC, upc: UPC, net: '1', country: 'France' },
    ]);
    const loaded = await f.ingestBelieve(file);
    expect(loaded.lineCount).toBe(3);
    expect((await testFileTotals(loaded.id)).keys).toBe('2');
    expect(loaded.netTotal).toBe('1.300000000001');
    const units = await f.modules.sources.units();
    expect(units).toHaveLength(1);
    expect(units[0]?.isrc).toBe(ISRC);
  });

  it('stores the sha256 of the file', async () => {
    const f = await newFacade();
    const file = writeBelieve('2026-07', [{ isrc: ISRC, upc: UPC, net: '1' }]);
    const loaded = await f.ingestBelieve(file);
    expect(loaded.sha256).toBe(createHash('sha256').update(readFileSync(file.path)).digest('hex'));
  });

  it('a second file for an already loaded (reporting month, account) is an error', async () => {
    const f = await newFacade();
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: ISRC, upc: UPC, net: '1' }]));
    const second = writeBelieve('2026-07', [{ isrc: ISRC, upc: UPC, net: '2' }], { reportId: '9000002' });
    await expect(f.ingestBelieve(second)).rejects.toMatchObject({
      code: 'duplicate_period',
      statusCode: 409,
    });
    // another account for the same month is a different scope
    await f.ingestBelieve(
      writeBelieve('2026-07', [{ isrc: ISRC, upc: UPC, net: '2' }], {
        account: '7777777',
        reportId: '9000003',
      }),
    );
    expect(await f.modules.sources.listFiles()).toHaveLength(2);
  });

  it('the same file content under another month name is rejected by sha256', async () => {
    const f = await newFacade();
    const a = writeBelieve('2026-07', [{ isrc: ISRC, upc: UPC, net: '1' }]);
    await f.ingestBelieve(a);
    const copy = tmpPath('9000009_1052428_2026-08-01_2026-08-01.csv');
    writeFileSync(copy, readFileSync(a.path));
    await expect(
      f.ingestBelieve({ path: copy, fileName: '9000009_1052428_2026-08-01_2026-08-01.csv' }),
    ).rejects.toMatchObject({ code: 'duplicate_file' });
  });

  it('rejects a whole file on a bad line and keeps nothing (atomic)', async () => {
    const f = await newFacade();
    const bad = writeBelieve('2026-07', [
      { isrc: ISRC, upc: UPC, net: '1' },
      { isrc: ISRC, upc: UPC, net: 'abc', country: 'Chile' },
    ]);
    await expect(f.ingestBelieve(bad)).rejects.toThrow(/Line 3: (Gross|Net) Revenue/);
    // the failed load is recorded, but nothing of it counts and it does not block the period
    expect((await f.modules.sources.listFiles()).map((x) => x.status)).toEqual(['failed']);
    expect(await f.modules.sources.units()).toHaveLength(0);
    // the period is free again after a failed load
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: ISRC, upc: UPC, net: '1' }]));
  });

  it('only USD is accepted (everything inside is USD)', async () => {
    const f = await newFacade();
    await expect(
      f.ingestBelieve(writeBelieve('2026-07', [{ isrc: ISRC, upc: UPC, net: '1', currency: 'EUR' }])),
    ).rejects.toThrow(/only USD/);
  });

  it('a line of another reporting month is rejected', async () => {
    const f = await newFacade();
    await expect(
      f.ingestBelieve(
        writeBelieve('2026-07', [{ isrc: ISRC, upc: UPC, net: '1', reportingMonth: '2026-06' }]),
      ),
    ).rejects.toThrow(/differs/);
  });

  it('keeps negative lines and lines without ISRC', async () => {
    const f = await newFacade();
    const loaded = await f.ingestBelieve(
      writeBelieve('2026-07', [
        { isrc: ISRC, upc: UPC, net: '-0.5', quantity: -1 },
        { isrc: '', upc: UPC, net: '3', platform: 'iTunes', salesType: 'Download' },
      ]),
    );
    expect(loaded.netTotal).toBe('2.5');
    const units = await f.modules.sources.units();
    expect(units.map((u) => [u.isrc, u.netPico.toString()]).sort()).toEqual([
      ['', '3000000000000'],
      [ISRC, '-500000000000'],
    ]);
  });

  it('streams a large file (200k lines) without loading it into memory', async () => {
    const f = await newFacade();
    const fileName = '9100000_1052428_2026-07-01_2026-07-01.csv';
    const path = tmpPath(fileName);
    const out = createWriteStream(path);
    out.write(believeCsv('2026-07', []));
    const countries = ['Brazil', 'France', 'Chile', 'Peru', 'Spain'];
    for (let i = 0; i < 200_000; i++) {
      const isrc = `QZTST26${String(i % 5000).padStart(5, '0')}`;
      const row = believeCsv('2026-07', [
        {
          isrc,
          upc: UPC,
          net: '0.000001',
          country: countries[i % 5] as string,
          platform: `P${Math.floor(i / 25000)}`,
        },
      ]).split('\r\n')[1];
      if (!out.write(row + '\r\n')) await new Promise<void>((r) => out.once('drain', () => r()));
    }
    await new Promise<void>((r) => out.end(() => r()));
    const before = process.memoryUsage().heapUsed;
    const loaded = await f.ingestBelieve({ path, fileName });
    expect(loaded.lineCount).toBe(200_000);
    expect(loaded.netTotal).toBe('0.2');
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(300 * 1024 * 1024);
  }, 120_000);

  it('header has all Believe columns', async () => {
    expect(BELIEVE_COLUMNS).toHaveLength(21);
  });
});
