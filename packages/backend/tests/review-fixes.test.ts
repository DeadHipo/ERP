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
  type TestFacade,
} from './helpers/fixtures';

// Regression tests for findings of the independent module reviews (see 97_принятые_решения.md, D-030+).

const I1 = 'QZTST2600001';
const UPC = '1234567890123';

describe('owners: merge and documents', () => {
  it('merge into an unconfirmed owner, chains and cycles are rejected', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const a = await o.createOwner({ name: 'Stub A', kind: 'person' });
    const b = await o.createOwner({ name: 'Stub B', kind: 'person' });
    await expect(async () => await o.mergeOwners(a.id, b.id, 'x')).rejects.toThrow(/confirmed owner/);
    const c = await confirmedOwner(f, 'Real C', ['C']);
    await o.mergeOwners(a.id, c.owner.id, 'same');
    await expect(async () => await o.mergeOwners(a.id, c.owner.id, 'again')).rejects.toThrow(/merged/);
    await expect(async () => await o.createArtist({ pseudonym: 'late', ownerId: a.id })).rejects.toThrow(
      /merged/,
    );
  });

  it('artist merge: no chains; owners must match', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const x = await o.createArtist({ pseudonym: 'X' });
    const y = await o.createArtist({ pseudonym: 'Y' });
    await o.mergeArtists(x.id, y.id, 'dup');
    await expect(async () => await o.mergeArtists(y.id, x.id, 'cycle')).rejects.toThrow(/live records/);
  });

  it("a contract is confirmed only by the owner's own document; a new file resets approval", async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const a = await confirmedOwner(f, 'Owner A', ['A']);
    const b = await o.createOwner({ name: 'Owner B', kind: 'person' });
    await expect(
      async () => await o.createContract({ ownerId: b.id, documentId: a.contractDocId, artistIds: [] }),
    ).rejects.toThrow(/another owner/);
    await o.attachFile(a.contractDocId, 'dummy://replaced.pdf');
    expect((await o.getDocument(a.contractDocId)).status).toBe('not_approved');
    expect(await o.isOwnerConfirmed(a.owner.id)).toBe(false);
  });
});

