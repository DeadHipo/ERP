import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { labelsViewer } from '../src/facade/viewer';
import { assumeResultSchema } from '@erp/shared/api-responses';
import { approvedAppendix, confirmedOwner, newFacade, TMP, writeBelieve, type TestFacade } from './helpers/fixtures';
import { writer } from './helpers/writer';

// «Accept as an assumption» (D-172, plan «этап4_онбординг.md» §1.2, §6): synthetic names and ISRCs only.

const I1 = 'QZTST2600201'; // two versions without any document: both get the assumption
const I2 = 'QZTST2600202'; // the split has a document that is not approved: skipped
const I3 = 'QZTST2600203'; // no split document, but every row has its own: skipped
const I4 = 'QZTST2600204'; // replaced from its first day: an empty period, and the new version has a document
const I5 = 'QZTST2600205'; // in a file of Echo8 only
const UPC = '1234567890123';

/** The group of §1.2 on one facade: two confirmed pseudonyms, the splits above, July 2026 sales of I1 and I2. */
async function setup() {
  const f = await newFacade();
  const o = f.modules.owners;
  const { artists, owner } = await confirmedOwner(f, 'Owner Assume', ['Assume One', 'Assume Two']);
  const [a1, a2] = artists as unknown as [{ id: string }, { id: string }];
  const appendix = await approvedAppendix(f, owner.id);
  const pending = await o.createDocument({ kind: 'appendix', title: 'Pending appendix', ownerId: owner.id, requiresApproval: true });
  for (const isrc of [I1, I2]) await o.createTrack({ title: `T ${isrc}`, isrc, upc: UPC, artistIds: [a1.id] });
  const i1a = await f.createSplit({ isrc: I1, validFrom: '2025-01-01', validTo: '2026-01-01', shares: [{ artistId: a1.id, percent: '40' }] });
  const i1b = await f.createSplit({ isrc: I1, validFrom: '2026-01-01', shares: [{ artistId: a1.id, percent: '40' }] });
  const i2 = await f.createSplit({ isrc: I2, validFrom: '2025-01-01', shares: [{ artistId: a2.id, percent: '10' }], documentId: pending.id });
  const i3 = await f.createSplit({ isrc: I3, validFrom: '2025-01-01', shares: [{ artistId: a2.id, percent: '10', documentId: appendix.id }] });
  const i4old = await f.createSplit({ isrc: I4, validFrom: '2026-01-01', shares: [{ artistId: a2.id, percent: '10' }] });
  const i4new = await f.changeSplit({ isrc: I4, from: '2026-01-01', shares: [{ artistId: a2.id, percent: '20' }], documentId: appendix.id });
  await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }, { isrc: I2, upc: UPC, net: '100' }]), f.testLabels['0to8']);
  return { f, owner, appendix, ids: { i1a: i1a.id, i1b: i1b.id, i2: i2.id, i3: i3.id, i4old: i4old.id, i4new: i4new.id } };
}

const assume = (f: TestFacade, group: { isrcs?: string[]; splitIds?: string[] }, viewer?: Parameters<TestFacade['assumeSplits']>[1], labelId = f.testLabels['0to8']) =>
  f.assumeSplits({ labelId, reason: 'council synthetic', ...group }, viewer);

const text = (m: Record<string, { toFixed(): string } | undefined>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v?.toFixed()]));

