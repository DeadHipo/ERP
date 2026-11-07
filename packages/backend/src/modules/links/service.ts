import { assertDate, nowIso } from '../../shared/dates';
import { ConflictError, ValidationError } from '../../shared/errors';
import { newId } from '../../shared/identifiers';
import { Decimal } from '../../shared/money';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createLinksRepository, type PublishingTermRow, type SongIsrcRow, type SongwriterOwnerRow } from './repository';

export type { PublishingTermRow, SongIsrcRow, SongwriterOwnerRow };

/** The links between modules (D-183): it stores decisions and checks nothing; the facade knows both sides. */
export function createLinksService(db: Db, org: OrgScope) {
  const repo = createLinksRepository(db, org);
  return {
    songwriterOwners: () => repo.songwriterOwners(),
    /** Every term with a canonical percent, oldest first. */
    publishingTerms: async (): Promise<PublishingTermRow[]> =>
      (await repo.publishingTerms()).map((r) => ({ ...r, percent: new Decimal(r.percent).toFixed() })),
    /**
     * A new percent from a date: a term is never edited. The open term of the owner (and operation type) gets
     * `valid_to` = the date and a new row opens; a date on or before the start of a term is `terms_overlap`.
     */
    async setPublishingTerm(input: {
      ownerId: string;
      percent: string;
      validFrom: string;
      documentId?: string | null;
      operationType?: string | null;
      decidedBy: string;
    }): Promise<PublishingTermRow> {
      if (!/^\d+(\.\d+)?$/.test(input.percent) || new Decimal(input.percent).gt(100))
        throw new ValidationError(`Invalid author percent "${input.percent}"`);
      const validFrom = assertDate(input.validFrom);
      const operationType = input.operationType ?? null;
      return repo.transaction(async () => {
        const same = (await repo.termsOfOwner(input.ownerId)).filter((t) => t.operationType === operationType);
        if (same.some((t) => t.validFrom >= validFrom))
          throw new ConflictError('Publishing terms already start on or after this date', 'terms_overlap');
        const open = same.find((t) => t.validTo === null);
        if (open) await repo.closeTerm(open.id, validFrom);
        const row: PublishingTermRow = {
          id: newId(),
          ownerId: input.ownerId,
          percent: input.percent,
          validFrom,
          validTo: null,
          documentId: input.documentId ?? null,
          operationType,
          decidedBy: input.decidedBy,
          createdAt: nowIso(),
        };
        await repo.insertTerm(row);
        return row;
      });
    },
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
