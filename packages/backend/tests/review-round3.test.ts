import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

import {
  approvedDoc,
  believeCsv,
  confirmedOwner,
  newFacade,
  tmpPath,
  writeBelieve,
} from './helpers/fixtures';
import { testFileTotals } from './helpers/test-sources';

// Regression tests for the second review round of sources and publishing (97_принятые_решения.md, D-075).

const I1 = 'QZTST2600001';
const UPC = '1234567890123';

/** Minimal zip writer (stored entries) for tests; real Believe files are `.csv.zip`. */
function writeZip(path: string, entries: { name: string; data: Buffer; date?: Date }[]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const d = e.date ?? new Date(2026, 7, 12, 10, 30, 0);
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(e.data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    parts.push(local, name, e.data);
    central.push(cd, name);
    offset += 30 + name.length + e.data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(path, Buffer.concat([...parts, cdBuf, end]));
}

describe('sources: zip input, key dimensions, recovery, validation', () => {
  it('loads a zipped report; more than one entry or a non-CSV entry is rejected', async () => {
    const f = await newFacade();
    const csv = Buffer.from(believeCsv('2026-07', [{ isrc: I1, upc: UPC, net: '1.5' }]));
    const name = '9100001_1052428_2026-07-01_2026-07-01.csv.zip';
    const path = tmpPath(name);
    writeZip(path, [{ name: name.replace(/\.zip$/, ''), data: csv }]);
    const loaded = await f.ingestBelieve({ path, fileName: name }, f.testLabels['0to8']);
    expect(loaded.netTotal).toBe('1.5');
    const two = tmpPath('9100002_1052428_2026-08-01_2026-08-01.csv.zip');
    writeZip(two, [
      { name: 'a.csv', data: csv },
      { name: 'b.csv', data: csv },
    ]);
    await expect(
      f.ingestBelieve({ path: two, fileName: '9100002_1052428_2026-08-01_2026-08-01.csv.zip' }, f.testLabels['0to8']),
    ).rejects.toThrow(/exactly one/);
    const notCsv = tmpPath('9100003_1052428_2026-09-01_2026-09-01.csv.zip');
    writeZip(notCsv, [{ name: 'report.xlsx', data: csv }]);
    await expect(
      f.ingestBelieve({ path: notCsv, fileName: '9100003_1052428_2026-09-01_2026-09-01.csv.zip' }, f.testLabels['0to8']),
    ).rejects.toThrow(/must be a \.csv/);
    // a zipped load that fails mid-file releases the archive: the zip can be removed at once (D-101)
    const bad = Buffer.from(
      believeCsv('2026-10', [
        { isrc: I1, upc: UPC, net: '1' },
        { isrc: I1, upc: UPC, net: '1', currency: 'EUR', country: 'Peru' },
      ]),
    );
    const badName = '9100004_1052428_2026-10-01_2026-10-01.csv.zip';
    const badPath = tmpPath(badName);
    writeZip(badPath, [{ name: badName.replace(/\.zip$/, ''), data: bad }]);
    await expect(f.ingestBelieve({ path: badPath, fileName: badName }, f.testLabels['0to8'])).rejects.toThrow(/USD/);
    rmSync(badPath);
    expect(existsSync(badPath)).toBe(false);
    const files = await f.modules.sources.listFiles();
    expect(files.filter((x) => x.status === 'loaded').map((x) => x.reportingMonth)).toEqual(['2026-07']);
    expect(files.filter((x) => x.status === 'failed')).toHaveLength(3); // each refused file is recorded as failed
  });

  it('every key dimension separates lines; only identical keys are summed', async () => {
    const f = await newFacade();
    const base = { isrc: I1, upc: UPC, net: '1' };
    const loaded = await f.ingestBelieve(
      writeBelieve('2026-07', [
        base,
        { ...base }, // same key: summed
        { ...base, salesMonth: '2026-06' },
        { ...base, platform: 'Deezer' },
        { ...base, country: 'Peru' },
        { ...base, subscription: 'Free' },
        { ...base, salesType: 'Download' },
        { ...base, upc: '999' },
      ]), f.testLabels['0to8'],
    );
    expect(loaded.lineCount).toBe(8);
    expect((await testFileTotals(loaded.id)).keys).toBe('7');
  });

  it('an invalid month in the file name is rejected before anything is stored', async () => {
    const f = await newFacade();
    const file = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '1' }]);
    const bad = tmpPath('9000001_1052428_2026-13-01_2026-13-01.csv');
    writeFileSync(bad, readFileSync(file.path));
    await expect(
      f.ingestBelieve({ path: bad, fileName: '9000001_1052428_2026-13-01_2026-13-01.csv' }, f.testLabels['0to8']),
    ).rejects.toThrow(/Invalid month/);
    expect(await f.modules.sources.listFiles()).toHaveLength(0);
  });
});