describe('assume: one assumption document for the splits without a document', () => {
  it('one document under the label; only the splits without a document; the money moves from split_unconfirmed to assumption, A and B unchanged', async () => {
    const { f, owner, appendix, ids } = await setup();
    const [before] = await f.reconciliation();
    expect(text(before?.C_breakdown ?? {})).toEqual({ split_unconfirmed: '50' });
    const balanceBefore = await f.ownerBalance(owner.id);
    expect(text(balanceBefore.period.waitingBreakdown)).toEqual({ split_unconfirmed: '50' });

    const r = await assume(f, { isrcs: [I1, I2, I3, I4, I1.toLowerCase()] });
    expect(assumeResultSchema.safeParse(r).success).toBe(true);
    expect(r.assigned.sort()).toEqual([ids.i1a, ids.i1b].sort());
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { splitId: ids.i2, code: 'has_document' },
        { splitId: ids.i3, code: 'has_document' },
        { splitId: ids.i4old, code: 'empty_period' },
        { splitId: ids.i4new, code: 'has_document' },
      ]),
    );
    expect(r.skipped).toHaveLength(4);

    const doc = await f.modules.owners.getDocument(r.documentId);
    expect(doc).toMatchObject({ kind: 'assumption', labelId: f.testLabels['0to8'], title: 'Допущение: council synthetic', fileRef: null });
    const docs = await f.modules.owners.listDocuments({ kind: 'assumption' });
    expect(docs.map((d) => d.id)).toEqual([r.documentId]);
    for (const id of [ids.i1a, ids.i1b]) expect((await f.modules.splits.getSplit(id)).documentId).toBe(r.documentId);
    // the skipped splits keep what they had
    expect((await f.modules.splits.getSplit(ids.i3)).documentId).toBeNull();
    expect((await f.modules.splits.getSplit(ids.i4old)).documentId).toBeNull();

    const [after] = await f.reconciliation();
    expect(text(after?.C_breakdown ?? {})).toEqual({ split_unconfirmed: '10', assumption: '40' });
    expect(after?.A_received.toFixed()).toBe(before?.A_received.toFixed());
    expect(after?.B_notOurs.toFixed()).toBe(before?.B_notOurs.toFixed());
    expect(after?.C_waiting.toFixed()).toBe(before?.C_waiting.toFixed());
    expect(after?.discrepancy.toFixed()).toBe('0');
    const balanceAfter = await f.ownerBalance(owner.id);
    expect(text(balanceAfter.period.waitingBreakdown)).toEqual({ split_unconfirmed: '10', assumption: '40' });

    // an assumption is never approved; a real document replaces it only through a change
    await expect(f.approveDocument(r.documentId, 'tests')).rejects.toMatchObject({ code: 'assumption_not_approvable' });
    await expect(f.confirmSplit(ids.i1b, appendix.id)).rejects.toMatchObject({ code: 'split_document_set' });
  });

  it('a second call skips everything: 422 nothing_to_assume and no second document', async () => {
    const { f, ids } = await setup();
    await assume(f, { isrcs: [I1] });
    await expect(assume(f, { isrcs: [I1] })).rejects.toMatchObject({
      statusCode: 422,
      code: 'nothing_to_assume',
      details: { skipped: expect.arrayContaining([{ splitId: ids.i1a, code: 'has_document' }, { splitId: ids.i1b, code: 'has_document' }]) },
    });
    expect(await f.modules.owners.listDocuments({ kind: 'assumption' })).toHaveLength(1);
  });

  it('by split ids: only the listed splits', async () => {
    const { f, ids } = await setup();
    const r = await assume(f, { splitIds: [ids.i1b, ids.i3, ids.i1b] });
    expect(r).toMatchObject({ assigned: [ids.i1b], skipped: [{ splitId: ids.i3, code: 'has_document' }] });
    expect((await f.modules.splits.getSplit(ids.i1a)).documentId).toBeNull();
  });

  it('refusals: an empty group, an unknown split or label, a sublabel, a bad ISRC, an ISRC of another book', async () => {
    const { f, ids } = await setup();
    await expect(assume(f, { isrcs: [] })).rejects.toMatchObject({ statusCode: 422, code: 'nothing_to_assume' });
    await expect(assume(f, { isrcs: ['QZTST2600299'] })).rejects.toMatchObject({ code: 'nothing_to_assume' });
    await expect(assume(f, { splitIds: ['no-such-split'] })).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
    await expect(assume(f, { isrcs: [I1] }, undefined, 'no-such-label')).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
    const sub = await f.modules.labels.createLabel({ name: 'Sub Assume', kind: 'sublabel', ownLabelId: f.testLabels['0to8'] });
    await expect(assume(f, { isrcs: [I1] }, undefined, sub.id)).rejects.toMatchObject({ statusCode: 400, code: 'label_not_own' });
    await expect(assume(f, { isrcs: ['bad'] })).rejects.toMatchObject({ code: 'validation_error' });
    // a viewer of some labels (D-171): the label must be its own, every ISRC in its files or in none
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I5, upc: UPC, net: '1' }], { account: '1055956' }), f.testLabels.Echo8);
    const echoSplit = await f.createSplit({ isrc: I5, validFrom: '2025-01-01', shares: [{ newArtistPseudonym: 'Echo Assume', percent: '10' }] });
    const zeroViewer = labelsViewer([f.testLabels['0to8']]);
    await expect(assume(f, { isrcs: [I5] }, zeroViewer)).rejects.toMatchObject({ statusCode: 403, code: 'label_forbidden' });
    await expect(assume(f, { splitIds: [echoSplit.id] }, zeroViewer)).rejects.toMatchObject({ code: 'label_forbidden' });
    await expect(assume(f, { isrcs: [I1] }, labelsViewer([f.testLabels.Echo8]))).rejects.toMatchObject({ code: 'label_forbidden' });
    expect(await f.modules.owners.listDocuments({ kind: 'assumption' })).toEqual([]);
    // the viewer's own label and its ISRCs pass
    expect((await assume(f, { isrcs: [I1] }, zeroViewer)).assigned.sort()).toEqual([ids.i1a, ids.i1b].sort());
  });
});

describe('assume: the API', () => {
  it('201 with the result; one audit row with the counts and the document, never the reason; the label and one group are required', async () => {
    const { f, ids } = await setup();
    const app = createApp(f, { tmpDir: join(TMP, 'assume-uploads') });
    const w = writer(app);
    const L = f.testLabels['0to8'];
    const none = await w.post('/api/v1/splits/assume').send({ isrcs: [I1], reason: 'council synthetic' });
    expect([none.status, none.body.error.code]).toEqual([400, 'label_required']);
    const both = await w.post('/api/v1/splits/assume').send({ labelId: L, isrcs: [I1], splitIds: [ids.i1a], reason: 'council synthetic' });
    expect([both.status, both.body.error.code]).toEqual([400, 'validation_error']);
    const neither = await w.post('/api/v1/splits/assume').send({ labelId: L, reason: 'council synthetic' });
    expect(neither.status).toBe(400);
    expect(await f.recentActions(50)).toEqual([]);

    const res = await w.post('/api/v1/splits/assume').send({ labelId: L, isrcs: [I1, I2], reason: 'council synthetic' }).expect(201);
    expect(assumeResultSchema.safeParse(res.body).success).toBe(true);
    const rows = await f.recentActions(50);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: '/splits/assume', labelId: L });
    expect(rows[0]?.summary).toMatchObject({ body: { documentId: res.body.documentId, assigned: 2, skipped: 1 } });
    expect(rows[0]?.entityIds).toEqual(expect.arrayContaining([res.body.documentId, ids.i1a, ids.i1b, I1, I2, L]));
    expect(JSON.stringify(rows[0])).not.toContain('council synthetic');

    const again = await w.post('/api/v1/splits/assume').send({ labelId: L, isrcs: [I1], reason: 'council synthetic' });
    expect([again.status, again.body.error.code]).toEqual([422, 'nothing_to_assume']);
    expect(await f.recentActions(50)).toHaveLength(1);
  });
});
