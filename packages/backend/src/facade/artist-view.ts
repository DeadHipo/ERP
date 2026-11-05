import { NotFoundError } from '../shared/errors';
import { todayIso } from '../shared/dates';
import { calculate, type PeriodFilter } from './calculation';
import { artistReach, artistsReach } from './owner-scope';
import { scoped } from './scope';
import { artistBalance, artistUnitIndex, ownerIndex } from './balance';
import { timed, timedSync } from '../shared/timing';
import { parseIdList } from './aggregates';
import type { FacadeContext } from './context';
import type { splitsApi } from './splits';

/**
 * The card and the money of one pseudonym (P12, D-165). A merged id answers for the surviving pseudonym, and everything
 * is collected by every id the pseudonym had (the splits of a merged record are not rewritten, D-095).
 */
export function artistViewApi(ctx: FacadeContext, splitsPart: ReturnType<typeof splitsApi>) {
  const { db, owners, splits, settlements, modules, artistBalanceWithReach, opDocIds } = ctx;
  const api = {
    /**
     * Every live pseudonym of the registry as a row without money (P11, D-167): its owner (id, name, status), how many
     * ids were merged into it, the distinct tracks it is on (registry links, split rows and participations, by every
     * id), its split rows and participations not closed by today, the contracts naming it and the open rows and
     * participations without a document (their money waits). Additive over the former `GET /artists` item.
     */
    artistList() {
      return db.snapshot(async () => {
        const [idx, ownerList, splitList, partList, links, trackList, contractLinks] = await Promise.all([
          owners.artistIndex(),
          owners.listOwners(),
          splits.listSplits(),
          splits.listParticipations(),
          owners.artistLinks(),
          owners.listTracks(),
          owners.contractLinks(),
        ]);
        const today = todayIso();
        const canon = (id: string) => idx.get(id)?.id ?? id;
        const open = (validTo: string | null) => validTo === null || validTo > today;
        const ownerById = new Map(ownerList.map((o) => [o.id, o]));
        const trackById = new Map(trackList.map((t) => [t.id, t]));
        type Agg = { previousIds: number; tracks: Set<string>; splitRows: number; participations: number; contracts: Set<string>; undocumented: number };
        const aggs = new Map<string, Agg>();
        const of = (id: string): Agg => {
          let a = aggs.get(id);
          if (!a) aggs.set(id, (a = { previousIds: 0, tracks: new Set(), splitRows: 0, participations: 0, contracts: new Set(), undocumented: 0 }));
          return a;
        };
        for (const [id, a] of idx) if (id !== a.id) of(a.id).previousIds += 1;
        for (const l of links) {
          const t = trackById.get(l.trackId);
          if (t) of(canon(l.artistId)).tracks.add(t.isrc ?? `track:${t.id}`);
        }
        for (const s of splitList)
          for (const sh of s.shares) {
            const a = of(canon(sh.artistId));
            a.tracks.add(s.isrc);
            if (!open(s.validTo)) continue;
            a.splitRows += 1;
            if (!(sh.documentId ?? s.documentId)) a.undocumented += 1;
          }
        for (const p of partList) {
          const a = of(canon(p.artistId));
          a.tracks.add(p.isrc);
          if (!open(p.validTo)) continue;
          a.participations += 1;
          if (!p.documentId) a.undocumented += 1;
        }
        for (const c of contractLinks) of(canon(c.artistId)).contracts.add(c.contractId);
        return [...idx.entries()]
          .filter(([id, a]) => id === a.id)
          .map(([, a]) => {
            const g = of(a.id);
            const owner = a.ownerId ? ownerById.get(a.ownerId) : undefined;
            return {
              id: a.id,
              pseudonym: a.pseudonym,
              ownerId: a.ownerId,
              status: a.status,
              owner: owner ? { id: owner.id, name: owner.name, status: owner.status } : null,
              previousIds: g.previousIds,
              tracks: g.tracks.size,
              splitRows: g.splitRows,
              participations: g.participations,
              contracts: g.contracts.size,
              undocumented: g.undocumented,
            };
          })
          .sort((x, y) => x.pseudonym.localeCompare(y.pseudonym) || x.id.localeCompare(y.id));
      });
    },

    /**
     * The money of a list of pseudonyms (the visible rows of P11, D-167): one calculation over the union of their
     * reaches (`artistsReach`), then the very `artistBalance()` of each (the row of its owner's balance), so a row
     * equals `GET /artists/:id/balance` of that pseudonym. Without `ids`: every live pseudonym from the full
     * calculation. `remaining` = earned − recouped − adsCharged − paid: what this pseudonym's income left for its
     * owner's payable (the payout stays the owner's, D-051). An unknown id is left out; a merged id answers for its
     * survivor, once.
     */
    async artistBalances(f: { from?: string; to?: string; basis?: 'report' | 'sales'; ids?: string } = {}) {
      const only = f.ids === undefined ? undefined : parseIdList(f.ids);
      const docIds = await timed('settlements.allOperations (document ids)', opDocIds, (r) => `${r.length} ids`);
      const { idx, ops } = await timed('pg snapshot: artistIndex + operations', () =>
        db.snapshot(async () => ({
          idx: await owners.artistIndex(),
          ops: await settlements.listOperations({}),
        })),
      );
      const wanted = new Map<string, { id: string; pseudonym: string; ownerId: string | null }>();
      for (const raw of only ?? idx.keys()) {
        const e = idx.get(raw);
        if (e) wanted.set(e.id, e);
      }
      const calc = only
        ? await timed('calculate (the union reach)', async () => {
            const reach = await timed('artistsReach', () => artistsReach(modules, [...wanted.keys()]), (r) => `${r.isrcs.length} ISRCs`);
            return calculate(scoped(modules, { isrcs: reach.isrcs }), docIds);
          })
        : await timed('calculate (full)', () => calculate(modules, docIds));
      const opsOf = new Map<string, typeof ops>();
      for (const o of ops) if (o.ownerId) opsOf.set(o.ownerId, [...(opsOf.get(o.ownerId) ?? []), o]);
      const byArtist = timedSync('artistUnitIndex + ownerIndex (JS)', () => ({ units: artistUnitIndex(calc), owners: ownerIndex(calc) }));
      const items = timedSync('artistBalance per row (JS)', () => [...wanted.values()]
        .sort((x, y) => x.pseudonym.localeCompare(y.pseudonym) || x.id.localeCompare(y.id))
        .map((e) => {
          const m = artistBalance(calc, e.id, e.ownerId ? (opsOf.get(e.ownerId) ?? []) : [], f, {
            units: byArtist.units.get(e.id) ?? [],
            owner: e.ownerId ? (byArtist.owners.get(e.ownerId) ?? { units: [], publishing: [] }) : undefined,
          });
          const { earned, waiting, recouped, unrecouped, adsCharged, paid } = m.total;
          return {
            artistId: m.artistId,
            pseudonym: m.pseudonym,
            ownerId: m.ownerId,
            earned,
            waiting,
            recouped,
            unrecouped,
            adsCharged,
            paid,
            remaining: earned.sub(recouped).sub(adsCharged).sub(paid),
          };
        }), (r) => `${r.length} rows`);
      return { calculatedAt: new Date().toISOString(), items };
    },

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
