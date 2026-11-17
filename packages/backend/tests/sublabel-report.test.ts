import { describe, expect, it } from 'vitest';
import { approvedAppendix, confirmedOwner, labelOwner, newFacade, writeBelieve } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// The report of a sublabel by its terms (D-219): a read of the calculation, which does not read the terms. A world
// whose sublabel exists twice with one id, as after migration 0033: a label of kind sublabel with an alias and a rule
// (the money today) and the same id in the register (the terms). Synthetic names, ISRCs and amounts only.

const T1 = 'QZTST2600101';
const T2 = 'QZTST2600102';
const UPC = '1111111111101';

async function world() {
  const f = await newFacade();
  const l = f.modules.labels;
  const o = f.modules.owners;
  const a = await confirmedOwner(f, 'Report Owner', ['Report Artist', 'Second Artist']);
  const artist = a.artists[0]!;
  const second = a.artists[1]!;
  // T1 by one pseudonym, T2 by two: two groups «by artist»
  await o.createTrack({ title: 'Song 1', isrc: T1, upc: UPC, artistIds: [artist.id] });
  await o.createTrack({ title: 'Song 2', isrc: T2, upc: UPC, artistIds: [artist.id, second.id] });
  const appendix = (await approvedAppendix(f)).id;
  // T1: the artist 50 % (confirmed) -> the label share is half the net; T2 has no split
  await f.createSplit({ isrc: T1, validFrom: '2020-01-01', shares: [{ artistId: artist.id, percent: '50' }], documentId: appendix });
  const sub = await l.createLabel({ name: 'Sub R', kind: 'sublabel', ownLabelId: f.testLabels['0to8'] });
  await l.addAlias(sub.id, 'Sub R Records');
  const recipient = await labelOwner(f, 'Sub R');
  await l.setRule({ labelId: sub.id, percent: '50', recipientArtistId: recipient.artist.id, validFrom: '2026-01-01', documentId: appendix });
  // the register row with the same id (what 0033 copies)
  const { pg, orgId } = await testStack();
  await pg.pool.query('INSERT INTO labels.sublabels (org_id, id, name, created_at) VALUES ($1, $2, $3, now())', [orgId, sub.id, 'Sub R']);
  await f.ingestBelieve(
    writeBelieve('2026-07', [
      { isrc: T1, upc: UPC, net: '100', labelName: 'Sub R Records' },
      { isrc: T2, upc: UPC, net: '40', labelName: 'Sub R Records' },
    ]),
    f.testLabels['0to8'],
  );
  await f.ingestBelieve(writeBelieve('2026-08', [{ isrc: T1, upc: UPC, net: '10', labelName: 'Sub R Records' }]), f.testLabels['0to8']);
  return { f, sub: sub.id, appendix, artist, second };
}

describe('the report of a sublabel by its terms (D-219)', () => {
  it('gives its part per track and month, equal to the rule when the term is the same; the money does not move', async () => {
    const { f, sub, appendix, artist, second } = await world();
    const before = JSON.stringify(await f.trackMoney(T1));
    expect((await f.sublabelReport(sub)).rows).toEqual([]);
    await f.addSublabelTerms(sub, { percent: '50', validFrom: '2026-07', documentId: appendix, items: [{ isrc: T1 }] }, { dryRun: false }, 'tester');
    await f.addSublabelTerms(sub, { percent: '50', validFrom: '2026-07', items: [{ isrc: T2 }] }, { dryRun: false }, 'tester');
    // a buyout of half of the sublabel's share on T1 from August, without a document yet
    await f.addSublabelTerms(sub, { percent: '25', validFrom: '2026-08', items: [{ isrc: T1 }] }, { dryRun: false }, 'tester');
    expect(JSON.stringify(await f.trackMoney(T1))).toBe(before);

    const r = await f.sublabelReport(sub);
    expect(r.rows.map((x) => [x.month, x.isrc, x.title, x.labelShare, x.percent, x.amount, x.status, x.reason, x.currentAmount])).toEqual([
      ['2026-07', T1, 'Song 1', '50', '50', '25', 'confirmed', null, '25'],
      ['2026-07', T2, 'Song 2', '0', '50', '0', 'waiting', 'no_split', '0'],
      ['2026-08', T1, 'Song 1', '5', '25', '1.25', 'waiting', 'no_document', '2.5'],
    ]);
    expect(r.months).toEqual([
      { month: '2026-07', labelShare: '50', amount: '25', confirmed: '25', waiting: '0', currentAmount: '25' },
      { month: '2026-08', labelShare: '5', amount: '1.25', confirmed: '0', waiting: '1.25', currentAmount: '2.5' },
    ]);
    expect(r.total).toEqual({ labelShare: '55', amount: '26.25', confirmed: '25', waiting: '1.25', currentAmount: '27.5' });
    // the period per track (the largest part first) and per set of pseudonyms: both add up to the total
    const A = { id: artist.id, pseudonym: 'Report Artist' };
    const B = { id: second.id, pseudonym: 'Second Artist' };
    expect(r.rows.map((x) => x.artists)).toEqual([[A], [A, B].sort((x, y) => x.pseudonym.localeCompare(y.pseudonym)), [A]]);
    expect(r.tracks.map((x) => [x.isrc, x.months, x.labelShare, x.amount, x.confirmed, x.waiting, x.currentAmount])).toEqual([
      [T1, 2, '55', '26.25', '25', '1.25', '27.5'],
      [T2, 1, '0', '0', '0', '0', '0'],
    ]);
    expect(r.artists.map((x) => [x.artists.map((y) => y.pseudonym), x.tracks, x.isrcs, x.amount])).toEqual([
      [['Report Artist'], 1, [T1], '26.25'],
      [['Report Artist', 'Second Artist'], 1, [T2], '0'],
    ]);
    // a period
    expect((await f.sublabelReport(sub, { from: '2026-08', to: '2026-08' })).rows.map((x) => x.month)).toEqual(['2026-08']);
    // the csv of the same rows
    const csv = await f.sublabelReportCsv(sub, { from: '2026-07', to: '2026-07' });
    expect(csv.fileName).toBe('sublabel_Sub R_2026-07_2026-07.csv');
    expect(csv.text.split('\r\n').slice(0, 2)).toEqual([
      '﻿"month";"isrc";"title";"artists";"label_share";"percent";"amount";"status";"reason"',
      `"2026-07";"${T1}";"Song 1";"Report Artist";"50";"50";"25";"confirmed";""`,
    ]);
    await expect(f.sublabelReport('nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('hints the tracks under the sublabel string without a term in force, never the covered ones', async () => {
    const { f, sub, appendix } = await world();
    expect(await f.sublabelSuggestions('2026-07')).toEqual({
      month: '2026-07',
      groups: [
        {
          sublabelId: sub,
          sublabelName: 'Sub R',
          net: '140',
          items: [
            { isrc: T1, title: 'Song 1', labelString: 'Sub R Records', net: '100' },
            { isrc: T2, title: 'Song 2', labelString: 'Sub R Records', net: '40' },
          ],
        },
      ],
    });
    await f.addSublabelTerms(sub, { percent: '50', validFrom: '2026-07', documentId: appendix, items: [{ isrc: T1 }] }, { dryRun: false }, 'tester');
    expect((await f.sublabelSuggestions('2026-07')).groups[0]?.items.map((x) => x.isrc)).toEqual([T2]);
    expect(await f.sublabelSuggestions('2026-06')).toEqual({ month: '2026-06', groups: [] });
  });
});