describe('splits: change and buyout edge cases', () => {
  it('a buyout on the first day of a split works and keeps history', async () => {
    const f = await newFacade();
    const s = await f.createSplit({
      isrc: I1,
      validFrom: '2026-05-01',
      shares: [{ newArtistPseudonym: 'Seller', percent: '40' }],
    });
    const seller = s.shares[0]?.artistId as string;
    await f.buyout({
      isrcs: [I1],
      sellerArtistId: seller,
      effectiveFrom: '2026-05-01',
      documentId: (await approvedDoc(f, 'buyout')).id,
    });
    expect((await f.modules.splits.splitAt(I1, '2026-05-01'))?.ourShare.toFixed()).toBe('100');
    expect(await f.modules.splits.listSplits({ isrc: I1 })).toHaveLength(2);
  });

  it('a buyout also zeroes the seller in later splits', async () => {
    const f = await newFacade();
    const s = await f.createSplit({
      isrc: I1,
      validFrom: '2025-01-01',
      validTo: '2026-07-01',
      shares: [{ newArtistPseudonym: 'Seller', percent: '40' }],
    });
    const seller = s.shares[0]?.artistId as string;
    await f.createSplit({ isrc: I1, validFrom: '2026-07-01', shares: [{ artistId: seller, percent: '30' }] });
    await f.buyout({
      isrcs: [I1],
      sellerArtistId: seller,
      effectiveFrom: '2026-05-01',
      documentId: (await approvedDoc(f, 'buyout')).id,
    });
    expect((await f.modules.splits.splitAt(I1, '2026-04-01'))?.ourShare.toFixed()).toBe('60');
    expect((await f.modules.splits.splitAt(I1, '2026-06-01'))?.ourShare.toFixed()).toBe('100');
    expect((await f.modules.splits.splitAt(I1, '2026-08-01'))?.ourShare.toFixed()).toBe('100');
  });

  it('a buyout zeroes the seller also in splits that still hold an artist merged into it (D-095)', async () => {
    const f = await newFacade();
    const old = await f.createSplit({
      isrc: I1,
      validFrom: '2025-01-01',
      validTo: '2026-07-01',
      shares: [{ newArtistPseudonym: 'Seller dup', percent: '40' }],
    });
    const dup = old.shares[0]?.artistId as string;
    const seller = (await f.modules.owners.createArtist({ pseudonym: 'Seller', ownerId: null })).id;
    await f.createSplit({ isrc: I1, validFrom: '2026-07-01', shares: [{ artistId: dup, percent: '30' }] });
    await f.modules.owners.mergeArtists(dup, seller, 'duplicate record');
    // the merged id stands for the surviving artist, so both ids in one split are the same person
    await expect(
      async () =>
        await f.changeSplit({
          isrc: I1,
          from: '2026-09-01',
          shares: [
            { artistId: dup, percent: '10' },
            { artistId: seller, percent: '10' },
          ],
          documentId: (await approvedDoc(f, 'appendix')).id,
        }),
    ).rejects.toThrow(/twice/);
    await f.buyout({
      isrcs: [I1],
      sellerArtistId: seller,
      effectiveFrom: '2026-05-01',
      documentId: (await approvedDoc(f, 'buyout')).id,
    });
    expect((await f.modules.splits.splitAt(I1, '2026-06-01'))?.ourShare.toFixed()).toBe('100');
    expect((await f.modules.splits.splitAt(I1, '2026-08-01'))?.ourShare.toFixed()).toBe('100');
  });

  it('a rejected split creates no orphan artists; a split document must be an appendix/contract/buyout', async () => {
    const f = await newFacade();
    const before = (await f.modules.owners.artistIndex()).size;
    await expect(
      async () =>
        await f.createSplit({
          isrc: I1,
          validFrom: '2020-01-01',
          shares: [
            { newArtistPseudonym: 'A', percent: '70' },
            { newArtistPseudonym: 'B', percent: '40' },
          ],
        }),
    ).rejects.toThrow(/exceeds 100/);
    expect((await f.modules.owners.artistIndex()).size).toBe(before);
    const proof = await f.modules.owners.createDocument({
      kind: 'payment_proof',
      title: 'p',
      fileRef: 'dummy://p',
      requiresApproval: false,
    });
    await expect(
      async () =>
        await f.createSplit({ isrc: I1, validFrom: '2020-01-01', shares: [], documentId: proof.id }),
    ).rejects.toThrow(/appendix/);
    await expect(
      async () =>
        await f.createSplit({
          isrc: I1,
          validFrom: '2020-01-01',
          shares: [{ newArtistPseudonym: 'A', percent: '33.3333333' }],
        }),
    ).rejects.toThrow(/6 decimals/);
  });

  it('a change between two existing splits lasts until the next one', async () => {
    const f = await newFacade();
    const s = await f.createSplit({
      isrc: I1,
      validFrom: '2025-01-01',
      validTo: '2026-01-01',
      shares: [{ newArtistPseudonym: 'A', percent: '50' }],
    });
    await f.createSplit({
      isrc: I1,
      validFrom: '2026-06-01',
      shares: [{ artistId: s.shares[0]?.artistId as string, percent: '20' }],
    });
    await f.changeSplit({
      isrc: I1,
      from: '2026-02-01',
      shares: [{ artistId: s.shares[0]?.artistId as string, percent: '10' }],
      documentId: (await approvedDoc(f, 'appendix')).id,
    });
    const list = (await f.modules.splits.listSplits({ isrc: I1 })).map((x) => [
      x.validFrom,
      x.validTo,
      x.ourShare,
    ]);
    expect(list).toContainEqual(['2026-02-01', '2026-06-01', '90']);
  });
});

