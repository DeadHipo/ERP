import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { labelsViewer } from '../src/facade/viewer';
import { ConflictError } from '../src/shared/errors';
import { splitImportSchema } from '@erp/shared/api-responses';
import { approvedAppendix, confirmedOwner, newFacade, tmpPath, TMP, writeBelieve, type TestFacade } from './helpers/fixtures';
import { writer } from './helpers/writer';

// The split import (D-172, plan «этап4_онбординг.md» §1.1, §6): synthetic names and ISRCs only.

const I1 = 'QZTST2600101';
const I2 = 'QZTST2600102';
const I3 = 'QZTST2600103';
const I4 = 'QZTST2600104';
const UPC = '1234567890123';
const HEADER = ['isrc', 'pseudonym', 'percent', 'from', 'to', 'owner', 'document', 'artist_id', 'note'];

type Row = Partial<Record<(typeof HEADER)[number], string>>;

function csv(rows: Row[], opts: { delimiter?: string; bom?: boolean; header?: string[] } = {}) {
  const d = opts.delimiter ?? ',';
  const header = opts.header ?? HEADER;
  const q = (v: string) => (v.includes(d) || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
  const text = [header.join(d), ...rows.map((r) => header.map((h) => q(r[h] ?? '')).join(d))].join('\r\n') + '\r\n';
  const path = tmpPath('splits.csv');
  writeFileSync(path, (opts.bom ? '﻿' : '') + text);
  return { path, fileName: 'splits.csv' };
}

async function xlsx(rows: Row[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Splits');
  ws.addRow(HEADER);
  for (const r of rows) ws.addRow(HEADER.map((h) => r[h] ?? ''));
  const path = tmpPath('splits.xlsx');
  await wb.xlsx.writeFile(path);
  return { path, fileName: 'splits.xlsx' };
}

const run = (f: TestFacade, file: { path: string; fileName: string }, dryRun = true, viewer?: Parameters<TestFacade['importSplits']>[1]) =>
  f.importSplits({ ...file, labelId: f.testLabels['0to8'], dryRun }, viewer);

const codesOf = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code).sort();

describe('split import: reading the file', () => {
  it('csv with ";" + BOM + quotes, csv with ",", and xlsx of the same content give the same rows', async () => {
    const f = await newFacade();
    const rows: Row[] = [
      { isrc: I1, pseudonym: 'Synth, Artist', percent: '40', from: '2026-01-15' },
      { isrc: I1, pseudonym: 'Second "Q" Artist', percent: '10.5', from: '2026-01-15', note: 'a; note' },
    ];
    const a = await run(f, csv(rows, { delimiter: ';', bom: true }));
    const b = await run(f, csv(rows));
    const c = await run(f, await xlsx(rows));
    const strip = (x: typeof a) => x.rows.map(({ line: _l, ...r }) => r);
    expect(strip(a)).toEqual(strip(b));
    expect(strip(c)).toEqual(strip(b));
    expect(a.rows[0]).toMatchObject({ pseudonym: 'Synth, Artist', fromFloored: '2026-01-01', percent: '40' });
    expect(splitImportSchema.safeParse(a).success).toBe(true);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a missing or unknown column is 400 import_header; not csv/xlsx is validation_error; 5 001 rows is 413', async () => {
    const f = await newFacade();
    await expect(run(f, csv([{ isrc: I1 }], { header: ['isrc', 'pseudonym', 'percent', 'colour'] }))).rejects.toMatchObject({
      code: 'import_header',
      details: { missing: ['from'], unknown: ['colour'] },
    });
    const txt = tmpPath('splits.txt');
    writeFileSync(txt, 'x');
    await expect(run(f, { path: txt, fileName: 'splits.txt' })).rejects.toMatchObject({ code: 'validation_error' });
    const many: Row[] = Array.from({ length: 5001 }, (_, i) => ({ isrc: I1, pseudonym: `P${i}`, percent: '0.01', from: '2026-01-01' }));
    await expect(run(f, csv(many))).rejects.toMatchObject({ statusCode: 413, code: 'import_too_large' });
  });
});

describe('split import: the row classes', () => {
  it('every class of the preview on one file; nothing is written by a preview', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const { artists, owner } = await confirmedOwner(f, 'Owner Synth', ['Known One', 'Known Two']);
    const [k1, k2] = artists as unknown as [{ id: string }, { id: string }];
    const free = await o.createArtist({ pseudonym: 'Free Artist', ownerId: null });
    await o.createArtist({ pseudonym: 'Twin', ownerId: null });
    await o.createArtist({ pseudonym: 'Twin', ownerId: null });
    await o.createArtist({ pseudonym: 'Words Order', ownerId: null });
    const appendix = await approvedAppendix(f, owner.id);
    const buyout = await o.createDocument({ kind: 'payment_proof', title: 'Synthetic proof', ownerId: null, requiresApproval: false });
    const echoDoc = await o.createDocument({ kind: 'appendix', title: 'Echo appendix', ownerId: null, requiresApproval: false, labelId: f.testLabels.Echo8 });
    await o.createDocument({ kind: 'appendix', title: 'Twice', ownerId: null, requiresApproval: false });
    await o.createDocument({ kind: 'appendix', title: 'Twice', ownerId: null, requiresApproval: false });
    // I2 has a split of Known One 50 (with the appendix): the file changes it from 2026-03
    await f.createSplit({ isrc: I2, validFrom: '2025-01-01', shares: [{ artistId: k1.id, percent: '50' }], documentId: appendix.id });
    // I3: Known Two is a participant
    await f.createParticipation({ isrc: I3, artistId: k2.id, percent: '5', base: 'net', fundedFrom: 'top', validFrom: '2025-01-01', documentId: appendix.id });
    // I4 sits in a file of Echo8
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I4, upc: UPC, net: '1' }], { account: '1055956' }), f.testLabels.Echo8);

    const file = csv([
      /* 2 */ { isrc: 'bad', pseudonym: 'X', percent: '10', from: '2026-01-01' },
      /* 3 */ { isrc: I1, pseudonym: 'Known One', percent: 'abc', from: '2026-01-01' },
      /* 4 */ { isrc: I1, pseudonym: 'Known Two', percent: '10', from: '2026-13-01' },
      /* 5 */ { isrc: I1, pseudonym: '', percent: '', from: '2026-01-01' },
      /* 6 */ { isrc: 'QZTST2600110', pseudonym: 'Brand New', percent: '30', from: '2026-02-17', owner: 'New Owner Synth', document: appendix.id },
      /* 7 */ { isrc: 'QZTST2600110', pseudonym: 'Order Words', percent: '20', from: '2026-02-17', document: appendix.id },
      /* 8 */ { isrc: 'QZTST2600111', pseudonym: 'Known One', percent: '60', from: '2026-01-01', to: '2026-01-20' },
      /* 9 */ { isrc: 'QZTST2600112', pseudonym: 'Known One', percent: '70', from: '2026-01-01' },
      /* 10 */ { isrc: 'QZTST2600112', pseudonym: 'Known Two', percent: '40', from: '2026-01-01' },
      /* 11 */ { isrc: 'QZTST2600113', pseudonym: 'Known One', percent: '10', from: '2026-01-01' },
      /* 12 */ { isrc: 'QZTST2600113', artist_id: k1.id, pseudonym: 'Known One', percent: '10', from: '2026-01-01' },
      /* 13 */ { isrc: I2, pseudonym: 'Known One', percent: '40', from: '2026-03-01', to: '2026-09-01' },
      /* 14 */ { isrc: I3, pseudonym: 'Known Two', percent: '20', from: '2026-01-01', document: buyout.id },
      /* 15 */ { isrc: 'QZTST2600114', pseudonym: 'Known One', percent: '20', from: '2026-01-01', document: 'No such title' },
      /* 16 */ { isrc: 'QZTST2600115', pseudonym: 'Known One', percent: '20', from: '2026-01-01', document: 'Twice' },
      /* 17 */ { isrc: 'QZTST2600116', pseudonym: 'Known One', percent: '20', from: '2026-01-01', document: echoDoc.id },
      /* 18 */ { isrc: 'QZTST2600117', pseudonym: 'Twin', percent: '20', from: '2026-01-01' },
      /* 19 */ { isrc: 'QZTST2600118', artist_id: 'no-such-id', pseudonym: 'Ghost', percent: '20', from: '2026-01-01' },
      /* 20 */ { isrc: 'QZTST2600119', pseudonym: 'Known One', percent: '20', from: '2026-01-01', owner: 'Somebody Else' },
      /* 21 */ { isrc: 'QZTST2600120', artist_id: free.id, pseudonym: 'Free Artist', percent: '20', from: '2026-01-01', owner: 'Owner Synth' },
      /* 22 */ { isrc: I4, pseudonym: 'Known One', percent: '20', from: '2026-01-01' },
    ]);
    const p = await run(f, file);
    const at = (line: number) => codesOf(p.rows.find((r) => r.line === line) as { issues: { code: string }[] });
    expect(at(2)).toContain('isrc_invalid');
    expect(at(3)).toEqual(['existing', 'isrc_outside_label', 'percent_invalid']);
    expect(at(4)).toEqual(['date_invalid', 'existing']);
    expect(at(5)).toEqual(['isrc_outside_label', 'row_incomplete']);
    expect(at(6)).toEqual(['date_floored', 'isrc_outside_label', 'new_pseudonym', 'our_share', 'owner_new']);
    const row7 = p.rows.find((r) => r.line === 7);
    expect(row7?.issues.find((i) => i.code === 'new_pseudonym')?.details).toMatchObject({ similar: [{ name: 'Words Order', matchedBy: ['pseudonym words'] }] });
    expect(row7?.fromFloored).toBe('2026-02-01');
    expect(at(8)).toEqual(['date_floored', 'empty_period', 'existing', 'isrc_outside_label', 'our_share']);
    expect(at(9)).toEqual(['existing', 'isrc_outside_label', 'split_sum_above_100']);
    expect(at(12)).toEqual(['duplicate_artist', 'existing', 'isrc_outside_label', 'our_share']);
    expect(at(13)).toEqual(['document_required', 'existing', 'isrc_outside_label', 'our_share', 'replaces', 'to_on_change']);
    expect(at(14)).toEqual(['document_kind', 'double_participation', 'existing', 'isrc_outside_label', 'our_share']);
    expect(at(15)).toContain('document_not_found');
    expect(at(16)).toContain('document_ambiguous');
    expect(at(17)).toContain('document_other_label');
    expect(at(18)).toContain('pseudonym_ambiguous');
    expect(at(19)).toContain('artist_not_found');
    expect(at(20)).toEqual(['existing', 'isrc_outside_label', 'our_share', 'owner_mismatch', 'owner_new']);
    expect(at(21)).toEqual(['existing', 'isrc_outside_label', 'our_share', 'owner_assign', 'owner_found']);
    expect(p.rows.find((r) => r.line === 22)?.issues.find((i) => i.code === 'isrc_outside_label')?.details).toEqual({
      book: 'other',
      labelId: f.testLabels.Echo8,
      labelName: 'Echo8',
    });
    const g = p.groups.find((x) => x.key === 'QZTST2600110|2026-02-01');
    expect(g).toMatchObject({ action: 'create', ourShare: '50', documentId: appendix.id });
    expect(p.groups.find((x) => x.key === `${I2}|2026-03-01`)).toMatchObject({ action: 'blocked', before: [{ artistId: k1.id, percent: '50' }] });
    expect(p.totals).toMatchObject({ rows: 21, artistsNew: 3, ownersNew: 2 }); // X, Brand New, Order Words; New Owner Synth, Somebody Else
    expect(p.totals.errors).toBeGreaterThan(0);
    expect(p.result).toBeNull();
    // the preview wrote nothing; the apply refuses with the error rows
    expect((await f.listSplits({})).total).toBe(1);
    await expect(run(f, file, false)).rejects.toMatchObject({ code: 'import_invalid', details: { rows: expect.arrayContaining([{ line: 2, code: 'isrc_invalid' }]) } });
    expect((await f.listSplits({})).total).toBe(1);
  });

  it('two groups of a new ISRC are create + change; the apply creates owners, pseudonyms and splits; a replacement keeps the row document of an equal percent; a repeat is unchanged', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const { artists } = await confirmedOwner(f, 'Owner Keep', ['Keeper']);
    const keeper = (artists as unknown as [{ id: string }])[0];
    const appendix = await approvedAppendix(f);
    const second = await o.createDocument({ kind: 'appendix', title: 'Second appendix', ownerId: null, requiresApproval: false });
    const own = await o.createDocument({ kind: 'appendix', title: 'Row appendix', ownerId: null, requiresApproval: false });
    // I2: Keeper 30 with its own row document
    await f.createSplit({ isrc: I2, validFrom: '2025-01-01', shares: [{ artistId: keeper.id, percent: '30', documentId: own.id }], documentId: null });
    const file = csv([
      { isrc: I1, pseudonym: 'Fresh Synth', percent: '50', from: '2026-01-01', owner: 'Fresh Owner', document: 'Dummy appendix (Schedule C)' },
      { isrc: I1, pseudonym: 'Fresh Synth', percent: '60', from: '2026-04-01', document: appendix.id },
      { isrc: I2, pseudonym: 'Keeper', percent: '30', from: '2026-05-01', document: second.id },
      { isrc: I2, pseudonym: 'Fresh Synth', percent: '10', from: '2026-05-01', document: second.id },
    ]);
    const p = await run(f, file);
    expect(p.groups.map((g) => [g.key, g.action])).toEqual([
      [`${I1}|2026-01-01`, 'create'],
      [`${I1}|2026-04-01`, 'change'],
      [`${I2}|2026-05-01`, 'change'],
    ]);
    const done = await run(f, file, false);
    expect(done.applied).toBe(true);
    expect(done.result?.splitIds).toHaveLength(3);
    expect(done.result?.artistIds).toHaveLength(1);
    expect(done.result?.ownerIds).toHaveLength(1);
    const fresh = await o.getArtist(done.result?.artistIds[0] as string);
    expect([fresh.pseudonym, fresh.ownerId, fresh.origin]).toEqual(['Fresh Synth', done.result?.ownerIds[0], 'import']);
    const i1 = (await f.listSplits({ isrc: I1 })).items;
    expect(i1.map((s) => [s.validFrom, s.validTo, s.origin, s.shares.map((x) => x.percent)])).toEqual([
      ['2026-01-01', '2026-04-01', 'import', ['50']],
      ['2026-04-01', null, 'import', ['60']],
    ]);
    const i2 = (await f.listSplits({ isrc: I2 })).items.find((s) => s.validFrom === '2026-05-01');
    expect(i2?.documentId).toBe(second.id);
    expect(i2?.shares.find((x) => x.artistId === keeper.id)?.documentId).toBe(own.id); // same percent keeps its document
    expect(i2?.shares.find((x) => x.artistId !== keeper.id)?.documentId).toBeNull();
    const again = await run(f, file);
    expect(again.groups.every((g) => g.action === 'unchanged')).toBe(true);
    expect(again.totals).toMatchObject({ artistsNew: 0, ownersNew: 0, errors: 0 });
  });

  it('an unchanged group still assigns the owner the preview promised (a new owner is created)', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const free = await o.createArtist({ pseudonym: 'Unowned Synth', ownerId: null });
    const appendix = await approvedAppendix(f);
    await f.createSplit({ isrc: I1, validFrom: '2026-01-01', shares: [{ artistId: free.id, percent: '30' }], documentId: appendix.id });
    const file = csv([{ isrc: I1, pseudonym: 'Unowned Synth', percent: '30', from: '2026-01-01', owner: 'Assigned Owner Synth' }]);
    const p = await run(f, file);
    expect(p.groups[0]?.action).toBe('unchanged');
    expect(codesOf(p.rows[0] as { issues: { code: string }[] })).toEqual(expect.arrayContaining(['owner_assign', 'owner_new', 'unchanged']));
    const done = await run(f, file, false);
    expect(done.result?.splitIds).toEqual([]);
    expect(done.result?.ownerIds).toHaveLength(1);
    expect((await o.getArtist(free.id)).ownerId).toBe(done.result?.ownerIds[0]);
  });

  it('a change whose from precedes every split is applied as the preview says: it lasts to the first split', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const a = await o.createArtist({ pseudonym: 'Early Synth', ownerId: null });
    const appendix = await approvedAppendix(f);
    await f.createSplit({ isrc: I1, validFrom: '2026-01-01', shares: [{ artistId: a.id, percent: '30' }], documentId: appendix.id });
    const file = csv([{ isrc: I1, pseudonym: 'Early Synth', percent: '20', from: '2025-03-01', document: appendix.id }]);
    const p = await run(f, file);
    expect(p.groups[0]).toMatchObject({ action: 'change', before: null });
    const done = await run(f, file, false);
    expect(done.result?.splitIds).toHaveLength(1);
    expect((await f.listSplits({ isrc: I1 })).items.map((s) => [s.validFrom, s.validTo])).toEqual([
      ['2025-03-01', '2026-01-01'],
      ['2026-01-01', null],
    ]);
  });

  it('all or nothing: a refusal of the facade at the second group writes nothing and keeps its code as details.cause', async () => {
    const f = await newFacade();
    const before = (await f.modules.owners.listOwners()).length;
    const original = f.modules.splits.createSplit.bind(f.modules.splits);
    let calls = 0;
    const spy = vi.spyOn(f.modules.splits, 'createSplit').mockImplementation(async (input) => {
      if (++calls === 2) throw new ConflictError('synthetic overlap', 'split_overlap');
      return original(input);
    });
    try {
      const file = csv([
        { isrc: I1, pseudonym: 'Roll Back One', percent: '50', from: '2026-01-01', owner: 'Roll Back Owner' },
        { isrc: I2, pseudonym: 'Roll Back Two', percent: '50', from: '2026-01-01' },
      ]);
      await expect(run(f, file, false)).rejects.toMatchObject({
        statusCode: 422,
        code: 'import_invalid',
        details: { group: `${I2}|2026-01-01`, cause: 'split_overlap' },
      });
    } finally {
      spy.mockRestore();
    }
    expect((await f.listSplits({})).total).toBe(0);
    expect((await f.modules.owners.findSimilarArtists('Roll Back One')).length).toBe(0);
    expect((await f.modules.owners.listOwners()).length).toBe(before);
  });

  it('rows without a document wait in C split_unconfirmed, not assumption', async () => {
    const f = await newFacade();
    const { artists } = await confirmedOwner(f, 'Owner Wait', ['Waiter']);
    await f.modules.owners.createTrack({ title: 'T', isrc: I1, upc: UPC, artistIds: [(artists as unknown as [{ id: string }])[0].id] });
    await run(f, csv([{ isrc: I1, pseudonym: 'Waiter', percent: '40', from: '2026-01-01' }]), false);
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }]), f.testLabels['0to8']);
    const [r] = await f.reconciliation();
    expect(r?.C_breakdown.split_unconfirmed?.toFixed()).toBe('40');
    expect(r?.C_breakdown.assumption).toBeUndefined();
  });

  it('a viewer of some labels: change and owner assignment are forbidden, an ISRC of another book label_forbidden, an ISRC without a book passes', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const free = await o.createArtist({ pseudonym: 'Free Mgr', ownerId: null });
    const appendix = await approvedAppendix(f);
    await f.createSplit({ isrc: I2, validFrom: '2025-01-01', shares: [{ artistId: free.id, percent: '10' }], documentId: appendix.id });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I4, upc: UPC, net: '1' }], { account: '1055956' }), f.testLabels.Echo8);
    await o.createOwner({ name: 'Visible Nowhere', kind: 'person' });
    const manager = labelsViewer([f.testLabels['0to8']]);
    const p = await run(
      f,
      csv([
        { isrc: I1, pseudonym: 'Mgr New', percent: '20', from: '2026-01-01', owner: 'Mgr New Owner' },
        { isrc: I2, pseudonym: 'Free Mgr', percent: '20', from: '2026-03-01', document: appendix.id },
        { isrc: I3, pseudonym: 'Free Mgr', percent: '20', from: '2026-01-01', owner: 'Visible Nowhere' },
        { isrc: I4, pseudonym: 'Mgr New', percent: '20', from: '2026-01-01' },
      ]),
      true,
      manager,
    );
    expect(codesOf(p.rows[0] as { issues: { code: string }[] })).not.toContain('forbidden');
    expect(p.groups[0]?.action).toBe('create');
    expect(p.rows[1]?.issues.find((i) => i.code === 'forbidden')?.details).toEqual({ reason: 'change' });
    expect(p.rows[2]?.issues.find((i) => i.code === 'forbidden')?.details).toEqual({ reason: 'owner_assign' });
    expect(codesOf(p.rows[3] as { issues: { code: string }[] })).toContain('label_forbidden');
  });
});

