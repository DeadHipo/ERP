import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { ModuleDb } from '../../shared/db';
import {
  artistTracks,
  artists,
  contractArtists,
  contracts,
  documents,
  merges,
  ownerAliases,
  owners,
  ownersSchema,
  tracks,
} from './schema';

export type OwnersDb = ModuleDb<typeof ownersSchema>;
export type OwnerRow = typeof owners.$inferSelect;
export type ArtistRow = typeof artists.$inferSelect;
export type TrackRow = typeof tracks.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type ContractRow = typeof contracts.$inferSelect;

/** All SQL of module 1 lives here. */
export function createOwnersRepository(db: OwnersDb) {
  const { orm } = db;
  return {
    transaction<T>(fn: () => T): T {
      return db.sqlite.transaction(fn)();
    },

    insertOwner: (row: typeof owners.$inferInsert) => orm.insert(owners).values(row).run(),
    getOwner: (id: string) => orm.select().from(owners).where(eq(owners.id, id)).get(),
    listOwners: () => orm.select().from(owners).where(isNull(owners.mergedInto)).orderBy(owners.name).all(),
    allOwners: () => orm.select().from(owners).all(),
    setOwnerMergedInto: (id: string, into: string) =>
      orm.update(owners).set({ mergedInto: into }).where(eq(owners.id, id)).run(),
    ownersByNameNorm: (norm: string) =>
      orm
        .select()
        .from(owners)
        .where(and(eq(owners.nameNorm, norm), isNull(owners.mergedInto)))
        .all(),

    insertAlias: (row: typeof ownerAliases.$inferInsert) =>
      orm.insert(ownerAliases).values(row).onConflictDoNothing().run(),
    aliasesOf: (ownerId: string) =>
      orm.select().from(ownerAliases).where(eq(ownerAliases.ownerId, ownerId)).all(),
    ownerIdsByAlias: (norm: string) =>
      orm
        .select({ ownerId: ownerAliases.ownerId })
        .from(ownerAliases)
        .where(eq(ownerAliases.aliasNorm, norm))
        .all()
        .map((r) => r.ownerId),
    moveAliases: (from: string, into: string) => {
      for (const a of orm.select().from(ownerAliases).where(eq(ownerAliases.ownerId, from)).all()) {
        orm
          .insert(ownerAliases)
          .values({ ...a, ownerId: into })
          .onConflictDoNothing()
          .run();
      }
      orm.delete(ownerAliases).where(eq(ownerAliases.ownerId, from)).run();
    },

    insertArtist: (row: typeof artists.$inferInsert) => orm.insert(artists).values(row).run(),
    getArtist: (id: string) => orm.select().from(artists).where(eq(artists.id, id)).get(),
    allArtists: () => orm.select().from(artists).all(),
    artistsOfOwner: (ownerId: string) =>
      orm
        .select()
        .from(artists)
        .where(and(eq(artists.ownerId, ownerId), isNull(artists.mergedInto)))
        .orderBy(artists.pseudonym)
        .all(),
    artistsByPseudonymNorm: (norm: string) =>
      orm
        .select()
        .from(artists)
        .where(and(eq(artists.pseudonymNorm, norm), isNull(artists.mergedInto)))
        .all(),
    setArtistOwner: (id: string, ownerId: string) =>
      orm.update(artists).set({ ownerId }).where(eq(artists.id, id)).run(),
    moveArtistsToOwner: (from: string, into: string) =>
      orm.update(artists).set({ ownerId: into }).where(eq(artists.ownerId, from)).run(),
    setArtistMergedInto: (id: string, into: string) =>
      orm.update(artists).set({ mergedInto: into }).where(eq(artists.id, id)).run(),

    insertTrack: (row: typeof tracks.$inferInsert) => orm.insert(tracks).values(row).run(),
    getTrack: (id: string) => orm.select().from(tracks).where(eq(tracks.id, id)).get(),
    trackByPair: (isrc: string, upc: string) =>
      orm
        .select()
        .from(tracks)
        .where(and(eq(tracks.isrc, isrc), eq(tracks.upc, upc)))
        .get(),
    tracksByIsrc: (isrc: string) => orm.select().from(tracks).where(eq(tracks.isrc, isrc)).all(),
    allTracks: () => orm.select().from(tracks).all(),
    setTrackIds: (id: string, isrc: string | null, upc: string | null) =>
      orm.update(tracks).set({ isrc, upc }).where(eq(tracks.id, id)).run(),

    linkArtistTrack: (artistId: string, trackId: string) =>
      orm.insert(artistTracks).values({ artistId, trackId }).onConflictDoNothing().run(),
    tracksOfArtists: (artistIds: string[]) =>
      artistIds.length === 0
        ? []
        : orm
            .select({ artistId: artistTracks.artistId, track: tracks })
            .from(artistTracks)
            .innerJoin(tracks, eq(tracks.id, artistTracks.trackId))
            .where(inArray(artistTracks.artistId, artistIds))
            .all(),
    artistLinksOfTrack: (trackId: string) =>
      orm.select().from(artistTracks).where(eq(artistTracks.trackId, trackId)).all(),
    moveArtistTracks: (from: string, into: string) => {
      for (const l of orm.select().from(artistTracks).where(eq(artistTracks.artistId, from)).all()) {
        orm.insert(artistTracks).values({ artistId: into, trackId: l.trackId }).onConflictDoNothing().run();
      }
      orm.delete(artistTracks).where(eq(artistTracks.artistId, from)).run();
    },

    insertDocument: (row: typeof documents.$inferInsert) => orm.insert(documents).values(row).run(),
    getDocument: (id: string) => orm.select().from(documents).where(eq(documents.id, id)).get(),
    documentsByIds: (ids: string[]) =>
      ids.length === 0 ? [] : orm.select().from(documents).where(inArray(documents.id, ids)).all(),
    listDocuments: (ownerId?: string) =>
      ownerId === undefined
        ? orm.select().from(documents).orderBy(documents.createdAt).all()
        : orm
            .select()
            .from(documents)
            .where(eq(documents.ownerId, ownerId))
            .orderBy(documents.createdAt)
            .all(),
    updateDocument: (id: string, patch: Partial<typeof documents.$inferInsert>) =>
      orm.update(documents).set(patch).where(eq(documents.id, id)).run(),
    moveDocuments: (from: string, into: string) =>
      orm.update(documents).set({ ownerId: into }).where(eq(documents.ownerId, from)).run(),

    insertContract: (row: typeof contracts.$inferInsert) => orm.insert(contracts).values(row).run(),
    contractsOfOwner: (ownerId: string) =>
      orm.select().from(contracts).where(eq(contracts.ownerId, ownerId)).all(),
    allContracts: () => orm.select().from(contracts).all(),
    moveContracts: (from: string, into: string) =>
      orm.update(contracts).set({ ownerId: into }).where(eq(contracts.ownerId, from)).run(),
    linkContractArtist: (contractId: string, artistId: string) =>
      orm.insert(contractArtists).values({ contractId, artistId }).onConflictDoNothing().run(),
    contractArtistsOf: (contractIds: string[]) =>
      contractIds.length === 0
        ? []
        : orm.select().from(contractArtists).where(inArray(contractArtists.contractId, contractIds)).all(),
    moveContractArtists: (from: string, into: string) => {
      for (const l of orm.select().from(contractArtists).where(eq(contractArtists.artistId, from)).all()) {
        orm
          .insert(contractArtists)
          .values({ contractId: l.contractId, artistId: into })
          .onConflictDoNothing()
          .run();
      }
      orm.delete(contractArtists).where(eq(contractArtists.artistId, from)).run();
    },

    insertMerge: (row: typeof merges.$inferInsert) => orm.insert(merges).values(row).run(),
    listMerges: () => orm.select().from(merges).all(),

    /** Fast bulk lookup used by the facade: every (isrc, upc) pair known in module 1. */
    knownPairs: () =>
      orm
        .select({ isrc: tracks.isrc, upc: tracks.upc })
        .from(tracks)
        .where(and(isNotNull(tracks.isrc), isNotNull(tracks.upc)))
        .all(),
  };
}

export type OwnersRepository = ReturnType<typeof createOwnersRepository>;
