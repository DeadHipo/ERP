import { asc, eq, inArray } from 'drizzle-orm';
import type { ModuleDb } from '../../shared/db';
import { splitShares, splits, splitsSchema } from './schema';

export type SplitsDb = ModuleDb<typeof splitsSchema>;
export type SplitRow = typeof splits.$inferSelect;
export type ShareRow = typeof splitShares.$inferSelect;

export function createSplitsRepository(db: SplitsDb) {
  const { orm } = db;
  return {
    transaction<T>(fn: () => T): T {
      return db.sqlite.transaction(fn)();
    },
    insertSplit: (row: typeof splits.$inferInsert) => orm.insert(splits).values(row).run(),
    insertShare: (row: typeof splitShares.$inferInsert) => orm.insert(splitShares).values(row).run(),
    getSplit: (id: string) => orm.select().from(splits).where(eq(splits.id, id)).get(),
    splitsOfIsrc: (isrc: string) =>
      orm.select().from(splits).where(eq(splits.isrc, isrc)).orderBy(asc(splits.validFrom)).all(),
    allSplits: () => orm.select().from(splits).orderBy(asc(splits.isrc), asc(splits.validFrom)).all(),
    setValidTo: (id: string, validTo: string | null) =>
      orm.update(splits).set({ validTo }).where(eq(splits.id, id)).run(),
    setDocument: (id: string, documentId: string) =>
      orm.update(splits).set({ documentId }).where(eq(splits.id, id)).run(),
    sharesOf: (splitIds: string[]) =>
      splitIds.length === 0
        ? []
        : orm.select().from(splitShares).where(inArray(splitShares.splitId, splitIds)).all(),
    allShares: () => orm.select().from(splitShares).all(),
    splitIdsOfArtist: (artistId: string) =>
      orm
        .select({ splitId: splitShares.splitId })
        .from(splitShares)
        .where(eq(splitShares.artistId, artistId))
        .all()
        .map((r) => r.splitId),
  };
}
