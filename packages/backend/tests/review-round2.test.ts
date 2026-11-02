import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/shared/money';
import type { IncomeItem, Position } from '../src/modules/settlements';
import { recoup } from '../src/facade/layers/recoup';
import {
  approvedAppendix,
  approvedDoc,
  confirmedOwner,
  newFacade,
  writeB17,
  writeBelieve,
  type TestFacade,
} from './helpers/fixtures';

// Regression tests for the second round of independent reviews (97_принятые_решения.md, D-072 to D-074).

const I1 = 'QZTST2600001';
const I2 = 'QZTST2600002';
const UPC = '1234567890123';
const D = (v: number) => new Decimal(v);

/** Confirmed owner A with artist A1 holding 100% of I1 and I2 (confirmed split). */
async function ownerWithTracks(f: TestFacade) {
  const a = await confirmedOwner(f, 'Owner A', ['A1']);
  const artistId = a.artists[0]?.id as string;
  const appendix = await approvedAppendix(f, a.owner.id);
  for (const isrc of [I1, I2]) {
    await f.modules.owners.createTrack({ title: isrc, isrc, upc: UPC });
    await f.createSplit({
      isrc,
      validFrom: '2020-01-01',
      shares: [{ artistId, percent: '100' }],
      documentId: appendix.id,
    });
  }
  return { a, artistId };
}

describe('recoupment is capped by the net income in scope', () => {
  it('negative lines of another ISRC reduce what a master advance can take; publishing stays untouched', async () => {
    const f = await newFacade();
    const { a, artistId } = await ownerWithTracks(f);
    await f.ingestBelieve(
      writeBelieve('2026-07', [
        { isrc: I1, upc: UPC, net: '100' },
        { isrc: I2, upc: UPC, net: '-100' },
      ]),
    );
    await f.modules.owners.addOwnerAlias(a.owner.id, 'OWNER, A');
    await f.setPublishingTerms({
      ownerId: a.owner.id,
      percent: '100',
      validFrom: '2020-01-01',
      documentId: a.contractDocId,
    });
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'S', payable: '500' }]));
    const adv = await f.createOperation({
      direction: 'out',
      amount: '100',
      artistId,
      date: '2026-01-01',
      scope: { kind: 'master' },
      documentId: (await approvedDoc(f, 'advance_basis', a.owner.id)).id,
      comment: 'adv',
    });
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    const b = await f.ownerBalance(a.owner.id);
    expect(b.total.recouped.toFixed()).toBe('0');
    expect(b.total.payable.toFixed()).toBe('500');
  });

  it('a later chargeback month also nets the scope (pure function)', async () => {
    const item = (id: string, amount: number, month: string): IncomeItem => ({
      id,
      stream: 'master',
      ownerId: 'O',
      artistId: 'x',
      isrc: I1,
      reportMonth: month,
      amount: D(amount),
    });
    const p: Position = {
      id: 'p',
      ownerId: 'O',
      artistId: 'x',
      month: null,
      amount: D(100),
      scope: { kind: 'master' },
    };
    expect(recoup([p], [item('a', 100, '2026-06'), item('b', -60, '2026-07')])[0]?.recouped.toFixed()).toBe(
      '40',
    );
  });

  it('equal positions are processed in a deterministic order (by id)', async () => {
    const inc: IncomeItem[] = [
      {
        id: 'i',
        stream: 'publishing',
        ownerId: 'O',
        artistId: null,
        isrc: null,
        reportMonth: '2026-06',
        amount: D(50),
      },
    ];
    const mk = (id: string): Position => ({
      id,
      ownerId: 'O',
      artistId: 'x',
      month: '2026-01',
      amount: D(100),
      scope: { kind: 'any' },
    });
    const r1 = recoup([mk('b'), mk('a')], inc);
    const r2 = recoup([mk('a'), mk('b')], inc);
    expect(r1.find((r) => r.positionId === 'a')?.recouped.toFixed()).toBe('50');
    expect(r2.find((r) => r.positionId === 'a')?.recouped.toFixed()).toBe('50');
  });
});

describe('merged artists keep their settlements', () => {
  it('an advance on a merged artist recoups the surviving artist master income', async () => {
    const f = await newFacade();
    const { a, artistId } = await ownerWithTracks(f);
    const dup = await f.modules.owners.createArtist({ pseudonym: 'A1 dup', ownerId: a.owner.id });
    const adv = await f.createOperation({
      direction: 'out',
      amount: '30',
      artistId: dup.id,
      date: '2026-01-01',
      scope: { kind: 'master' },
      documentId: (await approvedDoc(f, 'advance_basis', a.owner.id)).id,
      comment: 'adv',
    });
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    await f.modules.owners.mergeArtists(dup.id, artistId, 'duplicate record');
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }]));
    const b = await f.ownerBalance(a.owner.id);
    expect(b.total.recouped.toFixed()).toBe('30');
    expect(b.total.payable.toFixed()).toBe('70');
  });
});

