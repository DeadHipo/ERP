import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackView } from '@erp/shared/api-responses';
import { displayTitle, fallbackTitleOf, isOwnIsrc, trackText } from '../src/lib/track-title';
import { isMoneyKey } from '../src/api/queries/core';
import { trackKeys } from '../src/api/queries/tracks';

// The batch loader of the track directory (D-250): the asks of one frame are one `POST /tracks/query`, a list
// longer than 1 000 goes out in chunks, and every ISRC gets its own track with the map records it names. `fetch` is
// replaced: the loader runs over the real client.

vi.mock('../src/lib/operator', () => ({ getOperator: () => '' }));

const { createTracksLoader, TRACKS_BATCH } = await import('../src/api/tracks-loader');

const isrcOf = (n: number) => `QZTST26${String(n).padStart(5, '0')}`;
const viewOf = (isrc: string, over: Partial<TrackView> = {}): TrackView => ({
  isrc,
  catalogTitle: `Song ${isrc}`,
  reportTitle: null,
  meta: null,
  catalogLabel: null,
  upcs: [`upc-${isrc}`, 'upc-shared'],
  artists: [`artist-${isrc}`, 'artist-shared'],
  ...over,
});

/** The ISRCs the stub does not know (answered without a track). */
const unknown = new Set<string>();
const sent: string[][] = [];
let fail = false;

