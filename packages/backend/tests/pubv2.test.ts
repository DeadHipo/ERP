import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { quarterOfFileName, readB17Summary } from '../src/modules/pubv2';
import { newFacade, tmpPath } from './helpers/fixtures';

// Publishing v2 (D-182): the summaries of the reports, read by the shape of a sheet. Synthetic names and amounts only.

type Cell = string | number | null;

async function workbook(name: string, sheets: Record<string, Cell[][]>): Promise<string> {
  const wb = new ExcelJS.Workbook();
  for (const [sheet, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(sheet);
    for (const r of rows) ws.addRow(r);
  }
  const path = tmpPath(name);
  await wb.xlsx.writeFile(path);
  return path;
}

const cover: Cell[][] = [['Name', 'Total Gross', 'Total Withholding', 'Total Net']];
const breakdown = (a: number, b: number): Cell[][] => [
  ['SONG', 'GROSS', 'WITHHOLDING', 'TOTAL PAYABLE'],
  ['SONGWRITER: Writer One', a + b + 2, 2, a + b],
  ['  Song A', a + 1, 1, a],
  ['  Song', b + 1, 1, b],
  [],
  ['SONGWRITER: writer  one', 5, 0, 5],
  ['  SONG A!', 5, 0, 5],
];

describe('the shapes of the summaries (D-182)', () => {
  it('blocks of the Songwriter Breakdown: the writer heads its songs, the block total is the declared one', async () => {
    const path = await workbook('Q22026.xlsx', { Cover: cover, 'Songwriter Breakdown': breakdown(10, 2.5) });
    const s = await readB17Summary(path, '0to8_Q22026_Publishing_Statement.xlsx');
    expect([s.format, s.periods, s.rows.length]).toEqual(['blocks', ['2026-Q2'], 3]);
    expect(s.rows[0]).toMatchObject({ writerName: 'Writer One', title: 'Song A', grossPico: 11_000_000_000_000n, withholdingPico: 1_000_000_000_000n, payablePico: 10_000_000_000_000n });
  });

  it('blocks of a Cover: text amounts, TOTAL: in the writer row, a header per block, the top list ignored', async () => {
    const rows: Cell[][] = [
      ['TOTAL  ROYALTIES: $12.50', 'TOTAL WITHHOLDING: $1.00'],
      ['SONGWRITER TOTALS'],
      ['Writer One', 12.5],
      [],
      ['SONGWRITER: Writer One', 'TOTAL: $12.50'],
      [],
      ['SONGS', 'TOTAL PAYABLE', 'WITHHOLDING'],
      ['  Song A', '$10.00', 0.5],
      ['  Song B', 2.5, '$0.50'],
    ];
    const s = await readB17Summary(await workbook('Q22025.xlsx', { Cover: rows }), '0to8_Q22025_Statement.xlsx');
    expect([s.format, s.rows.length, s.declaredPayablePico]).toEqual(['blocks', 2, 12_500_000_000_000n]);
    expect(s.rows[0]).toMatchObject({ grossPico: null, withholdingPico: 500_000_000_000n, payablePico: 10_000_000_000_000n });
  });

  it('flat: a writer on every row, Net is the payable, the file declares no total', async () => {
    const rows: Cell[][] = [
      ['Songwriter', 'Song Title', 'Gross', 'Withholding', 'Net'],
      ['Writer One', 'Song A', 3, 1, 2],
      ['Writer Two', 'Song B', 1, 0, 1],
    ];
    const s = await readB17Summary(await workbook('Q42025.xlsx', { Cover: cover, 'Songwriter Breakdown': rows }), '0to8_Q42025_Publishing_Statement.xlsx');
    expect([s.format, s.rows.length, s.declaredPayablePico]).toEqual(['flat', 2, null]);
    expect(s.rows[1]).toMatchObject({ writerName: 'Writer Two', period: '2025-Q4', payablePico: 1_000_000_000_000n });
  });

  it('periods: two lists, the writer is the one rights-holder of the lines', async () => {
    const list: Cell[][] = [
      ['Period', 'Amount', null, null, 'Period', 'Amount'],
      ['1Q25', 3, null, null, '4Q24', 1],
      ['Song A', 3, null, null, 'Song B', 1],
    ];
    const detail: Cell[][] = [
      ['Period', 'rights-holder name', 'asset title'],
      ['1Q25', 'Writer One', 'Song A'],
    ];
    const s = await readB17Summary(await workbook('Q4Q1.xlsx', { Cover: list, Lines: detail }), '0to8_Q42024_Q12025_Publishing_Breakdown.xlsx');
    expect([s.format, s.periods, s.declaredPayablePico]).toEqual(['periods', ['2024-Q4', '2025-Q1'], 4_000_000_000_000n]);
    expect(s.rows.map((r) => [r.writerName, r.title, r.period])).toEqual([
      ['Writer One', 'Song A', '2025-Q1'],
      ['Writer One', 'Song B', '2024-Q4'],
    ]);
  });

  it('a file without a summary is refused, and so is a quarter that the name does not give', async () => {
    await expect(readB17Summary(await workbook('none.xlsx', { Cover: cover }), 'x.xlsx')).rejects.toThrow('No B17 summary');
    await expect(readB17Summary(await workbook('noq.xlsx', { B: breakdown(1, 1) }), 'statement.xlsx')).rejects.toThrow('quarter');
    expect(['Q22026', '2Q2026 - Updated', '2Q26', 'Q12026_Q22026'].map(quarterOfFileName)).toEqual(['2026-Q2', '2026-Q2', '2026-Q2', undefined]);
  });
});

describe('the partition of a file (D-182)', () => {
  const load = async (f: Awaited<ReturnType<typeof newFacade>>, a: number, replace = false) => {
    const label = (await f.modules.labels.listLabels()).find((l) => l.name === '0to8');
    return f.modules.pubv2.ingest({
      path: await workbook(`p${a}.xlsx`, { 'Songwriter Breakdown': breakdown(a, 1) }),
      fileName: '0to8_Q22026_Publishing_Statement.xlsx',
      labelId: (label as { id: string }).id,
      replace,
    });
  };

  it('merges spellings by the normal form, keeps a declared total, and lists the sums', async () => {
    const f = await newFacade();
    const file = await load(f, 10);
    expect([file.status, file.rowCount, file.payable, file.declaredPayable, file.difference]).toEqual(['loaded', 3, '16', '16', '0']);
    const writers = await f.modules.pubv2.listSongwriters();
    expect(writers.map((w) => [w.name, w.songs, w.payable, w.aliases])).toEqual([['Writer One', 2, '16', ['Writer One']]]);
    const detail = await f.modules.pubv2.songwriter((writers[0] as { id: string }).id);
    expect(detail.periods).toEqual([{ period: '2026-Q2', gross: '18', withholding: '2', payable: '16' }]);
    expect(detail.songs.map((s) => [s.title, s.payable])).toEqual([['Song A', '15'], ['Song', '1']]);
  });

  it('refuses the same bytes and a loaded quarter; replace supersedes, remove restores', async () => {
    const f = await newFacade();
    const first = await load(f, 10);
    await expect(load(f, 20)).rejects.toMatchObject({ code: 'period_loaded' });
    const second = await load(f, 20, true);
    expect((await f.modules.pubv2.getFile(first.id)).status).toBe('superseded');
    expect((await f.modules.pubv2.listSongwriters())[0]?.payable).toBe('26');
    await f.modules.pubv2.removeFile(second.id);
    expect((await f.modules.pubv2.getFile(first.id))).toMatchObject({ status: 'loaded', replacedBy: null });
    expect((await f.modules.pubv2.listSongwriters())[0]?.payable).toBe('16');
    await expect(f.modules.pubv2.removeFile('missing')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the boundary of publishing v2 (D-182)', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });

  it('the calculation, the layers, the balance and the old module never read it', () => {
    const src = join(process.cwd(), 'src');
    const money = [...files(join(src, 'facade', 'layers')), ...files(join(src, 'modules', 'publishing'))].concat(
      ['calculation.ts', 'balance.ts', 'context.ts', 'payouts.ts', 'payroll.ts', 'owner-scope.ts'].map((f) => join(src, 'facade', f)),
    );
    for (const f of money) expect(readFileSync(f, 'utf8'), f).not.toMatch(/pubv2/i);
  });
});
