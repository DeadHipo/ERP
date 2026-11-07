import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { quarterOfFileName, readB17Summary } from '../src/modules/pubv2';
import { calculate } from '../src/facade/calculation';
import { pubV2Source } from '../src/facade/pubv2-source';
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

describe('the links of songwriters to owners (D-183)', () => {
  const upload = async (f: Awaited<ReturnType<typeof newFacade>>, writer: string) => {
    const label = (await f.modules.labels.listLabels()).find((l) => l.name === '0to8') as { id: string };
    await f.modules.pubv2.ingest({
      path: await workbook(`l-${writer.replace(/\W/g, '')}.xlsx`, {
        'Songwriter Breakdown': [['SONG', 'GROSS', 'WITHHOLDING', 'TOTAL PAYABLE'], [`SONGWRITER: ${writer}`, 1, 0, 1], ['  Song', 1, 0, 1]],
      }),
      fileName: '0to8_Q22026_Publishing_Statement.xlsx',
      labelId: label.id,
      replace: true,
    });
    return (await f.pubV2Links())[0] as Awaited<ReturnType<typeof f.pubV2Links>>[number];
  };

  it('suggests by the name, then by the same words, and sets nothing on its own', async () => {
    const f = await newFacade();
    const owner = await f.modules.owners.createOwner({ name: 'Writer Synth One', kind: 'person', origin: 'test' });
    const exact = await upload(f, 'Writer Synth One');
    expect([exact.link, exact.recommendation?.ownerId, exact.recommendation?.reason]).toEqual([null, owner.id, 'exact_name']);
    const words = (await f.pubV2Links()).length;
    expect(words).toBe(1);
    const other = await newFacade();
    const person = await other.modules.owners.createOwner({ name: 'Writer Synth Two', kind: 'person', origin: 'test' });
    const swapped = await upload(other, 'Two Synth Writer');
    expect([swapped.recommendation?.ownerId, swapped.recommendation?.reason]).toEqual([person.id, 'same_words']);
    const none = await newFacade();
    expect((await upload(none, 'Nobody Known')).recommendation).toBeNull();
  });

  it('the operator confirms or chooses another; a new decision replaces the old one; a label is refused', async () => {
    const f = await newFacade();
    const owner = await f.modules.owners.createOwner({ name: 'Writer Synth One', kind: 'person', origin: 'test' });
    const other = await f.modules.owners.createOwner({ name: 'Somebody Else', kind: 'person', origin: 'test' });
    const label = await f.modules.owners.createOwner({ name: 'A Company', kind: 'label', origin: 'test' });
    const row = await upload(f, 'Writer Synth One');
    const confirmed = await f.linkSongwriter({ songwriterId: row.songwriterId, ownerId: owner.id }, 'tester');
    expect([confirmed.source, confirmed.decidedBy, confirmed.ownerName]).toEqual(['recommended', 'tester', 'Writer Synth One']);
    await f.linkSongwriter({ songwriterId: row.songwriterId, ownerId: other.id }, 'tester');
    expect((await f.pubV2Links())[0]?.link).toMatchObject({ ownerId: other.id, source: 'manual' });
    await expect(f.linkSongwriter({ songwriterId: row.songwriterId, ownerId: label.id }, 'tester')).rejects.toMatchObject({ code: 'owner_is_label' });
    await expect(f.linkSongwriter({ songwriterId: 'missing', ownerId: owner.id }, 'tester')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the links of songs to ISRCs (D-184)', () => {
  const isrcs = ['QZTST2600101', 'QZTST2600102', 'QZTST2600103'];
  const world = async () => {
    const f = await newFacade();
    const label = (await f.modules.labels.listLabels()).find((l) => l.name === '0to8') as { id: string };
    const owner = await f.modules.owners.createOwner({ name: 'Writer Synth One', kind: 'person', origin: 'test' });
    const stranger = await f.modules.owners.createOwner({ name: 'Somebody Else', kind: 'person', origin: 'test' });
    const artist = await f.modules.owners.createArtist({ pseudonym: 'SYNTH ONE', ownerId: owner.id });
    const other = await f.modules.owners.createArtist({ pseudonym: 'SOMEBODY', ownerId: stranger.id });
    await f.modules.owners.createTrack({ isrc: isrcs[0] as string, title: 'Song A (Slowed)' });
    await f.modules.owners.createTrack({ isrc: isrcs[1] as string, title: 'Song A - SYNTH ONE' });
    await f.modules.owners.createTrack({ isrc: isrcs[2] as string, title: 'Another' });
    await f.createSplit({ isrc: isrcs[0] as string, validFrom: '2026-01-01', shares: [{ artistId: artist.id, percent: '50' }] });
    await f.createSplit({ isrc: isrcs[1] as string, validFrom: '2026-01-01', shares: [{ artistId: other.id, percent: '50' }] });
    await f.modules.pubv2.ingest({
      path: await workbook('isrc.xlsx', {
        'Songwriter Breakdown': [['SONG', 'GROSS', 'WITHHOLDING', 'TOTAL PAYABLE'], ['SONGWRITER: Writer Synth One', 1, 0, 1], ['  Song A', 1, 0, 1]],
      }),
      fileName: '0to8_Q22026_Publishing_Statement.xlsx',
      labelId: label.id,
    });
    return { f, owner };
  };

  it('finds the tracks by the title without its version, those of the linked owner first, and sets nothing', async () => {
    const { f, owner } = await world();
    const before = (await f.pubV2Songs())[0];
    expect([before?.ownerId, before?.candidates, before?.ownerCandidates]).toEqual([null, 2, 0]);
    await f.linkSongwriter({ songwriterId: before?.songwriterId as string, ownerId: owner.id }, 'tester');
    const song = (await f.pubV2Songs())[0];
    expect([song?.ownerName, song?.candidates, song?.ownerCandidates, song?.isrcs]).toEqual(['Writer Synth One', 2, 1, []]);
    const found = await f.pubV2SongCandidates(song?.songId as string);
    expect(found.candidates.map((c) => [c.isrc, c.reason, c.artists])).toEqual([
      [isrcs[0], 'owner', ['SYNTH ONE']],
      [isrcs[1], 'title', ['SOMEBODY']],
    ]);
  });

  it('the operator sets the whole set; a track out of the candidates is manual; an unknown ISRC is refused', async () => {
    const { f } = await world();
    const id = (await f.pubV2Songs())[0]?.songId as string;
    expect((await f.setPubV2SongIsrcs(id, [isrcs[0] as string, isrcs[2] as string], 'tester')).isrcs).toEqual([isrcs[0], isrcs[2]]);
    expect((await f.pubV2SongCandidates(id)).isrcs.map((x) => [x.isrc, x.source])).toEqual([[isrcs[0], 'recommended'], [isrcs[2], 'manual']]);
    await f.setPubV2SongIsrcs(id, [isrcs[1] as string], 'tester');
    expect((await f.pubV2Songs())[0]?.isrcs).toEqual([isrcs[1]]);
    await expect(f.setPubV2SongIsrcs(id, ['QZTST2699999'], 'tester')).rejects.toMatchObject({ code: 'not_found' });
    await expect(f.setPubV2SongIsrcs(id, ['nonsense'], 'tester')).rejects.toMatchObject({ code: 'validation_error' });
    await expect(f.setPubV2SongIsrcs('missing', [], 'tester')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the owners behind the songs (D-187)', () => {
  it('suggests the owner of the pseudonym in the splits of the songs before the name', async () => {
    const f = await newFacade();
    const label = (await f.modules.labels.listLabels()).find((l) => l.name === '0to8') as { id: string };
    const byName = await f.modules.owners.createOwner({ name: 'Writer Synth One', kind: 'person', origin: 'test' });
    const real = await f.modules.owners.createOwner({ name: 'Owner of SYNTH', kind: 'person', origin: 'test' });
    const artist = await f.modules.owners.createArtist({ pseudonym: 'SYNTH', ownerId: real.id });
    await f.setPublishingTerm({ ownerId: real.id, percent: '50', validFrom: '2025-01-01' }, 'tester');
    for (const [i, title] of ['Song A (Slowed)', 'Song B'].entries()) {
      const isrc = `QZTST260020${i}`;
      await f.modules.owners.createTrack({ isrc, title });
      await f.createSplit({ isrc, validFrom: '2026-01-01', shares: [{ artistId: artist.id, percent: '50' }] });
    }
    await f.modules.pubv2.ingest({
      path: await workbook('songs.xlsx', {
        'Songwriter Breakdown': [
          ['SONG', 'GROSS', 'WITHHOLDING', 'TOTAL PAYABLE'],
          ['SONGWRITER: Writer Synth One', 2, 0, 2],
          ['  Song A', 1, 0, 1],
          ['  Song B', 1, 0, 1],
        ],
      }),
      fileName: '0to8_Q22026_Publishing_Statement.xlsx',
      labelId: label.id,
    });
    const row = (await f.pubV2Links())[0];
    expect([row?.recommendation?.ownerId, row?.recommendation?.reason, row?.recommendation?.hasTerms, row?.songs]).toEqual([real.id, 'songs', true, 2]);
    expect(row?.songCandidates).toEqual([{ ownerId: real.id, ownerName: 'Owner of SYNTH', songs: 2, hasTerms: true }]);
    expect(byName.id).not.toBe(real.id);
  });
});

describe('the source of the calculation (D-185)', () => {
  const summary = async (f: Awaited<ReturnType<typeof newFacade>>, labelId: string) =>
    f.modules.pubv2.ingest({
      path: await workbook('source.xlsx', {
        'Songwriter Breakdown': [
          ['SONG', 'GROSS', 'WITHHOLDING', 'TOTAL PAYABLE'],
          ['SONGWRITER: Writer Synth One', 100, 0, 100],
          ['  Song A', 100, 0, 100],
          ['SONGWRITER: Nobody Linked', 40, 0, 40],
          ['  Song B', 40, 0, 40],
        ],
      }),
      fileName: '0to8_Q22026_Publishing_Statement.xlsx',
      labelId,
    });

  it('a new term closes the open one and is never edited; an earlier date is refused', async () => {
    const f = await newFacade();
    const owner = await f.modules.owners.createOwner({ name: 'Writer Synth One', kind: 'person', origin: 'test' });
    await f.setPublishingTerm({ ownerId: owner.id, percent: '50', validFrom: '2025-01-01' }, 'tester');
    await f.setPublishingTerm({ ownerId: owner.id, percent: '0', validFrom: '2026-04-01' }, 'tester');
    const terms = await f.modules.links.publishingTerms();
    expect(terms.map((t) => [t.percent, t.validFrom, t.validTo, t.decidedBy])).toEqual([
      ['50', '2025-01-01', '2026-04-01', 'tester'],
      ['0', '2026-04-01', null, 'tester'],
    ]);
    await expect(f.setPublishingTerm({ ownerId: owner.id, percent: '10', validFrom: '2026-04-01' }, 'tester')).rejects.toMatchObject({ code: 'terms_overlap' });
    await expect(f.setPublishingTerm({ ownerId: owner.id, percent: '101', validFrom: '2026-06-01' }, 'tester')).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('v2: the whole line goes to the linked owner with the percent of links; without a link it waits; v1 stays as it was', async () => {
    const f = await newFacade();
    const label = (await f.modules.labels.listLabels()).find((l) => l.name === '0to8') as { id: string };
    const owner = await f.modules.owners.createOwner({ name: 'Writer Synth One', kind: 'person', origin: 'test' });
    await summary(f, label.id);
    await f.setPublishingTerm({ ownerId: owner.id, percent: '90', validFrom: '2026-01-01' }, 'tester');
    const row = (await f.pubV2Links()).find((l) => l.name === 'Writer Synth One') as { songwriterId: string };
    await f.linkSongwriter({ songwriterId: row.songwriterId, ownerId: owner.id }, 'tester');

    const { owners, splits, labels, sources, publishing, ads, pubv2, links } = f.modules;
    const base = { db: f.db, owners, splits, labels, sources, ads };
    const v2 = await calculate({ ...base, publishing: pubV2Source(f.db, publishing, { pubv2, links }) });
    const parts = v2.publishing.map((p) => [p.writerName, p.ownerId, p.payable.toFixed(), p.authorAmount.toFixed(), p.reason]);
    expect(parts).toEqual([
      ['Nobody Linked', null, '40', '0', 'writer_unmapped'],
      ['Writer Synth One', owner.id, '100', '90', 'owner_unconfirmed'],
    ]);
    expect((await calculate({ ...base, publishing })).publishing).toEqual([]);
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
    for (const f of money) expect(readFileSync(f, 'utf8'), f).not.toMatch(/pubv2|modules\/links/i);
  });
});
