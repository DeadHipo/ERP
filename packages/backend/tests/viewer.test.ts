import { describe, expect, it } from 'vitest';
import { ACC2, Case, I } from './helpers/golden-case';
import { ALL_VIEWER, labelsViewer } from '../src/facade/viewer';

// The viewer's labels on record-dependent reads and writes (D-171): a viewer of label A (a label manager) reads a
// record of label B as an unknown id (404), writes on it get 403 `label_forbidden`; documents of «any label» pass;
// lists hold only what is visible under A; `ALL_VIEWER` answers as before, byte for byte. Synthetic data only.

const text = (x: unknown) => JSON.stringify(x, (k, v: unknown) => (k === 'calculatedAt' ? undefined : v));
const notFound = { statusCode: 404, code: 'not_found' };
const forbidden = { statusCode: 403, code: 'label_forbidden' };

/**
 * Label A = 0to8 (account 1): PA with a split on I(1). Label B = Echo8 (account 2): PB with a split on I(2), QB with a
 * participation on I(2). Documents: of A, of B (PA's, so PA's card has one to hide), of any label. Ads and payouts
 * under each label.
 */
async function world() {
  const c = await Case.start();
  const f = c.f;
  const A = f.testLabels['0to8'];
  const B = f.testLabels.Echo8;
  await c.person('PA', 'PB', 'QB');
  // a pseudonym of PB's owner whose name doubles PA's: a duplicate group visible only as a whole
  await c.second('pa', 'PB');
  for (const n of [1, 2]) await c.track(I(n));
  await c.split(I(1), [['PA', '50']]);
  await c.split(I(2), [['PB', '50']]);
  const partB = await c.part(I(2), 'QB', '10', 'bucket', 'label_share');
  await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
  await c.load('2026-03', [{ isrc: I(2), net: '100', label: 'Echo8' }], ACC2);
  const o = f.modules.owners;
  const doc = (title: string, labelId: string | null, kind: 'appendix' | 'contract' = 'appendix') =>
    o.createDocument({ kind, title, fileRef: `dummy://${title}.pdf`, ownerId: kind === 'contract' ? null : (c.owners.get('PA') as string), requiresApproval: true, labelId });
  const docA = await doc('doc A', A);
  const docB = await doc('doc B', B);
  const docAny = await doc('doc any', null);
  const { created } = await f.createAds([
    { isrc: I(1), month: '2026-03', amount: '4', labelId: A },
    { isrc: I(2), month: '2026-03', amount: '4', labelId: B },
  ]);
  const [adA, adB] = created.map((x) => (x as { id: string }).id) as [string, string];
  const payA = await f.createPayout(c.owners.get('PA') as string, { labelId: A });
  const payB = await f.createPayout(c.owners.get('PB') as string, { labelId: B });
  return { c, f, A, B, docA, docB, docAny, adA, adB, payA, payB, partB, vA: labelsViewer([A]) };
}