describe('publishing: terms, merges, statement checks', () => {
  async function setup() {
    const f = await newFacade();
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    await f.modules.owners.addOwnerAlias(a.owner.id, 'OWNER, A');
    return { f, a };
  }

  // D-234: «terms with an unapproved document wait» was a test of the old B17 module (removed)
  it('publishing terms are refused for a label and for a document of another owner', async () => {
    const { f, a } = await setup();
    const label = await f.modules.owners.createOwner({ name: 'Some Label', kind: 'label' });
    await expect(
      async () => await f.setPublishingTerms({ ownerId: label.id, percent: '50', validFrom: '2020-01-01' }),
    ).rejects.toThrow(/label/);
    const other = await confirmedOwner(f, 'Owner B', ['B1']);
    await expect(
      async () =>
        await f.setPublishingTerms({
          ownerId: a.owner.id,
          percent: '50',
          validFrom: '2020-01-01',
          documentId: other.contractDocId,
        }),
    ).rejects.toThrow(/another owner/);
  });

  it('a person is never merged into a label, so publishing cannot reach a label', async () => {
    const { f } = await setup();
    const label = await confirmedOwner(f, 'Label Owner', []);
    const stub = await f.modules.owners.createOwner({ name: 'Writer Unknown', kind: 'person' });
    await f.mergeOwners(stub.id, label.owner.id, 'x'); // must not throw: both person in this helper
    const realLabel = await f.modules.owners.createOwner({ name: 'Real Label', kind: 'label' });
    const stub2 = await f.modules.owners.createOwner({ name: 'Writer Two', kind: 'person' });
    await expect(async () => await f.modules.owners.mergeOwners(stub2.id, realLabel.id, 'x')).rejects.toThrow(
      /different kinds/,
    );
  });

  // D-234: «the surviving owner keeps its own terms after a merge» was a test of the old B17 module (removed)
});

describe('final review: dates, adjustment documents, label guard, contracts', () => {
  it('impossible dates and zone-less date-times are rejected', async () => {
    const { normalizeTimestamp, assertDate } = await import('../src/shared/dates');
    expect(() => assertDate('2024-02-30')).toThrow();
    expect(() => normalizeTimestamp('2024-02-30')).toThrow();
    expect(() => normalizeTimestamp('2024-01-01T10:00')).toThrow(/zone/);
    expect(normalizeTimestamp('2024-01-01T10:00:00+03:00')).toBe('2024-01-01T07:00:00.000Z');
  });

  it('a credit is not counted through a payment proof: it needs an approved basis document', async () => {
    const f = await newFacade();
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    const proof = await f.modules.owners.createDocument({
      kind: 'payment_proof',
      title: 'p',
      fileRef: 'dummy://p',
      requiresApproval: false,
      ownerId: a.owner.id,
    });
    await expect(
      async () =>
        await f.createOperation({ labelId: f.testLabels['0to8'],
          direction: 'in',
          amount: '-50',
          artistId: a.artists[0]?.id as string,
          date: '2026-08-01',
          paymentProofId: proof.id,
          comment: 'x',
        }),
    ).rejects.toThrow(/basis document/);
  });

  // D-234: «a writer mapped to a label owner is never paid» was a test of the old B17 module (removed)
  it('a contract rejects duplicated, merged or foreign artists, and a document of another owner', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    const b = await confirmedOwner(f, 'Owner B', ['B1']);
    const doc = await o.createDocument({
      kind: 'contract',
      title: 'c',
      fileRef: 'dummy://c',
      ownerId: a.owner.id,
      requiresApproval: false,
    });
    const a1 = a.artists[0]?.id as string;
    await expect(
      async () => await o.createContract({ ownerId: a.owner.id, documentId: doc.id, artistIds: [a1, a1] }),
    ).rejects.toThrow(/twice/);
    await expect(
      async () =>
        await o.createContract({
          ownerId: a.owner.id,
          documentId: doc.id,
          artistIds: [b.artists[0]?.id as string],
        }),
    ).rejects.toThrow(/another owner/);
    await expect(
      async () => await o.createContract({ ownerId: b.owner.id, documentId: doc.id, artistIds: [] }),
    ).rejects.toThrow(/another owner/);
    const dup = await o.createArtist({ pseudonym: 'A1 copy', ownerId: a.owner.id });
    await o.mergeArtists(dup.id, a1, 'dup');
    await expect(
      async () => await o.createContract({ ownerId: a.owner.id, documentId: doc.id, artistIds: [dup.id] }),
    ).rejects.toThrow(/merged/);
    await expect(async () => await o.addOwnerAlias(a.owner.id, '  ,  ')).rejects.toThrow(/empty/);
  });
});

