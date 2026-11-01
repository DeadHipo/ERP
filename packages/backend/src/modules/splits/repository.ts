import { asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { Decimal } from '../../shared/money';
import { splitShares, splits } from './schema';

export type SplitRow = typeof splits.$inferSelect;
export type ShareRow = typeof splitShares.$inferSelect;

/** PostgreSQL pads numeric(9,6) with zeros; the application keeps percents as they were entered ('14.34'). */
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
    splitIdsOfArtist: async (artistId: string) =>
      (
        await orm()
          .select({ splitId: splitShares.splitId })
          .from(splitShares)
          .where(eq(splitShares.artistId, artistId))
      ).map((r) => r.splitId),
  };
}
