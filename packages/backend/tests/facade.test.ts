import { describe, expect, it } from 'vitest';
import {
  approvedAppendix,
  approvedDoc,
  confirmedOwner,
  newFacade,
  writeB17,
  writeBelieve,
  type TestFacade,
} from './helpers/fixtures';

const I1 = 'QZTST2600001';
const I2 = 'QZTST2600002';
const I3 = 'QZTST2600003';
const UPC = '1234567890123';

/** Two owners: Owner A (artists A1, A2, confirmed), Owner B (artist B1, no approved contract). */
async function world(f: TestFacade) {
  const a = await confirmedOwner(f, 'Owner A', ['A1', 'A2']);
  const o = f.modules.owners;
  const ownerB = await o.createOwner({ name: 'Owner B', kind: 'person' });
  const b1 = await o.createArtist({ pseudonym: 'B1', ownerId: ownerB.id });
  const [a1, a2] = a.artists as unknown as [{ id: string }, { id: string }];
  for (const isrc of [I1, I2, I3]) await o.createTrack({ title: isrc, isrc, upc: UPC, artistIds: [a1.id] });
  const appendix = await approvedAppendix(f, a.owner.id);
  // I1: A1 30 + A2 20 confirmed -> ours 50
  await f.createSplit({
    isrc: I1,
    validFrom: '2020-01-01',
    shares: [
      { artistId: a1.id, percent: '30' },
      { artistId: a2.id, percent: '20' },
    ],
    documentId: appendix.id,
  });
  // I2: A1 50 without appendix -> C
  await f.createSplit({ isrc: I2, validFrom: '2020-01-01', shares: [{ artistId: a1.id, percent: '50' }] });
  // I3: B1 40 confirmed split, but owner B is not confirmed -> C
  await f.createSplit({
    isrc: I3,
    validFrom: '2020-01-01',
    shares: [{ artistId: b1.id, percent: '40' }],
    documentId: appendix.id,
  });
  return { a, a1, a2, ownerB, b1, appendix };
}

async function loadJuly(f: TestFacade) {
  return await f.ingestBelieve(
    writeBelieve('2026-07', [
      { isrc: I1, upc: UPC, net: '100', salesMonth: '2026-06' },
      { isrc: I1, upc: UPC, net: '100', salesMonth: '2026-07', country: 'France' },
      { isrc: I2, upc: UPC, net: '10' },
      { isrc: I3, upc: UPC, net: '50' },
      { isrc: 'QZTST2699999', upc: '999', net: '7', artistName: 'A1' }, // unknown pair, artist name matches but must not be used
      { isrc: 'QZTST2688888', upc: UPC, net: '3' }, // known? no: pair not in module 1
      { isrc: '', upc: UPC, net: '2', platform: 'iTunes', salesType: 'Download' },
    ]),
  );
}

