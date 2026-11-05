import { normalizeLabelString } from '../modules/labels';
import type { Modules } from './calculation';

/**
 * The reach of an owner (D-163): every ISRC whose units can carry an allocation to one of the owner's pseudonyms, or an
 * advertising position of the owner. `ownerBalance()` reads only the units where the owner has an allocation, so a
 * calculation over a superset of those units gives the very same balance; the reach is such a superset, built from the
 * reference data without a calculation:
 * - the ISRCs of every split row and participation of the owner's pseudonyms (any period);
 * - the ISRCs whose label string maps to a sublabel whose rule (any period) names one of them as recipient (the
 *   carve of the sublabel goes to that pseudonym; the ads borne by the sublabel are looked up by the same strings);
 * - the ISRCs of the advertising records on one of them (a part of the owner recovered or pre-allocated).
 * Merged pseudonyms count by every id they had. The publishing side is not narrowed (the B17 lines are few).
 */
export async function ownerReach(modules: Modules, ownerId: string): Promise<{ artistIds: string[]; isrcs: string[] }> {
  return ownersReach(modules, [ownerId]);
}

/** The reach of several owners at once (the visible rows of P9): the union, read once. */
export async function ownersReach(modules: Modules, ownerIds: readonly string[]): Promise<{ artistIds: string[]; isrcs: string[] }> {
  const wantedOwners = new Set(ownerIds);
  const artistIds = [...(await modules.owners.artistIndex()).entries()]
    .filter(([, a]) => a.ownerId !== null && wantedOwners.has(a.ownerId))
    .map(([id]) => id);
  return reachOf(modules, artistIds);
}

/**
 * The reach of a pseudonym (D-165): the same three sources, for one artist, by every id it had (the ids merged into it
 * count too). The artist row of `ownerBalance()` reads only the units where the pseudonym has an allocation and recoups
 * its positions from its own master income (and the owner's publishing income, read whole), so a calculation over the
 * pseudonym's reach gives the very same row as the full calculation of its owner.
 */
export async function artistReach(modules: Modules, artistId: string): Promise<{ artistIds: string[]; isrcs: string[] }> {
  const idx = await modules.owners.artistIndex();
  const canonical = idx.get(artistId)?.id ?? artistId;
  const ids = [...idx.entries()].filter(([, a]) => a.id === canonical).map(([id]) => id);
  return reachOf(modules, ids.length > 0 ? ids : [artistId]);
}

/**
 * The reach of several pseudonyms at once (the visible rows of P11, D-167): the union over every id each of them had,
 * read once. A merged id stands for its survivor; an unknown id is ignored.
 */
export async function artistsReach(modules: Modules, artistIds: readonly string[]): Promise<{ artistIds: string[]; isrcs: string[] }> {
  const idx = await modules.owners.artistIndex();
  const canonical = new Set(artistIds.map((id) => idx.get(id)?.id ?? id));
  const ids = [...idx.entries()].filter(([, a]) => canonical.has(a.id)).map(([id]) => id);
  return reachOf(modules, ids.length > 0 ? ids : [...canonical]);
}

/** The ISRCs that can carry money to any of the pseudonym ids (every id, merged ones included). */
async function reachOf(modules: Modules, artistIds: readonly string[]): Promise<{ artistIds: string[]; isrcs: string[] }> {
  const { splits, labels, sources, ads } = modules;
  const unique = new Set(artistIds);
  const isrcs = new Set<string>();
  // one read of every split and participation, filtered here: a read per pseudonym would load all splits each time
  for (const s of await splits.listSplits()) if (s.shares.some((sh) => unique.has(sh.artistId))) isrcs.add(s.isrc);
  for (const p of await splits.listParticipations())
    if (unique.has(p.artistId) || (p.fromArtistId !== null && unique.has(p.fromArtistId))) isrcs.add(p.isrc);
  const aliases = (await labels.listLabels())
    .filter((l) => l.rules.some((r) => unique.has(r.recipientArtistId)))
    .flatMap((l) => l.aliases.map(normalizeLabelString));
  for (const isrc of await sources.isrcsOfLabelAliases(aliases, normalizeLabelString)) isrcs.add(isrc);
  if (unique.size > 0)
    for (const ad of await ads.list({ artistIds: [...unique], active: true })) if (ad.isrc) isrcs.add(ad.isrc);
  return { artistIds: [...unique].sort(), isrcs: [...isrcs].sort() };
}
