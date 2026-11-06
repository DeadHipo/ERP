import { describe, expect, it } from 'vitest';
import { confirmedOwner, newFacade } from './helpers/fixtures';

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
