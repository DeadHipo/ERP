import { describe, expect, it } from 'vitest';
import { createReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { calculate } from '../src/facade/calculation';
import { releaseSignals } from '../src/facade/release-registry';
import { labelsViewer } from '../src/facade/viewer';
import { exportDateTime, exportUpc, parseBelieveExport } from '../src/modules/owners';
import { Decimal } from '../src/shared/money';
import { releaseApplySchema, releasePreviewSchema, releaseRegistrySchema, releaseSchema, releasesSchema } from '@erp/shared/api-responses';
import { Case, I } from './helpers/golden-case';
import { tmpPath, TMP } from './helpers/fixtures';
import { writer } from './helpers/writer';

// The release registry from the Believe release export (D-172, D-195: preview, then apply the accepted changes):
// navigation, never money. Synthetic data only: invented UPCs, titles «Release R-n», artists «Synth …».

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
  time?: string;
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
    `"${r.date ?? '2025-03-14'}<br />${r.time ?? '00:00:00'}"`,
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
  it('reads the fields: BOM, «;», quoted cells, the UPC prefix, the date and time around <br />, empty Version / Cat. # = null', async () => {
    const { rows, issues } = await parseBelieveExport(createReadStream(exportFile([{ ...(BASE[0] as Rel), time: '18:30:05' }, BASE[1] as Rel]).path));
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      {
        line: 2,
        upc: UPC_A,
        releaseTitle: 'Release R-1',
        version: null,
        artistString: 'Synth Artist A, Synth Artist B',
        labelString: 'SynthLabel',
        releasedAt: '2025-03-14T18:30:05',
        trackCount: 3,
        catalogNumber: 'CAT-1',
        territories: 240,
        stores: 23,
      },
      expect.objectContaining({ line: 3, upc: UPC_B, version: 'Remix', catalogNumber: null, trackCount: 1, releasedAt: '2025-04-01T00:00:00' }),
    ]);
    expect([exportUpc('UPC : 3600000000000'), exportUpc('3600000000000'), exportUpc('UPC : 36x'), exportUpc('')]).toEqual([
      '3600000000000',
      '3600000000000',
      null,
      null,
    ]);
    expect(
      ['2025-02-30<br />00:00:00', '', '2025-02-28<br/>10:00', '2025-02-28', '2025-02-28 07:05:09', '2025-02-28<br />25:00:00'].map(exportDateTime),
    ).toEqual([null, undefined, '2025-02-28T10:00:00', '2025-02-28T00:00:00', '2025-02-28T07:05:09', null]);
  });

  it('a bad row is an issue of its line, the other rows are read; a missing column is release_import_header', async () => {
    const bad = exportFile([
      ...BASE,
      { title: 'Release R-3', upc: '12AB' },
      { title: 'Release R-4', upc: UPC_C, tracks: 'many', date: '2025-13-01' },
    ]);
    const { rows, issues } = await parseBelieveExport(createReadStream(bad.path));
    expect(rows.map((r) => r.upc)).toEqual([UPC_A, UPC_B]);
    expect(issues).toEqual([
      { line: 4, upc: null, codes: ['upc_invalid'] },
      { line: 5, upc: UPC_C, codes: ['track_count_invalid', 'date_invalid'] },
    ]);
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
      { labelId: L, upc: UPC_A, releaseTitle: 'Release R-1', trackCount: 3 },
      { labelId: L, upc: UPC_B, releaseTitle: 'Release R-2', trackCount: 1 },
      { labelId: M, upc: UPC_A, releaseTitle: 'Release R-1', trackCount: 0 },
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
type Viewer = Parameters<World['f']['previewReleases']>[1];
const previewOf = (w: World, rows: (Rel | string)[], labelId: string | undefined = w.zero, viewer?: Viewer) =>
  w.f.previewReleases({ ...exportFile(rows), labelId, source: 'believe' }, viewer);
/** The changes of a preview as the screen sends them back: every create and update. */
const accepted = (p: Awaited<ReturnType<typeof previewOf>>) =>
  p.items.flatMap((i) =>
    (i.action === 'create' || i.action === 'update') && i.upc && i.release ? [{ upc: i.upc, action: i.action, release: i.release, before: i.before }] : [],
  );
/** Preview, then apply everything it proposes. */
const importOf = async (w: World, rows: Rel[], labelId: string | undefined = w.zero, viewer?: Viewer) => {
  const p = await previewOf(w, rows, labelId, viewer);
  return accepted(p).length === 0 ? null : w.f.applyReleases({ labelId, changes: accepted(p) }, viewer);
};

describe('the release registry on the stack (D-172, D-195)', () => {
  it('the preview writes nothing and gives create / update with the diff / unchanged / error / duplicate / missing', async () => {
    const w = await world();
    const { f, zero } = w;
    const first = await previewOf(w, BASE);
    expect(releasePreviewSchema.safeParse(first).error?.issues ?? []).toEqual([]);
    expect(first.totals).toEqual({ rows: 2, create: 2, update: 0, unchanged: 0, error: 0, duplicate: 0, missing: 0 });
    expect((await f.releaseRegistry({ label: zero })).items).toEqual([]);
    expect(await f.applyReleases({ labelId: zero, changes: accepted(first) })).toEqual({ labelId: zero, created: 2, updated: 0, upcs: [UPC_A, UPC_B] });
    expect((await previewOf(w, BASE)).totals).toMatchObject({ rows: 2, create: 0, update: 0, unchanged: 2 });

    const second = await previewOf(w, [
      { ...(BASE[0] as Rel), title: 'Release R-1 (deluxe)', time: '09:15:00' },
      { title: 'Release R-6', upc: UPC_C },
      { title: 'Release R-6', upc: UPC_C },
      { title: 'Release R-7', upc: 'x' },
    ]);
    expect(second.totals).toEqual({ rows: 4, create: 1, update: 1, unchanged: 0, error: 1, duplicate: 1, missing: 1 });
    expect(second.items.map((i) => [i.line, i.upc, i.action, i.codes])).toEqual([
      [2, UPC_A, 'update', []],
      [3, UPC_C, 'create', []],
      [4, UPC_C, 'duplicate', []],
      [5, null, 'error', ['upc_invalid']],
    ]);
    expect(second.items[0]?.changes).toEqual([
      { field: 'releaseTitle', before: 'Release R-1', after: 'Release R-1 (deluxe)' },
      { field: 'releasedAt', before: '2025-03-14T00:00:00', after: '2025-03-14T09:15:00' },
    ]);
    expect(second.missing).toEqual([{ upc: UPC_B, releaseTitle: 'Release R-2' }]);
    // a UPC whose lines disagree is an error on every line
    const split = await previewOf(w, [{ title: 'Release R-8', upc: UPC_C }, { title: 'Release R-8 other', upc: UPC_C }]);
    expect(split.items.map((i) => [i.line, i.action, i.codes])).toEqual([
      [2, 'error', ['duplicate_upc']],
      [3, 'error', ['duplicate_upc']],
    ]);

    // apply only the accepted update: the create waits, the missing UPC stays
    await f.applyReleases({ labelId: zero, changes: accepted(second).filter((c) => c.action === 'update') });
    const listed = (await f.releaseRegistry({ label: zero })).items;
    expect(listed.map((r) => [r.upc, r.releaseTitle, r.releasedAt, r.releaseDate])).toEqual([
      [UPC_A, 'Release R-1 (deluxe)', '2025-03-14T09:15:00', '2025-03-14'],
      [UPC_B, 'Release R-2', '2025-04-01T00:00:00', '2025-04-01'],
    ]);
    const [a, b] = listed as [(typeof listed)[number], (typeof listed)[number]];
    expect([a.createdAt === b.createdAt, a.updatedAt > a.createdAt]).toEqual([true, true]);
  });

  it('the apply refuses a registry that moved since the preview, all or nothing', async () => {
    const w = await world();
    const { f, zero } = w;
    await importOf(w, BASE);
    const p = await previewOf(w, [{ ...(BASE[0] as Rel), title: 'Release R-1 v2' }, { title: 'Release R-6', upc: UPC_C }]);
    // somebody else applies another title of UPC_A in between
    await importOf(w, [{ ...(BASE[0] as Rel), title: 'Release R-1 other' }]);
    await expect(f.applyReleases({ labelId: zero, changes: accepted(p) })).rejects.toMatchObject({
      statusCode: 409,
      code: 'release_changed',
      details: { upcs: [UPC_A] },
    });
    expect((await f.releaseRegistry({ label: zero })).items.map((r) => [r.upc, r.releaseTitle])).toEqual([
      [UPC_A, 'Release R-1 other'],
      [UPC_B, 'Release R-2'],
    ]);
    // a create of a UPC that exists since the preview
    const fresh = await previewOf(w, [{ title: 'Release R-9', upc: UPC_C }]);
    await importOf(w, [{ title: 'Release R-9 first', upc: UPC_C }]);
    await expect(f.applyReleases({ labelId: zero, changes: accepted(fresh) })).rejects.toMatchObject({ code: 'release_changed' });
    const twice = accepted(fresh)[0] as ReturnType<typeof accepted>[number];
    await expect(f.applyReleases({ labelId: zero, changes: [twice, twice] })).rejects.toMatchObject({ code: 'duplicate_upc' });
  });

  it('refusals: the label is required, own and the viewer’s', async () => {
    const w = await world();
    const { f, zero, echo } = w;
    await expect(f.previewReleases({ ...exportFile(BASE), labelId: undefined, source: 'believe' })).rejects.toMatchObject({ statusCode: 400, code: 'label_required' });
    await expect(f.applyReleases({ labelId: undefined, changes: [] })).rejects.toMatchObject({ statusCode: 400, code: 'label_required' });
    await expect(importOf(w, BASE, 'no-such-label')).rejects.toMatchObject({ statusCode: 404 });
    const sub = await f.modules.labels.createLabel({ name: 'Sub Synthetic', kind: 'sublabel', ownLabelId: zero });
    await expect(importOf(w, BASE, sub.id)).rejects.toMatchObject({ statusCode: 400, code: 'label_not_own' });
    // a manager of Echo8 under 0to8
    await expect(importOf(w, BASE, zero, labelsViewer([echo]))).rejects.toMatchObject({ statusCode: 403, code: 'label_forbidden' });
    await expect(f.applyReleases({ labelId: zero, changes: [] }, labelsViewer([echo]))).rejects.toMatchObject({ statusCode: 403, code: 'label_forbidden' });
    expect(await importOf(w, BASE, echo, labelsViewer([echo]))).toMatchObject({ created: 2 });
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
    expect(list.items.map((r) => [r.upc, r.registered, r.registry?.releaseTitle ?? null])).toEqual([
      [UPC_A, true, 'Release R-1'],
      [UPC_C, false, null],
    ]);
    const one = await f.release(UPC_A, zero);
    expect(releaseSchema.safeParse(JSON.parse(JSON.stringify(one))).error?.issues ?? []).toEqual([]);
    expect(one.registry.map((r) => [r.labelName, r.releaseTitle])).toEqual([['0to8', 'Release R-1']]);
    expect((await f.release(UPC_A)).registry.map((r) => r.labelId).sort()).toEqual([zero, echo].sort());
    // a registered UPC without units or tracks is still a release
    expect((await f.release(UPC_B)).registry.map((r) => r.releaseTitle)).toEqual(['Release R-2']);
  });
});

describe('the release registry: the API', () => {
  it('the preview leaves no audit row, the apply is 201 with one; the label is required; the body may be large', async () => {
    const w = await world();
    const { f, zero } = w;
    const app = createApp(f, { tmpDir: join(TMP, 'release-uploads') });
    const api = writer(app);
    const file = exportFile(BASE);
    const none = await api.post('/api/v1/releases/preview').attach('file', file.path, file.fileName);
    expect([none.status, none.body.error.code]).toEqual([400, 'label_required']);
    const prev = await api.post('/api/v1/releases/preview').query({ label: zero, source: 'believe' }).attach('file', file.path, file.fileName).expect(200);
    expect(releasePreviewSchema.safeParse(prev.body).success).toBe(true);
    expect(await f.recentActions(50)).toHaveLength(0);
    const badSource = await api.post('/api/v1/releases/preview').query({ label: zero, source: 'other' }).attach('file', file.path, file.fileName);
    expect(badSource.status).toBe(400);
    const changes = accepted(prev.body as Awaited<ReturnType<typeof previewOf>>);
    const res = await api.post('/api/v1/releases/preview/apply').query({ label: zero }).send({ changes }).expect(201);
    expect(releaseApplySchema.safeParse(res.body).success).toBe(true);
    const rows = await f.recentActions(50);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: '/releases/preview/apply', labelId: zero });
    expect(rows[0]?.summary).toMatchObject({ body: { created: 2, updated: 0, upcs: [UPC_A, UPC_B] } });
    // a body above the 1 MB of the other routes: 4 000 changes (refused as release_changed, not as too large)
    const many = Array.from({ length: 4000 }, () => changes[0]);
    const big = await api.post('/api/v1/releases/preview/apply').query({ label: zero }).send({ changes: many });
    expect([big.status, big.body.error.code]).toEqual([400, 'duplicate_upc']);
    // the static segment before /releases/:upc
    const reg = await api.get('/api/v1/releases/registry').query({ label: zero }).expect(200);
    expect(reg.body.items.map((r: { upc: string }) => r.upc)).toEqual([UPC_A, UPC_B]);
  });
});
