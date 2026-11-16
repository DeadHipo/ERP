import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgQuery, orgRows, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { publishingTerms, songIsrc, songwriterOwner, sublabelTerms } from './schema';

export type SongwriterOwnerRow = OrgFree<typeof songwriterOwner.$inferSelect>;
export type SongIsrcRow = OrgFree<typeof songIsrc.$inferSelect>;
export type PublishingTermRow = OrgFree<typeof publishingTerms.$inferSelect>;
export type SublabelTermRow = OrgFree<typeof sublabelTerms.$inferSelect>;

/** Which sublabel terms to read (D-217); the cancelled ones only on request. */
export interface SublabelTermFilter {
  sublabelId?: string;
  isrcs?: readonly string[];
  withCancelled?: boolean;
}

/** All SQL of the links module lives here (schema `links`); every statement is of the organization `org` (D-170). */
export function createLinksRepository(db: Db, org: OrgScope) {
  const q = orgQuery(db, org);
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),
    songwriterOwners: (): Promise<SongwriterOwnerRow[]> =>
      db.orm().select(orgFree(songwriterOwner)).from(songwriterOwner).where(orgWhere(org, songwriterOwner)),
    songwriterOwner: async (songwriterId: string): Promise<SongwriterOwnerRow | undefined> =>
      (
        await db
          .orm()
          .select(orgFree(songwriterOwner))
          .from(songwriterOwner)
          .where(orgWhere(org, songwriterOwner, eq(songwriterOwner.songwriterId, songwriterId)))
      )[0],
    /** The terms that count: never the cancelled ones. */
    publishingTerms: (): Promise<PublishingTermRow[]> =>
      db
        .orm()
        .select(orgFree(publishingTerms))
        .from(publishingTerms)
        .where(orgWhere(org, publishingTerms, isNull(publishingTerms.cancelledAt)))
        .orderBy(publishingTerms.validFrom),
    /** The live terms of one owner and one ISRC (null = the owner's own percent, D-192). */
    termsOfOwner: (ownerId: string, isrc: string | null): Promise<PublishingTermRow[]> =>
      db
        .orm()
        .select(orgFree(publishingTerms))
        .from(publishingTerms)
        .where(
          orgWhere(
            org,
            publishingTerms,
            and(
              eq(publishingTerms.ownerId, ownerId),
              isrc === null ? isNull(publishingTerms.isrc) : eq(publishingTerms.isrc, isrc),
              isNull(publishingTerms.cancelledAt),
            ),
          ),
        ),
    term: async (id: string): Promise<PublishingTermRow | undefined> =>
      (await db.orm().select(orgFree(publishingTerms)).from(publishingTerms).where(orgWhere(org, publishingTerms, eq(publishingTerms.id, id))))[0],
    cancelTerm: async (id: string, by: string, reason: string, at: string) => {
      await db
        .orm()
        .update(publishingTerms)
        .set({ cancelledAt: at, cancelledBy: by, cancelReason: reason })
        .where(orgWhere(org, publishingTerms, eq(publishingTerms.id, id)));
    },
    reopenTerm: async (id: string) => {
      await db.orm().update(publishingTerms).set({ validTo: null }).where(orgWhere(org, publishingTerms, eq(publishingTerms.id, id)));
    },
    closeTerm: async (id: string, validTo: string) => {
      await db.orm().update(publishingTerms).set({ validTo }).where(orgWhere(org, publishingTerms, eq(publishingTerms.id, id)));
    },
    insertTerm: async (row: PublishingTermRow) => {
      await db.orm().insert(publishingTerms).values(orgRows(org, [row]));
    },
    songIsrcs: (): Promise<SongIsrcRow[]> => db.orm().select(orgFree(songIsrc)).from(songIsrc).where(orgWhere(org, songIsrc)),
    isrcsOfSong: (songId: string): Promise<SongIsrcRow[]> =>
      db.orm().select(orgFree(songIsrc)).from(songIsrc).where(orgWhere(org, songIsrc, eq(songIsrc.songId, songId))),
    /** The whole set of a song: the rows go and the given ones come. */
    replaceSongIsrcs: async (songId: string, rows: SongIsrcRow[]) => {
      await db.orm().delete(songIsrc).where(orgWhere(org, songIsrc, eq(songIsrc.songId, songId)));
      if (rows.length > 0) await db.orm().insert(songIsrc).values(orgRows(org, rows));
    },
    /** One link per songwriter: a new decision takes the place of the old one; the audit keeps the history. */
    setSongwriterOwner: async (r: SongwriterOwnerRow) => {
      await q(
        `INSERT INTO links.songwriter_owner (org_id, songwriter_id, owner_id, source, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (org_id, songwriter_id)
         DO UPDATE SET owner_id = $3, source = $4, decided_by = $5, decided_at = $6`,
        [r.songwriterId, r.ownerId, r.source, r.decidedBy, r.decidedAt],
      );
    },
    /** The sublabel terms (D-217), by ISRC then start. */
    sublabelTerms: (f: SublabelTermFilter = {}): Promise<SublabelTermRow[]> => {
      const conds: SQL[] = [];
      if (!f.withCancelled) conds.push(isNull(sublabelTerms.cancelledAt));
      if (f.sublabelId !== undefined) conds.push(eq(sublabelTerms.sublabelId, f.sublabelId));
      if (f.isrcs !== undefined) {
        if (f.isrcs.length === 0) return Promise.resolve([]);
        conds.push(inArray(sublabelTerms.isrc, [...f.isrcs]));
      }
      return db
        .orm()
        .select(orgFree(sublabelTerms))
        .from(sublabelTerms)
        .where(orgWhere(org, sublabelTerms, ...conds))
        .orderBy(asc(sublabelTerms.isrc), asc(sublabelTerms.validFrom));
    },
    sublabelTerm: async (id: string): Promise<SublabelTermRow | undefined> =>
      (await db.orm().select(orgFree(sublabelTerms)).from(sublabelTerms).where(orgWhere(org, sublabelTerms, eq(sublabelTerms.id, id))))[0],
    insertSublabelTerms: async (rows: SublabelTermRow[]) => {
      if (rows.length > 0) await db.orm().insert(sublabelTerms).values(orgRows(org, rows));
    },
    setSublabelTermValidTo: async (id: string, validTo: string | null) => {
      await db.orm().update(sublabelTerms).set({ validTo }).where(orgWhere(org, sublabelTerms, eq(sublabelTerms.id, id)));
    },
    cancelSublabelTerm: async (id: string, by: string, reason: string, at: string) => {
      await db
        .orm()
        .update(sublabelTerms)
        .set({ cancelledAt: at, cancelledBy: by, cancelReason: reason })
        .where(orgWhere(org, sublabelTerms, eq(sublabelTerms.id, id)));
    },
    attachSublabelTermDocument: async (ids: readonly string[], documentId: string, by: string, at: string) => {
      await db
        .orm()
        .update(sublabelTerms)
        .set({ documentId, documentBy: by, documentAt: at })
        .where(orgWhere(org, sublabelTerms, inArray(sublabelTerms.id, [...ids]), isNull(sublabelTerms.documentId)));
    },
    /** D-194: a merge of owners moves the songwriters of the merged owner to the survivor. */
    reassignSongwriters: async (fromOwnerId: string, intoOwnerId: string) => {
      await q(`UPDATE links.songwriter_owner SET owner_id = $3 WHERE org_id = $1 AND owner_id = $2`, [fromOwnerId, intoOwnerId]);
    },
  };
}