describe('splits: report date, owners, confirmation', () => {
  it('the split is chosen by the report date, not the sales date', async () => {
    const f = await newFacade();
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    const artistId = a.artists[0]?.id as string;
    const appendix = await approvedAppendix(f, a.owner.id);
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      validTo: '2026-07-01',
      shares: [{ artistId, percent: '10' }],
      documentId: appendix.id,
    });
    await f.createSplit({
      isrc: I1,
      validFrom: '2026-07-01',
      shares: [{ artistId, percent: '60' }],
      documentId: appendix.id,
    });
    // sold in June, reported in July: the July split (60%) applies
    await f.ingestBelieve(
      writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100', salesMonth: '2026-06' }]),
    );
    expect((await f.ownerBalance(a.owner.id)).total.earned.toFixed()).toBe('60');
  });

  it('money of an artist without owner is C until an owner is assigned and confirmed', async () => {
    const f = await newFacade();
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    const s = await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ newArtistPseudonym: 'Newcomer', percent: '50' }],
      documentId: (await approvedAppendix(f)).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }]));
    expect((await f.reconciliation())[0]?.C_breakdown.artist_without_owner?.toFixed()).toBe('50');
    const artistId = s.shares[0]?.artistId as string;
    const o = await f.modules.owners.createOwner({ name: 'Newcomer Owner', kind: 'person' });
    const doc = await f.modules.owners.createDocument({
      kind: 'contract',
      title: 'Dummy contract',
      fileRef: 'dummy://c',
      ownerId: o.id,
      requiresApproval: true,
    });
    await f.modules.owners.createContract({ ownerId: o.id, documentId: doc.id, artistIds: [artistId] });
    expect((await f.reconciliation())[0]?.C_breakdown.owner_unconfirmed?.toFixed()).toBe('50');
    await f.modules.owners.approveDocument(doc.id, 'manager');
    expect((await f.reconciliation())[0]?.B_notOurs.toFixed()).toBe('50');
  });

  it('a refused split change creates no artists; a split is confirmed once, by a split document', async () => {
    const f = await newFacade();
    const s = await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ newArtistPseudonym: 'A', percent: '50' }],
    });
    const before = (await f.modules.owners.artistIndex()).size;
    const doc = await approvedDoc(f, 'appendix');
    await expect(
      async () =>
        await f.changeSplit({
          isrc: I1,
          from: '2026-01-01',
          shares: [
            { newArtistPseudonym: 'B', percent: '70' },
            { newArtistPseudonym: 'C', percent: '40' },
          ],
          documentId: doc.id,
        }),
    ).rejects.toThrow(/exceeds 100/);
    expect((await f.modules.owners.artistIndex()).size).toBe(before);
    const proof = await f.modules.owners.createDocument({
      kind: 'payment_proof',
      title: 'p',
      fileRef: 'dummy://p',
      requiresApproval: false,
    });
    await expect(async () => await f.confirmSplit(s.id, proof.id)).rejects.toThrow(/appendix/);
    await f.confirmSplit(s.id, doc.id);
    await expect(
      async () => await f.confirmSplit(s.id, (await approvedDoc(f, 'appendix')).id),
    ).rejects.toThrow(/already confirmed/);
  });
});

