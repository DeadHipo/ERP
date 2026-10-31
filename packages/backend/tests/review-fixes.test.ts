import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import {
  approvedAppendix,
  approvedDoc,
  confirmedOwner,
  newFacade,
  tmpPath,
  writeBelieve,
  writeB17,
} from './helpers/fixtures';
import { testSources } from './helpers/test-sources';

// Regression tests for findings of the independent module reviews (see 97_принятые_решения.md, D-030+).

const I1 = 'QZTST2600001';
const UPC = '1234567890123';

describe('owners: merge and documents', () => {
  it('merge into an unconfirmed owner, chains and cycles are rejected', () => {
    const f = newFacade();
    const o = f.modules.owners;
    const a = o.createOwner({ name: 'Stub A', kind: 'person' });
    const b = o.createOwner({ name: 'Stub B', kind: 'person' });
    expect(() => o.mergeOwners(a.id, b.id, 'x')).toThrow(/confirmed owner/);
    const c = confirmedOwner(f, 'Real C', ['C']);
    o.mergeOwners(a.id, c.owner.id, 'same');
    expect(() => o.mergeOwners(a.id, c.owner.id, 'again')).toThrow(/merged/);
    expect(() => o.createArtist({ pseudonym: 'late', ownerId: a.id })).toThrow(/merged/);
    f.close();
  });

  it('artist merge: no chains; owners must match', () => {
    const f = newFacade();
    const o = f.modules.owners;
    const x = o.createArtist({ pseudonym: 'X' });
    const y = o.createArtist({ pseudonym: 'Y' });
    o.mergeArtists(x.id, y.id, 'dup');
    expect(() => o.mergeArtists(y.id, x.id, 'cycle')).toThrow(/live records/);
    f.close();
  });

  it("a contract is confirmed only by the owner's own document; a new file resets approval", () => {
    const f = newFacade();
    const o = f.modules.owners;
    const a = confirmedOwner(f, 'Owner A', ['A']);
    const b = o.createOwner({ name: 'Owner B', kind: 'person' });
    expect(() => o.createContract({ ownerId: b.id, documentId: a.contractDocId, artistIds: [] })).toThrow(
      /another owner/,
    );
    o.attachFile(a.contractDocId, 'dummy://replaced.pdf');
    expect(o.getDocument(a.contractDocId).status).toBe('not_approved');
    expect(o.isOwnerConfirmed(a.owner.id)).toBe(false);
    f.close();
  });
});