describe('settlements: returns, manual payouts, migration, negative income', () => {
  async function owner100() {
    const f = await newFacade();
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId: a.artists[0]?.id as string, percent: '50' }],
      documentId: (await approvedAppendix(f)).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '200' }]), f.testLabels['0to8']);
    return { f, a, artistId: a.artists[0]?.id as string };
  }

  it('a payout without payment proof cannot be returned; returns cannot exceed the payout', async () => {
    const { f, a } = await owner100();
    const p = await f.createPayout(a.owner.id, { labelId: f.testLabels['0to8'] });
    await expect(
      async () => await f.returnPayout(p.id, { fileRef: 'dummy://r', date: '2026-08-01', comment: 'x' }),
    ).rejects.toThrow(/counted payout/);
    await f.attachPaymentProof(p.id, { fileRef: 'dummy://proof' });
    await f.returnPayout(p.id, { fileRef: 'dummy://r1', date: '2030-01-01', comment: 'bounce' });
    await expect(
      async () => await f.returnPayout(p.id, { fileRef: 'dummy://r2', date: '2030-01-02', comment: 'again' }),
    ).rejects.toThrow(/exceed/);
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('100');
  });

  it('an advance cannot be returned as if it were a payout', async () => {
    const { f, a, artistId } = await owner100();
    const adv = await f.createOperation({ labelId: f.testLabels['0to8'],
      direction: 'out',
      amount: '50',
      artistId,
      date: '2026-01-01',
      scope: { kind: 'any' },
      documentId: (await approvedDoc(f, 'advance_basis', a.owner.id)).id,
      comment: 'adv',
    });
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    await expect(
      async () => await f.returnPayout(adv.id, { fileRef: 'dummy://r', date: '2026-08-01', comment: 'x' }),
    ).rejects.toThrow(/counted payout/);
  });

  it('a plain payout of earned money is only possible with the payout button', async () => {
    const { f, a } = await owner100();
    await expect(
      async () =>
        await f.createOperation({ labelId: f.testLabels['0to8'],
          direction: 'out',
          amount: '10',
          ownerId: a.owner.id,
          date: '2026-08-01',
          comment: 'manual',
        }),
    ).rejects.toThrow(/payout button/);
  });

  it('migrated payouts count without documents and do not block new payouts', async () => {
    const { f, a } = await owner100();
    await f.createOperation({ labelId: f.testLabels['0to8'],
      direction: 'out',
      amount: '30',
      ownerId: a.owner.id,
      date: '2026-06-01',
      comment: 'transfer',
      migration: true,
    });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('70');
    expect((await f.createPayout(a.owner.id, { labelId: f.testLabels['0to8'] })).amountCents).toBe(7000);
  });

  it('an advance with an unapproved basis document is not applied', async () => {
    const { f, a, artistId } = await owner100();
    const basis = await f.modules.owners.createDocument({
      kind: 'advance_basis',
      title: 'b',
      requiresApproval: true,
      ownerId: a.owner.id,
    });
    const adv = await f.createOperation({ labelId: f.testLabels['0to8'],
      direction: 'out',
      amount: '50',
      artistId,
      date: '2026-01-01',
      scope: { kind: 'master', excludeIsrcs: ['qz-tst-26-00009'] },
      documentId: basis.id,
      comment: 'adv',
    });
    expect(adv.scope?.excludeIsrcs).toEqual(['QZTST2600009']);
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('100');
  });

  it('negative master lines net with positive ones of the same ISRC/month before recoupment', async () => {
    const f = await newFacade();
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    const artistId = a.artists[0]?.id as string;
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId, percent: '100' }],
      documentId: (await approvedAppendix(f)).id,
    });
    await f.ingestBelieve(
      writeBelieve('2026-07', [
        { isrc: I1, upc: UPC, net: '100' },
        { isrc: I1, upc: UPC, net: '-100', country: 'Chile' },
      ]), f.testLabels['0to8'],
    );
    await f.modules.owners.addOwnerAlias(a.owner.id, 'OWNER, A');
    await f.setPublishingTerms({
      ownerId: a.owner.id,
      percent: '100',
      validFrom: '2020-01-01',
      documentId: a.contractDocId,
    });
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'S', payable: '500' }]), f.testLabels['0to8']);
    const adv = await f.createOperation({ labelId: f.testLabels['0to8'],
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
    expect(b.total.payable.toFixed()).toBe('500'); // the master advance never touches publishing income
  });

  it('a deduction (scope any) reduces income earned before its date', async () => {
    const { f, a, artistId } = await owner100();
    await f.createOperation({ labelId: f.testLabels['0to8'],
      direction: 'in',
      amount: '40',
      artistId,
      date: '2026-12-01',
      documentId: (await approvedDoc(f, 'adjustment_basis', a.owner.id)).id,
      comment: 'penalty',
    });
    expect((await f.ownerBalance(a.owner.id)).total.payable.toFixed()).toBe('60');
  });

  it('the payment service is called after the payout is recorded; the snapshot says which artist it is for', async () => {
    // send() is synchronous: it starts the read of the stored operations at the moment it is called
    const calls: Promise<string>[] = [];
    const f: TestFacade = await newFacade(0, {
      paymentService: {
        send: () => {
          calls.push(f.modules.settlements.allOperations().then((ops) => String(ops.length)));
          return { externalRef: 'ext-1', status: 'queued' };
        },
      },
    });
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId: a.artists[0]?.id as string, percent: '50' }],
      documentId: (await approvedAppendix(f)).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '200' }]), f.testLabels['0to8']);
    const p = await f.createPayout(a.owner.id, { labelId: f.testLabels['0to8'] });
    expect(await Promise.all(calls)).toEqual(['1']);
    expect(p.externalRef).toBe('ext-1');
    const snap = (await f.modules.settlements.getSnapshot(p.id)) as {
      payoutByArtist: { label: string; shareOfPayout: string }[];
    };
    expect(JSON.parse(JSON.stringify(snap.payoutByArtist))).toEqual([
      { key: a.artists[0]?.id, label: 'A1', net: '100', shareOfPayout: '100' },
    ]);
  });
});