describe('facade: completeness check A = B + C + our share (09, principle 11)', () => {
  it('splits money into not ours (B), waiting (C) and our share; the totals reconcile', async () => {
    const f = await newFacade();
    await world(f);
    await loadJuly(f);
    const [r] = await f.reconciliation();
    expect(r?.A_received.toFixed()).toBe('272');
    expect(r?.B_notOurs.toFixed()).toBe('100'); // 50% of 200 on I1
    // C: I2 split without appendix 5, I3 owner not confirmed 20, unknown pairs 7 + 3, no ISRC 2
    expect(r?.C_waiting.toFixed()).toBe('37');
    expect(r?.C_breakdown.split_unconfirmed?.toFixed()).toBe('5');
    expect(r?.C_breakdown.owner_unconfirmed?.toFixed()).toBe('20');
    expect(r?.C_breakdown.unknown_pair?.toFixed()).toBe('10');
    expect(r?.C_breakdown.no_isrc?.toFixed()).toBe('2');
    expect(r?.ourShare.toFixed()).toBe('135');
    expect(r?.discrepancy.toFixed()).toBe('0');
  });

  it('unknown ISRC/UPC pair: nothing is created, lines are kept, a signal with the amount is raised', async () => {
    const f = await newFacade();
    await world(f);
    const artistsBefore = (await f.modules.owners.artistIndex()).size;
    const tracksBefore = (await f.modules.owners.listTracks()).length;
    await loadJuly(f);
    expect((await f.modules.owners.artistIndex()).size).toBe(artistsBefore);
    expect(await f.modules.owners.listTracks()).toHaveLength(tracksBefore);
    const s = await f.signals();
    expect(s.unallocated.total.toFixed()).toBe('12');
    expect(s.unallocated.pairs.map((p) => p.isrc)).toContain('QZTST2699999');
    // after the pair is entered in module 1, the recalculation from scratch allocates it
    await f.modules.owners.createTrack({ title: 'late', isrc: 'QZTST2688888', upc: UPC });
    expect((await f.signals()).unallocated.total.toFixed()).toBe('9');
  });

  it('ISRC without split on the report date stays with us and is shown separately', async () => {
    const f = await newFacade();
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '10' }]));
    const [r] = await f.reconciliation();
    expect(r?.ourShareNoSplit.toFixed()).toBe('10');
    expect(r?.ourShare.toFixed()).toBe('10');
    expect((await f.signals()).isrcsWithoutSplit[0]?.isrc).toBe(I1);
  });

  it('the artist-track link and report names never decide who gets paid: only the split does', async () => {
    const f = await newFacade();
    const { a1, a2 } = await world(f);
    await loadJuly(f);
    // I1 is linked only to A1, the report says "Synthetic Artist", yet A2 gets 20% by the split
    const bal = await f.ownerBalance((await f.modules.owners.getArtist(a1.id)).ownerId as string);
    const byArtist = new Map(bal.artists.map((x) => [x.artistId, x]));
    expect(byArtist.get(a1.id)?.earned.toFixed()).toBe('60');
    expect(byArtist.get(a2.id)?.earned.toFixed()).toBe('40');
  });

  it('splits are keyed by ISRC: the same ISRC in a single and an album uses one split', async () => {
    const f = await newFacade();
    const { a } = await world(f);
    await f.modules.owners.createTrack({ title: 'album version', isrc: I1, upc: '555' });
    await f.ingestBelieve(
      writeBelieve('2026-07', [
        { isrc: I1, upc: UPC, net: '100' },
        { isrc: I1, upc: '555', net: '100' },
      ]),
    );
    expect((await f.ownerBalance(a.owner.id)).total.earned.toFixed()).toBe('100');
  });
});