describe('splits: change and buyout edge cases', () => {
  it('a buyout on the first day of a split works and keeps history', () => {
    const f = newFacade();
    const s = f.createSplit({
      isrc: I1,
      validFrom: '2026-05-01',
      shares: [{ newArtistPseudonym: 'Seller', percent: '40' }],
    });
    const seller = s.shares[0]?.artistId as string;
    f.buyout({
      isrcs: [I1],
      sellerArtistId: seller,
      effectiveFrom: '2026-05-01',
      documentId: approvedDoc(f, 'buyout').id,
    });
    expect(f.modules.splits.splitAt(I1, '2026-05-01')?.ourShare.toFixed()).toBe('100');
    expect(f.modules.splits.listSplits({ isrc: I1 })).toHaveLength(2);
    f.close();
  });

  it('a buyout also zeroes the seller in later splits', () => {
    const f = newFacade();
    const s = f.createSplit({
      isrc: I1,
      validFrom: '2025-01-01',
      validTo: '2026-07-01',
      shares: [{ newArtistPseudonym: 'Seller', percent: '40' }],
    });
    const seller = s.shares[0]?.artistId as string;
    f.createSplit({ isrc: I1, validFrom: '2026-07-01', shares: [{ artistId: seller, percent: '30' }] });
    f.buyout({
      isrcs: [I1],
      sellerArtistId: seller,
      effectiveFrom: '2026-05-01',
      documentId: approvedDoc(f, 'buyout').id,
    });
    expect(f.modules.splits.splitAt(I1, '2026-04-01')?.ourShare.toFixed()).toBe('60');
    expect(f.modules.splits.splitAt(I1, '2026-06-01')?.ourShare.toFixed()).toBe('100');
    expect(f.modules.splits.splitAt(I1, '2026-08-01')?.ourShare.toFixed()).toBe('100');
    f.close();
  });

  it('a buyout zeroes the seller also in splits that still hold an artist merged into it (D-095)', () => {
    const f = newFacade();
    const old = f.createSplit({
      isrc: I1,
      validFrom: '2025-01-01',
      validTo: '2026-07-01',
      shares: [{ newArtistPseudonym: 'Seller dup', percent: '40' }],
    });
    const dup = old.shares[0]?.artistId as string;
    const seller = f.modules.owners.createArtist({ pseudonym: 'Seller', ownerId: null }).id;
    f.createSplit({ isrc: I1, validFrom: '2026-07-01', shares: [{ artistId: dup, percent: '30' }] });
    f.modules.owners.mergeArtists(dup, seller, 'duplicate record');
    // the merged id stands for the surviving artist, so both ids in one split are the same person
    expect(() =>
      f.changeSplit({
        isrc: I1,
        from: '2026-09-01',
        shares: [
          { artistId: dup, percent: '10' },
          { artistId: seller, percent: '10' },
        ],
        documentId: approvedDoc(f, 'appendix').id,
      }),
    ).toThrow(/twice/);
    f.buyout({
      isrcs: [I1],
      sellerArtistId: seller,
      effectiveFrom: '2026-05-01',
      documentId: approvedDoc(f, 'buyout').id,
    });
    expect(f.modules.splits.splitAt(I1, '2026-06-01')?.ourShare.toFixed()).toBe('100');
    expect(f.modules.splits.splitAt(I1, '2026-08-01')?.ourShare.toFixed()).toBe('100');
    f.close();
  });

  it('a rejected split creates no orphan artists; a split document must be an appendix/contract/buyout', () => {
    const f = newFacade();
    const before = f.modules.owners.artistIndex().size;
    expect(() =>
      f.createSplit({
        isrc: I1,
        validFrom: '2020-01-01',
        shares: [
          { newArtistPseudonym: 'A', percent: '70' },
          { newArtistPseudonym: 'B', percent: '40' },
        ],
      }),
    ).toThrow(/exceeds 100/);
    expect(f.modules.owners.artistIndex().size).toBe(before);
    const proof = f.modules.owners.createDocument({
      kind: 'payment_proof',
      title: 'p',
      fileRef: 'dummy://p',
      requiresApproval: false,
    });
    expect(() =>
      f.createSplit({ isrc: I1, validFrom: '2020-01-01', shares: [], documentId: proof.id }),
    ).toThrow(/appendix/);
    expect(() =>
      f.createSplit({
        isrc: I1,
        validFrom: '2020-01-01',
        shares: [{ newArtistPseudonym: 'A', percent: '33.3333333' }],
      }),
    ).toThrow(/6 decimals/);
    f.close();
  });

  it('a change between two existing splits lasts until the next one', () => {
    const f = newFacade();
    const s = f.createSplit({
      isrc: I1,
      validFrom: '2025-01-01',
      validTo: '2026-01-01',
      shares: [{ newArtistPseudonym: 'A', percent: '50' }],
    });
    f.createSplit({
      isrc: I1,
      validFrom: '2026-06-01',
      shares: [{ artistId: s.shares[0]?.artistId as string, percent: '20' }],
    });
    f.changeSplit({
      isrc: I1,
      from: '2026-02-01',
      shares: [{ artistId: s.shares[0]?.artistId as string, percent: '10' }],
      documentId: approvedDoc(f, 'appendix').id,
    });
    const list = f.modules.splits.listSplits({ isrc: I1 }).map((x) => [x.validFrom, x.validTo, x.ourShare]);
    expect(list).toContainEqual(['2026-02-01', '2026-06-01', '90']);
    f.close();
  });
});

