import { desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgRows, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { expenses } from './schema';

export type ExpenseRow = OrgFree<typeof expenses.$inferSelect>;

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

/** All SQL of the ads module lives here (schema `ads`); every statement is of the organization `org` (D-170). */
export function createAdsRepository(db: Db, org: OrgScope) {
  const orm = () => db.orm();
  const C = orgFree(expenses);
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),
    insert: async (rows: OrgFree<typeof expenses.$inferInsert>[]) => {
      if (rows.length > 0) await orm().insert(expenses).values(orgRows(org, rows));
    },
    get: async (id: string): Promise<ExpenseRow | undefined> =>
      (await orm().select(C).from(expenses).where(orgWhere(org, expenses, eq(expenses.id, id))))[0],
    /** External refs that already exist among the given ones. */
    existingRefs: async (refs: string[]): Promise<Set<string>> => {
      if (refs.length === 0) return new Set();
      const out = new Set<string>();
      for (let i = 0; i < refs.length; i += 5000) {
        const rows = await orm()
          .select({ r: expenses.externalRef })
          .from(expenses)
          .where(orgWhere(org, expenses, inArray(expenses.externalRef, refs.slice(i, i + 5000))));
        for (const r of rows) if (r.r) out.add(r.r);
      }
      return out;
    },
    /** Newest month first. */
    list: (f: ExpenseFilter = {}) =>
      orm()
        .select(C)
        .from(expenses)
        .where(
          orgWhere(
            org,
            expenses,
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
    all: () => orm().select(C).from(expenses).where(orgWhere(org, expenses)),
    update: async (
      id: string,
      set: Partial<Pick<ExpenseRow, 'recoveryPercent' | 'scope' | 'deactivatedAt' | 'deactivatedReason' | 'labelId'>>,
    ) => {
      await orm().update(expenses).set(set).where(orgWhere(org, expenses, eq(expenses.id, id)));
    },
    /** Sets the label of a record that has none (a migration script, D-169); false when it already has one. */
    assignLabel: async (id: string, labelId: string): Promise<boolean> =>
      (
        await orm()
          .update(expenses)
          .set({ labelId })
          .where(orgWhere(org, expenses, eq(expenses.id, id), isNull(expenses.labelId)))
          .returning({ id: expenses.id })
      ).length > 0,
  };
}

export type AdsRepository = ReturnType<typeof createAdsRepository>;
