import type { ArtistRef } from '@erp/shared/api-responses';
import type { OwnersService, TrackView } from '../modules/owners';

/**
 * The pseudonyms of the registry on an ISRC (D-166): the pseudonyms of its split rows and participations (any
 * period) and the registry links of its tracks (`owners.artist_tracks`). Merged ids resolve to the survivor through
 * the artist index (D-131), so a pseudonym appears once, by its surviving id. The artist string of a report pair
 * is text and is not matched here: a pseudonym is a record of the registry or nothing (R1, the backend decides).
 *
 * Pure: the reads happen beside the calculation of the caller (inside its snapshot where there is one).
 */
export type ArtistIndex = Map<string, { id: string; pseudonym: string }>;

export interface TrackArtistsInput {
  tracks: readonly TrackView[];
  links: readonly { artistId: string; trackId: string }[];
  splits: readonly { isrc: string; shares: readonly { artistId: string }[] }[];
  participations: readonly { isrc: string; artistId: string }[];
  index: ArtistIndex;
}

const byPseudonym = (a: ArtistRef, b: ArtistRef) => a.pseudonym.localeCompare(b.pseudonym) || a.id.localeCompare(b.id);

/** ISRC → its pseudonyms, sorted by pseudonym then id. An ISRC with none is absent. */
export function artistsByIsrc(input: TrackArtistsInput): Map<string, ArtistRef[]> {
  const found = new Map<string, Map<string, ArtistRef>>();
  const add = (isrc: string, artistId: string) => {
    const a = input.index.get(artistId);
    const ref: ArtistRef = a ? { id: a.id, pseudonym: a.pseudonym } : { id: artistId, pseudonym: '?' };
    const m = found.get(isrc) ?? found.set(isrc, new Map()).get(isrc)!;
    if (!m.has(ref.id)) m.set(ref.id, ref);
  };
  const isrcOfTrack = new Map(input.tracks.filter((t) => t.isrc).map((t) => [t.id, t.isrc as string]));
  for (const l of input.links) {
    const isrc = isrcOfTrack.get(l.trackId);
    if (isrc) add(isrc, l.artistId);
  }
  for (const s of input.splits) for (const sh of s.shares) add(s.isrc, sh.artistId);
  for (const p of input.participations) add(p.isrc, p.artistId);
  return new Map([...found].map(([isrc, m]) => [isrc, [...m.values()].sort(byPseudonym)]));
}

/** The union of the pseudonyms of several ISRCs, sorted by pseudonym then id. */
export function unionArtists(byIsrc: Map<string, ArtistRef[]>, isrcs: Iterable<string>): ArtistRef[] {
  const m = new Map<string, ArtistRef>();
  for (const isrc of isrcs) for (const a of byIsrc.get(isrc) ?? []) m.set(a.id, a);
  return [...m.values()].sort(byPseudonym);
}

/** The registry reads `artistsByIsrc` needs beside the tracks: the links of those tracks and the artist index. */
export async function readArtistLinks(owners: OwnersService, tracks: readonly TrackView[], all = false) {
  const [links, index] = await Promise.all([
    owners.artistLinks(all ? {} : { trackIds: tracks.map((t) => t.id) }),
    owners.artistIndex(),
  ]);
  return { links, index: index as ArtistIndex };
}
