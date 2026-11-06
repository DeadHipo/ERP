import { eq } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgQuery, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { songwriterOwner } from './schema';

export type SongwriterOwnerRow = OrgFree<typeof songwriterOwner.$inferSelect>;

/** All SQL of the links module lives here (schema `links`); every statement is of the organization `org` (D-170). */
export function createLinksRepository(db: Db, org: OrgScope) {
  const q = orgQuery(db, org);
  return {
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
