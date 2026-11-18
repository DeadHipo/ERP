import type { z } from 'zod';
import type * as R from '@erp/shared/api-responses';
import { isrcKey } from '../lib/isrc';
import { tracks } from './client';

// The batch loader of the track directory (D-250), no React. Every `load(isrc)` of one frame (the cells of every
// table of a page) lands in one queue; a `setTimeout(0)` later the queue goes out as `POST /tracks/query`, 1 000 ISRCs
// a request (the limit of the body), and each caller gets its own track with the releases and pseudonyms it names.
// What is fresh in the query cache never reaches the loader (`api/queries/tracks.ts`), so only the missing ISRCs travel.
//
// The server answers 400 for the whole request when one string is not an ISRC, and keys its answer by the normalised
// ISRC. So only the strings it will take travel, as their normalised keys (`lib/isrc.ts`, each key once); the answer is
// found by that key and handed back under the string that was asked. A string that is not an ISRC gets the empty entry
// at once, without a request.

/** The most ISRCs of one `POST /tracks/query` (`tracksQueryBody`). */
export const TRACKS_BATCH = 1000;

/** One ISRC of an answer (by its normalised key): its track (null = the directory does not know it) and the records of the two maps it names. */
function entryOf(res: z.output<typeof R.tracksQueryResponseSchema>, key: string) {
  const track = res.tracks[key] ?? null;
  const releases: Record<string, R.ReleaseView> = {};
  const artists: Record<string, R.ArtistView> = {};
  for (const upc of track?.upcs ?? []) {
    const release = res.releases[upc];
    if (release) releases[upc] = release;
  }
  for (const artistId of track?.artists ?? []) {
    const artist = res.artists[artistId];
    if (artist) artists[artistId] = artist;
  }
  return { track, releases, artists };
}

/** The entry of a string the directory cannot know: not an ISRC, or an ISRC it has no track for. */
const noTrack = (): ReturnType<typeof entryOf> => ({ track: null, releases: {}, artists: {} });

export function createTracksLoader(query: (isrcs: readonly string[]) => Promise<z.output<typeof R.tracksQueryResponseSchema>> = tracks.query) {
  // the queue of the frame by the string asked: one promise per string, so a repeat of the frame joins the first ask
  let queue = new Map<string, { key: string; promise: Promise<ReturnType<typeof entryOf>>; resolve: (entry: ReturnType<typeof entryOf>) => void; reject: (error: unknown) => void }>();
  let scheduled = false;

  function flush(): void {
    const batch = [...queue.values()];
    queue = new Map();
    scheduled = false;
    // two strings of one ISRC («qz-…» and «QZ…») travel as one key
    const keys = [...new Set(batch.map((w) => w.key))];
    for (let from = 0; from < keys.length; from += TRACKS_BATCH) {
      const chunk = new Set(keys.slice(from, from + TRACKS_BATCH));
      const waiting = batch.filter((w) => chunk.has(w.key));
      // a failed request fails only the asks of its own chunk; so does an exception while the answer is handed out
      // (a settled promise ignores the reject), so no ask is left pending for ever
      const fail = (error: unknown) => {
        for (const w of waiting) w.reject(error);
      };
      query([...chunk]).then((res) => {
        try {
          for (const w of waiting) w.resolve(entryOf(res, w.key));
        } catch (error) {
          fail(error);
        }
      }, fail);
    }
  }

  return {
    /** The track of the ISRC with its releases and pseudonyms; asked together with every other `load()` of the frame. */
    load(isrc: string): Promise<ReturnType<typeof entryOf>> {
      const key = isrcKey(isrc);
      if (key === null) return Promise.resolve(noTrack());
      const waiting = queue.get(isrc);
      if (waiting) return waiting.promise;
      let resolve!: (entry: ReturnType<typeof entryOf>) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<ReturnType<typeof entryOf>>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      queue.set(isrc, { key, promise, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
      return promise;
    },
  };
}

/** The loader of the app: one queue for every page. */
export const tracksLoader = createTracksLoader();
