import { describe, expect, it } from 'vitest';
import { ACC1, ACC2, Case, I } from './helpers/golden-case';
import { writeBelieve } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';
import { ALL_VIEWER, labelsViewer } from '../src/facade/viewer';

// The track directory of the facade (D-245): `tracksOf(isrcs, viewer)` gives three maps (tracks, releases,
// pseudonyms). The catalog side of an ISRC is the organization's; the report side, the UPCs and the pseudonyms follow
// the ISRC rule of the viewer (D-171). Synthetic data only.

const U1 = '1000000000001'; // the release of I(1) and I(2), label A; a registry row under A and under B
const U2 = '1000000000002'; // the release of I(3), label B
const U4 = '1000000000004'; // the release of I(6), label A; a registry row only under B
const U5A = '1000000000005'; // I(5): the first track row (empty title)
const U5B = '1000000000006'; // I(5): the second track row
const U7 = '1000000000007'; // I(7): the second pair of the reports
const U8 = '1000000000008'; // I(8): known only by a pair of the files of label B
const U9 = '1000000000009'; // I(10), I(11): one release without a registry row; the pair of I(10) has no release title
const U12A = '1000000000012'; // I(12) in the file of A
const U12B = '1000000000013'; // I(12) in the file of B

const release = (upc: string, releaseTitle: string, extra: Partial<{ version: string; releasedAt: string; trackCount: number }> = {}) => ({
  upc,
  releaseTitle,
  version: extra.version ?? null,
  artistString: null,
  labelString: null,
  releasedAt: extra.releasedAt ?? null,
  trackCount: extra.trackCount ?? null,
  catalogNumber: null,
  territories: null,
  stores: null,
});

/**
 * Label A = 0to8 (account 1): I(1), I(2) on the release U1 (PA has a row on both, QA a participation on I(1)), I(6) on
 * U4, I(7) on two releases. Label B = Echo8 (account 2): I(3) on U2 with PB. I(4) has only a meta, I(5) only two track
 * rows, I(9) nothing.
 */
async function world() {
  const c = await Case.start();
  const f = c.f;
  const A = f.testLabels['0to8'];
  const B = f.testLabels.Echo8;
  const o = f.modules.owners;
  await c.person('PA', 'QA', 'PB');
  await o.createTrack({ title: 'Catalog one', isrc: I(1), upc: U1 });
  await o.createTrack({ title: 'Catalog two', isrc: I(2), upc: U1 });
  await o.createTrack({ title: 'Catalog three', isrc: I(3), upc: U2 });
  const empty = await o.createTrack({ title: 'to be emptied', isrc: I(5), upc: U5A });
  await o.createTrack({ title: 'Second row', isrc: I(5), upc: U5B });
  await (await testStack()).pg.pool.query(`UPDATE owners.tracks SET title = '' WHERE id = $1`, [empty.id]);
  await c.split(I(1), [['PA', '50']]);
  await c.part(I(1), 'QA', '10', 'bucket', 'label_share');
  await c.split(I(2), [['PA', '40']]);
  await c.split(I(3), [['PB', '50']]);
  await f.ingestBelieve(
    writeBelieve(
      '2026-03',
      [
        { isrc: I(1), upc: U1, net: '100', trackTitle: 'Report one' },
        { isrc: I(2), upc: U1, net: '100', trackTitle: '' },
        { isrc: I(6), upc: U4, net: '100', trackTitle: 'Report six' },
        { isrc: I(7), upc: U7, net: '100', trackTitle: 'Report seven, later key' },
        { isrc: I(7), upc: U1, net: '100', trackTitle: 'Report seven, first key' },
        { isrc: I(10), upc: U9, net: '100', releaseTitle: '' },
        { isrc: I(11), upc: U9, net: '100', releaseTitle: 'Release nine' },
        { isrc: I(12), upc: U12A, net: '100', releaseTitle: 'Release twelve of A' },
      ],
      { account: ACC1 },
    ),
    A,
  );
  await f.ingestBelieve(
    writeBelieve(
      '2026-03',
      [
        { isrc: I(3), upc: U2, net: '100', trackTitle: 'Report three', labelName: 'Echo8' },
        { isrc: I(8), upc: U8, net: '100', trackTitle: 'Report eight', labelName: 'Echo8' }, // only a pair of B's files
        { isrc: I(12), upc: U12B, net: '100', releaseTitle: 'Release twelve of B', labelName: 'Echo8' },
      ],
      { account: ACC2 },
    ),
    B,
  );
  await f.setTrackMeta(I(1), { title: 'Song - Slowed', version: 'Slowed', artists: 'A, B', durationMs: 154000, explicit: false, releaseDate: '2026-07-22', coverUrl: 'https://example.com/a.jpg', primaryPlatform: 'spotify' }, 'op1');
  await f.setTrackMeta(I(3), { title: 'Meta three' }, 'op1');
  await f.setTrackMeta(I(4), { title: 'Only a meta' }, 'op1');
  await f.setTrackLabel(I(1), { labelId: A, from: '2026-01-01' });
  await f.setTrackLabel(I(3), { labelId: B, from: '2026-01-01' });
  await f.setTrackLabel(I(4), { labelId: A, from: '2026-01-01', to: '2026-02-01' }); // a closed interval: no catalog label
  await o.releases.upsert(A, [release(U1, 'Registry U1 of A', { version: 'Deluxe', releasedAt: '2026-02-03T10:00:00', trackCount: 2 })]);
  await new Promise((r) => setTimeout(r, 15));
  await o.releases.upsert(B, [release(U1, 'Registry U1 of B', { trackCount: 9 }), release(U4, 'Registry U4 of B'), release(U2, 'Registry U2 of B')]);
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(I);
  return { c, f, A, B, all, vA: labelsViewer([A]), vB: labelsViewer([B]) };
}