describe('split import: the API', () => {
  it('a preview leaves no audit row; an apply one with the summary and the created ids from the response; the label is required', async () => {
    const f = await newFacade();
    const app = createApp(f, { tmpDir: join(TMP, 'split-import-uploads') });
    const w = writer(app);
    const L = f.testLabels['0to8'];
    const file = csv([{ isrc: I1, pseudonym: 'Api Synth', percent: '25', from: '2026-01-01' }]);
    const none = await w.post('/api/v1/splits/import').attach('file', file.path, file.fileName);
    expect([none.status, none.body.error.code]).toEqual([400, 'label_required']);
    const preview = await w.post('/api/v1/splits/import').query({ label: L }).attach('file', file.path, file.fileName).expect(200);
    expect(preview.body).toMatchObject({ dryRun: true, applied: false, result: null });
    expect(await f.recentActions(50)).toEqual([]);
    const applied = await w.post('/api/v1/splits/import').query({ label: L, dryRun: '0' }).attach('file', file.path, file.fileName).expect(201);
    expect(splitImportSchema.safeParse(applied.body).success).toBe(true);
    const rows = await f.recentActions(50);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: '/splits/import', labelId: L });
    expect(rows[0]?.summary).toMatchObject({ body: { fileName: 'splits.csv', rows: 1, groups: 1, create: 1, artistsNew: 1, ownersNew: 0 } });
    expect(rows[0]?.entityIds).toEqual(expect.arrayContaining([...applied.body.result.splitIds, ...applied.body.result.artistIds]));
    // 5 001 rows: 413 import_too_large
    const many = csv(Array.from({ length: 5001 }, (_, i) => ({ isrc: I1, pseudonym: `P${i}`, percent: '0.01', from: '2026-01-01' })));
    const big = await w.post('/api/v1/splits/import').query({ label: L }).attach('file', many.path, many.fileName);
    expect([big.status, big.body.error.code]).toEqual([413, 'import_too_large']);
  });
});

