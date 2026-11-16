import { assertDate, nowIso } from '../../shared/dates';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { assertIsrc, newId } from '../../shared/identifiers';
import { Decimal } from '../../shared/money';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import {
  createLinksRepository,
  type PublishingTermRow,
  type SongIsrcRow,
  type SongwriterOwnerRow,
  type SublabelTermFilter,
  type SublabelTermRow,
} from './repository';

export type { PublishingTermRow, SongIsrcRow, SongwriterOwnerRow, SublabelTermFilter, SublabelTermRow };

/** A new sublabel term as the facade hands it (D-217): the dates already floored to a month start. */
export interface NewSublabelTerm {
  sublabelId: string;
  isrc: string;
  percent: string;
  validFrom: string;
  validTo?: string | null;
  documentId?: string | null;
  note?: string | null;
}

/** A sublabel percent: above 0, at most 100, at most 6 decimals (numeric(9,6)). */
function sublabelPercent(raw: string): string {
  const p = String(raw).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(p)) throw new ValidationError(`Invalid percent "${raw}" (above 0, up to 100, 6 decimals)`, undefined, 'percent_invalid');
  const d = new Decimal(p);
  if (d.isZero() || d.gt(100)) throw new ValidationError(`Invalid percent "${raw}" (above 0, up to 100)`, undefined, 'percent_invalid');
  return d.toFixed();
}

/** The first day of a month, as the terms store them (M52: the facade floors the dates before). */
function monthStartDate(raw: string, field: string): string {
  const d = assertDate(raw);
  if (!d.endsWith('-01')) throw new ValidationError(`${field} must be the first day of a month: "${raw}"`, undefined, 'date_invalid');
  return d;
}

const canonicalSublabelTerm = (r: SublabelTermRow): SublabelTermRow => ({ ...r, percent: new Decimal(r.percent).toFixed() });

