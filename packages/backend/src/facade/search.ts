import { ValidationError } from '../shared/errors';
import { normalizeName } from '../shared/identifiers';
import { SEARCH_KINDS } from '@erp/shared/api-responses';
import type { FacadeContext } from './context';

type SearchKind = (typeof SEARCH_KINDS)[number];

const PER_KIND = 10;

/** Global search (N10) and duplicate pseudonyms (N11): reads of several modules, no calculation (D-143). */
export function searchApi(ctx: FacadeContext) {
  const { db, owners, labels, splits, sources } = ctx;
  const api = {
    /**
     * Substring search over owners (name, aliases), pseudonyms, tracks (an exact ISRC / UPC first), documents (title) and
     * labels (name, aliases); at most 10 per kind. `kinds` (a comma list) restricts what is read.
     */
    async search(q: string, kinds?: string) {
      const needle = q.trim();
      if (!needle) throw new ValidationError('q must have at least 1 character');
      let wanted: Set<SearchKind> = new Set(SEARCH_KINDS);
      if (kinds !== undefined && kinds.trim() !== '') {
        const list = kinds
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean);
        const bad = list.filter((k) => !(SEARCH_KINDS as readonly string[]).includes(k));
        if (bad.length > 0) throw new ValidationError(`Unknown kinds: ${bad.join(', ')}`);
        wanted = new Set(list as SearchKind[]);
      }
      return db.snapshot(async () => {
        const [m1, labelList] = await Promise.all([
          owners.search(needle, PER_KIND, wanted),
          wanted.has('labels') ? labels.search(needle, PER_KIND) : [],
        ]);
        return { ...m1, labels: labelList };
      });
    },

    /**
     * Groups of two or more live artists with the same normalised pseudonym, with how much each one is used and the
     * ISRCs without any split that the Believe reports attribute to that name (a hint where the split is missing).
     */
    async artistDuplicates() {
      const [idx, ownerList, splitList, partList] = await db.snapshot(() =>
        Promise.all([
          owners.artistIndex(),
          owners.listOwners(),
          splits.listSplits(),
          splits.listParticipations(),
        ]),
      );
      const ownerName = new Map(ownerList.map((o) => [o.id, o.name]));
      const live = [...idx.entries()].filter(([id, a]) => id === a.id).map(([, a]) => a);
      const byNorm = new Map<string, typeof live>();
      for (const a of live) {
        const key = normalizeName(a.pseudonym);
        if (!key) continue;
        byNorm.set(key, [...(byNorm.get(key) ?? []), a]);
      }
      const dupes = [...byNorm.entries()]
        .filter(([, list]) => list.length > 1)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (dupes.length === 0) return { groups: [] };

      const canon = (id: string) => idx.get(id)?.id ?? id;
      const rows = new Map<string, number>();
      for (const s of splitList)
        for (const sh of s.shares) rows.set(canon(sh.artistId), (rows.get(canon(sh.artistId)) ?? 0) + 1);
      const parts = new Map<string, number>();
      for (const p of partList) parts.set(canon(p.artistId), (parts.get(canon(p.artistId)) ?? 0) + 1);
      const withSplit = new Set(splitList.map((s) => s.isrc));

      const attrs = await sources.pairAttributes();
      const wanted = new Set(dupes.map(([k]) => k));
      const pairsOf = new Map<string, { isrc: string; upc: string; trackTitle: string }[]>();
      for (const k of [...attrs.keys()].sort()) {
        const [isrc, upc] = k.split('|') as [string, string];
        const a = attrs.get(k);
        if (!a || withSplit.has(isrc)) continue;
        const norm = normalizeName(a.artistName);
        if (!wanted.has(norm)) continue;
        pairsOf.set(norm, [...(pairsOf.get(norm) ?? []), { isrc, upc, trackTitle: a.trackTitle }]);
      }
      const all = [...new Set([...pairsOf.values()].flatMap((l) => l.map((p) => p.isrc)))];
      const net = new Map((await sources.netByIsrc(all)).map((r) => [`${r.isrc}|${r.upc}`, r.net]));

      return {
        groups: dupes.map(([normalized, list]) => ({
          normalized,
          artists: list.map((a) => ({
            id: a.id,
            pseudonym: a.pseudonym,
            ownerId: a.ownerId,
            ownerName: a.ownerId ? (ownerName.get(a.ownerId) ?? null) : null,
            status: a.status,
            splitRows: rows.get(a.id) ?? 0,
            participations: parts.get(a.id) ?? 0,
          })),
          candidateIsrcs: (pairsOf.get(normalized) ?? []).map((p) => ({
            ...p,
            net: net.get(`${p.isrc}|${p.upc}`) ?? '0',
          })),
        })),
      };
    },
  };
  return api;
}
