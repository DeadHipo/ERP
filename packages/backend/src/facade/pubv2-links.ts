import { ConflictError, NotFoundError } from '../shared/errors';
import { assertIsrc, normalizeName } from '../shared/identifiers';
import type { LinksService } from '../modules/links';
import type { PubV2Service } from '../modules/pubv2';
import type { PublishingService } from '../modules/publishing';
import type { FacadeContext } from './context';

export type RecommendationReason = 'songs' | 'old_map' | 'exact_name' | 'same_words';

/** A title without its version: `Song (Slowed)`, `Song [Live]` and `Song - Artist` are one song. */
export const baseTitle = (title: string): string =>
  normalizeName(title.replace(/[([].*?[)\]]/g, ' ').replace(/\s-\s.*$/, ' '));

/**
 * The links of publishing v2 to owners (D-183). The facade only suggests: the old map of `pub_writers`, then one
 * person-owner with this name or alias, then one with the same words in another order. A link is written only by the
 * operator's confirmation; nothing here is set on its own.
 */
export function pubV2LinksApi(ctx: FacadeContext, m: { pubv2: PubV2Service; links: LinksService; publishing: PublishingService }) {
  const { owners, splits } = ctx;
  // the old module itself (its writer map is a hint), never the source of the money of `ctx`
  const { pubv2, links, publishing } = m;

  async function recommend(
    name: string,
    aliases: string[],
    oldMap: Map<string, string | null>,
    isPerson: (id: string) => boolean,
  ): Promise<{ ownerId: string; reason: RecommendationReason } | null> {
    for (const alias of aliases) {
      const mapped = oldMap.get(normalizeName(alias));
      if (mapped) return { ownerId: await owners.resolveOwnerId(mapped), reason: 'old_map' };
    }
    const exact = (await owners.findOwnersByWriter(name)).filter(isPerson);
    if (exact.length === 1) return { ownerId: exact[0] as string, reason: 'exact_name' };
    if (exact.length > 1) return null;
    const similar = await owners.findSimilarOwners(name);
    const ids = [...new Set(await Promise.all(similar.map((o) => owners.resolveOwnerId(o.id))))].filter(isPerson);
    return ids.length === 1 ? { ownerId: ids[0] as string, reason: 'same_words' } : null;
  }

  const context = async () => {
    const all = await owners.listOwners();
    const byId = new Map(all.map((o) => [o.id, o]));
    return {
      byId,
      isPerson: (id: string) => byId.get(id)?.kind === 'person',
      oldMap: new Map((await publishing.listWriters()).map((w) => [w.writerNorm, w.ownerId])),
    };
  };

  /** The catalog once per read: the ISRCs of a base title and the pseudonyms of the open split of an ISRC. */
  async function catalog() {
    const [tracks, all, artists, resolveOwner] = await Promise.all([
      owners.listTracks(),
      splits.listSplits(),
      owners.artistIndex(),
      owners.ownerResolver(),
    ]);
    const byTitle = new Map<string, Map<string, string>>();
    const titles = new Map<string, string>();
    for (const t of tracks) {
      if (!t.isrc) continue;
      titles.set(t.isrc, t.title);
      const key = baseTitle(t.title);
      if (!key) continue;
      const m = byTitle.get(key) ?? new Map<string, string>();
      m.set(t.isrc, t.title);
      byTitle.set(key, m);
    }
    const rows = new Map<string, Set<string>>();
    for (const s of all) {
      if (s.validTo !== null) continue;
      const set = rows.get(s.isrc) ?? new Set<string>();
      for (const share of s.shares) set.add(share.artistId);
      rows.set(s.isrc, set);
    }
    const owner = new Map<string, string>();
    for (const a of artists.values()) if (a.ownerId) owner.set(a.id, resolveOwner(a.ownerId));
    const candidates = (title: string, ownerId: string | null) =>
      [...(byTitle.get(baseTitle(title)) ?? new Map<string, string>()).entries()]
        .map(([isrc, trackTitle]) => {
          const ids = [...(rows.get(isrc) ?? [])];
          const own = ownerId !== null && ids.some((id) => owner.get(id) === ownerId);
          return {
            isrc,
            title: trackTitle,
            artists: ids.map((id) => artists.get(id)?.pseudonym ?? '').filter(Boolean),
            reason: own ? ('owner' as const) : ('title' as const),
          };
        })
        .sort((a, b) => (a.reason === b.reason ? a.isrc.localeCompare(b.isrc) : a.reason === 'owner' ? -1 : 1));
    /** The person-owners whose pseudonyms are in the open splits of the tracks with this title. */
    const ownersOfTitle = (title: string) => {
      const out = new Set<string>();
      for (const isrc of (byTitle.get(baseTitle(title)) ?? new Map<string, string>()).keys())
        for (const id of rows.get(isrc) ?? []) {
          const o = owner.get(id);
          if (o) out.add(o);
        }
      return out;
    };
    return { titles, candidates, ownersOfTitle };
  }

  const ownerOfSongwriters = async () => {
    const out = new Map<string, string>();
    for (const l of await links.songwriterOwners()) out.set(l.songwriterId, await owners.resolveOwnerId(l.ownerId));
    return out;
  };

  return {
    /** The songs for the tab «Треки» (D-184): the ones without an ISRC first, largest first. */
    async pubV2Songs(labelId?: string) {
      const [{ candidates }, ownerOf, songs, decided, all] = await Promise.all([
        catalog(),
        ownerOfSongwriters(),
        pubv2.listSongs(labelId),
        links.songIsrcs(),
        owners.listOwners(),
      ]);
      const names = new Map(all.map((o) => [o.id, o.name]));
      const isrcs = new Map<string, string[]>();
      for (const d of decided) isrcs.set(d.songId, [...(isrcs.get(d.songId) ?? []), d.isrc]);
      const rows = songs.map((s) => {
        const ownerId = ownerOf.get(s.songwriterId) ?? null;
        const found = candidates(s.title, ownerId);
        return {
          songId: s.id,
          title: s.title,
          songwriterId: s.songwriterId,
          songwriter: s.songwriter,
          ownerId,
          ownerName: ownerId ? (names.get(ownerId) ?? '') : null,
          payable: s.payable,
          isrcs: (isrcs.get(s.id) ?? []).sort(),
          candidates: found.length,
          ownerCandidates: found.filter((c) => c.reason === 'owner').length,
        };
      });
      return [...rows.filter((r) => r.isrcs.length === 0), ...rows.filter((r) => r.isrcs.length > 0)];
    },

    /** The candidates of one song and its confirmed ISRCs, with the titles of the catalog. */
    async pubV2SongCandidates(songId: string) {
      const song = await pubv2.getSong(songId);
      const [{ titles, candidates }, ownerOf, decided, all, writers] = await Promise.all([
        catalog(),
        ownerOfSongwriters(),
        links.isrcsOfSong(songId),
        links.songIsrcs(),
        pubv2.listSongwriters(),
      ]);
      // D-191: the ISRCs another songwriter already linked to its song (co-authorship) come first after the owner's
      const writerName = new Map(writers.map((w) => [w.id, w.name]));
      const coAuthors = new Map<string, Set<string>>();
      for (const l of all) {
        if (l.songwriterId === song.songwriterId) continue;
        const set = coAuthors.get(l.isrc) ?? new Set<string>();
        set.add(writerName.get(l.songwriterId) ?? '');
        coAuthors.set(l.isrc, set);
      }
      const rank = (c: { reason: string; coAuthors: string[] }) => (c.reason === 'owner' ? 0 : c.coAuthors.length > 0 ? 1 : 2);
      const found = candidates(song.title, ownerOf.get(song.songwriterId) ?? null)
        .map((c) => ({ ...c, coAuthors: [...(coAuthors.get(c.isrc) ?? [])].filter(Boolean).sort() }))
        .sort((a, b) => rank(a) - rank(b) || a.isrc.localeCompare(b.isrc));
      return {
        songId,
        title: song.title,
        candidates: found,
        isrcs: decided.map((d) => ({ isrc: d.isrc, title: titles.get(d.isrc) ?? '', source: d.source })),
      };
    },

    /** The operator's decision: the whole set of ISRCs of a song. An ISRC outside the catalog is refused. */
    async setPubV2SongIsrcs(songId: string, raw: string[], decidedBy: string) {
      const song = await pubv2.getSong(songId);
      const { titles, candidates } = await catalog();
      const ownerOf = await ownerOfSongwriters();
      const known = new Set(candidates(song.title, ownerOf.get(song.songwriterId) ?? null).map((c) => c.isrc));
      const isrcs = [...new Set(raw.map(assertIsrc))];
      for (const isrc of isrcs) if (!titles.has(isrc)) throw new NotFoundError('Track', isrc);
      return ctx.db.transaction(async () => {
        // D-190: one ISRC under two songs of one songwriter is a mistake (a double title); under two songwriters it is
        // co-authorship and stays allowed. The unique index of D-191 keeps it in the database too.
        const wanted = new Set(isrcs);
        const clash = (await links.songIsrcs()).filter(
          (l) => wanted.has(l.isrc) && l.songwriterId === song.songwriterId && l.songId !== songId,
        );
        if (clash.length > 0) {
          const list = [...new Set(clash.map((l) => l.isrc))].sort().join(', ');
          throw new ConflictError(`Another song of this songwriter already has ${list}`, 'isrc_on_songwriter_song');
        }
        const rows = await links.setSongIsrcs(
          { songId, songwriterId: song.songwriterId },
          isrcs.map((isrc) => ({ isrc, source: known.has(isrc) ? ('recommended' as const) : ('manual' as const) })),
          decidedBy,
        );
        return { songId, isrcs: rows.map((r) => r.isrc).sort() };
      });
    },

    /** A new percent of the linked owner (D-185): the open term closes, a new one starts at the date. */
    async setPublishingTerm(
      input: { ownerId: string; percent: string; validFrom: string; documentId?: string | null },
      decidedBy: string,
    ) {
      const ownerId = await owners.resolveOwnerId(input.ownerId);
      const owner = await owners.getOwner(ownerId);
      if (owner.kind !== 'person') throw new ConflictError('Publishing goes only to a person, not to a label', 'owner_is_label');
      if (input.documentId) {
        const d = await owners.getDocument(input.documentId);
        if (d.ownerId && d.ownerId !== ownerId) throw new ConflictError('The document belongs to another owner', 'document_owner_mismatch');
      }
      return links.setPublishingTerm({ ...input, ownerId, decidedBy });
    },

    /** A mistaken term cancelled (D-188): the term it had closed is open again. */
    cancelPublishingTerm(id: string, by: string, reason: string) {
      return links.cancelPublishingTerm(id, by, reason);
    },

    /** Every songwriter with its link and its recommendation: the ones without a link first, largest first. */
    async pubV2Links(labelId?: string) {
      const { byId, isPerson, oldMap } = await context();
      const { ownersOfTitle } = await catalog();
      const songsOf = new Map<string, string[]>();
      for (const s of await pubv2.listSongs()) songsOf.set(s.songwriterId, [...(songsOf.get(s.songwriterId) ?? []), s.title]);
      const withTerms = new Set<string>();
      for (const t of await links.publishingTerms()) withTerms.add(await owners.resolveOwnerId(t.ownerId));
      /** The owners behind the songs of a songwriter: how many of its songs lead to each, the largest first. */
      const bySongs = (songwriterId: string) => {
        const titles = songsOf.get(songwriterId) ?? [];
        const count = new Map<string, number>();
        for (const title of titles) for (const o of ownersOfTitle(title)) if (isPerson(o)) count.set(o, (count.get(o) ?? 0) + 1);
        const top = [...count.entries()].sort((a, b) => b[1] - a[1] || (byId.get(a[0])?.name ?? '').localeCompare(byId.get(b[0])?.name ?? ''));
        const [first, second] = top;
        const leader = first && first[1] * 2 >= titles.length && (!second || first[1] >= 2 * second[1]) ? first[0] : null;
        return {
          total: titles.length,
          leader,
          candidates: top.slice(0, 3).map(([ownerId, songs]) => ({
            ownerId,
            ownerName: byId.get(ownerId)?.name ?? '',
            songs,
            hasTerms: withTerms.has(ownerId),
          })),
        };
      };
      const decided = new Map((await links.songwriterOwners()).map((l) => [l.songwriterId, l]));
      const termsOf = new Map<string, { id: string; percent: string; validFrom: string; validTo: string | null; documentId: string | null }[]>();
      for (const t of await links.publishingTerms()) {
        const id = await owners.resolveOwnerId(t.ownerId);
        termsOf.set(id, [...(termsOf.get(id) ?? []), { id: t.id, percent: t.percent, validFrom: t.validFrom, validTo: t.validTo, documentId: t.documentId }]);
      }
      const rows = [];
      for (const w of await pubv2.listSongwriters(labelId)) {
        const link = decided.get(w.id);
        const songs = bySongs(w.id);
        const hint = songs.leader
          ? { ownerId: songs.leader, reason: 'songs' as const }
          : await recommend(w.name, w.aliases, oldMap, isPerson);
        const linkedOwner = link ? await owners.resolveOwnerId(link.ownerId) : null;
        rows.push({
          songwriterId: w.id,
          name: w.name,
          payable: w.payable,
          link:
            link && linkedOwner
              ? {
                  ownerId: linkedOwner,
                  ownerName: byId.get(linkedOwner)?.name ?? '',
                  source: link.source,
                  decidedBy: link.decidedBy,
                  decidedAt: link.decidedAt,
                  terms: termsOf.get(linkedOwner) ?? [],
                }
              : null,
          recommendation: hint
            ? { ownerId: hint.ownerId, ownerName: byId.get(hint.ownerId)?.name ?? '', reason: hint.reason, hasTerms: withTerms.has(hint.ownerId) }
            : null,
          songs: songs.total,
          songCandidates: songs.candidates,
        });
      }
      return [...rows.filter((r) => !r.link), ...rows.filter((r) => r.link)];
    },

    /** The operator's decision: this songwriter is this owner. A publishing owner is a person, never a label. */
    async linkSongwriter(input: { songwriterId: string; ownerId: string }, decidedBy: string) {
      const w = await pubv2.songwriter(input.songwriterId);
      const ownerId = await owners.resolveOwnerId(input.ownerId);
      const owner = await owners.getOwner(ownerId);
      if (owner.kind !== 'person') throw new ConflictError('Publishing goes only to a person, not to a label', 'owner_is_label');
      const { isPerson, oldMap } = await context();
      const hint = await recommend(w.name, w.aliases, oldMap, isPerson);
      const row = await links.setSongwriterOwner({
        songwriterId: w.id,
        ownerId,
        source: hint?.ownerId === ownerId ? 'recommended' : 'manual',
        decidedBy,
      });
      return { ...row, ownerName: owner.name };
    },
  };
}
