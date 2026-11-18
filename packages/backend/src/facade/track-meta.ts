import { assertIsrc } from '../shared/identifiers';
import type { TrackMetaInput, TrackPlatformInput } from '../modules/owners';
import type { FacadeContext } from './context';
import { ALL_VIEWER, type Viewer } from './viewer';

/**
 * The metadata of a recording (D-238): one row per ISRC (title with its version, artists, duration, cover…) and the
 * entries of the platforms. Navigation, not money: the calculation never reads it (`tests/boundaries.test.ts`). A
 * viewer of some labels writes only an ISRC of its labels' files or in no loaded file (the ISRC rule of D-171).
 */
export function trackMetaApi(ctx: FacadeContext) {
  const { owners, scopeOf } = ctx;
  const meta = owners.trackMeta;

  async function assertWritable(isrc: string, viewer: Viewer) {
    if (viewer.kind !== 'all') await scopeOf(viewer).assertIsrc(isrc);
  }

  return {
    /** The metadata of an ISRC: `meta` (null before the first edit) and its platform entries. */
    async trackMeta(isrcRaw: string) {
      const isrc = assertIsrc(isrcRaw);
      return { isrc, ...(await meta.get(isrc)) };
    },

    async setTrackMeta(isrcRaw: string, input: TrackMetaInput, by: string, viewer: Viewer = ALL_VIEWER) {
      const isrc = assertIsrc(isrcRaw);
      await assertWritable(isrc, viewer);
      return meta.set(isrc, input, by);
    },

    async addTrackPlatform(isrcRaw: string, input: TrackPlatformInput, by: string, viewer: Viewer = ALL_VIEWER) {
      const isrc = assertIsrc(isrcRaw);
      await assertWritable(isrc, viewer);
      return meta.addPlatform(isrc, input, by);
    },

    async updateTrackPlatform(id: string, input: Partial<TrackPlatformInput>, by: string, viewer: Viewer = ALL_VIEWER) {
      await assertWritable((await meta.platform(id)).isrc, viewer);
      return meta.updatePlatform(id, input, by);
    },

    async removeTrackPlatform(id: string, viewer: Viewer = ALL_VIEWER) {
      await assertWritable((await meta.platform(id)).isrc, viewer);
      return meta.removePlatform(id);
    },
  };
}
