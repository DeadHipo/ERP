import { NotFoundError } from '../shared/errors';
import type { PeriodFilter } from './calculation';
import { artistReach } from './owner-scope';
import type { FacadeContext } from './context';
import type { splitsApi } from './splits';

/**
 * The card and the money of one pseudonym (P12, D-165). A merged id answers for the surviving pseudonym, and everything
 * is collected by every id the pseudonym had (the splits of a merged record are not rewritten, D-095).
 */
export function artistViewApi(ctx: FacadeContext, splitsPart: ReturnType<typeof splitsApi>) {
  const { db, owners, modules, artistBalanceWithReach } = ctx;
  const api = {
    /**
     * The pseudonym, its owner, the ids merged into it, its tracks (the registry links and the tracks of the ISRCs of its
     * rows and participations), the contracts that name it, its split rows and participations (every id), the sublabel
     * rules where it is the recipient, and the documents all of these cite.
     * No money (the balance is `artistBalance`).
     */
    artistDetail(artistId: string) {
      return db.snapshot(async () => {
        const idx = await owners.artistIndex();
        const entry = idx.get(artistId);
        if (!entry) throw new NotFoundError('Artist', artistId);
        const ids = [...idx.entries()].filter(([, a]) => a.id === entry.id).map(([id]) => id);
        const artist = await owners.getArtist(entry.id);
        const owner = entry.ownerId ? await owners.getOwner(entry.ownerId) : null;
        const merges = (await owners.listMerges())
          .filter((m) => m.entity === 'artist' && ids.includes(m.intoId))
          .map((m) => ({ fromId: m.fromId, intoId: m.intoId, reason: m.reason, at: m.at }))
          .sort((a, b) => a.at.localeCompare(b.at));
        const contracts = owner
          ? (await owners.contractsOfOwner(owner.id)).filter((c) => c.artistIds.some((a) => ids.includes(a)))
          : [];
        const splits = new Map<string, Awaited<ReturnType<typeof splitsPart.listSplits>>['items'][number]>();
        const participations = new Map<string, Awaited<ReturnType<typeof splitsPart.listParticipations>>['items'][number]>();
        for (const id of ids) {
          for (const s of (await splitsPart.listSplits({ artistId: id, limit: 100_000 })).items) splits.set(s.id, s);
          for (const p of (await splitsPart.listParticipations({ artistId: id })).items) participations.set(p.id, p);
        }
        // the tracks: the registry links of the pseudonym and the tracks of the ISRCs its rows and participations are on
        const isrcs = [...new Set([...splits.values(), ...participations.values()].map((x) => x.isrc))];
        const tracks = [
          ...new Map(
            [...(await owners.tracksOfArtists(ids)).map((t) => t.track), ...(isrcs.length ? await owners.listTracks({ isrcs }) : [])].map(
              (t) => [t.id, t],
            ),
          ).values(),
        ].sort((a, b) => (a.isrc ?? '').localeCompare(b.isrc ?? '') || a.id.localeCompare(b.id));
        const byIsrcAndDate = <T extends { isrc: string; validFrom: string; id: string }>(a: T, b: T) =>
          a.isrc.localeCompare(b.isrc) || a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id);
        const labelRules = (await splitsPart.listLabels()).flatMap((l) =>
          l.rules.filter((r) => ids.includes(r.recipientArtistId)).map((r) => ({ ...r, labelName: l.name })),
        );
        const docIds = new Set<string>();
        for (const s of splits.values()) {
          if (s.documentId) docIds.add(s.documentId);
          for (const sh of s.shares) if (ids.includes(sh.artistId) && sh.documentId) docIds.add(sh.documentId);
        }
        for (const p of participations.values()) if (p.documentId) docIds.add(p.documentId);
        for (const c of contracts) docIds.add(c.documentId);
        for (const r of labelRules) if (r.documentId) docIds.add(r.documentId);
        const documents = [];
        for (const id of docIds) documents.push(await owners.getDocument(id));
        documents.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        return {
          artist,
          merged: entry.id !== artistId,
          previousIds: ids.filter((id) => id !== entry.id).sort(),
          merges,
          owner,
          tracks,
          contracts,
          splits: [...splits.values()].sort(byIsrcAndDate),
          participations: [...participations.values()].sort(byIsrcAndDate),
          labelRules,
          documents,
        };
      });
    },

    /** The money of one pseudonym from the units of its reach (D-165). */
    artistBalance(artistId: string, f: PeriodFilter = {}) {
      return artistBalanceWithReach(artistId, f);
    },

    /** The reach of a pseudonym (D-165): its ids and the ISRCs its money can come from. */
    artistReach(artistId: string) {
      return artistReach(modules, artistId);
    },
  };
  return api;
}
