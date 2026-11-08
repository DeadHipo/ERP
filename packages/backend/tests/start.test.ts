import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { payoutSnapshotSchema, startImportSchema, startListSchema } from '@erp/shared/api-responses';
import { START_IMPORT_COLUMNS } from '@erp/shared/start-import';
import { Case, I } from './helpers/golden-case';
import { approvedDoc, tmpPath, unconfirmedOwner } from './helpers/fixtures';
import { labelsViewer } from '../src/facade/viewer';

// The opening balances (D-174, the cut of 15.10.2026): a start per pseudonym in the book of a label replaces the
// recalculated history up to the cut; the balance drops the inputs of the book up to the cut month and the operations
// up to the synchronisation day (a reopened advance stays), and adds the start. Synthetic names only; every expected
// number is hand-computed.

const HEADER = START_IMPORT_COLUMNS.map((c) => c.name);
type Row = Partial<Record<(typeof HEADER)[number], string>>;

function csv(rows: Row[], opts: { header?: string[]; name?: string } = {}) {
  const header = opts.header ?? HEADER;
  const q = (v: string) => (v.includes(';') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
  const text = [header.join(';'), ...rows.map((r) => header.map((h) => q(r[h as keyof Row] ?? '')).join(';'))].join('\r\n') + '\r\n';
  const path = tmpPath(opts.name ?? 'start.csv');
  writeFileSync(path, '﻿' + text);
  return { path, fileName: opts.name ?? 'start.csv' };
}

const CUTOFF = '2026-08';
const SYNCED = '2026-10-15T15:09:49.505Z';

/**
 * One owner O with two pseudonyms S1 (I(1) 50 %) and S2 (I(2) 50 %), book 0to8. Files: 2026-07 (I1 100, I2 40 → S1
 * 50, S2 20), 2026-08 (I1 200 → S1 100), 2026-09 (I1 60, I2 10 → S1 30, S2 5). Operations: a migrated payout 30 of
 * 2026-08-20 (P1), an advance 40 to S1 of 2026-08-25 (A1), an advance 12 to S1 of 2026-09-02 (A2), a migrated payout
 * 5 of 2026-10-20 (P2); ads on I1: 3 in 2026-08, 2 in 2026-09. Before any start: earned 205, recouped 52 (A1 from the
 * 2026-08 income of S1, A2 from its 2026-09 income), paid 35, ads 5 → payable 113.
 */
async function world() {
  const c = await Case.start();
  const f = c.f;
  const zero = f.testLabels['0to8'];
  await c.person('S1');
  await c.second('S2', 'S1');
  await c.track(I(1));
  await c.track(I(2));
  await c.split(I(1), [['S1', '50']]);
  await c.split(I(2), [['S2', '50']]);
  await c.load('2026-07', [{ isrc: I(1), net: '100' }, { isrc: I(2), net: '40' }]);
  await c.load('2026-08', [{ isrc: I(1), net: '200' }]);
  await c.load('2026-09', [{ isrc: I(1), net: '60' }, { isrc: I(2), net: '10' }]);
  const owner = c.owners.get('S1') as string;
  const basis = await approvedDoc(f, 'advance_basis', owner);
  const p1 = await f.createOperation({ direction: 'out', amount: '30', ownerId: owner, date: '2026-08-20', comment: 'P1', migration: true, labelId: zero });
  const a1 = await f.createOperation({ direction: 'out', amount: '40', artistId: c.id('S1'), date: '2026-08-25', scope: { kind: 'any' }, documentId: basis.id, comment: 'A1', labelId: zero });
  await f.attachPaymentProof(a1.id, { fileRef: 'dummy://a1.pdf' });
  const a2 = await f.createOperation({ direction: 'out', amount: '12', artistId: c.id('S1'), date: '2026-09-02', scope: { kind: 'any' }, documentId: basis.id, comment: 'A2', labelId: zero });
  await f.attachPaymentProof(a2.id, { fileRef: 'dummy://a2.pdf' });
  const p2 = await f.createOperation({ direction: 'out', amount: '5', ownerId: owner, date: '2026-10-20', comment: 'P2', migration: true, labelId: zero });
  await f.createAds([
    { isrc: I(1), month: '2026-08', amount: '3', labelId: zero },
    { isrc: I(1), month: '2026-09', amount: '2', labelId: zero },
  ]);
  const rows: Row[] = [
    { pseudonym: 'S1', master: '70.5' },
    { pseudonym: 'S2', master: '-10' },
    { pseudonym: 'S1', kind: 'adjustment', master: '12', basis: 'reopen A2', operation_ref: a2.id },
  ];
  const run = (file = csv(rows), dryRun = true, extra: { basis?: string; cutoff?: string; syncedAt?: string } = {}) =>
    f.importStart({ ...file, labelId: zero, cutoff: extra.cutoff ?? CUTOFF, syncedAt: extra.syncedAt ?? SYNCED, dryRun, basis: extra.basis ?? 'cabinet synth sha' });
  return { c, f, zero, owner, p1, a1, a2, p2, rows, run };
}

const codesOf = (r: { issues: { code: string }[] } | undefined) => (r?.issues ?? []).map((i) => i.code).sort();

describe('the opening balances (D-174): the cut and the start in the balance', () => {
  it('before the start the history counts; after it the book drops the inputs up to the cut and adds the start', async () => {
    const { c, f, zero, owner, a2, run } = await world();
    const before = await f.ownerBalance(owner);
    expect([before.total.earned, before.total.recouped, before.total.paid, before.total.adsCharged, before.total.payable].map((x) => x.toFixed())).toEqual(['205', '52', '35', '5', '113']);
    expect(before.start).toBeNull();
    expect(before.total.start.toFixed()).toBe('0');

    const preview = await run();
    expect(startImportSchema.safeParse(JSON.parse(JSON.stringify(preview))).success).toBe(true);
    expect([preview.applied, preview.totals.create, preview.totals.starts, preview.totals.adjustments, preview.totals.master, preview.totals.publishing]).toEqual([false, 3, 2, 1, '72.5', '0']);
    expect((await f.listStart({ labelId: zero })).rows).toEqual([]); // the preview wrote nothing
    const applied = await run(undefined, false);
    expect([applied.applied, applied.result?.ids.length]).toEqual([true, 3]);

    const b = await f.ownerBalance(owner);
    // start 70.5 − 10 + 12 = 72.5; after the cut: S1 30 + S2 5 earned, A2 (reopened) recoups 12, P2 paid 5, the 2026-09 ad 2
    expect([b.total.start, b.total.earned, b.total.recouped, b.total.paid, b.total.adsCharged, b.total.payable].map((x) => x.toFixed())).toEqual(['72.5', '35', '12', '5', '2', '88.5']);
    expect(b.total.startMissing).toBe(false);
    expect(b.positions.map((p) => [p.operationId, p.recouped.toFixed(), p.remaining.toFixed()])).toEqual([[a2.id, '12', '0']]);
    expect(b.ads.map((a) => a.month)).toEqual(['2026-09']);
    expect(b.blockingPayouts).toEqual([]);
    // the book and its areas
    const book = b.byLabel['0to8'] as NonNullable<(typeof b.byLabel)[string]>;
    expect([book.start, book.payable, book.byArea.master.start, book.byArea.master.payable, book.byArea.publishing.start].map((x) => x.toFixed())).toEqual(['72.5', '88.5', '72.5', '88.5', '0']);
    // the pseudonym rows carry their start; S1 holds the reopened position
    const s1 = b.artists.find((a) => a.pseudonym === 'S1');
    const s2 = b.artists.find((a) => a.pseudonym === 'S2');
    expect([s1?.start, s1?.earned, s1?.recouped, s1?.unrecouped].map((x) => x?.toFixed())).toEqual(['82.5', '30', '12', '0']);
    expect([s2?.start, s2?.earned].map((x) => x?.toFixed())).toEqual(['-10', '5']);
    expect(s1?.byLabel['0to8']?.start.toFixed()).toBe('82.5');
    // the start block: the cut of the book, the three rows, what the cut removed
    expect(b.start?.cuts).toEqual([{ labelId: zero, cutoffMonth: CUTOFF, syncedDay: '2026-10-15', syncedAt: SYNCED }]);
    expect(b.start?.rows.map((r) => [r.pseudonym, r.kind, r.masterCents, r.operationRef])).toEqual([['S1', 'start', 7050, null], ['S2', 'start', -1000, null], ['S1', 'adjustment', 1200, a2.id]]);
    const inside = b.start?.insideStart;
    expect([inside?.earned, inside?.waiting, inside?.paid, inside?.advances, inside?.adsCharged].map((x) => x?.toFixed())).toEqual(['170', '0', '30', '40', '3']);
    expect(inside?.operations).toBe(2);
    // the pseudonym card: the same start, nothing paid before the cut
    const s1Money = await f.artistBalance(c.id('S1'));
    expect([s1Money.total.start, s1Money.total.paid, s1Money.byLabel['0to8']?.start].map((x) => x?.toFixed())).toEqual(['82.5', '0', '82.5']);
  });

  it('asOf before or at the cut answers the start alone; after it the movements of that month; the payables and the payroll carry the start', async () => {
    const { f, zero, owner, run } = await world();
    await run(undefined, false);
    const at08 = await f.ownerBalance(owner, { asOf: '2026-08' });
    expect([at08.total.start, at08.total.earned, at08.total.payable].map((x) => x.toFixed())).toEqual(['72.5', '0', '72.5']);
    const at07 = await f.ownerBalance(owner, { asOf: '2026-07' });
    expect(at07.total.payable.toFixed()).toBe('72.5');
    // 2026-09: the units of 09 (35), A2 recoups 12, the ad of 09 (2); P2 of 2026-10-20 is after
    const at09 = await f.ownerBalance(owner, { asOf: '2026-09' });
    expect([at09.total.earned, at09.total.recouped, at09.total.paid, at09.total.adsCharged, at09.total.payable].map((x) => x.toFixed())).toEqual(['35', '12', '0', '2', '93.5']);
    // the payables list and the payroll are the same balance
    const item = (await f.ownerPayables({ label: zero })).items.find((i) => i.ownerId === owner);
    expect([item?.start?.toFixed(), item?.payable.toFixed(), item?.startMissing]).toEqual(['72.5', '88.5', false]);
    const p = await f.payroll(zero, { area: 'master' });
    const rows = p.rows.filter((r) => r.ownerId === owner);
    expect(rows.map((r) => [r.rowKind, r.pseudonym, r.start.toFixed()])).toEqual([['pseudonym', 'S1', '82.5'], ['pseudonym', 'S2', '-10'], ['owner', null, '0'], ['total', null, '72.5']]);
    expect(rows.at(-1)?.payable?.toFixed()).toBe('88.5');
    const all = (await f.payroll(zero, { area: 'all' })).rows.filter((r) => r.ownerId === owner);
    expect(all.at(-1)?.start.toFixed()).toBe('72.5');
    // the list of the book
    const list = await f.listStart({ labelId: zero });
    expect(startListSchema.safeParse(JSON.parse(JSON.stringify(list))).success).toBe(true);
    expect([list.totals.starts, list.totals.adjustments, list.totals.missing, list.totals.inactive, list.totals.master.toFixed(), list.totals.total.toFixed(), list.totals.cutoffMonths]).toEqual([2, 1, 0, 0, '72.5', '72.5', [CUTOFF]]);
    expect(list.rows.map((r) => [r.pseudonym, r.ownerId])).toEqual([['S1', owner], ['S2', owner], ['S1', owner]]);
  });

  it('the payout pays the start plus the movements, its snapshot records the start; a deactivated row leaves the book cut while the owner keeps rows in it', async () => {
    const { c, f, zero, owner, run } = await world();
    await run(undefined, false);
    const op = await f.createPayout(owner, { labelId: zero });
    // D-181: the button pays Σ of the positive positions: S1 93.5 (start 82.5 + 35 − 12 − 2 − 5 … its own terms); the
    // position of S2 (start −10 + its 2026-09 income 5 = −5) stays its own and is not netted
    expect(op.amountCents).toBe(9350);
    expect(op.allocation).toEqual({ [c.id('S1')]: 9350 });
    const snapshot = await f.operationSnapshot(op.id);
    expect(payoutSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect((snapshot as { total: { start: string } }).total.start).toBe('72.5');
    // the start of S2 deactivated: the start loses −10; the book stays cut for the whole owner by the rows of S1 (S2's
    // 2026-07 income stays inside the start: a pseudonym without a row had no position in the cabinet)
    const s2Row = (await f.listStart({ labelId: zero })).rows.find((r) => r.pseudonym === 'S2' && r.kind === 'start');
    const off = await f.deactivateStart(s2Row?.id as string, 'wrong snapshot');
    expect([off.active, off.deactivatedReason]).toEqual([false, 'wrong snapshot']);
    await expect(f.deactivateStart(s2Row?.id as string, 'again')).rejects.toMatchObject({ code: 'already_inactive' });
    const after = await f.ownerBalance(owner);
    // start 82.5; earned 35; the payout of 93.5 is dated today (after the cut) and counts once its proof is approved: pending here
    expect([after.total.start, after.total.earned, after.total.payable].map((x) => x.toFixed())).toEqual(['82.5', '35', '98.5']);
    expect(after.start?.rows.map((r) => r.pseudonym)).toEqual(['S1', 'S1']);
    expect((await f.listStart({ labelId: zero })).totals.inactive).toBe(0);
    expect((await f.listStart({ labelId: zero, active: false })).totals.inactive).toBe(1);
    expect(c.id('S2')).toBeTruthy();
  });

  it('a missing start is not a zero: the history is cut, the gate and the button answer start_missing', async () => {
    const c = await Case.start();
    const f = c.f;
    const zero = f.testLabels['0to8'];
    await c.person('M1');
    await c.track(I(1));
    await c.split(I(1), [['M1', '50']]);
    await c.load('2026-07', [{ isrc: I(1), net: '100' }]);
    await c.load('2026-09', [{ isrc: I(1), net: '100' }]);
    const owner = c.owners.get('M1') as string;
    const out = await f.importStart({ ...csv([{ pseudonym: 'M1', missing: '1' }]), labelId: zero, cutoff: CUTOFF, syncedAt: SYNCED, dryRun: false, basis: 'cabinet 500' });
    expect([out.totals.missing, out.result?.ids.length]).toEqual([1, 1]);
    const b = await f.ownerBalance(owner);
    expect([b.total.start.toFixed(), b.total.earned.toFixed(), b.total.payable.toFixed(), b.total.startMissing]).toEqual(['0', '50', '50', true]);
    expect(b.byLabel['0to8']?.startMissing).toBe(true);
    expect(b.payout).toEqual({ allowed: false, reason: 'start_missing', amountCents: 5000 });
    await expect(f.createPayout(owner, { labelId: zero })).rejects.toMatchObject({ code: 'start_missing' });
    // under another book the owner has no start: nothing missing there (and nothing earned)
    expect((await f.ownerBalance(owner, {}, f.testLabels.Echo8)).payout.reason).toBe('nothing_to_pay');
  });
});

describe('the opening balances (D-174): the import classes and the refusals', () => {
  it('every class of the preview on one file; the apply with an error row writes nothing', async () => {
    const { c, f, zero, owner, p1, a2, run } = await world();
    await unconfirmedOwner(f, 'Unconfirmed Synth', ['Loose Start']);
    const late = await f.createOperation({ direction: 'out', amount: '1', artistId: c.id('S1'), date: '2026-11-01', scope: { kind: 'any' }, documentId: (await approvedDoc(f, 'advance_basis', owner)).id, comment: 'late advance', labelId: zero });
    await f.modules.owners.createArtist({ pseudonym: 'Orphan Start', ownerId: null });
    const file = csv([
      /* 2 */ { pseudonym: 'Nobody Start', master: '1' },
      /* 3 */ { pseudonym: 'Orphan Start', master: '1' },
      /* 4 */ { pseudonym: 'S1', kind: 'gift', master: '1' },
      /* 5 */ { pseudonym: 'S1', master: 'abc' },
      /* 6 */ { pseudonym: 'S1', master: '1', missing: 'maybe' },
      /* 7 */ { pseudonym: 'S1', master: '1', missing: '1' },
      /* 8 */ { pseudonym: 'S1' },
      /* 9 */ { pseudonym: 'S1', kind: 'adjustment', master: '0', publishing: '0', basis: 'b' },
      /* 10 */ { pseudonym: 'S1', master: '1', document: 'No such document' },
      /* 11 */ { pseudonym: 'S1', master: '1', operation_ref: 'no-such-operation' },
      /* 12 */ { pseudonym: 'S1', master: '1', operation_ref: p1.id },
      /* 13 */ { pseudonym: 'S1', master: '1', operation_ref: late.id },
      /* 14 */ { pseudonym: 'S1', master: '1', operation_ref: a2.id },
      /* 15 */ { pseudonym: 'S1', master: '2' },
      /* 16 */ { pseudonym: 'Loose Start', master: '1' },
      /* 17 */ { pseudonym: 'S2', master: '1,50', publishing: '0.25' },
    ]);
    const p = await run(file, true, { basis: '' });
    const row = (line: number) => p.rows.find((r) => r.line === line);
    expect(codesOf(row(2))).toEqual(['basis_required', 'pseudonym_not_found']);
    expect(codesOf(row(3))).toEqual(['artist_without_owner', 'basis_required']);
    expect(codesOf(row(4))).toEqual(['basis_required', 'kind_unknown']);
    expect(codesOf(row(5))).toEqual(['amount_invalid', 'basis_required']);
    expect(codesOf(row(6))).toEqual(['basis_required', 'missing_invalid']);
    expect(codesOf(row(7))).toEqual(['basis_required', 'missing_with_amount']);
    expect(codesOf(row(8))).toEqual(['amount_required', 'basis_required']);
    expect(codesOf(row(9))).toEqual(['amount_required']);
    expect(codesOf(row(10))).toEqual(['basis_required', 'document_not_found']);
    expect(codesOf(row(11))).toEqual(['basis_required', 'operation_not_found']);
    expect(codesOf(row(12))).toEqual(['basis_required', 'operation_not_advance']);
    expect(codesOf(row(13))).toEqual(['basis_required', 'operation_after_cut']);
    expect(codesOf(row(14))).toEqual(['basis_required']);
    expect(codesOf(row(15))).toEqual(['basis_required']);
    expect(codesOf(row(16))).toEqual(['basis_required']);
    expect([row(17)?.master, row(17)?.publishing, row(17)?.action]).toEqual(['1.5', '0.25', 'error']);
    // with a default basis the rows resolve: S1 twice = duplicate_in_file, the unconfirmed owner = a warning
    const q = await run(file, true, { basis: 'default basis' });
    const qrow = (line: number) => q.rows.find((r) => r.line === line);
    expect(codesOf(qrow(14))).toEqual([]);
    expect(codesOf(qrow(15))).toEqual(['duplicate_in_file']);
    expect(codesOf(qrow(16))).toEqual(['no_contract_for_label']);
    expect([qrow(16)?.action, qrow(17)?.action]).toEqual(['create', 'create']);
    expect(q.totals.errors).toBeGreaterThan(0);
    await expect(run(file, false, { basis: 'default basis' })).rejects.toMatchObject({ code: 'import_invalid', details: { errors: q.totals.errors } });
    expect((await f.listStart({ labelId: zero })).rows).toEqual([]);
  });

  it('a repeated file is unchanged; another amount for a pseudonym with a start is start_exists; the header, the kind of file, the cut and the label are checked', async () => {
    const { f, zero, rows, run } = await world();
    await run(undefined, false);
    const again = await run();
    expect(again.rows.map((r) => r.action)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect([again.totals.create, again.totals.unchanged]).toEqual([0, 3]);
    const changed = await run(csv([{ pseudonym: 'S1', master: '80' }, ...rows.slice(1)]));
    expect(codesOf(changed.rows[0])).toEqual(['start_exists']);
    expect(changed.rows[0]?.issues[0]?.details).toMatchObject({ masterCents: 7050 });
    // the same pseudonym at another cut is a new start (no refusal)
    const otherCut = await run(csv([{ pseudonym: 'S1', master: '80' }]), true, { cutoff: '2026-09', syncedAt: '2026-11-01T00:00:00Z' });
    expect(otherCut.rows[0]?.action).toBe('create');
    await expect(run(csv([{ pseudonym: 'S1', master: '1' }], { header: ['pseudonym', 'colour'] }))).rejects.toMatchObject({ code: 'import_header', details: { unknown: ['colour'] } });
    await expect(run(csv([], { header: ['master'] }))).rejects.toMatchObject({ code: 'import_header', details: { missing: ['pseudonym'] } });
    const txt = tmpPath('start.xlsx');
    writeFileSync(txt, 'x');
    await expect(run({ path: txt, fileName: 'start.xlsx' })).rejects.toMatchObject({ code: 'validation_error' });
    await expect(run(undefined, true, { cutoff: '2026-13' })).rejects.toMatchObject({ code: 'validation_error' });
    await expect(run(undefined, true, { syncedAt: '2026-07-01T00:00:00Z' })).rejects.toMatchObject({ code: 'synced_before_cutoff' });
    await expect(f.importStart({ ...csv(rows), labelId: undefined, cutoff: CUTOFF, syncedAt: SYNCED, dryRun: true })).rejects.toMatchObject({ code: 'label_required' });
    await expect(f.importStart({ ...csv(rows), labelId: 'no-such-label', cutoff: CUTOFF, syncedAt: SYNCED, dryRun: true })).rejects.toMatchObject({ statusCode: 404 });
    await expect(f.deactivateStart('no-such-row', 'r')).rejects.toMatchObject({ statusCode: 404 });
    // the viewer of another label (D-171): the list needs one of its labels
    const echoViewer = labelsViewer([f.testLabels.Echo8]);
    await expect(f.listStart({ labelId: zero }, echoViewer)).rejects.toMatchObject({ code: 'label_forbidden' });
    await expect(f.listStart({}, echoViewer)).rejects.toMatchObject({ code: 'label_required' });
    expect((await f.listStart({ labelId: f.testLabels.Echo8 }, echoViewer)).rows).toEqual([]);
    expect((await f.listStart({})).rows).toHaveLength(3);
    // D-203: a label with a cut takes no start row (the cuts replace the start), the preview included
    await f.createCut({ labelId: zero, name: 'C', cutDate: '2026-10-15' }, 'test');
    await expect(run()).rejects.toMatchObject({ statusCode: 409, code: 'start_label_has_cut' });
    await expect(run(undefined, false)).rejects.toMatchObject({ code: 'start_label_has_cut' });
  });
});