beforeEach(() => {
  sent.length = 0;
  unknown.clear();
  fail = false;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    expect(url).toBe('/api/v1/tracks/query');
    expect(init.method).toBe('POST');
    const { isrcs } = JSON.parse(init.body as string) as { isrcs: string[] };
    sent.push(isrcs);
    if (fail) return Promise.resolve(new Response(JSON.stringify({ error: { code: 'internal', message: 'boom' } }), { status: 500 }));
    const known = isrcs.filter((i) => !unknown.has(i));
    const body = {
      tracks: Object.fromEntries(known.map((i) => [i, viewOf(i)])),
      releases: Object.fromEntries(
        [...known.map((i) => `upc-${i}`), 'upc-shared'].map((upc) => [upc, { upc, title: `Release ${upc}`, version: null, releaseDate: null, labelName: null, trackCount: null }]),
      ),
      artists: Object.fromEntries([...known.map((i) => `artist-${i}`), 'artist-shared'].map((id) => [id, { id, pseudonym: `Nick ${id}`, ownerId: null }])),
    };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('the tracks loader (D-250)', () => {
  it('three load() of one frame are one request, a repeated ISRC once', async () => {
    const loader = createTracksLoader();
    const [a, b, again] = [loader.load(isrcOf(1)), loader.load(isrcOf(2)), loader.load(isrcOf(1))];
    expect(sent).toHaveLength(0); // nothing goes out before the frame ends
    const entries = await Promise.all([a, b, again]);
    expect(sent).toEqual([[isrcOf(1), isrcOf(2)]]);
    expect(again).toBe(a);
    expect(entries.map((e) => e.track?.isrc)).toEqual([isrcOf(1), isrcOf(2), isrcOf(1)]);
  });

  it('1 500 ISRCs are two requests of at most 1 000', async () => {
    const loader = createTracksLoader();
    const isrcs = Array.from({ length: 1500 }, (_, n) => isrcOf(n));
    const entries = await Promise.all(isrcs.map((i) => loader.load(i)));
    expect(sent.map((s) => s.length)).toEqual([TRACKS_BATCH, 500]);
    expect(sent.flat()).toEqual(isrcs);
    expect(entries.map((e) => e.track?.isrc)).toEqual(isrcs);
  });

  it('every ISRC gets its own track and only the map records its track names', async () => {
    const loader = createTracksLoader();
    unknown.add(isrcOf(3));
    const [one, two, none] = await Promise.all([loader.load(isrcOf(1)), loader.load(isrcOf(2)), loader.load(isrcOf(3))]);
    expect(one.track).toEqual(viewOf(isrcOf(1)));
    expect(Object.keys(one.releases).sort()).toEqual([`upc-${isrcOf(1)}`, 'upc-shared'].sort());
    expect(Object.keys(one.artists).sort()).toEqual([`artist-${isrcOf(1)}`, 'artist-shared'].sort());
    expect(one.artists[`artist-${isrcOf(1)}`]?.pseudonym).toBe(`Nick artist-${isrcOf(1)}`);
    expect(two.track?.isrc).toBe(isrcOf(2));
    expect(Object.keys(two.releases).sort()).toEqual([`upc-${isrcOf(2)}`, 'upc-shared'].sort());
    expect(two.artists).not.toHaveProperty(`artist-${isrcOf(1)}`);
    // an ISRC the directory does not know: a value, never undefined (TanStack v5)
    expect(none).toEqual({ track: null, releases: {}, artists: {} });
  });

  it('a later frame is a new request; a failed request rejects its own asks and the loader goes on', async () => {
    const loader = createTracksLoader();
    await loader.load(isrcOf(1));
    fail = true;
    await expect(loader.load(isrcOf(2))).rejects.toMatchObject({ status: 500 });
    fail = false;
    await expect(loader.load(isrcOf(2))).resolves.toMatchObject({ track: { isrc: isrcOf(2) } });
    expect(sent).toEqual([[isrcOf(1)], [isrcOf(2)], [isrcOf(2)]]);
  });

  it('a string the server would refuse never travels: the null entry at once, the valid ones get their tracks', async () => {
    const loader = createTracksLoader();
    const bad = ['', 'not an isrc', 'QZTST26', `${isrcOf(1)}X`, 'Q'.repeat(40)];
    const [one, two, ...none] = await Promise.all([loader.load(isrcOf(1)), loader.load(isrcOf(2)), ...bad.map((b) => loader.load(b))]);
    expect(sent).toEqual([[isrcOf(1), isrcOf(2)]]);
    expect(one.track?.isrc).toBe(isrcOf(1));
    expect(two.track?.isrc).toBe(isrcOf(2));
    for (const entry of none) expect(entry).toEqual({ track: null, releases: {}, artists: {} });
    // only refused strings: no request at all
    sent.length = 0;
    await expect(loader.load('not an isrc')).resolves.toEqual({ track: null, releases: {}, artists: {} });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sent).toEqual([]);
  });

  it('asks by the normalised key and answers under the string asked; two spellings of one ISRC travel once', async () => {
    const loader = createTracksLoader();
    const spelled = 'qz-tst-26-00001';
    const [a, b] = await Promise.all([loader.load(spelled), loader.load(isrcOf(1))]);
    expect(sent).toEqual([[isrcOf(1)]]);
    expect(a.track?.isrc).toBe(isrcOf(1));
    expect(b.track?.isrc).toBe(isrcOf(1));
  });

  it('an exception while the answer is handed out rejects the asks still waiting: none stays pending', async () => {
    // the second track of the answer throws when it is read
    const loader = createTracksLoader((isrcs) => {
      const tracks = Object.fromEntries(isrcs.map((i) => [i, viewOf(i, { upcs: [], artists: [] })]));
      Object.defineProperty(tracks, isrcOf(2), {
        enumerable: true,
        get: () => {
          throw new Error('broken answer');
        },
      });
      return Promise.resolve({ tracks, releases: {}, artists: {} });
    });
    const settled = await Promise.allSettled([loader.load(isrcOf(1)), loader.load(isrcOf(2)), loader.load(isrcOf(3))]);
    expect(settled.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
    expect((settled[1] as PromiseRejectedResult).reason).toMatchObject({ message: 'broken answer' });
  });

  it('sends no X-Operator: the query is a read (D-246)', async () => {
    const seen: RequestInit[] = [];
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      seen.push(init);
      return inner(url, init);
    });
    await createTracksLoader().load(isrcOf(1));
    expect(seen[0]?.headers).toEqual({ 'Content-Type': 'application/json' });
  });
});

describe('the track view cache key (D-250)', () => {
  it('is not a money key, and sits under [tracks, view]', () => {
    expect(trackKeys.view(isrcOf(1))).toEqual(['tracks', 'view', isrcOf(1)]);
    expect(isMoneyKey(trackKeys.view(isrcOf(1)))).toBe(false);
  });
});