describe('settlements: credits, rollback, merge, proofs, period figures', () => {
  async function owner200(f: TestFacade) {
    const { a, artistId } = await ownerWithTracks(f);
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '200' }]));
    return { a, artistId };
  }

  it('a credit (in, negative) adds to the payable amount once its document is approved', async () => {
    const f = await newFacade();
    const { a, artistId } = await owner200(f);
    await f.createOperation({
      direction: 'in',
      amount: '-25',
      artistId,
      date: '2026-08-01',
      documentId: (await approvedDoc(f, 'adjustment_basis', a.owner.id)).id,
      comment: 'album sale without ISRC (M10)',
    });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('225');
  });

  it('soft rollback: a deactivated operation drops out; a payout with returns cannot be deactivated; an unproven payout can', async () => {
    const f = await newFacade();
    const { a, artistId } = await owner200(f);
    const ded = await f.createOperation({
      direction: 'in',
      amount: '50',
      artistId,
      date: '2026-08-01',
      documentId: (await approvedDoc(f, 'adjustment_basis', a.owner.id)).id,
      comment: 'penalty',
    });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('150');
    await f.modules.settlements.deactivate(ded.id, 'entered by mistake');
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('200');
    const p1 = await f.createPayout(a.owner.id);
    // a sent payout is rolled back only when the transfer failure is confirmed (D-101)
    await expect(async () => await f.modules.settlements.deactivate(p1.id, 'oops')).rejects.toThrow(
      /transfer failed/,
    );
    await f.modules.settlements.deactivate(p1.id, 'transfer rejected by the bank', { transferFailed: true });
    const p2 = await f.createPayout(a.owner.id);
    await f.attachPaymentProof(p2.id, { fileRef: 'dummy://proof' });
    await expect(
      async () => await f.attachPaymentProof(p2.id, { fileRef: 'dummy://proof2' }),
    ).rejects.toThrow();
    await f.returnPayout(p2.id, { fileRef: 'dummy://ret', date: '2030-01-02', comment: 'bounced' });
    // a paid payout is never deactivated, with or without returns: money is given back by a return
    await expect(
      async () => await f.modules.settlements.deactivate(p2.id, 'x', { transferFailed: true }),
    ).rejects.toThrow(/return/);
  });

  it('owner merge is refused while the stub has a blocking payout; operations move to the survivor', async () => {
    const f = await newFacade();
    const target = await confirmedOwner(f, 'Real Owner', ['R1']);
    const stub = await f.modules.owners.createOwner({ name: 'Stub Owner', kind: 'person' });
    await f.createOperation({
      direction: 'out',
      amount: '10',
      ownerId: stub.id,
      date: '2026-01-01',
      comment: 'migrated payout',
      migration: true,
    });
    await f.mergeOwners(stub.id, target.owner.id, 'same person');
    expect(await f.modules.settlements.listOperations({ ownerId: target.owner.id })).toHaveLength(1);
    expect((await f.ownerBalance(target.owner.id)).total.payable.toFixed()).toBe('-10');
  });

  it('period figures: paid and advances in the period by operation date', async () => {
    const f = await newFacade();
    const { a, artistId } = await owner200(f);
    const adv = await f.createOperation({
      direction: 'out',
      amount: '40',
      artistId,
      date: '2026-07-10',
      scope: { kind: 'master' },
      documentId: (await approvedDoc(f, 'advance_basis', a.owner.id)).id,
      comment: 'adv',
    });
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    const july = await f.ownerBalance(a.owner.id, { from: '2026-07', to: '2026-07' });
    expect(july.period.advancesPaid.toFixed()).toBe('40');
    expect(july.period.recouped.toFixed()).toBe('40');
    expect(
      (await f.ownerBalance(a.owner.id, { from: '2026-08', to: '2026-08' })).period.advancesPaid.toFixed(),
    ).toBe('0');
  });

  it('basis documents must fit the operation; migrated payouts cannot be deferred', async () => {
    const f = await newFacade();
    const { a, artistId } = await owner200(f);
    const proof = await f.modules.owners.createDocument({
      kind: 'payment_proof',
      title: 'p',
      fileRef: 'dummy://p',
      requiresApproval: false,
      ownerId: a.owner.id,
    });
    await expect(
      async () =>
        await f.createOperation({
          direction: 'in',
          amount: '5',
          artistId,
          date: '2026-08-01',
          documentId: proof.id,
          comment: 'x',
        }),
    ).rejects.toThrow(/cannot be based/);
    const mig = await f.createOperation({
      direction: 'out',
      amount: '1',
      ownerId: a.owner.id,
      date: '2026-01-01',
      comment: 'migrated',
      migration: true,
    });
    await expect(async () => await f.modules.settlements.setDeferred(mig.id, true)).rejects.toThrow(
      /migrated/,
    );
  });
});

describe('publishing completeness check', () => {
  it('A = B + C + our share holds with an unmapped writer, an unconfirmed owner and unconfirmed terms', async () => {
    const f = await newFacade();
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    await f.modules.owners.addOwnerAlias(a.owner.id, 'OWNER, A');
    await f.modules.owners.createOwner({ name: 'Ivan Testov', kind: 'person' });
    await f.ingestB17(
      await writeB17('Q22026', [
        { writer: 'OWNER, A', title: 'S1', payable: '100' }, // confirmed owner, default terms -> C
        { writer: 'New Writer', title: 'S2', payable: '60' }, // created, unconfirmed -> C
        { writer: 'TESTOV, IVAN', title: 'S3', payable: '40' }, // ambiguous -> unmapped C (whole payable)
      ]),
    );
    const r = (await f.reconciliation()).find((x) => x.source === 'b17');
    expect(r?.A_received.toFixed()).toBe('200');
    expect(r?.C_breakdown.publishing_terms_unconfirmed?.toFixed()).toBe('50');
    expect(r?.C_breakdown.owner_unconfirmed?.toFixed()).toBe('30');
    expect(r?.C_breakdown.writer_unmapped?.toFixed()).toBe('40');
    expect(r?.ourShare.toFixed()).toBe('80');
    expect(r?.discrepancy.toFixed()).toBe('0');
  });
});
