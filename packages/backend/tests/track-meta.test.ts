import { describe, expect, it } from 'vitest';
import { ACC2, Case, I } from './helpers/golden-case';
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