describe('split import: the time of a full file', () => {
  it('5 000 rows (2 000 groups) apply in ≤ 30 s with one read of the pseudonym index', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const doc = await approvedAppendix(f);
    for (let i = 0; i < 50; i++) await o.createArtist({ pseudonym: `Bulk Known ${i}`, ownerId: null });
    const rows: Row[] = [];
    for (let g = 0; g < 2000; g++) {
      const isrc = `QZTST26${String(10000 + g).padStart(5, '0')}`;
      const n = g < 1000 ? 3 : 2;
      for (let k = 0; k < n; k++)
        rows.push({ isrc, pseudonym: k === 0 ? `Bulk Known ${g % 50}` : `Bulk New ${(g + k) % 100}`, percent: '10', from: '2026-01-01', document: doc.id });
    }
    expect(rows).toHaveLength(5000);
    const spy = vi.spyOn(o, 'artistIndex');
    const started = Date.now();
    const done = await run(f, csv(rows), false);
    const ms = Date.now() - started;
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(done.result?.splitIds).toHaveLength(2000);
    expect(done.result?.artistIds).toHaveLength(100);
    expect(ms).toBeLessThanOrEqual(30_000);
  }, 120_000);
});

describe('split import: the «100 % label» row (D-175)', () => {
  it('a row without a pseudonym and percent 100 creates a split without rows; alone in its group; a repeat is unchanged; the money is ours', async () => {
    const f = await newFacade();
    const L = f.testLabels['0to8'];
    await f.modules.owners.createTrack({ title: 'label track', isrc: I1, upc: UPC });
    await f.modules.owners.createTrack({ title: 'label track 2', isrc: I2, upc: UPC });
    await confirmedOwner(f, 'Label Row Owner', ['Label Row Synth']);
    const doc = await approvedAppendix(f);
    await f.ingestBelieve(writeBelieve('2026-09', [{ isrc: I1, upc: UPC, net: '100' }, { isrc: I2, upc: UPC, net: '40' }]), L);
    // before: both ISRCs wait in C no_split (D-175)
    const before = (await f.reconciliation()).find((r) => r.month === '2026-09');
    expect([before?.ourShare.toFixed(), before?.C_breakdown.no_split?.toFixed()]).toEqual(['0', '140']);
    const p = await run(f, csv([
      /* 2 */ { isrc: I1, percent: '100', from: '2026-09-01', document: doc.id },
      /* 3 */ { isrc: I2, percent: '100', from: '2026-09-01', document: doc.id },
      /* 4 */ { isrc: I2, pseudonym: 'Label Row Synth', percent: '10', from: '2026-09-01', document: doc.id },
      /* 5 */ { isrc: I1, percent: '50', from: '2026-10-01', document: doc.id },
    ]));
    const row = (line: number) => p.rows.find((r) => r.line === line);
    expect(codesOf(row(2) as { issues: { code: string }[] })).toEqual(['label_only']);
    expect(codesOf(row(3) as { issues: { code: string }[] })).toEqual(['label_only', 'label_row_with_rows']);
    expect(codesOf(row(5) as { issues: { code: string }[] })).toEqual(['row_incomplete']);
    expect(p.groups.find((g) => g.isrc === I1 && g.from === '2026-09-01')).toMatchObject({ action: 'create', ourShare: '100' });
    const applied = await run(f, csv([{ isrc: I1, percent: '100', from: '2026-09-01', document: doc.id }]), false);
    expect(applied.applied).toBe(true);
    const split = (await f.modules.splits.listSplits({ isrcs: [I1] }))[0];
    expect([split?.shares, split?.documentId, split?.validFrom]).toEqual([[], doc.id, '2026-09-01']);
    const after = (await f.reconciliation()).find((r) => r.month === '2026-09');
    expect([after?.ourShare.toFixed(), after?.C_breakdown.no_split?.toFixed()]).toEqual(['100', '40']);
    const again = await run(f, csv([{ isrc: I1, percent: '100', from: '2026-09-01', document: doc.id }]));
    expect(again.groups[0]?.action).toBe('unchanged');
  });
});