describe('settlements: returns, manual payouts, migration, negative income', () => {
  async function owner100() {
    const f = newFacade();
    const a = confirmedOwner(f, 'Owner A', ['A1']);
    f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId: a.artists[0]?.id as string, percent: '50' }],
      documentId: approvedAppendix(f).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '200' }]));
    return { f, a, artistId: a.artists[0]?.id as string };
  }

  it('a payout without payment proof cannot be returned; returns cannot exceed the payout', async () => {
    const { f, a } = await owner100();
    const p = await f.createPayout(a.owner.id);
    expect(() => f.returnPayout(p.id, { fileRef: 'dummy://r', date: '2026-08-01', comment: 'x' })).toThrow(
      /counted payout/,
    );
    f.attachPaymentProof(p.id, { fileRef: 'dummy://proof' });
    f.returnPayout(p.id, { fileRef: 'dummy://r1', date: '2030-01-01', comment: 'bounce' });
    expect(() =>
      f.returnPayout(p.id, { fileRef: 'dummy://r2', date: '2030-01-02', comment: 'again' }),
    ).toThrow(/exceed/);
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('100');
    f.close();
  });

  it('an advance cannot be returned as if it were a payout', async () => {
    const { f, a, artistId } = await owner100();
    const adv = f.createOperation({
      direction: 'out',
      amount: '50',
      artistId,
      date: '2026-01-01',
      scope: { kind: 'any' },
      documentId: approvedDoc(f, 'advance_basis', a.owner.id).id,
      comment: 'adv',
    });
    f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    expect(() => f.returnPayout(adv.id, { fileRef: 'dummy://r', date: '2026-08-01', comment: 'x' })).toThrow(
      /counted payout/,
    );
    f.close();
  });

  it('a plain payout of earned money is only possible with the payout button', async () => {
    const { f, a } = await owner100();
    expect(() =>
      f.createOperation({
        direction: 'out',
        amount: '10',
        ownerId: a.owner.id,
        date: '2026-08-01',
        comment: 'manual',
      }),
    ).toThrow(/payout button/);
    f.close();
  });

  it('migrated payouts count without documents and do not block new payouts', async () => {
    const { f, a } = await owner100();
    f.createOperation({
      direction: 'out',
      amount: '30',
      ownerId: a.owner.id,
      date: '2026-06-01',
      comment: 'transfer',
      migration: true,
    });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('70');
    expect((await f.createPayout(a.owner.id)).amountCents).toBe(7000);
    f.close();
  });

  it('an advance with an unapproved basis document is not applied', async () => {
    const { f, a, artistId } = await owner100();
    const basis = f.modules.owners.createDocument({
      kind: 'advance_basis',
      title: 'b',
      requiresApproval: true,
      ownerId: a.owner.id,
    });
    const adv = f.createOperation({
      direction: 'out',
      amount: '50',
      artistId,
      date: '2026-01-01',
      scope: { kind: 'master', excludeIsrcs: ['qz-tst-26-00009'] },
      documentId: basis.id,
      comment: 'adv',
    });
    expect(adv.scope?.excludeIsrcs).toEqual(['QZTST2600009']);
    f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('100');
    f.close();
  });

  it('negative master lines net with positive ones of the same ISRC/month before recoupment', async () => {
    const f = newFacade();
    const a = confirmedOwner(f, 'Owner A', ['A1']);
    const artistId = a.artists[0]?.id as string;
    f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId, percent: '100' }],
      documentId: approvedAppendix(f).id,
    });
    await f.ingestBelieve(
      writeBelieve('2026-07', [
        { isrc: I1, upc: UPC, net: '100' },
        { isrc: I1, upc: UPC, net: '-100', country: 'Chile' },
      ]),
    );
    f.modules.owners.addOwnerAlias(a.owner.id, 'OWNER, A');
    f.setPublishingTerms({
      ownerId: a.owner.id,
      percent: '100',
      validFrom: '2020-01-01',
      documentId: a.contractDocId,
    });
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'S', payable: '500' }]));
    const adv = f.createOperation({
      direction: 'out',
      amount: '100',
      artistId,
      date: '2026-01-01',
      scope: { kind: 'master' },
      documentId: approvedDoc(f, 'advance_basis', a.owner.id).id,
      comment: 'adv',
    });
    f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    const b = await f.ownerBalance(a.owner.id);
    expect(b.total.recouped.toFixed()).toBe('0');
    expect(b.total.payable.toFixed()).toBe('500'); // the master advance never touches publishing income
    f.close();
  });

  it('a deduction (scope any) reduces income earned before its date', async () => {
    const { f, a, artistId } = await owner100();
    f.createOperation({
      direction: 'in',
      amount: '40',
      artistId,
      date: '2026-12-01',
      documentId: approvedDoc(f, 'adjustment_basis', a.owner.id).id,
      comment: 'penalty',
    });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('60');
    f.close();
  });

  it('the payment service is called after the payout is recorded; the snapshot says which artist it is for', async () => {
    const calls: string[] = [];
    const { openFacade } = await import('../src/facade');
    const f = openFacade({
      dataDir: ':memory:',
      payoutThresholdCents: 0,
      sources: testSources(),
      paymentService: {
        send: () => {
          calls.push(String(f.modules.settlements.allOperations().length));
          return { externalRef: 'ext-1', status: 'queued' };
        },
      },
    });
    const a = confirmedOwner(f, 'Owner A', ['A1']);
    f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId: a.artists[0]?.id as string, percent: '50' }],
      documentId: approvedAppendix(f).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '200' }]));
    const p = await f.createPayout(a.owner.id);
    expect(calls).toEqual(['1']);
    expect(p.externalRef).toBe('ext-1');
    const snap = f.modules.settlements.getSnapshot(p.id) as {
      payoutByArtist: { label: string; shareOfPayout: string }[];
    };
    expect(JSON.parse(JSON.stringify(snap.payoutByArtist))).toEqual([
      { key: a.artists[0]?.id, label: 'A1', net: '100', shareOfPayout: '100' },
    ]);
    f.close();
  });
});