describe('facade: owner balance, period filter, payouts (07, 09)', () => {
  it('owner view: received, not ours, waiting, our share, payable; period by report or sales date', async () => {
    const f = await newFacade();
    const { a } = await world(f);
    await loadJuly(f);
    const b = await f.ownerBalance(a.owner.id);
    expect(b.period.received.toFixed()).toBe('210'); // I1 200 + I2 10 (units where owner A participates)
    expect(b.period.notOurs.toFixed()).toBe('100');
    expect(b.period.waiting.toFixed()).toBe('5');
    expect(b.period.ourShare.toFixed()).toBe('105');
    expect(b.total.payable.toFixed()).toBe('100');
    const salesJune = await f.ownerBalance(a.owner.id, { from: '2026-06', to: '2026-06', basis: 'sales' });
    expect(salesJune.period.notOurs.toFixed()).toBe('50');
    const reportJune = await f.ownerBalance(a.owner.id, { from: '2026-06', to: '2026-06', basis: 'report' });
    expect(reportJune.period.notOurs.toFixed()).toBe('0');
    // payable is always all-time "as of today", independent of the filter
    expect(reportJune.total.payable.toFixed()).toBe('100');
  });

  it('a split without appendix becomes payable once the appendix is approved (recalculated from scratch)', async () => {
    const f = await newFacade();
    const { a } = await world(f);
    await loadJuly(f);
    const split = (await f.modules.splits.listSplits({ isrc: I2 }))[0];
    const doc = await f.modules.owners.createDocument({
      kind: 'appendix',
      title: 'Dummy appendix',
      requiresApproval: true,
    });
    await f.modules.splits.confirmSplit(split?.id as string, doc.id);
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('100'); // not attached yet
    await f.modules.owners.attachFile(doc.id, 'dummy://appendix2.pdf');
    await f.modules.owners.approveDocument(doc.id, 'manager');
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('105');
  });

  it('payout only for an owner with an approved document', async () => {
    const f = await newFacade();
    const { ownerB } = await world(f);
    await loadJuly(f);
    await expect(f.createPayout(ownerB.id)).rejects.toThrow(/approved contract/);
  });

  it('payout: one amount per owner, rounded down to cents, with snapshot; blocks until the payment proof exists', async () => {
    const f = await newFacade();
    const { a, a1 } = await world(f);
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100.123456789012' }]));
    const p = await f.createPayout(a.owner.id);
    expect(p.amountCents).toBe(5006); // 50% of 100.123456789012 = 50.061728394506 -> 50.06
    expect(p.direction).toBe('out');
    const snap = (await f.modules.settlements.getSnapshot(p.id)) as {
      files: { believe: { sha256: string }[] };
      perArtist: { artistId: string }[];
      payableExact: string;
    };
    expect(snap.files.believe[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.perArtist.map((x) => x.artistId)).toContain(a1.id);
    expect(snap.payableExact).toBe('50.061728394506');
    // no proof yet: not counted, and new payouts are blocked
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('50.061728394506');
    await expect(f.createPayout(a.owner.id)).rejects.toThrow(/blocked/);
    await f.attachPaymentProof(p.id, { fileRef: 'dummy://proof.pdf' });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('0.001728394506');
    await expect(f.createPayout(a.owner.id)).rejects.toThrow(/Nothing to pay/);
  });

  it('a deferred payment blocks payouts; a return is a separate operation linked by operation id', async () => {
    const f = await newFacade();
    const { a } = await world(f);
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }]));
    const p = await f.createPayout(a.owner.id);
    await f.attachPaymentProof(p.id, { fileRef: 'dummy://proof.pdf' });
    await f.modules.settlements.setDeferred(p.id, true);
    await expect(f.createPayout(a.owner.id)).rejects.toThrow(/blocked/);
    await f.modules.settlements.setDeferred(p.id, false);
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('0');
    const ret = await f.returnPayout(p.id, {
      fileRef: 'dummy://bounce.pdf',
      date: '2030-01-05',
      comment: 'bank rejected',
    });
    expect(ret.operationRef).toBe(p.id);
    expect(ret.direction).toBe('in');
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('50');
  });

  it('payout threshold is not part of the calculation, it only disables the button', async () => {
    const f = await newFacade(10000);
    const { a } = await world(f);
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }]));
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('50');
    await expect(f.createPayout(a.owner.id)).rejects.toThrow(/threshold/);
  });

  it('advance with scope: recouped only in scope after its date; deduction needs a document; negative balance shown as 0', async () => {
    const f = await newFacade();
    const { a, a1, a2 } = await world(f);
    await loadJuly(f); // A1 earns 60, A2 earns 40 (master)
    const basis = await approvedDoc(f, 'advance_basis', a.owner.id);
    const adv = await f.createOperation({
      direction: 'out',
      amount: '1000',
      artistId: a1.id,
      date: '2026-01-15',
      scope: { kind: 'master' },
      documentId: basis.id,
      comment: 'advance',
    });
    // advance without payment proof does not count yet
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('100');
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv-proof.pdf' });
    const b = await f.ownerBalance(a.owner.id);
    // A1's 60 recoups the advance; A2's 40 is not touched (settlements are per artist)
    expect(b.total.recouped.toFixed()).toBe('60');
    expect(b.total.payable.toFixed()).toBe('40');
    expect(b.positions[0]?.remaining.toFixed()).toBe('940');
    // a recoupable payout must carry a scope and a basis document
    await expect(
      async () =>
        await f.createOperation({
          direction: 'out',
          amount: '10',
          artistId: a1.id,
          date: '2026-01-15',
          scope: { kind: 'any' },
          comment: 'no doc',
        }),
    ).rejects.toThrow(/basis document/);
    // a deduction without an approved document is not applied
    const penaltyDoc = await f.modules.owners.createDocument({
      kind: 'adjustment_basis',
      title: 'Dummy penalty basis',
      requiresApproval: true,
      ownerId: a.owner.id,
    });
    await f.createOperation({
      direction: 'in',
      amount: '30',
      artistId: a2.id,
      date: '2026-07-20',
      documentId: penaltyDoc.id,
      comment: 'penalty',
    });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('40');
    expect((await f.ownerBalance(a.owner.id)).pendingOperations).toHaveLength(1);
    await f.modules.owners.attachFile(penaltyDoc.id, 'dummy://penalty.pdf');
    await f.modules.owners.approveDocument(penaltyDoc.id, 'manager');
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('10');
  });

  it('balance may be negative after a split change; it is stored with the minus and shown as 0', async () => {
    const f = await newFacade();
    const { a, a1, a2 } = await world(f);
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }]));
    const p = await f.createPayout(a.owner.id);
    await f.attachPaymentProof(p.id, { fileRef: 'dummy://proof.pdf' });
    // retroactive change confirmed by a new appendix: artist shares go down
    const doc = await approvedDoc(f, 'appendix', a.owner.id);
    await f.modules.splits.listSplits({ isrc: I1 });
    await f.changeSplit({
      isrc: I1,
      from: '2026-07-01',
      shares: [
        { artistId: a1.id, percent: '10' },
        { artistId: a2.id, percent: '10' },
      ],
      documentId: doc.id,
    });
    const b = await f.ownerBalance(a.owner.id);
    expect(b.total.payable.toFixed()).toBe('-30');
    expect(b.total.payableShown.toFixed()).toBe('0');
  });
});

