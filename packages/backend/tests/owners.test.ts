import { describe, expect, it } from 'vitest';
import { DOCUMENT_KINDS, SPLIT_DOCUMENT_KINDS } from '@erp/shared/document-kinds';
import { documentKind } from '@erp/shared/api-schemas';
import { openOwnersModule } from '../src/modules/owners';
import { orgScope } from '../src/shared/org-scope';
import { confirmedOwner, newFacade } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

describe('module 1: owners, artists, tracks, documents (README 5)', () => {
  it('a track record is identified by the pair (ISRC, UPC); a track may exist before ISRC is known', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    await o.createTrack({ title: 'Single', isrc: 'QZ-TST-26-00001', upc: '111' });
    await o.createTrack({ title: 'Album version', isrc: 'QZTST2600001', upc: '222' });
    await expect(
      async () => await o.createTrack({ title: 'Dup', isrc: 'qztst2600001', upc: '111' }),
    ).rejects.toThrow(/already exists/);
    const draft = await o.createTrack({ title: 'Not delivered yet' });
    expect(draft.isrc).toBeNull();
    await o.setTrackIdentifiers(draft.id, 'QZTST2600009', '333');
    expect((await o.knownPairs()).has('QZTST2600009|333')).toBe(true);
  });

  it('a document is approved only after a file is attached; approval is needed when flagged', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const d = await o.createDocument({ kind: 'contract', title: 'Dummy', requiresApproval: true });
    expect(d.status).toBe('not_attached');
    await expect(async () => await o.approveDocument(d.id, 'm')).rejects.toThrow(/Attach the file/);
    expect((await o.attachFile(d.id, 'dummy://c.pdf')).status).toBe('not_approved');
    expect((await o.approveDocument(d.id, 'm')).status).toBe('approved');
    const noApproval = await o.createDocument({
      kind: 'payment_proof',
      title: 'Proof',
      fileRef: 'dummy://p.pdf',
      requiresApproval: false,
    });
    expect(noApproval.status).toBe('approved');
  });

  it('the contract is concluded with the owner; an owner is confirmed only by an approved contract', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const owner = await o.createOwner({ name: 'Synthetic Owner', kind: 'person' });
    const artist = await o.createArtist({ pseudonym: 'Synth', ownerId: owner.id });
    expect((await o.getOwner(owner.id)).status).toBe('waiting_documents');
    const doc = await o.createDocument({
      kind: 'contract',
      title: 'Dummy',
      fileRef: 'dummy://x',
      requiresApproval: true,
      ownerId: owner.id,
    });
    await o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: [artist.id] });
    expect((await o.getOwner(owner.id)).status).toBe('waiting_documents'); // not approved yet
    await o.approveDocument(doc.id, 'manager');
    expect((await o.getOwner(owner.id)).status).toBe('confirmed');
    expect((await o.getArtist(artist.id)).status).toBe('confirmed');
  });

  it('D-169: listDocuments({ labelId }) gives the documents of the label and those without a label', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const [zero, echo] = [f.testLabels['0to8'], f.testLabels.Echo8];
    const any = await o.createDocument({ kind: 'other', title: 'Any Synthetic', requiresApproval: false });
    const ofZero = await o.createDocument({ kind: 'other', title: 'Zero Synthetic', requiresApproval: false, labelId: zero });
    const ofEcho = await o.createDocument({ kind: 'other', title: 'Echo Synthetic', requiresApproval: false, labelId: echo });
    expect([any.labelId, ofZero.labelId, ofEcho.labelId]).toEqual([null, zero, echo]);
    const ids = async (labelId?: string) => (await o.listDocuments(labelId ? { labelId } : {})).map((d) => d.id).sort();
    expect(await ids(zero)).toEqual([any.id, ofZero.id].sort());
    expect(await ids(echo)).toEqual([any.id, ofEcho.id].sort());
    expect(await ids()).toEqual([any.id, ofZero.id, ofEcho.id].sort());
    // only the label changes; null = any label again
    const moved = await o.setDocumentLabel(ofZero.id, null);
    expect({ ...moved, labelId: zero }).toEqual(ofZero);
    expect(await ids(echo)).toEqual([any.id, ofZero.id, ofEcho.id].sort());
    await expect(o.setDocumentLabel('no-such-document', null)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('D-169: isOwnerConfirmedUnder needs an approved contract whose document has the label or none', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const [zero, echo] = [f.testLabels['0to8'], f.testLabels.Echo8];
    const owner = await o.createOwner({ name: 'Under Synthetic', kind: 'person' });
    const contract = async (labelId: string | null, approve: boolean) => {
      const doc = await o.createDocument({ kind: 'contract', title: 'Dummy', fileRef: 'dummy://x', requiresApproval: true, ownerId: owner.id, labelId });
      await o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: [] });
      if (approve) await o.approveDocument(doc.id, 'manager');
      return doc;
    };
    const under = async () => [await o.isOwnerConfirmed(owner.id), await o.isOwnerConfirmedUnder(owner.id, zero), await o.isOwnerConfirmedUnder(owner.id, echo)];
    await contract(echo, false); // not approved: opens nothing
    expect(await under()).toEqual([false, false, false]);
    const ofZero = await contract(zero, true);
    expect(await under()).toEqual([true, true, false]);
    expect(await o.confirmedContracts()).toEqual([{ ownerId: owner.id, labelId: zero }]);
    await o.setDocumentLabel(ofZero.id, null); // without a label: every label
    expect(await under()).toEqual([true, true, true]);
    expect(await o.confirmedContracts()).toEqual([{ ownerId: owner.id, labelId: null }]);
  });

  it('an artist belongs to exactly one owner; the same pseudonym under two owners is two records', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const a = await confirmedOwner(f, 'Owner A', ['Same Nick']);
    const b = await confirmedOwner(f, 'Owner B', ['Same Nick']);
    expect(a.artists[0]?.id).not.toBe(b.artists[0]?.id);
    await expect(
      async () => await o.assignArtistOwner(a.artists[0]?.id as string, b.owner.id),
    ).rejects.toThrow(/another owner/);
    expect(await o.findSimilarArtists('same nick')).toHaveLength(2);
  });

  it('possible duplicates are only shown to the operator, never merged automatically', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    await o.createOwner({ name: 'Ivan Synthetic', kind: 'person' });
    expect(await o.findSimilarOwners('ivan  SYNTHETIC')).toHaveLength(1);
    await o.createOwner({ name: 'Ivan Synthetic', kind: 'person' });
    expect(await o.listOwners()).toHaveLength(2);
  });

  it('merge: the owner without documents merges into the confirmed one; never the other way round', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const confirmed = await confirmedOwner(f, 'Real Person', ['Nick']);
    const stub = await o.createOwner({ name: 'REAL, PERSON', kind: 'person', origin: 'publishing' });
    await expect(
      async () => await o.mergeOwners(confirmed.owner.id, stub.id, 'wrong direction'),
    ).rejects.toThrow(/without approved documents/);
    await f.mergeOwners(stub.id, confirmed.owner.id, 'same person');
    expect(await o.resolveOwnerId(stub.id)).toBe(confirmed.owner.id);
    expect(await o.findOwnersByWriter('REAL, PERSON')).toEqual([confirmed.owner.id]);
    expect((await o.listOwners()).map((x) => x.id)).not.toContain(stub.id);
  });
});

