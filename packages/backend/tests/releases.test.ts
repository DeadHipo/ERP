import { describe, expect, it } from 'vitest';
import { createReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { calculate } from '../src/facade/calculation';
import { releaseSignals } from '../src/facade/release-registry';
import { labelsViewer } from '../src/facade/viewer';
import { exportDate, exportUpc, parseBelieveExport } from '../src/modules/owners';
import { Decimal } from '../src/shared/money';
import { releaseImportSchema, releaseRegistrySchema, releaseSchema, releasesSchema } from '@erp/shared/api-responses';
import { Case, I } from './helpers/golden-case';
import { tmpPath, TMP } from './helpers/fixtures';
import { writer } from './helpers/writer';

// The release registry from the Believe release export (D-172, plan «этап4_онбординг.md» §1.5, §6): navigation, never
// money. Synthetic data only: invented UPCs, titles «Release R-n», artists «Synth …».

const HEADER =
  '"Release Title";Version;Artist;Label;"Release date / Hour / Time zone";"# of track";UPC;"Cat. #";"# of territories";"# of stores"';
const UPC_A = '1000000000001';
const UPC_B = '1000000000002';
const UPC_C = '1000000000003';

interface Rel {
  title: string;
  version?: string;
  artist?: string;
  label?: string;
  date?: string;
  tracks?: string;
  upc: string;
  cat?: string;
}
const line = (r: Rel) =>
  [
    `"${r.title}"`,
    r.version ?? '',
    `"${r.artist ?? 'Synth Artist'}"`,
    r.label ?? 'SynthLabel',
    `"${r.date ?? '2025-03-14'}<br />00:00:00"`,
    r.tracks ?? '1',
    `"UPC : ${r.upc}"`,
    r.cat ?? '',
    '240',
    '23',
  ].join(';');

/** A file in the format of the export: BOM, `;`, quoted cells, `UPC : `, `<br />` dates. */
function exportFile(rows: (Rel | string)[], header = HEADER) {
  const path = tmpPath('my_catalog_export.csv');
  writeFileSync(path, '﻿' + [header, ...rows.map((r) => (typeof r === 'string' ? r : line(r)))].join('\n') + '\n');
  return { path, fileName: 'my_catalog_export.csv' };
}

const BASE: Rel[] = [
  { title: 'Release R-1', artist: 'Synth Artist A, Synth Artist B', date: '2025-03-14', tracks: '3', upc: UPC_A, cat: 'CAT-1' },
  { title: 'Release R-2', version: 'Remix', date: '2025-04-01', tracks: '1', upc: UPC_B },
];

// ---------------------------------------------------------------- the reader (pure)

describe('the Believe release export reader', () => {
  it('reads the fields: BOM, «;», quoted cells, the UPC prefix, the date before <br />, empty Version / Cat. # = null', async () => {
    const rows = await parseBelieveExport(createReadStream(exportFile(BASE).path));
    expect(rows).toEqual([
      {
        line: 2,
        upc: UPC_A,
        title: 'Release R-1',
        version: null,
        artistString: 'Synth Artist A, Synth Artist B',
        labelString: 'SynthLabel',
        releaseDate: '2025-03-14',
        trackCount: 3,
        catalogNumber: 'CAT-1',
        territories: 240,
        stores: 23,
      },
      expect.objectContaining({ line: 3, upc: UPC_B, version: 'Remix', catalogNumber: null, trackCount: 1 }),
    ]);
    expect([exportUpc('UPC : 3600000000000'), exportUpc('3600000000000'), exportUpc('UPC : 36x'), exportUpc('')]).toEqual([
      '3600000000000',
      '3600000000000',
      null,
      null,
    ]);
    expect([exportDate('2025-02-30<br />00:00:00'), exportDate(''), exportDate('2025-02-28<br/>10:00:00')]).toEqual([
      null,
      undefined,
      '2025-02-28',
    ]);
  });

  it('a bad row refuses the whole file with every line and code; a missing column is release_import_header', async () => {
    const bad = exportFile([
      ...BASE,
      { title: 'Release R-3', upc: '12AB' },
      { title: 'Release R-4', upc: UPC_C, tracks: 'many', date: '2025-13-01' },
      { title: 'Release R-5', upc: UPC_A },
    ]);
    await expect(parseBelieveExport(createReadStream(bad.path))).rejects.toMatchObject({
      statusCode: 422,
      code: 'release_import_invalid',
      details: {
        rows: [
          { line: 4, code: 'upc_invalid' },
          { line: 5, code: 'track_count_invalid' },
          { line: 5, code: 'date_invalid' },
          { line: 6, code: 'duplicate_upc', upc: UPC_A },
        ],
        errors: 4,
      },
    });
    const noUpc = exportFile([], HEADER.replace(';UPC;', ';Code;'));
    await expect(parseBelieveExport(createReadStream(noUpc.path))).rejects.toMatchObject({
      statusCode: 400,
      code: 'release_import_header',
      details: { missing: ['UPC'] },
    });
  });
});

// ---------------------------------------------------------------- the signals (pure)

describe('the release signals', () => {
  it('incomplete: trackCount above the distinct ISRCs of the UPC in the units of the same book; unknown: a UPC of a book whose registry lacks it', () => {
    const L = 'label-l';
    const M = 'label-m';
    const u = (isrc: string, upc: string, book: string | null, net = '1') => ({ isrc, upc, bookLabelId: book, net: new Decimal(net) });
    const units = [u(I(1), UPC_A, L), u(I(2), UPC_A, L), u(I(2), UPC_A, L), u(I(3), UPC_C, L, '5'), u(I(4), UPC_C, M), u(I(5), UPC_A, null)];
    const registry = [
      { labelId: L, upc: UPC_A, title: 'Release R-1', trackCount: 3 },
      { labelId: L, upc: UPC_B, title: 'Release R-2', trackCount: 1 },
      { labelId: M, upc: UPC_A, title: 'Release R-1', trackCount: 0 },
    ];
    const s = releaseSignals(units, registry, (isrc) => `title of ${isrc}`);
    expect(s.releasesIncomplete).toEqual([
      { upc: UPC_A, labelId: L, title: 'Release R-1', trackCount: 3, isrcsInUnits: 2 },
      { upc: UPC_B, labelId: L, title: 'Release R-2', trackCount: 1, isrcsInUnits: 0 },
    ]);
    // M has a registry without UPC_C; the book '?' and a label without a registry are never «unknown»
    expect(s.releasesUnknown.map((x) => ({ ...x, net: x.net.toFixed() }))).toEqual([
      { upc: UPC_C, bookLabelId: L, releaseTitle: `title of ${I(3)}`, net: '5' },
      { upc: UPC_C, bookLabelId: M, releaseTitle: `title of ${I(4)}`, net: '1' },
    ]);
    expect(releaseSignals(units, [], () => '').releasesUnknown).toEqual([]);
  });
});

// ---------------------------------------------------------------- the stack

/** 0to8: UPC_A with I(1), I(2) (3 tracks in the export) and UPC_C with I(3) (not in the export); Echo8: UPC_A with I(4). */
async function world() {
  const c = await Case.start();
  const f = c.f;
  await c.person('PA');
  for (const n of [1, 2]) await c.track(I(n), UPC_A);
  await c.track(I(3), UPC_C);
  await c.split(I(1), [['PA', '50']]);
  await c.load('2026-01', [
    { isrc: I(1), upc: UPC_A, net: '10' },
    { isrc: I(2), upc: UPC_A, net: '4' },
    { isrc: I(3), upc: UPC_C, net: '7' },
  ]);
  await c.load('2026-01', [{ isrc: I(4), upc: UPC_A, net: '3', label: 'Echo8' }], '1055956');
  return { c, f, zero: f.testLabels['0to8'], echo: f.testLabels.Echo8 };
}
type World = Awaited<ReturnType<typeof world>>;

const text = (x: unknown) => JSON.stringify(x, (k, v: unknown) => (k === 'calculatedAt' ? undefined : v));
const money = async ({ f }: World) =>
  text({
    calc: await calculate({ ...f.modules, db: f.db }),
    overview: JSON.stringify(await f.overview(), (k, v: unknown) => (k === 'signals' || k === 'calculatedAt' ? undefined : v)),
  });
const importOf = (w: World, rows: Rel[], labelId: string | undefined = w.zero, viewer?: Parameters<World['f']['importReleases']>[1]) => {
  const file = exportFile(rows);
  return w.f.importReleases({ ...file, labelId }, viewer);
};

describe('the release registry on the stack (D-172)', () => {
  it('imports under a label: inserted, then updated / unchanged; UPCs not in the file stay; a bad file writes nothing', async () => {
    const w = await world();
    const { f, zero } = w;
    const first = await importOf(w, BASE);
    expect(first).toMatchObject({ labelId: zero, fileName: 'my_catalog_export.csv', rows: 2, inserted: 2, updated: 0, unchanged: 0 });
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await importOf(w, BASE)).toMatchObject({ rows: 2, inserted: 0, updated: 0, unchanged: 2 });
    const second = await importOf(w, [{ ...(BASE[0] as Rel), title: 'Release R-1 (deluxe)' }, { title: 'Release R-6', upc: UPC_C }]);
    expect(second).toMatchObject({ rows: 2, inserted: 1, updated: 1, unchanged: 0 });
    const listed = (await f.releaseRegistry({ label: zero })).items;
    expect(listed.map((r) => [r.upc, r.title])).toEqual([
      [UPC_A, 'Release R-1 (deluxe)'],
      [UPC_B, 'Release R-2'],
      [UPC_C, 'Release R-6'],
    ]);
    // all or nothing: a refused row leaves the registry as it was
    await expect(importOf(w, [{ ...(BASE[1] as Rel), title: 'Release R-2 changed' }, { title: 'Release R-7', upc: 'x' }])).rejects.toMatchObject({
      statusCode: 422,
      code: 'release_import_invalid',
    });
    expect((await f.releaseRegistry({ label: zero })).items).toEqual(listed);
  });

  it('refusals: the label is required, own and the viewer’s', async () => {
    const w = await world();
    const { f, zero, echo } = w;
    await expect(f.importReleases({ ...exportFile(BASE), labelId: undefined })).rejects.toMatchObject({ statusCode: 400, code: 'label_required' });
    await expect(importOf(w, BASE, 'no-such-label')).rejects.toMatchObject({ statusCode: 404 });
    const sub = await f.modules.labels.createLabel({ name: 'Sub Synthetic', kind: 'sublabel', ownLabelId: zero });
    await expect(importOf(w, BASE, sub.id)).rejects.toMatchObject({ statusCode: 400, code: 'label_not_own' });
    // a manager of Echo8 under 0to8
    await expect(importOf(w, BASE, zero, labelsViewer([echo]))).rejects.toMatchObject({ statusCode: 403, code: 'label_forbidden' });
    expect(await importOf(w, BASE, echo, labelsViewer([echo]))).toMatchObject({ inserted: 2 });
    expect((await f.releaseRegistry({ label: zero })).items).toEqual([]);
  });

  it('the registry under a label and under «Все»: a row per label, isrcsInUnits from the files of the row label, q', async () => {
    const w = await world();
    const { f, zero, echo } = w;
    await importOf(w, BASE);
    await importOf(w, [{ title: 'Release R-1', tracks: '1', upc: UPC_A }], echo);
    const under = await f.releaseRegistry({ label: zero });
    expect(releaseRegistrySchema.safeParse(under).success).toBe(true);
    expect(under.items.map((r) => [r.labelName, r.upc, r.trackCount, r.isrcsInUnits])).toEqual([
      ['0to8', UPC_A, 3, 2],
      ['0to8', UPC_B, 1, 0],
    ]);
    const all = await f.releaseRegistry();
    expect(all.items.map((r) => [r.labelId, r.upc, r.isrcsInUnits]).sort()).toEqual(
      [
        [zero, UPC_A, 2],
        [zero, UPC_B, 0],
        [echo, UPC_A, 1],
      ].sort(),
    );
    expect((await f.releaseRegistry({ q: 'remix' })).items.map((r) => r.upc)).toEqual([UPC_B]);
    await expect(f.releaseRegistry({ label: 'no-such-label' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('the signals and the money pin: calculate() and the overview without signals are byte for byte the same after an import', async () => {
    const w = await world();
    const { f, zero, echo } = w;
    const before = await money(w);
    const s0 = await f.signals();
    expect([s0.releasesIncomplete, s0.releasesUnknown]).toEqual([[], []]);
    await importOf(w, BASE);
    expect(await money(w)).toBe(before);
    const s1 = await f.signals();
    // UPC_A: 3 tracks, 2 ISRCs in the 0to8 units; UPC_B: no unit at all
    expect(s1.releasesIncomplete).toEqual([
      { upc: UPC_A, labelId: zero, title: 'Release R-1', trackCount: 3, isrcsInUnits: 2 },
      { upc: UPC_B, labelId: zero, title: 'Release R-2', trackCount: 1, isrcsInUnits: 0 },
    ]);
    // UPC_C has units in the 0to8 book but no row in its registry; Echo8 has no registry: nothing
    expect(s1.releasesUnknown.map((x) => [x.upc, x.bookLabelId, x.net.toFixed()])).toEqual([[UPC_C, zero, '7']]);
    const counts = new Map((await f.overview()).signals.map((x) => [x.name, x.count]));
    expect([counts.get('releasesIncomplete'), counts.get('releasesUnknown')]).toEqual([2, 1]);
    // under Echo8: its units and its (empty) registry only
    const sEcho = await f.signals({}, echo);
    expect([sEcho.releasesIncomplete, sEcho.releasesUnknown]).toEqual([[], []]);
    const sZero = await f.signals({}, zero);
    expect([sZero.releasesIncomplete.length, sZero.releasesUnknown.length]).toEqual([2, 1]);
  });

  it('GET /releases and /releases/:upc carry the registry: the label’s row under a label, every label’s under «Все»', async () => {
    const w = await world();
    const { f, zero, echo } = w;
    await importOf(w, BASE);
    await importOf(w, [{ title: 'Release R-1 Echo', tracks: '1', upc: UPC_A }], echo);
    const list = await f.releases(undefined, zero);
    expect(releasesSchema.safeParse(JSON.parse(JSON.stringify(list))).success).toBe(true);
    expect(list.items.map((r) => [r.upc, r.registered, r.registry?.title ?? null])).toEqual([
      [UPC_A, true, 'Release R-1'],
      [UPC_C, false, null],
    ]);
    const one = await f.release(UPC_A, zero);
    expect(releaseSchema.safeParse(JSON.parse(JSON.stringify(one))).error?.issues ?? []).toEqual([]);
    expect(one.registry.map((r) => [r.labelName, r.title])).toEqual([['0to8', 'Release R-1']]);
    expect((await f.release(UPC_A)).registry.map((r) => r.labelId).sort()).toEqual([zero, echo].sort());
    // a registered UPC without units or tracks is still a release
    expect((await f.release(UPC_B)).registry.map((r) => r.title)).toEqual(['Release R-2']);
  });
});

describe('the release registry: the API', () => {
  it('the import is 201 with one audit row whose summary is the response; the registry read; the label is required', async () => {
    const w = await world();
    const { f, zero } = w;
    const app = createApp(f, { tmpDir: join(TMP, 'release-uploads') });
    const api = writer(app);
    const file = exportFile(BASE);
    const none = await api.post('/api/v1/releases/import').attach('file', file.path, file.fileName);
    expect([none.status, none.body.error.code]).toEqual([400, 'label_required']);
    const res = await api.post('/api/v1/releases/import').query({ label: zero }).attach('file', file.path, file.fileName).expect(201);
    expect(releaseImportSchema.safeParse(res.body).success).toBe(true);
    const rows = await f.recentActions(50);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: '/releases/import', labelId: zero });
    expect(rows[0]?.summary).toMatchObject({ body: { fileName: 'my_catalog_export.csv', rows: 2, inserted: 2, updated: 0, unchanged: 0 } });
    const bad = exportFile([{ title: 'Release R-9', upc: 'none' }]);
    const refused = await api.post('/api/v1/releases/import').query({ label: zero }).attach('file', bad.path, bad.fileName);
    expect([refused.status, refused.body.error.code, refused.body.error.details.rows]).toEqual([422, 'release_import_invalid', [{ line: 2, code: 'upc_invalid' }]]);
    // the static segment before /releases/:upc
    const reg = await api.get('/api/v1/releases/registry').query({ label: zero }).expect(200);
    expect(reg.body.items.map((r: { upc: string }) => r.upc)).toEqual([UPC_A, UPC_B]);
  });
});