describe('facade: publishing B17 (08)', () => {
  it('Total Payable times the contract percent goes to the owner; the remainder stays with the label', async () => {
    const f = await newFacade();
    const { a } = await world(f);
    await f.modules.owners.addOwnerAlias(a.owner.id, 'OWNER, A');
    const termsDoc = await approvedDoc(f, 'contract', a.owner.id);
    await f.modules.publishing.setTerms({
      ownerId: a.owner.id,
      percent: '50',
      validFrom: '2020-01-01',
      documentId: termsDoc.id,
    });
    const res = await f.ingestB17(
      await writeB17('Q22026', [
        { writer: 'OWNER, A', title: 'Song One', payable: '200' },
        { writer: 'Unknown Writer', title: 'Song Two', payable: '80' },
      ]),
    );
    expect(res.writers).toMatchObject({ matched: 1, created: 1, ambiguous: 0 });
    const b = await f.ownerBalance(a.owner.id);
    expect(b.total.earned.toFixed()).toBe('100');
    expect(b.publishing[0]?.amount.toFixed()).toBe('100');
    const pubRow = (await f.reconciliation()).find((r) => r.source === 'b17');
    expect(pubRow?.month).toBe('2026-06');
    expect(pubRow?.A_received.toFixed()).toBe('280');
    expect(pubRow?.B_notOurs.toFixed()).toBe('100');
    expect(pubRow?.C_waiting.toFixed()).toBe('40'); // unknown author: default 50% of 80, waiting for documents
    expect(pubRow?.ourShare.toFixed()).toBe('140');
  });

  it('unknown author: an owner without documents is created and accrued to; later merged into the confirmed owner', async () => {
    const f = await newFacade();
    const { a } = await world(f);
    const termsDoc = await approvedDoc(f, 'contract', a.owner.id);
    await f.modules.publishing.setTerms({
      ownerId: a.owner.id,
      percent: '50',
      validFrom: '2020-01-01',
      documentId: termsDoc.id,
    });
    await f.ingestB17(
      await writeB17('Q22026', [{ writer: 'Writer Unknown', title: 'Song', payable: '100' }]),
    );
    const stub = (await f.modules.owners.listOwners()).find((o) => o.origin === 'publishing');
    expect(stub?.status).toBe('waiting_documents');
    expect((await f.ownerBalance(stub?.id as string)).total.waiting.toFixed()).toBe('50');
    await expect(f.createPayout(stub?.id as string)).rejects.toThrow(/approved contract/);
    await f.mergeOwners(stub?.id as string, a.owner.id, 'same person');
    expect((await f.ownerBalance(a.owner.id)).total.earned.toFixed()).toBe('50');
  });

  it('owner publishing recoups a publishing-only advance of any of its artists', async () => {
    const f = await newFacade();
    const { a, a1 } = await world(f);
    await f.modules.owners.addOwnerAlias(a.owner.id, 'OWNER, A');
    const termsDoc = await approvedDoc(f, 'contract', a.owner.id);
    await f.modules.publishing.setTerms({
      ownerId: a.owner.id,
      percent: '50',
      validFrom: '2020-01-01',
      documentId: termsDoc.id,
    });
    await loadJuly(f); // master: 100 confirmed
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'Song', payable: '400' }])); // author 200
    const basis = await approvedDoc(f, 'advance_basis', a.owner.id);
    const adv = await f.createOperation({
      direction: 'out',
      amount: '1500',
      artistId: a1.id,
      date: '2026-04-01',
      scope: { kind: 'publishing' },
      documentId: basis.id,
      comment: 'publishing advance',
    });
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://p.pdf' });
    const b = await f.ownerBalance(a.owner.id);
    expect(b.total.recouped.toFixed()).toBe('200');
    expect(b.total.payable.toFixed()).toBe('100'); // master untouched
    expect(b.positions[0]?.remaining.toFixed()).toBe('1300');
  });

  it('a second B17 statement for the same quarter is an error', async () => {
    const f = await newFacade();
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'W', title: 'S', payable: '1' }]));
    await expect(
      f.ingestB17(
        await writeB17(
          'Q22026',
          [{ writer: 'W', title: 'S', payable: '2' }],
          '0to8_Q22026_Publishing_Statement_Updated.xlsx',
        ),
      ),
    ).rejects.toMatchObject({ code: 'duplicate_period' });
  });
});
