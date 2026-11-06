import { nowIso } from '../../shared/dates';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createLinksRepository, type SongIsrcRow, type SongwriterOwnerRow } from './repository';

export type { SongIsrcRow, SongwriterOwnerRow };

/** The links between modules (D-183): it stores decisions and checks nothing; the facade knows both sides. */
export function createLinksService(db: Db, org: OrgScope) {
  const repo = createLinksRepository(db, org);
  return {
    songwriterOwners: () => repo.songwriterOwners(),
    songIsrcs: () => repo.songIsrcs(),
    isrcsOfSong: (songId: string) => repo.isrcsOfSong(songId),
    /** The set of ISRCs of a song, as the operator left it. */
    async setSongIsrcs(songId: string, rows: { isrc: string; source: 'recommended' | 'manual' }[], decidedBy: string) {
      const decidedAt = nowIso();
      return repo.transaction(async () => {
        await repo.replaceSongIsrcs(songId, rows.map((r) => ({ ...r, songId, decidedBy, decidedAt })));
        return repo.isrcsOfSong(songId);
      });
    },
    async setSongwriterOwner(input: Omit<SongwriterOwnerRow, 'decidedAt'>): Promise<SongwriterOwnerRow> {
      await repo.setSongwriterOwner({ ...input, decidedAt: nowIso() });
      return (await repo.songwriterOwner(input.songwriterId)) as SongwriterOwnerRow;
    },
  };
}

export type LinksService = ReturnType<typeof createLinksService>;
