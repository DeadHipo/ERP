import { describe, expect, it } from 'vitest';
import { confirmedOwner, newFacade } from './helpers/fixtures';

describe('module 1: owners, artists, tracks, documents (README 5)', () => {
  it('a track record is identified by the pair (ISRC, UPC); a track may exist before ISRC is known', () => {
    const f = newFacade();
    const o = f.modules.owners;
    o.createTrack({ title: 'Single', isrc: 'QZ-TST-26-00001', upc: '111' });
    o.createTrack({ title: 'Album version', isrc: 'QZTST2600001', upc: '222' });
    expect(() => o.createTrack({ title: 'Dup', isrc: 'qztst2600001', upc: '111' })).toThrow(/already exists/);
    const draft = o.createTrack({ title: 'Not delivered yet' });
    expect(draft.isrc).toBeNull();
    o.setTrackIdentifiers(draft.id, 'QZTST2600009', '333');
    expect(o.knownPairs().has('QZTST2600009|333')).toBe(true);
    f.close();
  });

  it('a document is approved only after a file is attached; approval is needed when flagged', () => {
    const f = newFacade();
    const o = f.modules.owners;
    const d = o.createDocument({ kind: 'contract', title: 'Dummy', requiresApproval: true });
    expect(d.status).toBe('not_attached');
    expect(() => o.approveDocument(d.id, 'm')).toThrow(/Attach the file/);
    expect(o.attachFile(d.id, 'dummy://c.pdf').status).toBe('not_approved');
    expect(o.approveDocument(d.id, 'm').status).toBe('approved');
    const noApproval = o.createDocument({
      kind: 'payment_proof',
      title: 'Proof',
      fileRef: 'dummy://p.pdf',
      requiresApproval: false,
    });
    expect(noApproval.status).toBe('approved');
    f.close();
  });

  it('the contract is concluded with the owner; an owner is confirmed only by an approved contract', () => {
    const f = newFacade();
    const o = f.modules.owners;
    const owner = o.createOwner({ name: 'Synthetic Owner', kind: 'person' });
    const artist = o.createArtist({ pseudonym: 'Synth', ownerId: owner.id });
    expect(o.getOwner(owner.id).status).toBe('waiting_documents');
    const doc = o.createDocument({
      kind: 'contract',
      title: 'Dummy',
      fileRef: 'dummy://x',
      requiresApproval: true,
      ownerId: owner.id,
    });
    o.createContract({ ownerId: owner.id, documentId: doc.id, artistIds: [artist.id] });
    expect(o.getOwner(owner.id).status).toBe('waiting_documents'); // not approved yet
    o.approveDocument(doc.id, 'manager');
    expect(o.getOwner(owner.id).status).toBe('confirmed');
    expect(o.getArtist(artist.id).status).toBe('confirmed');
    f.close();
  });

  it('an artist belongs to exactly one owner; the same pseudonym under two owners is two records', () => {
    const f = newFacade();
    const o = f.modules.owners;
    const a = confirmedOwner(f, 'Owner A', ['Same Nick']);
    const b = confirmedOwner(f, 'Owner B', ['Same Nick']);
    expect(a.artists[0]?.id).not.toBe(b.artists[0]?.id);
    expect(() => o.assignArtistOwner(a.artists[0]?.id as string, b.owner.id)).toThrow(/another owner/);
    expect(o.findSimilarArtists('same nick')).toHaveLength(2);
    f.close();
  });

  it('possible duplicates are only shown to the operator, never merged automatically', () => {
    const f = newFacade();
    const o = f.modules.owners;
    o.createOwner({ name: 'Ivan Synthetic', kind: 'person' });
    expect(o.findSimilarOwners('ivan  SYNTHETIC')).toHaveLength(1);
    o.createOwner({ name: 'Ivan Synthetic', kind: 'person' });
    expect(o.listOwners()).toHaveLength(2);
    f.close();
  });

  it('merge: the owner without documents merges into the confirmed one; never the other way round', () => {
    const f = newFacade();
    const o = f.modules.owners;
    const confirmed = confirmedOwner(f, 'Real Person', ['Nick']);
    const stub = o.createOwner({ name: 'REAL, PERSON', kind: 'person', origin: 'publishing' });
    expect(() => o.mergeOwners(confirmed.owner.id, stub.id, 'wrong direction')).toThrow(
      /without approved documents/,
    );
    f.mergeOwners(stub.id, confirmed.owner.id, 'same person');
    expect(o.resolveOwnerId(stub.id)).toBe(confirmed.owner.id);
    expect(o.findOwnersByWriter('REAL, PERSON')).toEqual([confirmed.owner.id]);
    expect(o.listOwners().map((x) => x.id)).not.toContain(stub.id);
    f.close();
  });
});