describe('D-172: the label decision kind', () => {
  it('one list of kinds: the module, the request schema and the split kinds carry label_decision', () => {
    expect(DOCUMENT_KINDS).toContain('label_decision');
    expect(documentKind.options).toEqual([...DOCUMENT_KINDS]);
    expect(SPLIT_DOCUMENT_KINDS).toContain('label_decision');
  });

  it('createContract accepts an approved label decision like a contract and refuses an appendix', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const owner = await o.createOwner({ name: 'Decision Synthetic', kind: 'person' });
    const artist = await o.createArtist({ pseudonym: 'Decision Nick', ownerId: owner.id });
    const appendix = await o.createDocument({ kind: 'appendix', title: 'Dummy', fileRef: 'dummy://a', requiresApproval: false });
    await expect(o.createContract({ ownerId: owner.id, documentId: appendix.id, artistIds: [] })).rejects.toMatchObject({
      code: 'validation_error',
    });
    const decision = await o.createDocument({
      kind: 'label_decision',
      title: 'Dummy decision',
      fileRef: 'dummy://d',
      requiresApproval: true,
      ownerId: owner.id,
    });
    expect(decision.kind).toBe('label_decision');
    await o.createContract({ ownerId: owner.id, documentId: decision.id, artistIds: [artist.id] });
    expect((await o.getOwner(owner.id)).status).toBe('waiting_documents'); // not approved yet
    await o.approveDocument(decision.id, 'manager');
    expect((await o.getOwner(owner.id)).status).toBe('confirmed');
    expect((await o.getArtist(artist.id)).status).toBe('confirmed');
  });

  it('a split row and a participation accept a label decision; a payment proof is still refused', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const { artists } = await confirmedOwner(f, 'Row Synthetic', ['Row Nick', 'Part Nick']);
    const decision = await o.createDocument({ kind: 'label_decision', title: 'Dummy', fileRef: 'dummy://d', requiresApproval: false });
    const proof = await o.createDocument({ kind: 'payment_proof', title: 'Dummy', fileRef: 'dummy://p', requiresApproval: false });
    const [row, part] = artists.map((a) => a.id) as [string, string];
    await expect(
      f.createSplit({ isrc: 'QZTST2600071', validFrom: '2020-01-01', validTo: null, shares: [{ artistId: row, percent: '50' }], documentId: proof.id }),
    ).rejects.toThrow(/label decision/);
    await f.createSplit({
      isrc: 'QZTST2600071',
      validFrom: '2020-01-01',
      validTo: null,
      shares: [{ artistId: row, percent: '50', documentId: decision.id }],
      documentId: decision.id,
    });
    await f.createParticipation({
      isrc: 'QZTST2600071',
      artistId: part,
      percent: '10',
      base: 'net',
      fundedFrom: 'top',
      validFrom: '2020-01-01',
      documentId: decision.id,
    });
  });
});