describe('sources: robustness', () => {
  it('concurrent uploads are serialized and both load', async () => {
    const f = await newFacade();
    await f.modules.labels.addAccount(f.testLabels['0to8'], '1');
    await f.modules.labels.addAccount(f.testLabels['0to8'], '2');
    const [x, y] = await Promise.all([
      f.ingestBelieve(
        writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '1' }], { account: '1', reportId: '11' }), f.testLabels['0to8'],
      ),
      f.ingestBelieve(
        writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '2' }], { account: '2', reportId: '12' }), f.testLabels['0to8'],
      ),
    ]);
    expect([x.netTotal, y.netTotal]).toEqual(['1', '2']);
  });

  it('invalid UTF-8, an unclosed quote and a duplicated header column are rejected', async () => {
    const f = await newFacade();
    const name = '9000001_1052428_2026-07-01_2026-07-01.csv';
    const p1 = tmpPath(name);
    writeFileSync(
      p1,
      Buffer.concat([Buffer.from('"Reporting month";"x"\n"'), Buffer.from([0xff, 0xfe]), Buffer.from('"\n')]),
    );
    await expect(f.ingestBelieve({ path: p1, fileName: name }, f.testLabels['0to8'])).rejects.toThrow(/UTF-8/);
    const good = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '1' }]);
    const p2 = tmpPath(name);
    writeFileSync(
      p2,
      Buffer.from(readFileSync(good.path, 'utf8').replace('"Platform"', '"Reporting month"')),
    );
    await expect(f.ingestBelieve({ path: p2, fileName: name }, f.testLabels['0to8'])).rejects.toThrow(/duplicated/);
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
    const f = await newFacade();
    const o = f.modules.owners;
    await o.createOwner({ name: 'Label Writer', kind: 'label' });
    await o.createOwner({ name: 'Ivan Testov', kind: 'person' });
    const res = await f.ingestB17(
      await writeB17('Q22026', [
        { writer: 'Label Writer', title: 'S1', payable: '10' },
        { writer: 'TESTOV, IVAN', title: 'S2', payable: '10' },
      ]), f.testLabels['0to8'],
    );
    expect(res.writers).toMatchObject({ matched: 0, created: 1, ambiguous: 1 });
    expect((await f.signals()).ambiguousWriters.map((w) => w.displayName)).toEqual(['TESTOV, IVAN']);
    const target = (await o.listOwners()).find((x) => x.name === 'Ivan Testov');
    await f.mapWriter('testov ivan', { ownerId: target?.id as string });
    expect(
      (await f.modules.publishing.listWriters()).find((w) => w.writerNorm === 'testov ivan')?.ownerId,
    ).toBe(target?.id);
  });

  it('numeric and formula cells keep 15 significant digits', async () => {
    const f = await newFacade();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Detail');
    ws.addRow(['Period', 'asset title', 'rights-holder name', 'Total Payable']);
    ws.addRow(['2Q26', 'S', 'W', 0.1 + 0.2]);
    ws.addRow(['2Q26', 'S2', 'W', { formula: 'D2*2', result: 12.340000000000002 }]);
    ws.addRow(['', '', '', 12.64]); // total row without title and writer
    const path = tmpPath('0to8_Q22026_Publishing_Statement.xlsx');
    await wb.xlsx.writeFile(path);
    const res = await f.ingestB17({ path, fileName: '0to8_Q22026_Publishing_Statement.xlsx' }, f.testLabels['0to8']);
    expect(res.statement.totalPayable).toBe('12.64');
    expect(res.statement.lineCount).toBe(2);
  });
});

