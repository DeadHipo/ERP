import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { Decimal } from '../../shared/money';
import { participations, splitShares, splits } from './schema';

export type SplitRow = typeof splits.$inferSelect;
export type ShareRow = typeof splitShares.$inferSelect;
export type ParticipationRow = typeof participations.$inferSelect;

/** PostgreSQL pads numeric(9,6) with zeros; the application keeps percents as they were entered ('14.34'). */
const canonicalPart = (r: ParticipationRow): ParticipationRow => ({
  ...r,
  percent: new Decimal(r.percent).toFixed(),
});
const canonicalShare = (r: ShareRow): ShareRow => ({ ...r, percent: new Decimal(r.percent).toFixed() });

/** All SQL of the splits module lives here (schema `splits`). */
export function createSplitsRepository(db: Db) {
  const orm = () => db.orm();
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),
    insertSplit: async (row: typeof splits.$inferInsert) => {
      await orm().insert(splits).values(row);
    },
    insertShares: async (rows: (typeof splitShares.$inferInsert)[]) => {
      if (rows.length > 0) await orm().insert(splitShares).values(rows);
    },
    getSplit: async (id: string) => (await orm().select().from(splits).where(eq(splits.id, id)))[0],
    splitsOfIsrc: (isrc: string) =>
      orm().select().from(splits).where(eq(splits.isrc, isrc)).orderBy(asc(splits.validFrom)),
    allSplits: () => orm().select().from(splits).orderBy(asc(splits.isrc), asc(splits.validFrom)),
    setValidTo: async (id: string, validTo: string | null) => {
      await orm().update(splits).set({ validTo }).where(eq(splits.id, id));
    },
    setDocument: async (id: string, documentId: string) => {
      await orm().update(splits).set({ documentId }).where(eq(splits.id, id));
    },
    sharesOf: async (splitIds: string[]) =>
      splitIds.length === 0
        ? []
        : (await orm().select().from(splitShares).where(inArray(splitShares.splitId, splitIds))).map(
            canonicalShare,
          ),
    allShares: async () => (await orm().select().from(splitShares)).map(canonicalShare),
    insertParticipation: async (row: typeof participations.$inferInsert) => {
      await orm().insert(participations).values(row);
    },
    getParticipation: async (id: string) => {
      const r = (await orm().select().from(participations).where(eq(participations.id, id)))[0];
      return r ? canonicalPart(r) : undefined;
    },
    setParticipationValidTo: async (id: string, validTo: string | null) => {
      await orm().update(participations).set({ validTo }).where(eq(participations.id, id));
    },
    participationsOfIsrc: async (isrc: string) =>
      (
        await orm()
          .select()
          .from(participations)
          .where(eq(participations.isrc, isrc))
          .orderBy(asc(participations.validFrom), asc(participations.id))
      ).map(canonicalPart),
    allParticipations: async () =>
      (
        await orm()
          .select()
          .from(participations)
          .orderBy(asc(participations.isrc), asc(participations.validFrom), asc(participations.id))
      ).map(canonicalPart),
    participationsOfArtist: async (artistId: string) =>
      (
        await orm()
          .select()
          .from(participations)
          .where(eq(participations.artistId, artistId))
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
      const victims = (await orm().select({ id: splits.id }).from(splits).where(empty)).map((r) => r.id);
      if (victims.length === 0) return [];
      await orm().delete(splitShares).where(inArray(splitShares.splitId, victims));
      await orm().delete(splits).where(inArray(splits.id, victims));
      return victims;
    },
    /** Migration loader only (D-137): deletes participations by id (rows the loader created, found by its marker). */
    deleteParticipations: async (ids: string[]): Promise<number> => {
      if (ids.length === 0) return 0;
      return (
        await orm()
          .delete(participations)
          .where(inArray(participations.id, ids))
          .returning({ id: participations.id })
      ).length;
    },
    splitIdsOfArtist: async (artistId: string) =>
      (
        await orm()
          .select({ splitId: splitShares.splitId })
          .from(splitShares)
          .where(eq(splitShares.artistId, artistId))
      ).map((r) => r.splitId),
  };
}