describe('final module reviews: advances are payouts, smaller checks', () => {
  it('an advance needs a confirmed owner and no blocking payout, like the payout button', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const stub = await o.createOwner({ name: 'Stub Owner', kind: 'person' });
    const artist = await o.createArtist({ pseudonym: 'Stub Artist', ownerId: stub.id });
    const basis = await o.createDocument({
      kind: 'advance_basis',
      title: 'b',
      fileRef: 'dummy://b',
      ownerId: stub.id,
      requiresApproval: false,
    });
    await expect(
      async () =>
        await f.createOperation({ labelId: f.testLabels['0to8'],
          direction: 'out',
          amount: '10',
          artistId: artist.id,
          date: '2026-01-01',
          scope: { kind: 'any' },
          documentId: basis.id,
          comment: 'adv',
        }),
    ).rejects.toThrow(/approved contract/);
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    const artistId = a.artists[0]?.id as string;
    await o.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId, percent: '50' }],
      documentId: (await approvedDoc(f, 'appendix')).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '200' }]), f.testLabels['0to8']);
    await f.createPayout(a.owner.id, { labelId: f.testLabels['0to8'] }); // no proof yet
    await expect(
      async () =>
        await f.createOperation({ labelId: f.testLabels['0to8'],
          direction: 'out',
          amount: '10',
          artistId,
          date: '2026-01-01',
          scope: { kind: 'any' },
          documentId: (await approvedDoc(f, 'advance_basis', a.owner.id)).id,
          comment: 'adv',
        }),
    ).rejects.toThrow(/blocked/);
  });

  it('the same existing artist twice in a split is refused before anything is created; a return cannot precede its payout', async () => {
    const f = await newFacade();
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    const artistId = a.artists[0]?.id as string;
    const before = (await f.modules.owners.artistIndex()).size;
    await expect(
      async () =>
        await f.createSplit({
          isrc: I1,
          validFrom: '2020-01-01',
          shares: [
            { artistId, percent: '10' },
            { artistId, percent: '10' },
            { newArtistPseudonym: 'New', percent: '5' },
          ],
        }),
    ).rejects.toThrow(/twice/);
    expect((await f.modules.owners.artistIndex()).size).toBe(before);
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId, percent: '50' }],
      documentId: (await approvedDoc(f, 'appendix')).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '200' }]), f.testLabels['0to8']);
    const p = await f.createPayout(a.owner.id, { labelId: f.testLabels['0to8'] });
    await f.attachPaymentProof(p.id, { fileRef: 'dummy://proof' });
    await expect(
      async () => await f.returnPayout(p.id, { fileRef: 'dummy://r', date: '2000-01-01', comment: 'x' }),
    ).rejects.toThrow(/before its payout/);
  });

  // D-234: «a B17 statement with two detail sheets» tested the reader of the old module (removed)
});

// D-234: «B17 songwriters» (D-087 equal parts, the unknown-author rule, an ambiguous songwriter) left with the old module

describe('sources: units', () => {
  it('equal keys are summed per unit (ISRC + UPC + report month + sales month)', async () => {
    const f = await newFacade();
    await f.ingestBelieve(
      writeBelieve('2026-07', [
        { isrc: I1, upc: UPC, net: '1.5', salesMonth: '2026-06' },
        { isrc: I1, upc: UPC, net: '2', salesMonth: '2026-07' },
        { isrc: I1, upc: UPC, net: '0.25', salesMonth: '2026-07', country: 'Peru' },
      ]), f.testLabels['0to8'],
    );
    const units = (await f.modules.sources.units()).map((u) => [u.salesMonth, u.netPico.toString()]).sort();
    expect(units).toEqual([
      ['2026-06', '1500000000000'],
      ['2026-07', '2250000000000'],
    ]);
  });
});