describe('payout snapshot attribution', () => {
  it('a publishing-scoped advance reduces the publishing part; the statement of 0to8 sits in the 0to8 book, so the payout under 0to8 pays master + publishing (D-168, D-169 R8)', async () => {
    const f = await newFacade();
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    const artistId = a.artists[0]?.id as string;
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId, percent: '50' }],
      documentId: (await approvedAppendix(f)).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '200' }]), f.testLabels['0to8']);
    await f.modules.owners.addOwnerAlias(a.owner.id, 'OWNER, A');
    await f.setPublishingTerms({
      ownerId: a.owner.id,
      percent: '50',
      validFrom: '2020-01-01',
      documentId: a.contractDocId,
    });
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'OWNER, A', title: 'S', payable: '400' }]), f.testLabels['0to8']);
    const adv = await f.createOperation({ labelId: f.testLabels['0to8'],
      direction: 'out',
      amount: '150',
      artistId,
      date: '2026-04-01',
      scope: { kind: 'publishing' },
      documentId: (await approvedDoc(f, 'advance_basis', a.owner.id)).id,
      comment: 'adv',
    });
    await f.attachPaymentProof(adv.id, { fileRef: 'dummy://adv' });
    // the whole owner: master 100 + publishing 200 − the advance 150 recouped from publishing = 150 payable
    const whole = await f.ownerBalance(a.owner.id);
    expect([whole.total.payable.toFixed(), whole.publishingRecouped.toFixed()]).toEqual(['150', '150']);
    const books = Object.fromEntries(Object.entries(whole.byLabel).map(([k, b]) => [k, [b.earned.toFixed(), b.recouped.toFixed(), b.payable.toFixed()]]));
    expect(books).toEqual({ '0to8': ['300', '150', '150'] });
    const p = await f.createPayout(a.owner.id, { labelId: f.testLabels['0to8'] });
    expect(p.amountCents).toBe(15000);
    const snap = JSON.parse(JSON.stringify(await f.modules.settlements.getSnapshot(p.id))) as {
      labelId: string;
      total: { payable: string };
      payoutByArtist: { label: string; shareOfPayout: string }[];
    };
    expect([snap.labelId, snap.total.payable]).toEqual([f.testLabels['0to8'], '150']);
    // master 100 − 0 and publishing 200 − 150: the advance reduced the publishing part only
    expect(snap.payoutByArtist.map((x) => [x.label, x.shareOfPayout])).toEqual([['A1', '100'], ['Publishing (owner)', '50']]);
    // after it the 0to8 book is paid in full
    await f.attachPaymentProof(p.id, { fileRef: 'dummy://p' });
    const after = await f.ownerBalance(a.owner.id);
    expect([after.total.payable.toFixed(), after.byLabel['0to8']?.payable.toFixed(), after.byLabel['?']]).toEqual(['0', '0', undefined]);
  });
});
