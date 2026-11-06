import { and, eq, inArray, isNotNull, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import {
  artistTracks,
  artists,
  contractArtists,
  contracts,
  documents,
  merges,
  ownerAliases,
  owners,
  tracks,
} from './schema';

export type OwnerRow = typeof owners.$inferSelect;
export type AliasRow = typeof ownerAliases.$inferSelect;
export type ArtistRow = typeof artists.$inferSelect;
export type TrackRow = typeof tracks.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type ContractRow = typeof contracts.$inferSelect;
export type ContractArtistRow = typeof contractArtists.$inferSelect;

/** `col = ANY($1)` with the whole list as one array parameter (no parameter-count limit for long lists). */
const anyOf = (col: AnyColumn, ids: string[]): SQL => sql`${col} = any(${sql.param(ids)}::text[])`;

/** Byte order, as SQLite sorted text (the database collation would sort case- and accent-insensitively). */
const byBytes = (col: AnyColumn): SQL => sql`${col} collate "C"`;

/** `lower(col) LIKE '%q%'` with the LIKE wildcards of `q` escaped; served by the pg_trgm indexes of 0011. */
const containsText = (col: AnyColumn, q: string): SQL =>
  sql`lower(${col}) like ${`%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`} escape '\\'`;

/** All SQL of module 1 lives here (schema `owners`). */
export function createOwnersRepository(db: Db) {
  const orm = () => db.orm();
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),

    insertOwner: async (row: typeof owners.$inferInsert) => {
      await orm().insert(owners).values(row);
    },
    getOwner: async (id: string): Promise<OwnerRow | undefined> =>
      (await orm().select().from(owners).where(eq(owners.id, id)))[0],
    listOwners: () =>
      orm().select().from(owners).where(isNull(owners.mergedInto)).orderBy(byBytes(owners.name)),
    allOwners: () => orm().select().from(owners),
    setOwnerMergedInto: async (id: string, into: string) => {
      await orm().update(owners).set({ mergedInto: into }).where(eq(owners.id, id));
    },
    ownersByNameNorm: (norm: string) =>
      orm()
        .select()
        .from(owners)
        .where(and(eq(owners.nameNorm, norm), isNull(owners.mergedInto))),

    insertAlias: async (row: typeof ownerAliases.$inferInsert) => {
      await orm().insert(ownerAliases).values(row).onConflictDoNothing();
    },
    aliasesOf: (ownerId: string) =>
      orm().select().from(ownerAliases).where(eq(ownerAliases.ownerId, ownerId)),
    allAliases: () => orm().select().from(ownerAliases),
    ownerIdsByAlias: async (norm: string) =>
      (
        await orm()
          .select({ ownerId: ownerAliases.ownerId })
          .from(ownerAliases)
          .where(eq(ownerAliases.aliasNorm, norm))
      ).map((r) => r.ownerId),
    /** Aliases of `from` go to `into`; an alias `into` already has keeps its own spelling. */
    moveAliases: async (from: string, into: string) => {
      await db.query(
        `INSERT INTO owners.owner_aliases (owner_id, alias, alias_norm)
         SELECT $2, alias, alias_norm FROM owners.owner_aliases WHERE owner_id = $1
         ON CONFLICT DO NOTHING`,
        [from, into],
      );
      await orm().delete(ownerAliases).where(eq(ownerAliases.ownerId, from));
    },

    insertArtist: async (row: typeof artists.$inferInsert) => {
      await orm().insert(artists).values(row);
    },
    getArtist: async (id: string): Promise<ArtistRow | undefined> =>
      (await orm().select().from(artists).where(eq(artists.id, id)))[0],
    allArtists: () => orm().select().from(artists),
    artistsOfOwner: (ownerId: string) =>
      orm()
        .select()
        .from(artists)
        .where(and(eq(artists.ownerId, ownerId), isNull(artists.mergedInto)))
        .orderBy(byBytes(artists.pseudonym)),
    artistsByPseudonymNorm: (norm: string) =>
      orm()
        .select()
        .from(artists)
        .where(and(eq(artists.pseudonymNorm, norm), isNull(artists.mergedInto))),
    setArtistOwner: async (id: string, ownerId: string) => {
      await orm().update(artists).set({ ownerId }).where(eq(artists.id, id));
    },
    moveArtistsToOwner: async (from: string, into: string) => {
      await orm().update(artists).set({ ownerId: into }).where(eq(artists.ownerId, from));
    },
    setArtistMergedInto: async (id: string, into: string) => {
      await orm().update(artists).set({ mergedInto: into }).where(eq(artists.id, id));
    },

    insertTrack: async (row: typeof tracks.$inferInsert) => {
      await orm().insert(tracks).values(row);
    },
    getTrack: async (id: string): Promise<TrackRow | undefined> =>
      (await orm().select().from(tracks).where(eq(tracks.id, id)))[0],
    trackByPair: async (isrc: string, upc: string): Promise<TrackRow | undefined> =>
      (
        await orm()
          .select()
          .from(tracks)
          .where(and(eq(tracks.isrc, isrc), eq(tracks.upc, upc)))
      )[0],
    tracksByIsrc: (isrc: string) => orm().select().from(tracks).where(eq(tracks.isrc, isrc)),
    /** Every track, or (the unit scope of the facade, D-162) only those registered under the given ISRCs. */
    allTracks: (isrcs?: string[]) =>
      isrcs && isrcs.length === 0
        ? Promise.resolve([] as (typeof tracks.$inferSelect)[])
        : orm()
            .select()
            .from(tracks)
            .where(isrcs ? inArray(tracks.isrc, isrcs) : undefined),
    setTrackIds: async (id: string, isrc: string | null, upc: string | null) => {
      await orm().update(tracks).set({ isrc, upc }).where(eq(tracks.id, id));
    },

    setTrackNote: async (id: string, note: string | null) => {
      await orm().update(tracks).set({ note }).where(eq(tracks.id, id));
    },
    linkArtistTrack: async (artistId: string, trackId: string) => {
      await orm().insert(artistTracks).values({ artistId, trackId }).onConflictDoNothing();
    },
    tracksOfArtists: async (artistIds: string[]) =>
      artistIds.length === 0
        ? []
        : orm()
            .select({ artistId: artistTracks.artistId, track: tracks })
            .from(artistTracks)
            .innerJoin(tracks, eq(tracks.id, artistTracks.trackId))
            .where(anyOf(artistTracks.artistId, artistIds)),
    artistLinksOfTrack: (trackId: string) =>
      orm().select().from(artistTracks).where(eq(artistTracks.trackId, trackId)),
    /** Every artist → track link, or (the unit scope of the facade, D-166) only those of the given tracks. */
    artistLinksOfTracks: (trackIds?: string[]) =>
      trackIds && trackIds.length === 0
        ? Promise.resolve([] as (typeof artistTracks.$inferSelect)[])
        : orm()
            .select()
            .from(artistTracks)
            .where(trackIds ? anyOf(artistTracks.trackId, trackIds) : undefined),
    moveArtistTracks: async (from: string, into: string) => {
      await db.query(
        `INSERT INTO owners.artist_tracks (artist_id, track_id)
         SELECT $2, track_id FROM owners.artist_tracks WHERE artist_id = $1
         ON CONFLICT DO NOTHING`,
        [from, into],
      );
      await orm().delete(artistTracks).where(eq(artistTracks.artistId, from));
    },

    insertDocument: async (row: typeof documents.$inferInsert) => {
      await orm().insert(documents).values(row);
    },
    getDocument: async (id: string): Promise<DocumentRow | undefined> =>
      (await orm().select().from(documents).where(eq(documents.id, id)))[0],
    documentsByIds: async (ids: string[]) =>
      ids.length === 0 ? [] : orm().select().from(documents).where(anyOf(documents.id, ids)),
    allDocuments: () => orm().select().from(documents),
    listDocuments: (
      f: {
        ownerId?: string;
        status?: 'not_attached' | 'not_approved' | 'approved';
        kind?: string;
        q?: string;
        limit?: number;
        /** The documents of the label and those without a label (D-169). */
        labelId?: string;
      } = {},
    ) => {
      const noFile = sql`(${documents.fileRef} is null or ${documents.fileRef} = '')`;
      const waiting = sql`(${documents.requiresApproval} and ${documents.approvedAt} is null)`;
      const conds: (SQL | undefined)[] = [
        f.ownerId === undefined ? undefined : eq(documents.ownerId, f.ownerId),
        f.kind === undefined ? undefined : eq(documents.kind, f.kind),
        f.q ? containsText(documents.title, f.q) : undefined,
        f.labelId === undefined ? undefined : or(eq(documents.labelId, f.labelId), isNull(documents.labelId)),
        f.status === 'not_attached'
          ? noFile
          : f.status === 'not_approved'
            ? sql`(not ${noFile} and ${waiting})`
            : f.status === 'approved'
              ? sql`(not ${noFile} and not ${waiting})`
              : undefined,
      ];
      const q = orm()
        .select()
        .from(documents)
        .where(and(...conds))
        .orderBy(documents.createdAt, documents.id);
      return f.limit === undefined ? q : q.limit(f.limit);
    },
    updateDocument: async (id: string, patch: Partial<typeof documents.$inferInsert>) => {
      await orm().update(documents).set(patch).where(eq(documents.id, id));
    },
    moveDocuments: async (from: string, into: string) => {
      await orm().update(documents).set({ ownerId: into }).where(eq(documents.ownerId, from));
    },

    insertContract: async (row: typeof contracts.$inferInsert) => {
      await orm().insert(contracts).values(row);
    },
    contractsOfOwner: (ownerId: string) =>
      orm().select().from(contracts).where(eq(contracts.ownerId, ownerId)),
    allContracts: () => orm().select().from(contracts),
    moveContracts: async (from: string, into: string) => {
      await orm().update(contracts).set({ ownerId: into }).where(eq(contracts.ownerId, from));
    },
    linkContractArtist: async (contractId: string, artistId: string) => {
      await orm().insert(contractArtists).values({ contractId, artistId }).onConflictDoNothing();
    },
    contractArtistsOf: async (contractIds: string[]) =>
      contractIds.length === 0
        ? []
        : orm().select().from(contractArtists).where(anyOf(contractArtists.contractId, contractIds)),
    allContractArtists: () => orm().select().from(contractArtists),
    moveContractArtists: async (from: string, into: string) => {
      await db.query(
        `INSERT INTO owners.contract_artists (contract_id, artist_id)
         SELECT contract_id, $2 FROM owners.contract_artists WHERE artist_id = $1
         ON CONFLICT DO NOTHING`,
        [from, into],
      );
      await orm().delete(contractArtists).where(eq(contractArtists.artistId, from));
    },

    insertMerge: async (row: typeof merges.$inferInsert) => {
      await orm().insert(merges).values(row);
    },
    listMerges: () => orm().select().from(merges),

    /** Fast bulk lookup used by the facade: every (isrc, upc) pair known in module 1. */
    /** Substring search for the global search (N10); live owners and artists only, at most `limit` rows per kind. */
    searchOwners: (q: string, limit: number) =>
      orm()
        .select()
        .from(owners)
        .where(
          and(
            isNull(owners.mergedInto),
            or(
              containsText(owners.name, q),
              sql`${owners.id} in (select ${ownerAliases.ownerId} from ${ownerAliases} where ${containsText(ownerAliases.alias, q)})`,
            ),
          ),
        )
        .orderBy(byBytes(owners.name))
        .limit(limit),
    searchArtists: (q: string, limit: number) =>
      orm()
        .select()
        .from(artists)
        .where(and(isNull(artists.mergedInto), containsText(artists.pseudonym, q)))
        .orderBy(byBytes(artists.pseudonym))
        .limit(limit),
    /** An exact ISRC / UPC match comes first. */
    searchTracks: (q: string, exactIsrc: string, exactUpc: string, limit: number) =>
      orm()
        .select()
        .from(tracks)
        .where(or(containsText(tracks.isrc, q), containsText(tracks.upc, q), containsText(tracks.title, q)))
        .orderBy(
          sql`(${tracks.isrc} = ${exactIsrc} or (${exactUpc} <> '' and ${tracks.upc} = ${exactUpc})) desc`,
          byBytes(tracks.title),
          tracks.id,
        )
        .limit(limit),
    searchDocuments: (q: string, limit: number) =>
      orm()
        .select()
        .from(documents)
        .where(containsText(documents.title, q))
        .orderBy(documents.createdAt)
        .limit(limit),

    knownPairs: (isrcs?: string[]) =>
      isrcs && isrcs.length === 0
        ? Promise.resolve([] as { isrc: string | null; upc: string | null }[])
        : orm()
            .select({ isrc: tracks.isrc, upc: tracks.upc })
            .from(tracks)
            .where(and(isNotNull(tracks.isrc), isNotNull(tracks.upc), isrcs ? inArray(tracks.isrc, isrcs) : undefined)),
  };
}

export type OwnersRepository = ReturnType<typeof createOwnersRepository>;