/** The links between modules (D-183): it stores decisions and checks nothing; the facade knows both sides. */
export function createLinksService(db: Db, org: OrgScope) {
  const repo = createLinksRepository(db, org);
  return {
    songwriterOwners: () => repo.songwriterOwners(),
    /** Every term with a canonical percent, oldest first. */
    publishingTerms: async (): Promise<PublishingTermRow[]> =>
      (await repo.publishingTerms()).map((r) => ({ ...r, percent: new Decimal(r.percent).toFixed() })),
    /** The owners' own percents (no ISRC). */
    ownerTerms: async (): Promise<PublishingTermRow[]> =>
      (await repo.publishingTerms()).filter((r) => r.isrc === null).map((r) => ({ ...r, percent: new Decimal(r.percent).toFixed() })),
    /** The terms of one track (D-192). */
    isrcTerms: async (): Promise<PublishingTermRow[]> =>
      (await repo.publishingTerms()).filter((r) => r.isrc !== null).map((r) => ({ ...r, percent: new Decimal(r.percent).toFixed() })),
    /**
     * A new percent from a date: a term is never edited. The open term of the owner (and operation type) gets
     * `valid_to` = the date and a new row opens; a date on or before the start of a term is `terms_overlap`.
     */
    async setPublishingTerm(input: {
      ownerId: string;
      percent: string;
      validFrom: string;
      documentId?: string | null;
      /** D-192: the term of one track; absent = the owner's own percent. */
      isrc?: string | null;
      basis?: string | null;
      decidedBy: string;
    }): Promise<PublishingTermRow> {
      if (!/^\d+(\.\d+)?$/.test(input.percent) || new Decimal(input.percent).gt(100))
        throw new ValidationError(`Invalid author percent "${input.percent}"`);
      const validFrom = assertDate(input.validFrom);
      return repo.transaction(async () => {
        const isrc = input.isrc ?? null;
        const same = await repo.termsOfOwner(input.ownerId, isrc);
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
          isrc,
          basis: input.basis?.trim() || null,
          decidedBy: input.decidedBy,
          createdAt: nowIso(),
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
        };
        await repo.insertTerm(row);
        return row;
      });
    },
    /**
     * A mistaken term is cancelled, never deleted (D-188): only the latest term of its owner, and the term it had
     * closed is open again. The cancelled row stays with who, when and why.
     */
    async cancelPublishingTerm(id: string, by: string, reason: string): Promise<{ id: string; reopened: string | null }> {
      if (!reason.trim()) throw new ValidationError('A reason is required');
      return repo.transaction(async () => {
        const term = await repo.term(id);
        if (!term || term.cancelledAt) throw new NotFoundError('Publishing term', id);
        const others = (await repo.termsOfOwner(term.ownerId, term.isrc)).filter((t) => t.id !== id);
        if (others.some((t) => t.validFrom > term.validFrom))
          throw new ConflictError('Only the latest term of an owner can be cancelled', 'term_not_last');
        await repo.cancelTerm(id, by, reason.trim(), nowIso());
        const previous = others.find((t) => t.validTo === term.validFrom);
        if (previous) await repo.reopenTerm(previous.id);
        return { id, reopened: previous?.id ?? null };
      });
    },
    /** The sublabel terms (D-217), by ISRC then start; the cancelled ones only on request. */
    sublabelTerms: async (f: SublabelTermFilter = {}): Promise<SublabelTermRow[]> =>
      (await repo.sublabelTerms(f)).map(canonicalSublabelTerm),

    async sublabelTerm(id: string): Promise<SublabelTermRow> {
      const t = await repo.sublabelTerm(id);
      if (!t) throw new NotFoundError('Sublabel term', id);
      return canonicalSublabelTerm(t);
    },

    /**
     * New sublabel terms, all or nothing (D-217), the rules of the publishing terms: one live term per ISRC at a month;
     * a new term closes the open term of its ISRC at its start; a start on or before the start of a live term, or inside
     * a closed one, is `term_overlap`. A term is never edited.
     */
    async addSublabelTerms(input: readonly NewSublabelTerm[], decidedBy: string): Promise<SublabelTermRow[]> {
      const at = nowIso();
      const rows: SublabelTermRow[] = input.map((t) => {
        const validFrom = monthStartDate(t.validFrom, 'validFrom');
        const validTo = t.validTo ? monthStartDate(t.validTo, 'validTo') : null;
        if (validTo !== null && validTo <= validFrom)
          throw new ValidationError(`The term of ${t.isrc} ends before it starts`, undefined, 'empty_period');
        return {
          id: newId(),
          sublabelId: t.sublabelId,
          isrc: assertIsrc(t.isrc),
          percent: sublabelPercent(t.percent),
          validFrom,
          validTo,
          documentId: t.documentId ?? null,
          note: t.note?.trim() || null,
          decidedBy,
          decidedAt: at,
          documentBy: null,
          documentAt: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
        };
      });
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.isrc)) throw new ValidationError(`ISRC ${r.isrc} twice in one request`, undefined, 'duplicate_in_request');
        seen.add(r.isrc);
      }
      return repo.transaction(async () => {
        const live = await repo.sublabelTerms({ isrcs: [...seen] });
        for (const r of rows) {
          const same = live.filter((t) => t.isrc === r.isrc);
          const clash = same.find((t) => t.validFrom >= r.validFrom || (t.validTo !== null && t.validTo > r.validFrom));
          if (clash)
            throw new ConflictError(`A term of ${r.isrc} already covers ${r.validFrom}`, 'term_overlap', { isrc: r.isrc, termId: clash.id });
          const open = same.find((t) => t.validTo === null);
          if (open) await repo.setSublabelTermValidTo(open.id, r.validFrom);
        }
        await repo.insertSublabelTerms(rows);
        return rows;
      });
    },

    /** Closes an open term from a month (exclusive end); a closed or cancelled term is refused. */
    async closeSublabelTerm(id: string, validToRaw: string): Promise<SublabelTermRow> {
      const validTo = monthStartDate(validToRaw, 'validTo');
      return repo.transaction(async () => {
        const t = await repo.sublabelTerm(id);
        if (!t || t.cancelledAt) throw new NotFoundError('Sublabel term', id);
        if (t.validTo !== null) throw new ConflictError('The term is already closed', 'term_closed');
        if (validTo <= t.validFrom) throw new ValidationError('The term would end before it starts', undefined, 'empty_period');
        await repo.setSublabelTermValidTo(id, validTo);
        return canonicalSublabelTerm({ ...t, validTo });
      });
    },

    /**
     * A mistaken term is cancelled, never deleted (as D-188): only the latest term of its ISRC, and the term it had
     * closed is open again. The row stays with who, when and why.
     */
    async cancelSublabelTerm(id: string, by: string, reason: string): Promise<{ id: string; reopened: string | null }> {
      if (!reason.trim()) throw new ValidationError('A reason is required');
      return repo.transaction(async () => {
        const term = await repo.sublabelTerm(id);
        if (!term || term.cancelledAt) throw new NotFoundError('Sublabel term', id);
        const others = (await repo.sublabelTerms({ isrcs: [term.isrc] })).filter((t) => t.id !== id);
        if (others.some((t) => t.validFrom > term.validFrom))
          throw new ConflictError('Only the latest term of an ISRC can be cancelled', 'term_not_last');
        await repo.cancelSublabelTerm(id, by, reason.trim(), nowIso());
        const previous = others.find((t) => t.validTo === term.validFrom);
        if (previous) await repo.setSublabelTermValidTo(previous.id, null);
        return { id, reopened: previous?.id ?? null };
      });
    },

    /** A document attached later to live terms that have none: the one allowed change of a term (409 otherwise). */
    async attachSublabelTermDocument(ids: readonly string[], documentId: string, by: string): Promise<SublabelTermRow[]> {
      if (ids.length === 0) throw new ValidationError('No terms given');
      return repo.transaction(async () => {
        const terms = await Promise.all(ids.map((id) => repo.sublabelTerm(id)));
        terms.forEach((t, i) => {
          if (!t || t.cancelledAt) throw new NotFoundError('Sublabel term', ids[i] as string);
          if (t.documentId !== null) throw new ConflictError(`The term ${t.id} already has a document`, 'term_has_document');
        });
        await repo.attachSublabelTermDocument(ids, documentId, by, nowIso());
        return (await Promise.all(ids.map((id) => repo.sublabelTerm(id)))).map((t) => canonicalSublabelTerm(t as SublabelTermRow));
      });
    },

    songIsrcs: () => repo.songIsrcs(),
    isrcsOfSong: (songId: string) => repo.isrcsOfSong(songId),
    /** The set of ISRCs of a song, as the operator left it. */
    async setSongIsrcs(
      song: { songId: string; songwriterId: string },
      rows: { isrc: string; source: 'recommended' | 'manual' }[],
      decidedBy: string,
    ) {
      const { songId, songwriterId } = song;
      const decidedAt = nowIso();
      return repo.transaction(async () => {
        await repo.replaceSongIsrcs(songId, rows.map((r) => ({ ...r, songId, songwriterId, decidedBy, decidedAt })));
        return repo.isrcsOfSong(songId);
      });
    },
    /**
     * A merge of owners (D-194): the songwriters follow the survivor. The terms stay with their record, as in the old
     * module: the calculation resolves them through the merge and the survivor's own terms win.
     */
    reassignOwner: (fromOwnerId: string, intoOwnerId: string) =>
      repo.transaction(() => repo.reassignSongwriters(fromOwnerId, intoOwnerId)),
    async setSongwriterOwner(input: Omit<SongwriterOwnerRow, 'decidedAt'>): Promise<SongwriterOwnerRow> {
      await repo.setSongwriterOwner({ ...input, decidedAt: nowIso() });
      return (await repo.songwriterOwner(input.songwriterId)) as SongwriterOwnerRow;
    },
  };
}

export type LinksService = ReturnType<typeof createLinksService>;
