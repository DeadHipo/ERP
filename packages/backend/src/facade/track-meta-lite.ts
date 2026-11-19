import type { OwnersService } from '../modules/owners';

/**
 * The metadata of a recording beside an ISRC (D-238, D-242). Since D-256 only the track lists of P5 carry it
 * (`GET /tracks/catalog`, `GET /tracks/summary`: P5 searches by the title); every other answer names the ISRC and
 * the screen reads the track of `POST /tracks/query`.
 */
export interface TrackMetaLite {
  isrc: string;
  title: string | null;
  version: string | null;
  coverUrl: string | null;
}

/**
 * The track meta of some ISRCs as a lookup (one read). Navigation, not money: the calculation never reads it
 * (`tests/boundaries.test.ts`). An ISRC without a meta answers null.
 */
export async function metaLookup(owners: OwnersService, isrcs: Iterable<string>): Promise<(isrc: string | null | undefined) => TrackMetaLite | null> {
  const list = [...new Set([...isrcs].filter(Boolean))];
  const rows = list.length > 0 ? await owners.trackMeta.of(list) : [];
  const by = new Map(rows.map((m) => [m.isrc, { isrc: m.isrc, title: m.title, version: m.version, coverUrl: m.coverUrl }]));
  return (isrc) => (isrc ? (by.get(isrc) ?? null) : null);
}