describe('displayTitle (D-250)', () => {
  const meta = { title: 'Song - Slowed', baseTitle: 'Song', version: 'Slowed', artists: null, durationMs: null, explicit: null, releaseDate: null, coverUrl: null, primaryPlatform: null };
  it('takes the base title of the meta, then the catalog title, then the report title', () => {
    expect(displayTitle(viewOf('A', { meta, catalogTitle: 'Catalog', reportTitle: 'Report' }))).toBe('Song');
    expect(displayTitle(viewOf('A', { meta: { ...meta, title: null, baseTitle: null }, catalogTitle: 'Catalog', reportTitle: 'Report' }))).toBe('Catalog');
    expect(displayTitle(viewOf('A', { meta: null, catalogTitle: 'Catalog', reportTitle: 'Report' }))).toBe('Catalog');
    expect(displayTitle(viewOf('A', { meta: null, catalogTitle: null, reportTitle: 'Report' }))).toBe('Report');
  });
  it('is null without any title, and without a track', () => {
    expect(displayTitle(viewOf('A', { meta: null, catalogTitle: null, reportTitle: null }))).toBeNull();
    expect(displayTitle(null)).toBeNull();
    expect(displayTitle(undefined)).toBeNull();
  });
});

describe('trackText (D-254)', () => {
  const meta = { title: 'Song - Slowed', baseTitle: 'Song', version: 'Slowed', artists: null, durationMs: null, explicit: null, releaseDate: null, coverUrl: null, primaryPlatform: null };
  it('is «title · version · ISRC» of the track, the parts a grid sorts and filters by', () => {
    expect(trackText('A', viewOf('A', { meta }))).toBe('Song · Slowed · A');
    expect(trackText('A', viewOf('A', { meta: null, catalogTitle: null, reportTitle: 'Report' }))).toBe('Report · A');
  });
  it('is the ISRC alone until the track arrives, for an unknown track and for a track without a title', () => {
    expect(trackText('A', undefined)).toBe('A');
    expect(trackText('A', null)).toBe('A');
    expect(trackText('A', viewOf('A', { meta: null, catalogTitle: null, reportTitle: null }))).toBe('A');
  });
});

describe('a title equal to the ISRC is no title (D-254)', () => {
  const I = 'QZTST2600001';
  it('the catalog title is the ISRC and nothing else: null', () => {
    expect(displayTitle(viewOf(I, { meta: null, catalogTitle: I, reportTitle: null }))).toBeNull();
    expect(displayTitle(viewOf(I, { meta: null, catalogTitle: ' qz-tst-26-00001 ', reportTitle: I.toLowerCase() }))).toBeNull();
  });
  it('the catalog title is the ISRC, the report title is real: the report title', () => {
    expect(displayTitle(viewOf(I, { meta: null, catalogTitle: I, reportTitle: 'Report' }))).toBe('Report');
  });
  it('another ISRC as a title is a title', () => {
    expect(displayTitle(viewOf(I, { meta: null, catalogTitle: 'QZTST2600002', reportTitle: null }))).toBe('QZTST2600002');
  });
  it('trackText does not repeat the ISRC', () => {
    expect(trackText(I, viewOf(I, { meta: null, catalogTitle: I, reportTitle: null }))).toBe(I);
    expect(trackText(I, viewOf(I, { meta: null, catalogTitle: I, reportTitle: 'Report' }))).toBe(`Report · ${I}`);
  });
});

describe('the fallback title of a row (D-256)', () => {
  const I = 'QZTST2600001';
  it('is shown as it is', () => {
    expect(fallbackTitleOf(I, 'Catalog title')).toBe('Catalog title');
    expect(fallbackTitleOf(I, 'QZTST2600002')).toBe('QZTST2600002');
  });
  it('is no title when it is empty or the ISRC of the row itself (trimmed, dashes, any case)', () => {
    expect(fallbackTitleOf(I, null)).toBeNull();
    expect(fallbackTitleOf(I, undefined)).toBeNull();
    expect(fallbackTitleOf(I, '')).toBeNull();
    expect(fallbackTitleOf(I, I)).toBeNull();
    expect(fallbackTitleOf(I, ' qz-tst-26-00001 ')).toBeNull();
    expect(isOwnIsrc(I, I.toLowerCase())).toBe(true);
    expect(isOwnIsrc(I, 'Song')).toBe(false);
  });
});