describe('the viewer of a label (D-171)', () => {
  it('reads of a record of another label answer as an unknown id; the own records answer', async () => {
    const w = await world();
    const { c, f, vA } = w;
    const ownerA = c.owners.get('PA') as string;
    const ownerB = c.owners.get('PB') as string;
    await expect(f.ownerDetail(ownerB, vA)).rejects.toMatchObject(notFound);
    await expect(f.artistDetail(c.id('PB'), vA)).rejects.toMatchObject(notFound);
    await expect(f.ownerBalance(ownerB, {}, w.A, vA)).rejects.toMatchObject(notFound);
    await expect(f.artistBalance(c.id('PB'), {}, w.A, vA)).rejects.toMatchObject(notFound);
    await expect(f.getAd(w.adB, vA)).rejects.toMatchObject(notFound);
    await expect(f.operationSnapshot(w.payB.id, vA)).rejects.toMatchObject(notFound);
    await expect(f.documentUses(w.docB.id, vA)).rejects.toMatchObject(notFound);
    // an unknown id: the same answer
    await expect(f.ownerDetail('00000000-0000-0000-0000-000000000000', vA)).rejects.toMatchObject(notFound);

    // the own records: the card without the document of B
    const card = await f.ownerDetail(ownerA, vA);
    expect(card.documents.map((d) => d.title).sort()).toEqual(['Dummy contract Owner PA', 'doc A', 'doc any']);
    expect(card.contracts).toHaveLength(1);
    expect((await f.ownerDetail(ownerA)).documents.map((d) => d.title)).toContain('doc B');
    expect((await f.artistDetail(c.id('PA'), vA)).artist.id).toBe(c.id('PA'));
    expect((await f.ownerBalance(ownerA, {}, w.A, vA)).total.earned.toFixed()).toBe('50');
    expect((await f.artistBalance(c.id('PA'), {}, w.A, vA)).total.earned.toFixed()).toBe('50');
    expect((await f.getAd(w.adA, vA)).id).toBe(w.adA);
    expect(await f.operationSnapshot(w.payA.id, vA)).toMatchObject({ labelId: w.A });
    expect((await f.documentUses(w.docAny.id, vA)).document.id).toBe(w.docAny.id);
    expect((await f.documentUses(w.docA.id, vA)).document.id).toBe(w.docA.id);
  });

  it('writes on a record or an ISRC of another label are 403 label_forbidden; own, «any label» and new ones pass', async () => {
    const w = await world();
    const { c, f, vA } = w;
    const o = f.modules.owners;
    // advertising
    await expect(f.updateAd(w.adB, { recoveryPercent: '50' }, vA)).rejects.toMatchObject(forbidden);
    await expect(f.deactivateAd(w.adB, 'no', vA)).rejects.toMatchObject(forbidden);
    await expect(f.updateAd(w.adA, { labelId: w.A }, vA)).rejects.toMatchObject({ statusCode: 403, code: 'forbidden' });
    expect((await f.updateAd(w.adA, { recoveryPercent: '50' }, vA)).recoveryPercent).toBe('50');
    // operations by id
    await expect(f.setOperationDeferred(w.payB.id, true, vA)).rejects.toMatchObject(forbidden);
    await expect(f.deactivateOperation(w.payB.id, 'no', {}, vA)).rejects.toMatchObject(forbidden);
    await expect(f.attachPaymentProof(w.payB.id, { fileRef: 'dummy://p.pdf' }, vA)).rejects.toMatchObject(forbidden);
    await expect(f.setOperationLabel(w.payB.id, w.A, 'a reason', vA)).rejects.toMatchObject(forbidden);
    await expect(f.returnPayout(w.payB.id, { fileRef: 'dummy://r.pdf', date: '2026-12-01', comment: 'r' }, vA)).rejects.toMatchObject(forbidden);
    // documents
    await expect(f.attachDocumentFile(w.docB.id, 'dummy://x.pdf', vA)).rejects.toMatchObject(forbidden);
    await expect(f.approveDocument(w.docB.id, 'manager', vA)).rejects.toMatchObject(forbidden);
    await expect(f.setDocumentLabel(w.docB.id, w.A, vA)).rejects.toMatchObject(forbidden);
    await expect(f.setDocumentLabel(w.docA.id, null, vA)).rejects.toMatchObject(forbidden);
    expect((await f.attachDocumentFile(w.docAny.id, 'dummy://x.pdf', vA)).fileRef).toBe('dummy://x.pdf');
    expect((await f.approveDocument(w.docA.id, 'manager', vA)).status).toBe('approved');
    // contracts: the owner of B → 403; a new owner on a document of any label → 201
    const contractDoc = await o.createDocument({ kind: 'contract', title: 'c', fileRef: 'dummy://c.pdf', ownerId: null, requiresApproval: false, labelId: null });
    await expect(f.createContract({ ownerId: c.owners.get('PB') as string, documentId: contractDoc.id, artistIds: [] }, vA)).rejects.toMatchObject(forbidden);
    const contractDocB = await o.createDocument({ kind: 'contract', title: 'cb', fileRef: 'dummy://cb.pdf', ownerId: null, requiresApproval: false, labelId: w.B });
    const fresh = await o.createOwner({ name: 'Fresh owner', kind: 'person' });
    await expect(f.createContract({ ownerId: fresh.id, documentId: contractDocB.id, artistIds: [] }, vA)).rejects.toMatchObject(forbidden);
    expect((await f.createContract({ ownerId: fresh.id, documentId: contractDoc.id, artistIds: [] }, vA)).ownerId).toBe(fresh.id);
    // the ISRC rule: rows on I(2) (B's files) → 403; on I(9) (no book) → created; a document of B → 403
    const share = (pseudonym: string) => [{ newArtistPseudonym: pseudonym, percent: '10' }];
    await expect(f.createSplit({ isrc: I(2), validFrom: '2026-01-01', shares: share('n1') }, vA)).rejects.toMatchObject(forbidden);
    await expect(f.changeSplit({ isrc: I(2), from: '2026-05-01', shares: share('n1'), documentId: w.docAny.id }, vA)).rejects.toMatchObject(forbidden);
    await expect(f.buyout({ isrcs: [I(2)], sellerArtistId: c.id('PB'), effectiveFrom: '2026-05-01', documentId: w.docAny.id }, vA)).rejects.toMatchObject(forbidden);
    await expect(f.createSplit({ isrc: I(9), validFrom: '2026-01-01', shares: share('n2'), documentId: w.docB.id }, vA)).rejects.toMatchObject(forbidden);
    expect((await f.createSplit({ isrc: I(9), validFrom: '2026-01-01', shares: share('n3'), documentId: w.docAny.id }, vA)).isrc).toBe(I(9));
    const p = { artistId: c.id('PA'), percent: '5', base: 'bucket' as const, fundedFrom: 'label_share' as const, validFrom: '2026-01-01' };
    await expect(f.createParticipation({ ...p, isrc: I(2) }, vA)).rejects.toMatchObject(forbidden);
    expect((await f.createParticipation({ ...p, isrc: I(10) }, vA)).isrc).toBe(I(10));
    await expect(f.closeParticipation(w.partB.id, '2026-06-01', vA)).rejects.toMatchObject(forbidden);
    // a track: on I(2) → 403; a track of no book → updated; moving it onto I(2) → 403
    const tracks = await o.listTracks();
    const trackB = tracks.find((t) => t.isrc === I(2));
    await expect(f.updateTrack(trackB?.id as string, { note: 'x' }, vA)).rejects.toMatchObject(forbidden);
    const t = await o.createTrack({ title: 'new', isrc: I(11), upc: '1234567890999' });
    expect((await f.updateTrack(t.id, { note: 'mine' }, vA))?.note).toBe('mine');
    await expect(f.updateTrack(t.id, { isrc: I(2), upc: '1234567890999' }, vA)).rejects.toMatchObject(forbidden);
  });

  it('search, duplicates and the row lists hold only what is visible under the label', async () => {
    const w = await world();
    const { c, f, vA } = w;
    const ownerB = c.owners.get('PB') as string;
    const all = await f.search('Owner', 'owners');
    expect(all.owners.map((x) => x.id)).toContain(ownerB);
    const mine = await f.search('Owner', 'owners', vA);
    expect(mine.owners.map((x) => x.id)).toEqual([c.owners.get('PA')]);
    expect((await f.search('P', 'artists', vA)).artists.map((x) => x.id)).toEqual([c.id('PA')]);
    expect((await f.search('doc', 'documents', vA)).documents.map((x) => x.title).sort()).toEqual(['doc A', 'doc any']);
    // the group PA / pa: whole for everyone, gone for A (pa is visible under no label)
    expect((await f.artistDuplicates()).groups.map((g) => g.normalized)).toEqual(['pa']);
    expect((await f.artistDuplicates(vA)).groups).toEqual([]);
    expect((await f.listSplits({}, vA)).items.map((s) => s.isrc)).toEqual([I(1)]);
    expect((await f.listSplits({})).items.map((s) => s.isrc).sort()).toEqual([I(1), I(2)]);
    expect((await f.listParticipations({}, vA)).items).toEqual([]);
    expect((await f.listParticipations({})).items.map((p) => p.isrc)).toEqual([I(2)]);
  });

  it('ALL_VIEWER answers as before, byte for byte', async () => {
    const w = await world();
    const { c, f } = w;
    const pairs: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
      ['ownerDetail', () => f.ownerDetail(c.owners.get('PB') as string), () => f.ownerDetail(c.owners.get('PB') as string, ALL_VIEWER)],
      ['artistDetail', () => f.artistDetail(c.id('PB')), () => f.artistDetail(c.id('PB'), ALL_VIEWER)],
      ['ownerBalance', () => f.ownerBalance(c.owners.get('PB') as string), () => f.ownerBalance(c.owners.get('PB') as string, {}, undefined, ALL_VIEWER)],
      ['artistBalance', () => f.artistBalance(c.id('PB')), () => f.artistBalance(c.id('PB'), {}, undefined, ALL_VIEWER)],
      ['search', () => f.search('o'), () => f.search('o', undefined, ALL_VIEWER)],
      ['artistDuplicates', () => f.artistDuplicates(), () => f.artistDuplicates(ALL_VIEWER)],
      ['listSplits', () => f.listSplits({}), () => f.listSplits({}, ALL_VIEWER)],
      ['listParticipations', () => f.listParticipations({}), () => f.listParticipations({}, ALL_VIEWER)],
      ['getAd', () => f.getAd(w.adB), () => f.getAd(w.adB, ALL_VIEWER)],
      ['documentUses', () => f.documentUses(w.docB.id), () => f.documentUses(w.docB.id, ALL_VIEWER)],
      ['operationSnapshot', () => f.operationSnapshot(w.payB.id), () => f.operationSnapshot(w.payB.id, ALL_VIEWER)],
    ];
    for (const [name, without, withAll] of pairs) expect(text(await withAll()), name).toBe(text(await without()));
    // a viewer of every label sees the same records as ALL_VIEWER
    const both = labelsViewer([w.A, w.B]);
    expect(text(await f.listSplits({}, both))).toBe(text(await f.listSplits({})));
    expect(text(await f.ownerDetail(c.owners.get('PB') as string, both))).toBe(text(await f.ownerDetail(c.owners.get('PB') as string)));
  });
});
