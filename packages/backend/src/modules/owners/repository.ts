import { and, asc, eq, inArray, isNotNull, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgQuery, orgRow, orgRows, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import {
  artistTracks,
  artists,
  contractArtists,
  contracts,
  documents,
  merges,
  ownerAliases,
  owners,
  releases,
  trackLabels,
  tracks,
} from './schema';

export type OwnerRow = OrgFree<typeof owners.$inferSelect>;
export type AliasRow = OrgFree<typeof ownerAliases.$inferSelect>;
export type ArtistRow = OrgFree<typeof artists.$inferSelect>;
export type TrackRow = OrgFree<typeof tracks.$inferSelect>;
export type DocumentRow = OrgFree<typeof documents.$inferSelect>;
export type ContractRow = OrgFree<typeof contracts.$inferSelect>;
export type ContractArtistRow = OrgFree<typeof contractArtists.$inferSelect>;
export type ArtistTrackRow = OrgFree<typeof artistTracks.$inferSelect>;
export type MergeRow = OrgFree<typeof merges.$inferSelect>;
export type TrackLabelRow = OrgFree<typeof trackLabels.$inferSelect>;
export type ReleaseRow = OrgFree<typeof releases.$inferSelect>;

/** `col = ANY($1)` with the whole list as one array parameter (no parameter-count limit for long lists). */
const anyOf = (col: AnyColumn, ids: string[]): SQL => sql`${col} = any(${sql.param(ids)}::text[])`;

/** Byte order, as SQLite sorted text (the database collation would sort case- and accent-insensitively). */
const byBytes = (col: AnyColumn): SQL => sql`${col} collate "C"`;

/** `lower(col) LIKE '%q%'` with the LIKE wildcards of `q` escaped; served by the pg_trgm indexes of 0011. */
const containsText = (col: AnyColumn, q: string): SQL =>
  sql`lower(${col}) like ${`%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`} escape '\\'`;

/** All SQL of module 1 lives here (schema `owners`); every statement is of the organization `org` (D-170). */
export function createOwnersRepository(db: Db, org: OrgScope) {
  const orm = () => db.orm();
  const q = orgQuery(db, org);
  const C = {
    owners: orgFree(owners),
    ownerAliases: orgFree(ownerAliases),
    artists: orgFree(artists),
    tracks: orgFree(tracks),
    artistTracks: orgFree(artistTracks),
    documents: orgFree(documents),
    contracts: orgFree(contracts),
    contractArtists: orgFree(contractArtists),
    merges: orgFree(merges),
    trackLabels: orgFree(trackLabels),
    releases: orgFree(releases),
  };
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),

    insertOwner: async (row: OrgFree<typeof owners.$inferInsert>) => {
      await orm().insert(owners).values(orgRow(org, row));
    },
    getOwner: async (id: string): Promise<OwnerRow | undefined> =>
      (await orm().select(C.owners).from(owners).where(orgWhere(org, owners, eq(owners.id, id))))[0],
    listOwners: () =>
      orm()
        .select(C.owners)
        .from(owners)
        .where(orgWhere(org, owners, isNull(owners.mergedInto)))
        .orderBy(byBytes(owners.name)),
    allOwners: () => orm().select(C.owners).from(owners).where(orgWhere(org, owners)),
    setOwnerMergedInto: async (id: string, into: string) => {
      await orm().update(owners).set({ mergedInto: into }).where(orgWhere(org, owners, eq(owners.id, id)));
    },
    ownersByNameNorm: (norm: string) =>
      orm()
        .select(C.owners)
        .from(owners)
        .where(orgWhere(org, owners, eq(owners.nameNorm, norm), isNull(owners.mergedInto))),

    insertAlias: async (row: OrgFree<typeof ownerAliases.$inferInsert>) => {
      await orm().insert(ownerAliases).values(orgRow(org, row)).onConflictDoNothing();
    },
    aliasesOf: (ownerId: string) =>
      orm()
        .select(C.ownerAliases)
        .from(ownerAliases)
        .where(orgWhere(org, ownerAliases, eq(ownerAliases.ownerId, ownerId))),
    allAliases: () => orm().select(C.ownerAliases).from(ownerAliases).where(orgWhere(org, ownerAliases)),
    ownerIdsByAlias: async (norm: string) =>
      (
        await orm()
          .select({ ownerId: ownerAliases.ownerId })
          .from(ownerAliases)
          .where(orgWhere(org, ownerAliases, eq(ownerAliases.aliasNorm, norm)))
      ).map((r) => r.ownerId),
    /** Aliases of `from` go to `into`; an alias `into` already has keeps its own spelling. */
    moveAliases: async (from: string, into: string) => {
      await q(
        `INSERT INTO owners.owner_aliases (org_id, owner_id, alias, alias_norm)
         SELECT org_id, $3, alias, alias_norm FROM owners.owner_aliases WHERE org_id = $1 AND owner_id = $2
         ON CONFLICT DO NOTHING`,
        [from, into],
      );
      await orm().delete(ownerAliases).where(orgWhere(org, ownerAliases, eq(ownerAliases.ownerId, from)));
    },

    insertArtist: async (row: OrgFree<typeof artists.$inferInsert>) => {
      await orm().insert(artists).values(orgRow(org, row));
    },
    getArtist: async (id: string): Promise<ArtistRow | undefined> =>
      (await orm().select(C.artists).from(artists).where(orgWhere(org, artists, eq(artists.id, id))))[0],
    allArtists: () => orm().select(C.artists).from(artists).where(orgWhere(org, artists)),
    artistsOfOwner: (ownerId: string) =>
      orm()
        .select(C.artists)
        .from(artists)
        .where(orgWhere(org, artists, eq(artists.ownerId, ownerId), isNull(artists.mergedInto)))
        .orderBy(byBytes(artists.pseudonym)),
    artistsByPseudonymNorm: (norm: string) =>
      orm()
        .select(C.artists)
        .from(artists)
        .where(orgWhere(org, artists, eq(artists.pseudonymNorm, norm), isNull(artists.mergedInto))),
    setArtistOwner: async (id: string, ownerId: string) => {
      await orm().update(artists).set({ ownerId }).where(orgWhere(org, artists, eq(artists.id, id)));
    },
    moveArtistsToOwner: async (from: string, into: string) => {
      await orm().update(artists).set({ ownerId: into }).where(orgWhere(org, artists, eq(artists.ownerId, from)));
    },
    setArtistMergedInto: async (id: string, into: string) => {
      await orm().update(artists).set({ mergedInto: into }).where(orgWhere(org, artists, eq(artists.id, id)));
    },

    insertTrack: async (row: OrgFree<typeof tracks.$inferInsert>) => {
      await orm().insert(tracks).values(orgRow(org, row));
    },
    getTrack: async (id: string): Promise<TrackRow | undefined> =>
      (await orm().select(C.tracks).from(tracks).where(orgWhere(org, tracks, eq(tracks.id, id))))[0],
    trackByPair: async (isrc: string, upc: string): Promise<TrackRow | undefined> =>
      (
        await orm()
          .select(C.tracks)
          .from(tracks)
          .where(orgWhere(org, tracks, eq(tracks.isrc, isrc), eq(tracks.upc, upc)))
      )[0],
    tracksByIsrc: (isrc: string) =>
      orm().select(C.tracks).from(tracks).where(orgWhere(org, tracks, eq(tracks.isrc, isrc))),
    /** Every track, or (the unit scope of the facade, D-162) only those registered under the given ISRCs. */
    allTracks: (isrcs?: string[]) =>
      isrcs && isrcs.length === 0
        ? Promise.resolve([] as TrackRow[])
        : orm()
            .select(C.tracks)
            .from(tracks)
            .where(orgWhere(org, tracks, isrcs ? inArray(tracks.isrc, isrcs) : undefined)),
    setTrackIds: async (id: string, isrc: string | null, upc: string | null) => {
      await orm().update(tracks).set({ isrc, upc }).where(orgWhere(org, tracks, eq(tracks.id, id)));
    },

    setTrackNote: async (id: string, note: string | null) => {
      await orm().update(tracks).set({ note }).where(orgWhere(org, tracks, eq(tracks.id, id)));
    },
    linkArtistTrack: async (artistId: string, trackId: string) => {
      await orm().insert(artistTracks).values(orgRow(org, { artistId, trackId })).onConflictDoNothing();
    },
    tracksOfArtists: async (artistIds: string[]) =>
      artistIds.length === 0
        ? []
        : orm()
            .select({ artistId: artistTracks.artistId, track: C.tracks })
            .from(artistTracks)
            .innerJoin(tracks, orgWhere(org, tracks, eq(tracks.id, artistTracks.trackId)))
            .where(orgWhere(org, artistTracks, anyOf(artistTracks.artistId, artistIds))),
    artistLinksOfTrack: (trackId: string) =>
      orm()
        .select(C.artistTracks)
        .from(artistTracks)
        .where(orgWhere(org, artistTracks, eq(artistTracks.trackId, trackId))),
    /** Every artist → track link, or (the unit scope of the facade, D-166) only those of the given tracks. */
    artistLinksOfTracks: (trackIds?: string[]) =>
      trackIds && trackIds.length === 0
        ? Promise.resolve([] as ArtistTrackRow[])
        : orm()
            .select(C.artistTracks)
            .from(artistTracks)
            .where(orgWhere(org, artistTracks, trackIds ? anyOf(artistTracks.trackId, trackIds) : undefined)),
    moveArtistTracks: async (from: string, into: string) => {
      await q(
        `INSERT INTO owners.artist_tracks (org_id, artist_id, track_id)
         SELECT org_id, $3, track_id FROM owners.artist_tracks WHERE org_id = $1 AND artist_id = $2
         ON CONFLICT DO NOTHING`,
        [from, into],
      );
      await orm().delete(artistTracks).where(orgWhere(org, artistTracks, eq(artistTracks.artistId, from)));
    },

    insertDocument: async (row: OrgFree<typeof documents.$inferInsert>) => {
      await orm().insert(documents).values(orgRow(org, row));
    },
    getDocument: async (id: string): Promise<DocumentRow | undefined> =>
      (await orm().select(C.documents).from(documents).where(orgWhere(org, documents, eq(documents.id, id))))[0],
    documentsByIds: async (ids: string[]) =>
      ids.length === 0
        ? []
        : orm().select(C.documents).from(documents).where(orgWhere(org, documents, anyOf(documents.id, ids))),
    allDocuments: () => orm().select(C.documents).from(documents).where(orgWhere(org, documents)),
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
      const query = orm()
        .select(C.documents)
        .from(documents)
        .where(orgWhere(org, documents, ...conds))
        .orderBy(documents.createdAt, documents.id);
      return f.limit === undefined ? query : query.limit(f.limit);
    },
    updateDocument: async (id: string, patch: Partial<OrgFree<typeof documents.$inferInsert>>) => {
      await orm().update(documents).set(patch).where(orgWhere(org, documents, eq(documents.id, id)));
    },
    moveDocuments: async (from: string, into: string) => {
      await orm().update(documents).set({ ownerId: into }).where(orgWhere(org, documents, eq(documents.ownerId, from)));
    },

    insertContract: async (row: OrgFree<typeof contracts.$inferInsert>) => {
      await orm().insert(contracts).values(orgRow(org, row));
    },
    contractsOfOwner: (ownerId: string) =>
      orm().select(C.contracts).from(contracts).where(orgWhere(org, contracts, eq(contracts.ownerId, ownerId))),
    allContracts: () => orm().select(C.contracts).from(contracts).where(orgWhere(org, contracts)),
    moveContracts: async (from: string, into: string) => {
      await orm().update(contracts).set({ ownerId: into }).where(orgWhere(org, contracts, eq(contracts.ownerId, from)));
    },
    linkContractArtist: async (contractId: string, artistId: string) => {
      await orm().insert(contractArtists).values(orgRow(org, { contractId, artistId })).onConflictDoNothing();
    },
    contractArtistsOf: async (contractIds: string[]) =>
      contractIds.length === 0
        ? []
        : orm()
            .select(C.contractArtists)
            .from(contractArtists)
            .where(orgWhere(org, contractArtists, anyOf(contractArtists.contractId, contractIds))),
    allContractArtists: () =>
      orm().select(C.contractArtists).from(contractArtists).where(orgWhere(org, contractArtists)),
    moveContractArtists: async (from: string, into: string) => {
      await q(
        `INSERT INTO owners.contract_artists (org_id, contract_id, artist_id)
         SELECT org_id, contract_id, $3 FROM owners.contract_artists WHERE org_id = $1 AND artist_id = $2
         ON CONFLICT DO NOTHING`,
        [from, into],
      );
      await orm().delete(contractArtists).where(orgWhere(org, contractArtists, eq(contractArtists.artistId, from)));
    },

    insertMerge: async (row: OrgFree<typeof merges.$inferInsert>) => {
      await orm().insert(merges).values(orgRow(org, row));
    },
    listMerges: (): Promise<MergeRow[]> => orm().select(C.merges).from(merges).where(orgWhere(org, merges)),

    /** Fast bulk lookup used by the facade: every (isrc, upc) pair known in module 1. */
    /** Substring search for the global search (N10); live owners and artists only, at most `limit` rows per kind. */
    searchOwners: (text: string, limit: number) =>
      orm()
        .select(C.owners)
        .from(owners)
        .where(
          orgWhere(
            org,
            owners,
            isNull(owners.mergedInto),
            or(
              containsText(owners.name, text),
              sql`${owners.id} in (select ${ownerAliases.ownerId} from ${ownerAliases} where ${orgWhere(org, ownerAliases, containsText(ownerAliases.alias, text))})`,
            ),
          ),
        )
        .orderBy(byBytes(owners.name))
        .limit(limit),
    searchArtists: (text: string, limit: number) =>
      orm()
        .select(C.artists)
        .from(artists)
        .where(orgWhere(org, artists, isNull(artists.mergedInto), containsText(artists.pseudonym, text)))
        .orderBy(byBytes(artists.pseudonym))
        .limit(limit),
    /** An exact ISRC / UPC match comes first. */
    searchTracks: (text: string, exactIsrc: string, exactUpc: string, limit: number) =>
      orm()
        .select(C.tracks)
        .from(tracks)
        .where(
          orgWhere(
            org,
            tracks,
            or(containsText(tracks.isrc, text), containsText(tracks.upc, text), containsText(tracks.title, text)),
          ),
        )
        .orderBy(
          sql`(${tracks.isrc} = ${exactIsrc} or (${exactUpc} <> '' and ${tracks.upc} = ${exactUpc})) desc`,
          byBytes(tracks.title),
          tracks.id,
        )
        .limit(limit),
    searchDocuments: (text: string, limit: number) =>
      orm()
        .select(C.documents)
        .from(documents)
        .where(orgWhere(org, documents, containsText(documents.title, text)))
        .orderBy(documents.createdAt)
        .limit(limit),

    knownPairs: (isrcs?: string[]) =>
      isrcs && isrcs.length === 0
        ? Promise.resolve([] as { isrc: string | null; upc: string | null }[])
        : orm()
            .select({ isrc: tracks.isrc, upc: tracks.upc })
            .from(tracks)
            .where(
              orgWhere(org, tracks, isNotNull(tracks.isrc), isNotNull(tracks.upc), isrcs ? inArray(tracks.isrc, isrcs) : undefined),
            ),
    // ---- catalog (D-172, 0018): the label history of an ISRC and the release registry; navigation, no money ----
    trackLabels: {
      /** The intervals of the ISRCs (all when omitted), optionally of one label; by ISRC, then `validFrom`. */
      list: (f: { isrcs?: string[]; labelId?: string } = {}): Promise<TrackLabelRow[]> =>
        f.isrcs && f.isrcs.length === 0
          ? Promise.resolve([])
          : orm()
              .select(C.trackLabels)
              .from(trackLabels)
              .where(
                orgWhere(
                  org,
                  trackLabels,
                  f.isrcs ? anyOf(trackLabels.isrc, f.isrcs) : undefined,
                  f.labelId === undefined ? undefined : eq(trackLabels.labelId, f.labelId),
                ),
              )
              .orderBy(byBytes(trackLabels.isrc), asc(trackLabels.validFrom)),
      /** Inserts the interval, or rewrites the one with this id (of this organization). */
      upsert: async (row: OrgFree<typeof trackLabels.$inferInsert>) => {
        const patch = { isrc: row.isrc, labelId: row.labelId, validFrom: row.validFrom, validTo: row.validTo, source: row.source, note: row.note };
        const updated = await orm()
          .update(trackLabels)
          .set(patch)
          .where(orgWhere(org, trackLabels, eq(trackLabels.id, row.id)))
          .returning({ id: trackLabels.id });
        if (updated.length === 0) await orm().insert(trackLabels).values(orgRow(org, row));
      },
      /** Replaces every interval of one source of an ISRC by `rows` (the other sources are not touched). */
      replaceOfIsrc: async (
        isrc: string,
        source: TrackLabelRow['source'],
        rows: OrgFree<typeof trackLabels.$inferInsert>[],
      ) => {
        await orm()
          .delete(trackLabels)
          .where(orgWhere(org, trackLabels, and(eq(trackLabels.isrc, isrc), eq(trackLabels.source, source))));
        if (rows.length > 0) await orm().insert(trackLabels).values(orgRows(org, rows));
      },
    },
    releases: {
      /** The registry rows of a label (all labels when omitted), optionally of some UPCs; by label, then UPC. */
      list: (f: { labelId?: string; upcs?: string[] } = {}): Promise<ReleaseRow[]> =>
        f.upcs && f.upcs.length === 0
          ? Promise.resolve([])
          : orm()
              .select(C.releases)
              .from(releases)
              .where(
                orgWhere(
                  org,
                  releases,
                  f.labelId === undefined ? undefined : eq(releases.labelId, f.labelId),
                  f.upcs ? anyOf(releases.upc, f.upcs) : undefined,
                ),
              )
              .orderBy(releases.labelId, byBytes(releases.upc)),
      /** Inserts the rows or rewrites them by the key `(org, label, upc)` (the key of this organization). */
      upsert: async (rows: OrgFree<typeof releases.$inferInsert>[]) => {
        if (rows.length === 0) return;
        const excluded = (col: string) => sql.raw(`excluded.${col}`);
        await orm()
          .insert(releases)
          .values(orgRows(org, rows))
          .onConflictDoUpdate({
            target: [releases.orgId, releases.labelId, releases.upc],
            set: {
              title: excluded('title'),
              version: excluded('version'),
              artistString: excluded('artist_string'),
              labelString: excluded('label_string'),
              releaseDate: excluded('release_date'),
              trackCount: excluded('track_count'),
              catalogNumber: excluded('catalog_number'),
              territories: excluded('territories'),
              stores: excluded('stores'),
              source: excluded('source'),
              fileSha256: excluded('file_sha256'),
              importedAt: excluded('imported_at'),
            },
          });
      },
    },
  };
}

export type OwnersRepository = ReturnType<typeof createOwnersRepository>;
