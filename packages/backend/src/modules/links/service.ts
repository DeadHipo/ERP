import { nowIso } from '../../shared/dates';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createLinksRepository, type SongwriterOwnerRow } from './repository';

export type { SongwriterOwnerRow };

/** The links between modules (D-183): it stores decisions and checks nothing; the facade knows both sides. */
export function createLinksService(db: Db, org: OrgScope) {
  const repo = createLinksRepository(db, org);
  return {
    songwriterOwners: () => repo.songwriterOwners(),
    async setSongwriterOwner(input: Omit<SongwriterOwnerRow, 'decidedAt'>): Promise<SongwriterOwnerRow> {
      await repo.setSongwriterOwner({ ...input, decidedAt: nowIso() });
      return (await repo.songwriterOwner(input.songwriterId)) as SongwriterOwnerRow;
    },
  };
}

export type LinksService = ReturnType<typeof createLinksService>;