describe('the track directory of the facade (D-245)', () => {
  it('every label: the titles as they are, the meta with the base title, the catalog label, the UPCs and the pseudonyms', async () => {
    const { c, f, A, all } = await world();
    const r = await f.tracksOf(all);
    expect(Object.keys(r.tracks)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(I)); // an unknown ISRC is absent
    expect(r.tracks[I(1)]).toEqual({
      isrc: I(1),
      catalogTitle: 'Catalog one',
      reportTitle: 'Report one',
      meta: {
        title: 'Song - Slowed',
        baseTitle: 'Song',
        version: 'Slowed',
        artists: 'A, B',
        durationMs: 154000,
        explicit: false,
        releaseDate: '2026-07-22',
        coverUrl: 'https://example.com/a.jpg',
        primaryPlatform: 'spotify',
      },
      catalogLabel: { id: A, name: '0to8' },
      upcs: [U1],
      artists: [c.id('PA'), c.id('QA')], // by pseudonym, then id (`artistsByIsrc`)
    });
    // an empty report title is null (D-243); no meta is null
    expect(r.tracks[I(2)]).toEqual({ isrc: I(2), catalogTitle: 'Catalog two', reportTitle: null, meta: null, catalogLabel: null, upcs: [U1], artists: [c.id('PA')] });
    // only a meta (and a closed label interval, which is no catalog label): present, nothing else
    expect(r.tracks[I(4)]).toMatchObject({ catalogTitle: null, reportTitle: null, catalogLabel: null, upcs: [], artists: [] });
    expect(r.tracks[I(4)]?.meta).toMatchObject({ title: 'Only a meta', baseTitle: 'Only a meta', version: null });
    // only report pairs: no catalog title; the report title is that of the first pair in key order (ISRC|UPC)
    expect(r.tracks[I(6)]).toEqual({ isrc: I(6), catalogTitle: null, reportTitle: 'Report six', meta: null, catalogLabel: null, upcs: [U4], artists: [] });
    expect(r.tracks[I(7)]).toMatchObject({ reportTitle: 'Report seven, first key', upcs: [U1, U7] });
    // the answer is the schema's shape: no `updatedBy` of the meta
    expect(JSON.stringify(r)).not.toMatch(/updatedBy|updatedAt|op1/);
  });

  it('catalogTitle is the first non-empty title of the track rows in the order (upc, id)', async () => {
    const { f } = await world();
    const r = await f.tracksOf([I(5)]);
    expect(r.tracks[I(5)]).toMatchObject({ catalogTitle: 'Second row', upcs: [U5A, U5B] });
    // GET /tracks/catalog keeps its own rule (the first row as the module read it, an empty one not skipped), so its
    // `title` may differ from `catalogTitle`; that read has no order, so the catalog row's title is not asserted here
    // a release only of the track rows: no registry row and no report pair
    expect(r.releases).toEqual({
      [U5A]: { upc: U5A, title: null, version: null, releaseDate: null, labelName: null, trackCount: null },
      [U5B]: { upc: U5B, title: null, version: null, releaseDate: null, labelName: null, trackCount: null },
    });
  });

  it('a release of two tracks is in `releases` once and a pseudonym of two tracks in `artists` once; only what a track names', async () => {
    const { c, f } = await world();
    const r = await f.tracksOf([I(1), I(2), I(1)]);
    expect(Object.keys(r.tracks)).toEqual([I(1), I(2)]);
    // every label: the last updated registry row of the UPC (label B's)
    expect(r.releases).toEqual({ [U1]: { upc: U1, title: 'Registry U1 of B', version: null, releaseDate: null, labelName: 'Echo8', trackCount: 9 } });
    expect(r.artists).toEqual({
      [c.id('PA')]: { id: c.id('PA'), pseudonym: 'PA', ownerId: c.owners.get('PA') },
      [c.id('QA')]: { id: c.id('QA'), pseudonym: 'QA', ownerId: c.owners.get('QA') },
    });
    // the owner of a pseudonym is the one GET /splits gives
    const row = (await f.listSplits({ isrc: I(2) })).items[0] as { shares: { artistId: string; ownerId: string | null }[] };
    expect(row.shares.map((s) => [s.artistId, s.ownerId])).toEqual([[c.id('PA'), r.artists[c.id('PA')]?.ownerId]]);
    // only I(2): QA and nothing of the other tracks
    const one = await f.tracksOf([I(2)]);
    expect(Object.keys(one.artists)).toEqual([c.id('PA')]);
    expect(Object.keys(one.releases)).toEqual([U1]);
  });

  it('a viewer of label A: the registry row of A, never the row of B of the same UPC; without a visible row the title of the reports', async () => {
    const { f, vA, all } = await world();
    const r = await f.tracksOf(all, vA);
    expect(r.releases[U1]).toEqual({ upc: U1, title: 'Registry U1 of A', version: 'Deluxe', releaseDate: '2026-02-03T10:00:00', labelName: '0to8', trackCount: 2 });
    // U4 has a registry row only under B: the release title of the report pair, the registry fields null
    expect(r.releases[U4]).toEqual({ upc: U4, title: 'Synthetic Release', version: null, releaseDate: null, labelName: null, trackCount: null });
    expect((await f.tracksOf(all)).releases[U4]).toMatchObject({ title: 'Registry U4 of B', labelName: 'Echo8' });
    expect(JSON.stringify(r)).not.toMatch(/Registry U\d of B/);
  });

  it('a viewer of label A on an ISRC of another book: the catalog side only; its UPCs and pseudonyms reach no map', async () => {
    const { c, f, B, vA, vB, all } = await world();
    const r = await f.tracksOf(all, vA);
    expect(r.tracks[I(3)]).toEqual({
      isrc: I(3),
      catalogTitle: 'Catalog three',
      reportTitle: null,
      meta: { title: 'Meta three', baseTitle: 'Meta three', version: null, artists: null, durationMs: null, explicit: null, releaseDate: null, coverUrl: null, primaryPlatform: null },
      catalogLabel: { id: B, name: 'Echo8' },
      upcs: null,
      artists: null,
    });
    expect(Object.keys(r.releases)).not.toContain(U2);
    expect(Object.keys(r.artists).sort()).toEqual([c.id('PA'), c.id('QA')].sort());
    // the own ISRCs and those in no file (I(4), I(5)) answer as for every label, but for the registry rows
    const full = await f.tracksOf(all);
    for (const n of [1, 2, 4, 5, 6, 7]) expect(r.tracks[I(n)]).toEqual(full.tracks[I(n)]);
    // the viewer of B: the mirror
    const b = await f.tracksOf(all, vB);
    expect(b.tracks[I(3)]).toEqual(full.tracks[I(3)]);
    expect(b.tracks[I(1)]).toMatchObject({ catalogTitle: 'Catalog one', reportTitle: null, upcs: null, artists: null });
    expect(b.tracks[I(1)]?.meta).toEqual(full.tracks[I(1)]?.meta);
    expect(Object.keys(b.artists)).toEqual([c.id('PB')]);
    expect(b.releases[U2]).toMatchObject({ title: 'Registry U2 of B', labelName: 'Echo8' });
    // ALL_VIEWER is the default
    expect(JSON.stringify(await f.tracksOf(all, ALL_VIEWER))).toBe(JSON.stringify(full));
  });

  it('an ISRC known only by a pair of another book is absent for the viewer of label A, as an unknown one; present for every label', async () => {
    const { f, vA, vB, all } = await world();
    const full = await f.tracksOf(all);
    expect(full.tracks[I(8)]).toEqual({ isrc: I(8), catalogTitle: null, reportTitle: 'Report eight', meta: null, catalogLabel: null, upcs: [U8], artists: [] });
    expect(full.releases[U8]).toEqual({ upc: U8, title: 'Synthetic Release', version: null, releaseDate: null, labelName: null, trackCount: null });
    const a = await f.tracksOf(all, vA);
    expect(Object.keys(a.tracks)).toEqual([1, 2, 3, 4, 5, 6, 7].map(I)); // I(3) stays: it has a track row, a meta, an interval
    expect(Object.keys(a.releases)).not.toContain(U8);
    expect(await f.tracksOf([I(8)], vA)).toEqual({ tracks: {}, releases: {}, artists: {} });
    // the viewer of B, whose file holds the pair, gets it as every label does
    expect((await f.tracksOf([I(8)], vB)).tracks[I(8)]).toEqual(full.tracks[I(8)]);
  });

  it('the fallback title of a release comes only from the pairs of the files of the viewer (an ISRC in the files of A and of B)', async () => {
    const { f, A, B, vA, vB } = await world();
    const none = { version: null, releaseDate: null, labelName: null, trackCount: null };
    const full = await f.tracksOf([I(12)]);
    expect(full.tracks[I(12)]?.upcs).toEqual([U12A, U12B]);
    expect(full.releases).toEqual({
      [U12A]: { upc: U12A, title: 'Release twelve of A', ...none },
      [U12B]: { upc: U12B, title: 'Release twelve of B', ...none },
    });
    // the viewer of A may touch the ISRC (it is in its files) and gets its UPCs as the catalog does, but the release
    // of the file of B carries nothing of B's report
    const a = await f.tracksOf([I(12)], vA);
    expect(a.tracks[I(12)]).toEqual(full.tracks[I(12)]);
    expect(a.releases).toEqual({
      [U12A]: { upc: U12A, title: 'Release twelve of A', ...none },
      [U12B]: { upc: U12B, title: null, ...none },
    });
    expect((await f.tracksOf([I(12)], vB)).releases).toEqual({
      [U12A]: { upc: U12A, title: null, ...none },
      [U12B]: { upc: U12B, title: 'Release twelve of B', ...none },
    });
    // both labels: both titles
    expect((await f.tracksOf([I(12)], labelsViewer([A, B]))).releases).toEqual(full.releases);
  });

  it('a release of two tracks without a registry row: an empty release title of the first pair is filled from the next track', async () => {
    const { f, vA } = await world();
    const expected = { [U9]: { upc: U9, title: 'Release nine', version: null, releaseDate: null, labelName: null, trackCount: null } };
    expect((await f.tracksOf([I(10), I(11)])).releases).toEqual(expected);
    expect((await f.tracksOf([I(10), I(11)], vA)).releases).toEqual(expected);
    expect((await f.tracksOf([I(10)])).releases[U9]?.title).toBeNull();
  });

  it('a viewer of both labels gets the last updated registry row of a UPC; equal times: the smaller label id', async () => {
    const { f, A, B } = await world();
    const both = labelsViewer([A, B]);
    expect((await f.tracksOf([I(1)], both)).releases[U1]).toMatchObject({ title: 'Registry U1 of B', labelName: 'Echo8' });
    await (await testStack()).pg.pool.query(
      `UPDATE owners.releases SET updated_at = (SELECT max(updated_at) FROM owners.releases WHERE upc = $1) WHERE upc = $1`,
      [U1],
    );
    const first = A < B ? { title: 'Registry U1 of A', labelName: '0to8' } : { title: 'Registry U1 of B', labelName: 'Echo8' };
    expect((await f.tracksOf([I(1)], both)).releases[U1]).toMatchObject(first);
    expect((await f.tracksOf([I(1)])).releases[U1]).toMatchObject(first);
  });

  it('the owner of a pseudonym under a viewer of label A is the one listSplits and listParticipations give that viewer', async () => {
    const { c, f, vA } = await world();
    const r = await f.tracksOf([I(1)], vA);
    const rows = (await f.listSplits({ isrc: I(1) }, vA)).items as { shares: { artistId: string; ownerId: string | null }[] }[];
    const parts = (await f.listParticipations({ isrc: I(1) }, vA)).items;
    const given = new Map<string, string | null>([
      ...rows.flatMap((s) => s.shares.map((x) => [x.artistId, x.ownerId] as [string, string | null])),
      ...parts.map((p) => [p.artistId, p.ownerId] as [string, string | null]),
    ]);
    expect([...given.keys()].sort()).toEqual([c.id('PA'), c.id('QA')].sort());
    expect(Object.fromEntries(Object.values(r.artists).map((a) => [a.id, a.ownerId]))).toEqual(Object.fromEntries(given));
    expect(r.artists[c.id('QA')]?.ownerId).toBe(c.owners.get('QA'));
  });

  it('an unknown ISRC is absent, an empty list is three empty maps, a malformed ISRC is refused', async () => {
    const { f, vA } = await world();
    expect(await f.tracksOf([I(9)])).toEqual({ tracks: {}, releases: {}, artists: {} });
    expect(await f.tracksOf([I(9)], vA)).toEqual({ tracks: {}, releases: {}, artists: {} });
    expect(await f.tracksOf([])).toEqual({ tracks: {}, releases: {}, artists: {} });
    await expect(f.tracksOf(['nope'])).rejects.toMatchObject({ statusCode: 400 });
  });
});
