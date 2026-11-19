import { describe, expect, it } from 'vitest';
import { ACC2, Case, I, UPC } from './helpers/golden-case';
import { labelsViewer } from '../src/facade/viewer';

// The metadata of a recording (D-238): one row per ISRC (no history) and the platform entries (1 : N). Navigation, not
// money: the calculation never reads it (`boundaries.test.ts`). Synthetic data only.

const forbidden = { statusCode: 403, code: 'label_forbidden' };

async function world() {
  const c = await Case.start();
  const f = c.f;
  await c.person('PA', 'PB');
  for (const n of [1, 2]) await c.track(I(n));
  await c.split(I(1), [['PA', '50']]);
  await c.split(I(2), [['PB', '50']]);
  await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
  await c.load('2026-03', [{ isrc: I(2), net: '100', label: 'Echo8' }], ACC2);
  return { c, f, vA: labelsViewer([f.testLabels['0to8']]) };
}

describe('the metadata of a recording (D-238)', () => {
  it('sets the fields sent, keeps the others, clears a field sent as null; no history', async () => {
    const { f } = await world();
    expect(await f.trackMeta(I(1))).toEqual({ isrc: I(1), meta: null, platforms: [] });
    const first = await f.setTrackMeta(I(1), { title: 'Song - Slowed', version: 'Slowed', durationMs: 154000, explicit: false, coverUrl: 'https://example.com/a.jpg', primaryPlatform: 'spotify' }, 'op1');
    expect([first.title, first.version, first.durationMs, first.explicit, first.coverUrl, first.updatedBy]).toEqual(['Song - Slowed', 'Slowed', 154000, false, 'https://example.com/a.jpg', 'op1']);
    const second = await f.setTrackMeta(I(1), { artists: 'A, B', version: null, releaseDate: '2026-07-22' }, 'op2');
    expect([second.title, second.version, second.artists, second.releaseDate, second.durationMs, second.updatedBy]).toEqual(['Song - Slowed', null, 'A, B', '2026-07-22', 154000, 'op2']);
    expect((await f.trackMeta(I(1))).meta).toEqual(second);
  });

  it('refuses a bad ISRC, duration, link, date or platform', async () => {
    const { f } = await world();
    await expect(f.setTrackMeta('nope', { title: 'x' }, 'op')).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.setTrackMeta(I(1), { durationMs: 0 }, 'op')).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.setTrackMeta(I(1), { coverUrl: 'ftp://x' }, 'op')).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.setTrackMeta(I(1), { releaseDate: '22.07.2026' }, 'op')).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.setTrackMeta(I(1), { primaryPlatform: 'myspace' }, 'op')).rejects.toMatchObject({ code: 'unknown_platform' });
    await expect(f.addTrackPlatform(I(1), { platform: 'myspace' }, 'op')).rejects.toMatchObject({ code: 'unknown_platform' });
  });

  it('platform entries: added, the same entry twice is 409, changed, removed', async () => {
    const { f } = await world();
    const sp = await f.addTrackPlatform(I(1), { platform: 'spotify', platformId: 'sp1', url: 'https://open.spotify.com/track/sp1', durationMs: 154000 }, 'op');
    expect([sp.platform, sp.status, sp.source, sp.isrc]).toEqual(['spotify', 'found', 'manual', I(1)]);
    await expect(f.addTrackPlatform(I(1), { platform: 'spotify', platformId: 'sp1' }, 'op')).rejects.toMatchObject({ statusCode: 409, code: 'platform_taken' });
    // another id on the same platform (a second upload) and a lookup that found nothing are entries of their own
    await f.addTrackPlatform(I(1), { platform: 'spotify', platformId: 'sp2' }, 'op');
    await f.addTrackPlatform(I(1), { platform: 'apple_music', status: 'not_found', source: 'isrc-lookup', raw: { tried: true } }, 'op');
    expect((await f.trackMeta(I(1))).platforms.map((p) => [p.platform, p.platformId, p.status])).toEqual([
      ['apple_music', null, 'not_found'],
      ['spotify', 'sp1', 'found'],
      ['spotify', 'sp2', 'found'],
    ]);
    const changed = await f.updateTrackPlatform(sp.id, { title: 'Song - Slowed', url: null }, 'op2');
    expect([changed.title, changed.url, changed.durationMs, changed.updatedBy]).toEqual(['Song - Slowed', null, 154000, 'op2']);
    await f.removeTrackPlatform(sp.id);
    expect((await f.trackMeta(I(1))).platforms).toHaveLength(2);
    await expect(f.removeTrackPlatform(sp.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('a viewer of a label writes only an ISRC of its files or of no file (D-171)', async () => {
    const { f, vA } = await world();
    expect((await f.setTrackMeta(I(1), { title: 'mine' }, 'm', vA)).title).toBe('mine');
    await expect(f.setTrackMeta(I(2), { title: 'theirs' }, 'm', vA)).rejects.toMatchObject(forbidden);
    await expect(f.addTrackPlatform(I(2), { platform: 'spotify' }, 'm', vA)).rejects.toMatchObject(forbidden);
    const other = await f.addTrackPlatform(I(2), { platform: 'spotify' }, 'admin');
    await expect(f.updateTrackPlatform(other.id, { title: 'x' }, 'm', vA)).rejects.toMatchObject(forbidden);
    await expect(f.removeTrackPlatform(other.id, vA)).rejects.toMatchObject(forbidden);
    // an ISRC in no loaded file is a new track: allowed
    expect((await f.setTrackMeta(I(9), { title: 'new' }, 'm', vA)).title).toBe('new');
  });
});

describe('the track meta comes only from the track directory (D-256)', () => {
  it('the cards and the lists name the ISRC and carry no meta; the cover of the release and the lists of P5 stay', async () => {
    const { c, f } = await world();
    await c.part(I(1), 'PB', '10', 'net', 'top');
    const cover = 'https://example.com/a.jpg';
    await f.setTrackMeta(I(1), { title: 'Song - Slowed', version: 'Slowed', coverUrl: cover }, 'op');
    const artistId = c.id('PA');
    const artist = await f.artistDetail(artistId);
    const release = await f.release(UPC);
    // a sublabel with a term on I(1): the term teaches the string, so I(3) of April (the same string, no term) is a hint
    const sub = await f.createSublabel('Sub T44');
    await c.load('2026-04', [{ isrc: I(3), net: '10' }]);
    await f.addSublabelTerms(sub.id, { percent: '50', validFrom: '2026-03', items: [{ isrc: I(1) }] }, { dryRun: false }, 'op');
    await f.setTrackMeta(I(3), { title: 'Hint - Live', version: 'Live', coverUrl: cover }, 'op');
    const splitList = await f.listSplits({ isrc: I(1) });
    const partList = await f.listParticipations({ isrc: I(1) });
    const terms = await f.listSublabelTerms({ sublabel: sub.id });
    const report = await f.sublabelReport(sub.id);
    const suggestions = await f.sublabelSuggestions();
    const money = await f.trackMoney(I(1));
    const uses = await f.documentUses(c.appendix);
    // every answer has a row of a track with a meta: the check below is not an empty one
    expect(splitList.items.map((x) => x.isrc)).toEqual([I(1)]);
    expect(partList.items.map((x) => x.isrc)).toEqual([I(1)]);
    expect(terms.map((x) => x.isrc)).toEqual([I(1)]);
    expect(report.rows.map((x) => x.isrc)).toEqual([I(1)]);
    expect(report.tracks.map((x) => x.isrc)).toEqual([I(1)]);
    expect(suggestions.groups.flatMap((g) => g.items.map((x) => x.isrc))).toEqual([I(3)]);
    expect([money.splits.length, money.participations.length]).toEqual([1, 1]);
    expect(uses.splits.map((x) => x.isrc)).toContain(I(1));
    expect(uses.participations.map((x) => x.isrc)).toContain(I(1));
    expect(artist.splits.map((x) => x.isrc)).toEqual([I(1)]);
    const answers: unknown[] = [release, artist, await f.ownerDetail(artist.owner?.id ?? ''), splitList, partList, terms, report, suggestions, money, uses];
    // no key `meta` or `trackMeta` anywhere in these answers
    const keys = (x: unknown): string[] =>
      Array.isArray(x) ? x.flatMap(keys) : x !== null && typeof x === 'object' ? Object.entries(x).flatMap(([k, v]) => [k, ...keys(v)]) : [];
    for (const a of answers) expect(keys(a).filter((k) => k === 'meta' || k === 'trackMeta')).toEqual([]);
    expect(JSON.stringify(answers)).not.toContain('Song - Slowed');
    // the cover of the release is still the cover of its first track that has one (D-240)
    expect(release.coverUrl).toBe(cover);
    expect(release.tracks.map((t) => t.isrc)).toContain(I(1));
    // P5 searches by the title of the meta: its two lists keep it (D-242)
    const lite = { isrc: I(1), title: 'Song - Slowed', version: 'Slowed', coverUrl: cover };
    expect((await f.trackCatalog()).items.find((x) => x.isrc === I(1))?.meta).toEqual(lite);
    expect((await f.trackSummary()).items.find((x) => x.isrc === I(1))?.meta).toEqual(lite);
    // and the directory gives the whole meta
    expect((await f.tracksOf([I(1)])).tracks[I(1)]?.meta).toMatchObject({ title: 'Song - Slowed', baseTitle: 'Song', version: 'Slowed', coverUrl: cover });
  });
});