describe('sources: robustness', () => {
  it('concurrent uploads are serialized and both load', async () => {
    const f = newFacade();
    const [x, y] = await Promise.all([
      f.ingestBelieve(
        writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '1' }], { account: '1', reportId: '11' }),
      ),
      f.ingestBelieve(
        writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '2' }], { account: '2', reportId: '12' }),
      ),
    ]);
    expect([x.netTotal, y.netTotal]).toEqual(['1', '2']);
    f.close();
  });

  it('invalid UTF-8, an unclosed quote and a duplicated header column are rejected', async () => {
    const f = newFacade();
    const name = '9000001_1052428_2026-07-01_2026-07-01.csv';
    const p1 = tmpPath(name);
    writeFileSync(
      p1,
      Buffer.concat([Buffer.from('"Reporting month";"x"\n"'), Buffer.from([0xff, 0xfe]), Buffer.from('"\n')]),
    );
    await expect(f.ingestBelieve({ path: p1, fileName: name })).rejects.toThrow(/UTF-8/);
    const good = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '1' }]);
    const p2 = tmpPath(name);
    writeFileSync(
      p2,
      Buffer.from(readFileSync(good.path, 'utf8').replace('"Platform"', '"Reporting month"')),
    );
    await expect(f.ingestBelieve({ path: p2, fileName: name })).rejects.toThrow(/duplicated/);
    f.close();
  });

  it('JSON money never uses exponent notation or -0', async () => {
    const { Decimal } = await import('../src/shared/money');
    expect(JSON.stringify({ a: new Decimal('0.000000001'), b: new Decimal(0).neg() })).toBe(
      '{"a":"0.000000001","b":"0"}',
    );
  });
});

describe('publishing: labels, similar names, numeric cells', () => {
  it('a writer is never mapped to a label owner; a similar name goes to the operator', async () => {
    const f = newFacade();
    const o = f.modules.owners;
    o.createOwner({ name: 'Label Writer', kind: 'label' });
    o.createOwner({ name: 'Ivan Testov', kind: 'person' });
    const res = await f.ingestB17(
      await writeB17('Q22026', [
        { writer: 'Label Writer', title: 'S1', payable: '10' },
        { writer: 'TESTOV, IVAN', title: 'S2', payable: '10' },
      ]),
    );
    expect(res.writers).toMatchObject({ matched: 0, created: 1, ambiguous: 1 });
    expect((await f.signals()).ambiguousWriters.map((w) => w.displayName)).toEqual(['TESTOV, IVAN']);
    const target = o.listOwners().find((x) => x.name === 'Ivan Testov');
    f.mapWriter('testov ivan', { ownerId: target?.id as string });
    expect(f.modules.publishing.listWriters().find((w) => w.writerNorm === 'testov ivan')?.ownerId).toBe(
      target?.id,
    );
    f.close();
  });

  it('numeric and formula cells keep 15 significant digits', async () => {
    const f = newFacade();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Detail');
    ws.addRow(['Period', 'asset title', 'rights-holder name', 'Total Payable']);
    ws.addRow(['2Q26', 'S', 'W', 0.1 + 0.2]);
    ws.addRow(['2Q26', 'S2', 'W', { formula: 'D2*2', result: 12.340000000000002 }]);
    ws.addRow(['', '', '', 12.64]); // total row without title and writer
    const path = tmpPath('0to8_Q22026_Publishing_Statement.xlsx');
    await wb.xlsx.writeFile(path);
    const res = await f.ingestB17({ path, fileName: '0to8_Q22026_Publishing_Statement.xlsx' });
    expect(res.statement.totalPayable).toBe('12.64');
    expect(res.statement.lineCount).toBe(2);
    f.close();
  });
});

describe('payout snapshot attribution', () => {
  it('a publishing-scoped advance reduces the publishing part of the payout, not the artist master part', async () => {
    const f = newFacade();
    const a = confirmedOwner(f, 'Owner A', ['A1']);
    const artistId = a.artists[0]?.id as string;
    f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId, percent: '50' }],
      documentId: approvedAppendix(f).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '200' }]));
    f.modules.owners.addOwnerAlias(a.owner.id, 'OWNER, A');
    f.setPublishingTerms({
      ownerId: a.owner.id,
      percent: '50',
      validFrom: '2020-01-01',
      documentId: a.contractDocId,
    });
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'S', payable: '400' }]));
    const adv = f.createOperation({
      direction: 'out',
      amount: '150',
      artistId,
      date: '2026-04-01',
      scope: { kind: 'publishing' },
      documentId: approvedDoc(f, 'advance_basis', a.owner.id).id,
      comment: 'adv',
    });
    f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    const p = await f.createPayout(a.owner.id);
    expect(p.amountCents).toBe(15000);
    const snap = JSON.parse(JSON.stringify(f.modules.settlements.getSnapshot(p.id))) as {
      payoutByArtist: { label: string; shareOfPayout: string }[];
    };
    expect(snap.payoutByArtist.map((x) => [x.label, x.shareOfPayout])).toEqual([
      ['A1', '100'],
      ['Publishing (owner)', '50'],
    ]);
    f.close();
  });
});
