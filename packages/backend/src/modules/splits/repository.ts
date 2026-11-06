import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { Decimal } from '../../shared/money';
import { orgFree, orgRow, orgRows, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { participations, splitShares, splits } from './schema';

export type SplitRow = OrgFree<typeof splits.$inferSelect>;
export type ShareRow = OrgFree<typeof splitShares.$inferSelect>;
export type ParticipationRow = OrgFree<typeof participations.$inferSelect>;

/** PostgreSQL pads numeric(9,6) with zeros; the application keeps percents as they were entered ('14.34'). */
const canonicalPart = (r: ParticipationRow): ParticipationRow => ({
  ...r,
  percent: new Decimal(r.percent).toFixed(),
});
const canonicalShare = (r: ShareRow): ShareRow => ({ ...r, percent: new Decimal(r.percent).toFixed() });

/** All SQL of the splits module lives here (schema `splits`); every statement is of the organization `org` (D-170). */
export function createSplitsRepository(db: Db, org: OrgScope) {
  const orm = () => db.orm();
  const C = {
    splits: orgFree(splits),
    splitShares: orgFree(splitShares),
    participations: orgFree(participations),
  };
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),
    insertSplit: async (row: OrgFree<typeof splits.$inferInsert>) => {
      await orm().insert(splits).values(orgRow(org, row));
    },
    insertShares: async (rows: OrgFree<typeof splitShares.$inferInsert>[]) => {
      if (rows.length > 0) await orm().insert(splitShares).values(orgRows(org, rows));
    },
    getSplit: async (id: string) =>
      (await orm().select(C.splits).from(splits).where(orgWhere(org, splits, eq(splits.id, id))))[0],
    splitsOfIsrc: (isrc: string) =>
      orm()
        .select(C.splits)
        .from(splits)
        .where(orgWhere(org, splits, eq(splits.isrc, isrc)))
        .orderBy(asc(splits.validFrom)),
    /** Every split, or (the unit scope of the facade, D-162) only those of the given ISRCs. */
    allSplits: (isrcs?: string[]) =>
      isrcs && isrcs.length === 0
        ? Promise.resolve([] as SplitRow[])
        : orm()
            .select(C.splits)
            .from(splits)
            .where(orgWhere(org, splits, isrcs ? inArray(splits.isrc, isrcs) : undefined))
            .orderBy(asc(splits.isrc), asc(splits.validFrom)),
    setValidTo: async (id: string, validTo: string | null) => {
      await orm().update(splits).set({ validTo }).where(orgWhere(org, splits, eq(splits.id, id)));
    },
    setDocument: async (id: string, documentId: string) => {
      await orm().update(splits).set({ documentId }).where(orgWhere(org, splits, eq(splits.id, id)));
    },
    sharesOf: async (splitIds: string[]) =>
      splitIds.length === 0
        ? []
        : (
            await orm()
              .select(C.splitShares)
              .from(splitShares)
              .where(orgWhere(org, splitShares, inArray(splitShares.splitId, splitIds)))
          ).map(canonicalShare),
    allShares: async () =>
      (await orm().select(C.splitShares).from(splitShares).where(orgWhere(org, splitShares))).map(canonicalShare),
    insertParticipation: async (row: OrgFree<typeof participations.$inferInsert>) => {
      await orm().insert(participations).values(orgRow(org, row));
    },
    getParticipation: async (id: string) => {
      const r = (
        await orm()
          .select(C.participations)
          .from(participations)
          .where(orgWhere(org, participations, eq(participations.id, id)))
      )[0];
      return r ? canonicalPart(r) : undefined;
    },
    setParticipationValidTo: async (id: string, validTo: string | null) => {
      await orm()
        .update(participations)
        .set({ validTo })
        .where(orgWhere(org, participations, eq(participations.id, id)));
    },
    participationsOfIsrc: async (isrc: string) =>
      (
        await orm()
          .select(C.participations)
          .from(participations)
          .where(orgWhere(org, participations, eq(participations.isrc, isrc)))
          .orderBy(asc(participations.validFrom), asc(participations.id))
      ).map(canonicalPart),
    allParticipations: async (isrcs?: string[]) =>
      isrcs && isrcs.length === 0
        ? []
        : (
            await orm()
              .select(C.participations)
              .from(participations)
              .where(orgWhere(org, participations, isrcs ? inArray(participations.isrc, isrcs) : undefined))
              .orderBy(asc(participations.isrc), asc(participations.validFrom), asc(participations.id))
          ).map(canonicalPart),
    participationsOfArtist: async (artistId: string) =>
      (
        await orm()
          .select(C.participations)
          .from(participations)
          .where(orgWhere(org, participations, eq(participations.artistId, artistId)))
          .orderBy(asc(participations.isrc), asc(participations.validFrom), asc(participations.id))
      ).map(canonicalPart),
    /**
     * Data hygiene of the migration loader only (D-137, `scripts/mvp`): deletes splits whose period is empty
     * (`valid_to = valid_from`, never in force, no money) with their shares. A split with a non-empty period is never
     * deleted (the guard is in the WHERE). Returns the ids deleted.
     */
    deleteEmptySplits: async (ids: string[]): Promise<string[]> => {
      if (ids.length === 0) return [];
      const empty = and(inArray(splits.id, ids), sql`${splits.validTo} = ${splits.validFrom}`);
      const victims = (await orm().select({ id: splits.id }).from(splits).where(orgWhere(org, splits, empty))).map(
        (r) => r.id,
      );
      if (victims.length === 0) return [];
      await orm().delete(splitShares).where(orgWhere(org, splitShares, inArray(splitShares.splitId, victims)));
      await orm().delete(splits).where(orgWhere(org, splits, inArray(splits.id, victims)));
      return victims;
    },
    /** Migration loader only (D-137): deletes participations by id (rows the loader created, found by its marker). */
    deleteParticipations: async (ids: string[]): Promise<number> => {
      if (ids.length === 0) return 0;
      return (
        await orm()
          .delete(participations)
          .where(orgWhere(org, participations, inArray(participations.id, ids)))
          .returning({ id: participations.id })
      ).length;
    },
    splitIdsOfArtist: async (artistId: string) =>
      (
        await orm()
          .select({ splitId: splitShares.splitId })
          .from(splitShares)
          .where(orgWhere(org, splitShares, eq(splitShares.artistId, artistId)))
      ).map((r) => r.splitId),
  };
}
