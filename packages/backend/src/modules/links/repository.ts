import { eq } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgQuery, orgRows, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { publishingTerms, songIsrc, songwriterOwner } from './schema';

export type SongwriterOwnerRow = OrgFree<typeof songwriterOwner.$inferSelect>;
export type SongIsrcRow = OrgFree<typeof songIsrc.$inferSelect>;
export type PublishingTermRow = OrgFree<typeof publishingTerms.$inferSelect>;

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
    publishingTerms: (): Promise<PublishingTermRow[]> =>
      db.orm().select(orgFree(publishingTerms)).from(publishingTerms).where(orgWhere(org, publishingTerms)).orderBy(publishingTerms.validFrom),
    termsOfOwner: (ownerId: string): Promise<PublishingTermRow[]> =>
      db.orm().select(orgFree(publishingTerms)).from(publishingTerms).where(orgWhere(org, publishingTerms, eq(publishingTerms.ownerId, ownerId))),
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
  };
}
