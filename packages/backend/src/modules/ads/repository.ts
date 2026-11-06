import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { expenses } from './schema';

export type ExpenseRow = typeof expenses.$inferSelect;

export interface ExpenseFilter {
  isrc?: string;
  artistIds?: string[];
  /** Inclusive months as first days YYYY-MM-01. */
  from?: string;
  to?: string;
  active?: boolean;
  /** The payer (D-169): an own label id; null = the records without a label. */
  labelId?: string | null;
}

/** All SQL of the ads module lives here (schema `ads`). */
export function createAdsRepository(db: Db) {
  const orm = () => db.orm();
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),
    insert: async (rows: (typeof expenses.$inferInsert)[]) => {
      if (rows.length > 0) await orm().insert(expenses).values(rows);
    },
    get: async (id: string): Promise<ExpenseRow | undefined> =>
      (await orm().select().from(expenses).where(eq(expenses.id, id)))[0],
    /** External refs that already exist among the given ones. */
    existingRefs: async (refs: string[]): Promise<Set<string>> => {
      if (refs.length === 0) return new Set();
      const out = new Set<string>();
      for (let i = 0; i < refs.length; i += 5000) {
        const rows = await orm()
          .select({ r: expenses.externalRef })
          .from(expenses)
          .where(inArray(expenses.externalRef, refs.slice(i, i + 5000)));
        for (const r of rows) if (r.r) out.add(r.r);
      }
      return out;
    },
    /** Newest month first. */
    list: (f: ExpenseFilter = {}) =>
      orm()
        .select()
        .from(expenses)
        .where(
          and(
            f.isrc ? eq(expenses.isrc, f.isrc) : undefined,
            f.artistIds ? inArray(expenses.artistId, f.artistIds.length ? f.artistIds : ['']) : undefined,
            f.from ? gte(expenses.month, f.from) : undefined,
            f.to ? lte(expenses.month, f.to) : undefined,
            f.labelId === undefined ? undefined : f.labelId === null ? isNull(expenses.labelId) : eq(expenses.labelId, f.labelId),
            f.active === undefined
              ? undefined
              : f.active
                ? isNull(expenses.deactivatedAt)
                : sql`${expenses.deactivatedAt} is not null`,
          ),
        )
        .orderBy(desc(expenses.month), desc(expenses.createdAt), expenses.id),
    all: () => orm().select().from(expenses),
    update: async (
      id: string,
      set: Partial<Pick<ExpenseRow, 'recoveryPercent' | 'scope' | 'deactivatedAt' | 'deactivatedReason' | 'labelId'>>,
    ) => {
      await orm().update(expenses).set(set).where(eq(expenses.id, id));
    },
    /** Sets the label of a record that has none (a migration script, D-169); false when it already has one. */
    assignLabel: async (id: string, labelId: string): Promise<boolean> =>
      (
        await orm()
          .update(expenses)
          .set({ labelId })
          .where(and(eq(expenses.id, id), isNull(expenses.labelId)))
          .returning({ id: expenses.id })
      ).length > 0,
  };
}

export type AdsRepository = ReturnType<typeof createAdsRepository>;
