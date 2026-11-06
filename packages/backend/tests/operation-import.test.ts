import { describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { operationImportSchema } from '@erp/shared/api-responses';
import { OPERATION_IMPORT_COLUMNS } from '@erp/shared/operation-import';
import { createApp } from '../src/api/app';
import { operationOf } from '../src/api/operations';
import { can, principalOfUser } from '../src/auth/abilities';
import { ConflictError } from '../src/shared/errors';
import { confirmedOwner, newFacade, tmpPath, TMP, type TestFacade } from './helpers/fixtures';
import { writer } from './helpers/writer';

// The operation import (D-173 stage 5 commit 4, plan «этап5_ведомость.md» §1.5, §6, FIX-9): synthetic names only.

const HEADER = OPERATION_IMPORT_COLUMNS.map((c) => c.name);
type Row = Partial<Record<(typeof HEADER)[number], string>>;

function csv(rows: Row[], opts: { delimiter?: string; bom?: boolean; header?: string[] } = {}) {
  const d = opts.delimiter ?? ',';
  const header = opts.header ?? HEADER;
  const q = (v: string) => (v.includes(d) || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
  const text = [header.join(d), ...rows.map((r) => header.map((h) => q(r[h as keyof Row] ?? '')).join(d))].join('\r\n') + '\r\n';
  const path = tmpPath('operations.csv');
  writeFileSync(path, (opts.bom ? '﻿' : '') + text);
  return { path, fileName: 'operations.csv' };
}

const run = (f: TestFacade, file: { path: string; fileName: string }, dryRun = true, documentId?: string) =>
  f.importOperations({ ...file, labelId: f.testLabels['0to8'], dryRun, documentId });

const codesOf = (r: { issues: { code: string }[] } | undefined) => (r?.issues ?? []).map((i) => i.code).sort();

async function world() {
  const f = await newFacade();
  const o = f.modules.owners;
  const L = f.testLabels['0to8'] as string;
  const { owner, artists } = await confirmedOwner(f, 'Import Owner Synth', ['Import Synth One', 'Import Synth Two']);
  const second = await o.createOwner({ name: 'Second Owner Synth', kind: 'person' });
  await o.createArtist({ pseudonym: 'Second Synth', ownerId: second.id });
  const doc = (kind: 'advance_basis' | 'adjustment_basis' | 'buyout', title: string, ownerId: string | null = owner.id) =>
    o.createDocument({ kind, title, ownerId, requiresApproval: false });
  const advanceBasis = await doc('advance_basis', 'Advance basis synth');
  const adjustBasis = await doc('adjustment_basis', 'Adjustment basis synth');
  const buyoutDoc = await doc('buyout', 'Buyout synth');
  const secondsBasis = await doc('adjustment_basis', 'Second basis synth', second.id);
  return { f, o, L, owner, second, artists: artists as unknown as { id: string }[], advanceBasis, adjustBasis, buyoutDoc, secondsBasis };
}

describe('operation import: reading the file', () => {
  it('a missing or unknown column is 400 import_header; not csv is validation_error; 5 001 rows is 413; ";" + BOM reads', async () => {
    const { f } = await world();
    await expect(run(f, csv([{ kind: 'payout' }], { header: ['owner', 'date', 'kind', 'colour'] }))).rejects.toMatchObject({
      code: 'import_header',
      details: { missing: ['amount'], unknown: ['colour'] },
    });
    const txt = tmpPath('operations.xlsx');
    writeFileSync(txt, 'x');
    await expect(run(f, { path: txt, fileName: 'operations.xlsx' })).rejects.toMatchObject({ code: 'validation_error' });
    const many: Row[] = Array.from({ length: 5001 }, (_, i) => ({ owner: 'Import Owner Synth', date: '2026-01-01', amount: '1', kind: 'payout', external_id: `M${i}` }));
    await expect(run(f, csv(many))).rejects.toMatchObject({ statusCode: 413, code: 'import_too_large' });
    await expect(f.importOperations({ ...csv([]), labelId: undefined, dryRun: true })).rejects.toMatchObject({ code: 'label_required' });
    const p = await run(f, csv([{ owner: 'Import Owner Synth', date: '2026-01-01', amount: '1 000,50', kind: 'payout', external_id: 'B1' }], { delimiter: ';', bom: true }));
    expect(p.rows[0]).toMatchObject({ action: 'create', amount: '1000.5', ownerId: expect.any(String) });
    expect(operationImportSchema.safeParse(p).success).toBe(true);
  });
});

describe('operation import: the row classes', () => {
  it('every class of the preview on one file; nothing is written by a preview', async () => {
    const { f, o, L, owner, second, artists, advanceBasis, adjustBasis, buyoutDoc, secondsBasis } = await world();
    await o.createOwner({ name: 'Twin Owner Synth', kind: 'person' });
    await o.createOwner({ name: 'Twin Owner Synth', kind: 'person' });
    await o.createArtist({ pseudonym: 'Twin Synth', ownerId: owner.id });
    await o.createArtist({ pseudonym: 'Twin Synth', ownerId: owner.id });
    await o.createArtist({ pseudonym: 'Loose Synth', ownerId: null });
    await o.createDocument({ kind: 'adjustment_basis', title: 'Twice', ownerId: null, requiresApproval: false });
    await o.createDocument({ kind: 'adjustment_basis', title: 'Twice', ownerId: null, requiresApproval: false });
    const old = await f.createOperation({
      kind: 'payout',
      direction: 'out',
      amount: '1.00',
      ownerId: owner.id,
      date: '2026-01-05',
      comment: 'paid before',
      migration: true,
      labelId: L,
      externalRef: 'E-OLD',
    });
    const before = (await f.modules.settlements.listOperations({})).length;
    const own = 'Import Owner Synth';
    const one = 'Import Synth One';
    const d = '2026-02-01';
    const file = csv([
      /* 2 */ { owner: 'Nobody Synth', date: d, amount: '10', kind: 'payout', external_id: 'X2' },
      /* 3 */ { owner: 'Twin Owner Synth', date: d, amount: '10', kind: 'payout', external_id: 'X3' },
      /* 4 */ { pseudonym: 'Ghost Synth', date: d, amount: '10', kind: 'deduction' },
      /* 5 */ { pseudonym: 'Twin Synth', date: d, amount: '10', kind: 'deduction' },
      /* 6 */ { owner: second.id, pseudonym: one, date: d, amount: '10', kind: 'deduction' },
      /* 7 */ { pseudonym: 'Loose Synth', date: d, amount: '10', kind: 'deduction' },
      /* 8 */ { owner: own, date: d, amount: '10', kind: 'gift' },
      /* 9 */ { owner: own, date: d, amount: '-10', kind: 'return' },
      /* 10 */ { owner: own, date: d, amount: 'abc', kind: 'payout', external_id: 'X10' },
      /* 11 */ { owner: own, date: '2026-13-01', amount: '10', kind: 'payout', external_id: 'X11' },
      /* 12 */ { pseudonym: one, date: d, amount: '5', kind: 'credit' },
      /* 13 */ { date: d, amount: '10', kind: 'writeoff', document: adjustBasis.id },
      /* 14 */ { owner: own, date: d, amount: '10', kind: 'deduction' },
      /* 15 */ { pseudonym: one, date: d, amount: '10', kind: 'advance', scope: 'everything', document: advanceBasis.id },
      /* 16 */ { pseudonym: one, date: d, amount: '10', kind: 'advance', document: advanceBasis.id },
      /* 17 */ { pseudonym: one, date: d, amount: '-10', kind: 'credit', scope: 'any' },
      /* 18 */ { owner: own, date: d, amount: '10', kind: 'adjustment', document: 'No such title' },
      /* 19 */ { owner: own, date: d, amount: '10', kind: 'adjustment', document: 'Twice' },
      /* 20 */ { owner: own, date: d, amount: '10', kind: 'buyout', external_id: 'X20' },
      /* 21 */ { owner: own, date: d, amount: '10', kind: 'adjustment', document: buyoutDoc.id },
      /* 22 */ { owner: own, date: d, amount: '10', kind: 'adjustment', document: secondsBasis.id },
      /* 23 */ { pseudonym: one, date: d, amount: '10', kind: 'deduction', confirmation: 'dummy://proof.pdf' },
      /* 24 */ { owner: own, date: d, amount: '10', kind: 'payout', external_id: 'X24', channel: 'c'.repeat(101) },
      /* 25 */ { owner: own, date: d, amount: '10', kind: 'payout' },
      /* 26 */ { pseudonym: one, date: d, amount: '10', kind: 'deduction', comment: 'fine' },
      /* 27 */ { owner: own, date: d, amount: '10', kind: 'payout', external_id: 'E-1' },
      /* 28 */ { owner: own, date: d, amount: '11', kind: 'payout', external_id: 'E-1' },
      /* 29 */ { owner: own, date: '2026-01-05', amount: '2', kind: 'payout', external_id: 'E-OLD' },
      /* 30 */ { owner: owner.id, date: '2026-01-05', amount: '1.00', kind: 'payout', external_id: 'E-OLD' },
      /* 31 */ { owner: own, date: d, amount: '1000', kind: 'writeoff', document: adjustBasis.id },
      /* 32 */ { owner: 'Second Owner Synth', date: d, amount: '10', kind: 'payout', external_id: 'X32' },
      /* 33 */ { pseudonym: artists[1]?.id, date: d, amount: '-3', kind: 'credit', document: adjustBasis.title, external_id: 'C33', channel: 'Synthetic bank' },
    ]);
    const p = await run(f, file);
    expect(operationImportSchema.safeParse(p).success).toBe(true);
    const row = (line: number) => p.rows.find((r) => r.line === line);
    const at = (line: number) => codesOf(row(line));
    expect(at(2)).toEqual(['owner_not_found']);
    expect(at(3)).toEqual(['owner_ambiguous']);
    expect(row(3)?.issues[0]?.details).toMatchObject({ candidates: [{ name: 'Twin Owner Synth' }, { name: 'Twin Owner Synth' }] });
    expect(at(4)).toEqual(['no_external_ref', 'pseudonym_not_found']);
    expect(at(5)).toEqual(['no_external_ref', 'pseudonym_ambiguous']);
    expect(at(6)).toEqual(['no_external_ref', 'pseudonym_other_owner']);
    expect(at(7)).toEqual(['artist_without_owner', 'no_external_ref']);
    expect(at(8)).toEqual(['kind_unknown']);
    expect(at(9)).toEqual(['kind_not_importable']);
    expect(at(10)).toEqual(['amount_invalid']);
    expect(at(11)).toEqual(['date_invalid']);
    expect(at(12)).toEqual(['kind_sign', 'no_external_ref']);
    expect(at(13)).toEqual(['no_external_ref', 'owner_required']);
    expect(at(14)).toEqual(['artist_required', 'no_external_ref']);
    expect(at(15)).toEqual(['no_external_ref', 'scope_invalid']);
    expect(at(16)).toEqual(['no_external_ref', 'scope_required']);
    expect(at(17)).toEqual(['no_external_ref', 'scope_forbidden']);
    expect(at(18)).toEqual(['document_not_found', 'no_external_ref']);
    expect(at(19)).toEqual(['document_ambiguous', 'no_external_ref']);
    expect(at(20)).toEqual(['document_required']);
    expect(at(21)).toEqual(['document_kind', 'no_external_ref']);
    expect(at(22)).toEqual(['document_owner_mismatch', 'no_external_ref']);
    expect(at(23)).toEqual(['confirmation_forbidden', 'no_external_ref']);
    expect(at(24)).toEqual(['channel_invalid']);
    expect(at(25)).toEqual(['external_ref_required']);
    expect([at(26), row(26)?.action]).toEqual([['no_external_ref'], 'create']);
    expect([at(27), row(27)?.action]).toEqual([[], 'create']);
    expect(at(28)).toEqual(['duplicate_in_file']);
    expect(row(28)?.issues[0]?.details).toEqual({ line: 27 });
    expect(at(29)).toEqual(['duplicate_external_ref']);
    expect(row(29)?.issues[0]?.details).toEqual({ operationIds: [old.id] });
    expect([at(30), row(30)?.action]).toEqual([['unchanged'], 'unchanged']);
    expect(at(31)).toEqual(['no_external_ref', 'writeoff_exceeds']);
    expect([at(32), row(32)?.action]).toEqual([['no_contract_for_label'], 'create']);
    expect([at(33), row(33)?.action, row(33)?.artistId, row(33)?.documentId]).toEqual([[], 'create', artists[1]?.id, adjustBasis.id]);
    expect(p.totals).toMatchObject({ rows: 32, create: 4, unchanged: 1, byKind: { deduction: '10', payout: '20', credit: '-3' } });
    // nothing written, no proof created
    expect((await f.modules.settlements.listOperations({})).length).toBe(before);
    expect((await o.listDocuments({ kind: 'payment_proof' })).length).toBe(0);
  });

  it('the documentId of the request is the basis of the rows without a document cell whose kind takes one', async () => {
    const { f, adjustBasis } = await world();
    const p = await run(
      f,
      csv([
        { owner: 'Import Owner Synth', date: '2026-02-01', amount: '5', kind: 'adjustment', external_id: 'A1' },
        { owner: 'Import Owner Synth', date: '2026-02-01', amount: '5', kind: 'payout', external_id: 'P1' },
      ]),
      true,
      adjustBasis.id,
    );
    expect(p.rows.map((r) => [r.action, r.documentId])).toEqual([
      ['create', adjustBasis.id],
      ['create', null],
    ]);
  });
});

describe('operation import: the apply', () => {
  const cleanFile = (w: Awaited<ReturnType<typeof world>>) =>
    csv([
      { owner: 'Import Owner Synth', date: '2026-02-03', amount: '100', kind: 'payout', external_id: 'T-1', channel: 'Synthetic cash', confirmation: 'dummy://t-1.pdf' },
      { owner: 'Import Owner Synth', date: '2026-02-04', amount: '40', kind: 'buyout', external_id: 'T-2', document: w.buyoutDoc.id },
      { pseudonym: 'Import Synth One', date: '2026-02-05', amount: '30', kind: 'advance', scope: 'master', document: w.advanceBasis.id, external_id: 'T-3' },
      { pseudonym: 'Import Synth Two', date: '2026-02-06', amount: '7', kind: 'deduction' },
      { pseudonym: 'Import Synth Two', date: '2026-02-06', amount: '-2', kind: 'credit', comment: 'synthetic credit' },
      { owner: 'Import Owner Synth', date: '2026-02-07', amount: '-1.5', kind: 'adjustment', document: w.adjustBasis.id },
    ]);

  it('writes every row through createOperation as migration under the label; the payouts count in paid at once; a repeated file is all unchanged', async () => {
    const w = await world();
    const { f, L, owner } = w;
    const file = cleanFile(w);
    const done = await run(f, file, false);
    expect(operationImportSchema.safeParse(done).success).toBe(true);
    expect([done.applied, done.totals.create, done.result?.operationIds.length, done.result?.proofIds.length]).toEqual([true, 6, 6, 1]);
    const ops = await f.modules.settlements.listOperations({ ownerId: owner.id });
    expect(ops.map((o) => o.kind).sort()).toEqual(['adjustment', 'advance', 'buyout', 'credit', 'deduction', 'payout']);
    for (const o of ops) expect([o.migration, o.labelId, o.labelSource, o.active]).toEqual([true, L, 'operator', true]);
    const payout = ops.find((o) => o.kind === 'payout');
    expect([payout?.externalRef, payout?.channel, payout?.amountCents, payout?.comment]).toEqual(['T-1', 'Synthetic cash', 10000, 'Imported from operations.csv, line 2']);
    // the confirmation is the payout's payment proof, no approval needed
    const proof = await f.modules.owners.getDocument(payout?.paymentProofId as string);
    expect([proof.kind, proof.fileRef, proof.ownerId, proof.labelId, proof.id]).toEqual(['payment_proof', 'dummy://t-1.pdf', owner.id, L, done.result?.proofIds[0]]);
    expect(ops.find((o) => o.kind === 'advance')?.scope).toEqual({ kind: 'master' });
    expect(ops.find((o) => o.kind === 'deduction')?.scope).toEqual({ kind: 'any' });
    // migrated: counted at once, the buyout outside paid, nothing blocks
    const b = await f.ownerBalance(owner.id);
    expect([b.total.paid.toFixed(), b.total.buyouts.toFixed()]).toEqual(['100', '40']);
    expect(b.blockingPayouts).toEqual([]);
    // the same file again: every row unchanged, nothing written
    const again = await run(f, file, false);
    expect([again.totals.create, again.totals.unchanged, again.result]).toEqual([0, 6, { operationIds: [], proofIds: [] }]);
    expect(again.rows.every((r) => r.action === 'unchanged')).toBe(true);
    expect((await f.modules.settlements.listOperations({ ownerId: owner.id })).length).toBe(6);
  });

  it('all or nothing: an error row refuses the apply with details.rows; a refusal of createOperation at the second row writes nothing', async () => {
    const w = await world();
    const { f, owner } = w;
    const bad = csv([
      { owner: 'Import Owner Synth', date: '2026-02-03', amount: '100', kind: 'payout', external_id: 'R-1' },
      { owner: 'Import Owner Synth', date: '2026-02-03', amount: '100', kind: 'payout' },
    ]);
    await expect(run(f, bad, false)).rejects.toMatchObject({
      statusCode: 422,
      code: 'import_invalid',
      details: { rows: [{ line: 3, code: 'external_ref_required' }], errors: 1 },
    });
    const original = f.modules.settlements.createOperation.bind(f.modules.settlements);
    let calls = 0;
    const spy = vi.spyOn(f.modules.settlements, 'createOperation').mockImplementation(async (input) => {
      if (++calls === 2) throw new ConflictError('synthetic refusal', 'synthetic_refusal');
      return original(input);
    });
    try {
      await expect(run(f, cleanFile(w), false)).rejects.toMatchObject({
        statusCode: 422,
        code: 'import_invalid',
        details: { line: 3, cause: 'synthetic_refusal' },
      });
    } finally {
      spy.mockRestore();
    }
    expect(await f.modules.settlements.listOperations({ ownerId: owner.id })).toEqual([]);
    expect(await f.modules.owners.listDocuments({ kind: 'payment_proof' })).toEqual([]);
  });
});

describe('operation import: the API', () => {
  it('a preview leaves no audit row; an apply one with the summary and the ids from the response; the label is required; 413', async () => {
    const w = await world();
    const { f, L } = w;
    const app = createApp(f, { tmpDir: join(TMP, 'operation-import-uploads') });
    const wr = writer(app);
    const file = csv([{ owner: 'Import Owner Synth', date: '2026-02-03', amount: '12.5', kind: 'payout', external_id: 'API-1' }]);
    const url = '/api/v1/settlements/operations/import';
    const none = await wr.post(url).attach('file', file.path, file.fileName);
    expect([none.status, none.body.error.code]).toEqual([400, 'label_required']);
    const preview = await wr.post(url).query({ label: L }).attach('file', file.path, file.fileName).expect(200);
    expect(preview.body).toMatchObject({ dryRun: true, applied: false, result: null, totals: { create: 1 } });
    expect(await f.recentActions(50)).toEqual([]);
    const applied = await wr.post(url).query({ label: L, dryRun: '0' }).attach('file', file.path, file.fileName).expect(201);
    expect(operationImportSchema.safeParse(applied.body).success).toBe(true);
    const rows = await f.recentActions(50);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: '/settlements/operations/import', labelId: L });
    expect(rows[0]?.summary).toMatchObject({ body: { fileName: 'operations.csv', rows: 1, create: 1, unchanged: 0, byKind: { payout: '12.5' } } });
    expect(rows[0]?.entityIds).toEqual(expect.arrayContaining(applied.body.result.operationIds));
    const invalid = await wr
      .post(url)
      .query({ label: L, dryRun: '0' })
      .attach('file', csv([{ owner: 'Nobody Synth', date: '2026-02-03', amount: '1', kind: 'payout', external_id: 'API-2' }]).path, 'operations.csv');
    expect([invalid.status, invalid.body.error.code]).toEqual([422, 'import_invalid']);
    const many = csv(Array.from({ length: 5001 }, (_, i) => ({ owner: 'Import Owner Synth', date: '2026-01-01', amount: '1', kind: 'payout', external_id: `M${i}` })));
    const big = await wr.post(url).query({ label: L }).attach('file', many.path, many.fileName);
    expect([big.status, big.body.error.code]).toEqual([413, 'import_too_large']);
  });

  it('is a pay operation: a label manager is refused even under the own label', () => {
    const op = operationOf('POST', '/settlements/operations/import');
    expect(op?.ability).toEqual({ action: 'pay', subject: 'settlements', scope: 'label' });
    const manager = principalOfUser({ id: 'u', login: 'mgr', isSystemAdmin: false, orgId: 'o', role: 'label_manager', labelIds: ['L'], sessionId: 's' });
    expect(can(manager, op!.ability!, { labelIds: ['L'] })).toEqual({ ok: false, status: 403, code: 'forbidden' });
  });
});