describe('D-172: the catalog tables (owners.track_labels, owners.releases)', () => {
  const ZERO = 'label-zero';
  const ECHO = 'label-echo';

  it('trackLabels: upsert, replace per ISRC and source, list; scoped to the organization', async () => {
    const f = await newFacade();
    const t = f.modules.owners.trackLabels;
    const op = await t.upsert({ isrc: 'qz-tst-26-00081', labelId: ECHO, validFrom: '2026-01-01', source: 'operator', note: 'by hand' });
    expect(op).toMatchObject({ isrc: 'QZTST2600081', labelId: ECHO, validFrom: '2026-01-01', validTo: null, source: 'operator' });
    // the files intervals of the ISRC are replaced whole; the operator interval stays
    await t.replaceOfIsrc('QZTST2600081', 'files', [{ labelId: ZERO, validFrom: '2024-01-01', validTo: '2025-08-01' }]);
    await t.replaceOfIsrc('QZTST2600081', 'files', [
      { labelId: ZERO, validFrom: '2024-02-01', validTo: '2025-08-01' },
      { labelId: ECHO, validFrom: '2025-08-01', validTo: '2026-01-01' },
    ]);
    const history = (await t.list({ isrcs: ['QZTST2600081'] })).map((r) => [r.labelId, r.validFrom, r.validTo, r.source]);
    expect(history).toEqual([
      [ZERO, '2024-02-01', '2025-08-01', 'files'],
      [ECHO, '2025-08-01', '2026-01-01', 'files'],
      [ECHO, '2026-01-01', null, 'operator'],
    ]);
    // rewriting the operator interval by its id: one row
    const closed = await t.upsert({ id: op.id, isrc: 'QZTST2600081', labelId: ZERO, validFrom: '2026-01-01', validTo: '2026-03-01', source: 'operator' });
    expect([closed.id, closed.labelId, closed.validTo]).toEqual([op.id, ZERO, '2026-03-01']);
    expect(await t.list({ labelId: ECHO })).toHaveLength(1);
    expect(await t.list({ isrcs: [] })).toEqual([]);
    // another organization sees none of them and may hold the same ISRC and months
    const { db } = await testStack();
    const other = openOwnersModule(db, orgScope('org-other-d172')).service.trackLabels;
    expect(await other.list()).toEqual([]);
    await other.upsert({ isrc: 'QZTST2600081', labelId: ECHO, validFrom: '2024-01-01', source: 'files' });
    expect(await t.list({ isrcs: ['QZTST2600081'] })).toHaveLength(3);
  });

  it('trackLabels: the overlap EXCLUDE and the first-of-month CHECK refuse; a refused replace leaves the old rows', async () => {
    const f = await newFacade();
    const t = f.modules.owners.trackLabels;
    await t.upsert({ isrc: 'QZTST2600082', labelId: ZERO, validFrom: '2025-01-01', validTo: '2025-08-01', source: 'files' });
    await expect(
      t.upsert({ isrc: 'QZTST2600082', labelId: ECHO, validFrom: '2025-07-01', source: 'operator' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'catalog_overlap' });
    await expect(
      t.upsert({ isrc: 'QZTST2600082', labelId: ECHO, validFrom: '2025-08-15', source: 'operator' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'validation_error' });
    await expect(
      t.upsert({ isrc: 'QZTST2600082', labelId: ECHO, validFrom: '2025-09-01', validTo: '2025-09-01', source: 'operator' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    // two overlapping rows in one replace: nothing changes
    await expect(
      t.replaceOfIsrc('QZTST2600082', 'files', [
        { labelId: ZERO, validFrom: '2025-01-01', validTo: '2025-09-01' },
        { labelId: ECHO, validFrom: '2025-08-01', validTo: null },
      ]),
    ).rejects.toMatchObject({ code: 'catalog_overlap' });
    expect((await t.list({ isrcs: ['QZTST2600082'] })).map((r) => [r.validFrom, r.validTo])).toEqual([['2025-01-01', '2025-08-01']]);
    // the same months next to each other are fine ([) intervals)
    await t.upsert({ isrc: 'QZTST2600082', labelId: ECHO, validFrom: '2025-08-01', source: 'operator' });
    expect(await t.list({ isrcs: ['QZTST2600082'] })).toHaveLength(2);
  });

  it('releases: upsert by (label, UPC) keeps the UPCs not listed; the same UPC under two labels; scoped to the organization', async () => {
    const f = await newFacade();
    const r = f.modules.owners.releases;
    const row = (upc: string, title: string) => ({
      upc,
      releaseTitle: title,
      version: null,
      artistString: 'Synthetic Artist',
      labelString: 'Test Label',
      releasedAt: '2025-05-01T10:30:00',
      trackCount: 2,
      catalogNumber: null,
      territories: 200,
      stores: 50,
    });
    await r.upsert(ZERO, [row('1234567890123', 'First'), row('1234567890124', 'Second')]);
    await r.upsert(ZERO, [row('1234567890123', 'First (fixed)')]);
    await r.upsert(ECHO, [row('1234567890123', 'Moved')]);
    const zero = await r.list({ labelId: ZERO });
    expect(zero.map((x) => [x.upc, x.releaseTitle, x.releasedAt])).toEqual([
      ['1234567890123', 'First (fixed)', '2025-05-01T10:30:00'],
      ['1234567890124', 'Second', '2025-05-01T10:30:00'],
    ]);
    // D-195: a rewrite keeps the time the UPC entered the registry
    expect((zero[0] as { createdAt: string }).createdAt <= (zero[0] as { updatedAt: string }).updatedAt).toBe(true);
    expect((zero[0] as { createdAt: string }).createdAt).toBe((zero[1] as { createdAt: string }).createdAt);
    expect((await r.list({ upcs: ['1234567890123'] })).map((x) => [x.labelId, x.releaseTitle])).toEqual([
      [ECHO, 'Moved'],
      [ZERO, 'First (fixed)'],
    ].sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1)));
    await expect(r.upsert(ZERO, [row('12345X', 'Bad')])).rejects.toMatchObject({ code: 'validation_error' });
    await expect(r.upsert(ZERO, [row('1', 'A'), row('1', 'B')])).rejects.toMatchObject({ code: 'validation_error' });
    const { db } = await testStack();
    const other = openOwnersModule(db, orgScope('org-other-d172')).service.releases;
    expect(await other.list()).toEqual([]);
    await other.upsert(ZERO, [row('1234567890123', 'Other org')]);
    expect((await r.list({ labelId: ZERO, upcs: ['1234567890123'] }))[0]?.releaseTitle).toBe('First (fixed)');
  });
});
