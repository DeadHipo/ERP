import type { OwnersService } from '../modules/owners';

/** The metadata of a recording beside an ISRC (D-238, D-242): the shape every list carries. */
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
