import { and, desc, eq, gte, isNotNull, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { operations, payoutSnapshots } from './schema';

export type OperationRow = typeof operations.$inferSelect;

export interface OperationFilter {
  ownerId?: string;
  artistId?: string;
  direction?: 'in' | 'out';
  /** Derived in SQL from direction, sign, scope and operation_ref, exactly as `meaningOf`. */
  meaning?: 'payout' | 'recoupable_payout' | 'deduction' | 'credit' | 'return';
  /** A payout (out) still active without a payment proof. */
  needsProof?: boolean;
  active?: boolean;
  /** Inclusive dates YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Operations of one own label (D-168); `null` = the operations without a label. */
  labelId?: string | null;
}

/** All SQL of the settlements module lives here (schema `settlements`). */
export function createSettlementsRepository(db: Db) {
  const orm = () => db.orm();
  return {
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),

    insertOperation: async (row: typeof operations.$inferInsert) => {
      await orm().insert(operations).values(row);
    },
    getOperation: async (id: string): Promise<OperationRow | undefined> =>
      (await orm().select().from(operations).where(eq(operations.id, id)))[0],
    /** Newest first. */
    listOperations: (f: OperationFilter = {}) => {
      const meaning = (m: NonNullable<OperationFilter['meaning']>): SQL =>
        m === 'payout'
          ? (and(eq(operations.direction, 'out'), isNull(operations.scope)) as SQL)
          : m === 'recoupable_payout'
            ? (and(eq(operations.direction, 'out'), isNotNull(operations.scope)) as SQL)
            : m === 'return'
              ? (and(
                  eq(operations.direction, 'in'),
                  lt(operations.amountCents, 0),
                  isNotNull(operations.operationRef),
                ) as SQL)
              : m === 'credit'
                ? (and(
                    eq(operations.direction, 'in'),
                    lt(operations.amountCents, 0),
                    isNull(operations.operationRef),
                  ) as SQL)
                : (and(eq(operations.direction, 'in'), gte(operations.amountCents, 0)) as SQL);
      return orm()
        .select()
        .from(operations)
        .where(
          and(
            f.ownerId ? eq(operations.ownerId, f.ownerId) : undefined,
            f.artistId ? eq(operations.artistId, f.artistId) : undefined,
            f.direction ? eq(operations.direction, f.direction) : undefined,
            f.meaning ? meaning(f.meaning) : undefined,
            f.active === undefined
              ? undefined
              : f.active
                ? isNull(operations.deactivatedAt)
                : sql`${operations.deactivatedAt} is not null`,
            f.needsProof
              ? and(
                  eq(operations.direction, 'out'),
                  isNull(operations.paymentProofId),
                  isNull(operations.deactivatedAt),
                )
              : undefined,
            f.from ? gte(operations.date, f.from) : undefined,
            f.to ? lte(operations.date, f.to) : undefined,
            f.labelId === undefined ? undefined : f.labelId === null ? isNull(operations.labelId) : eq(operations.labelId, f.labelId),
          ),
        )
        .orderBy(desc(operations.date), desc(operations.createdAt));
    },
    allOperations: () => orm().select().from(operations),
    /** Operations that refer to the given payout (returns), active or not. */
    operationsReferring: (operationRef: string) =>
      orm().select().from(operations).where(eq(operations.operationRef, operationRef)),
    operationsOfOwner: (ownerId: string) =>
      orm().select().from(operations).where(eq(operations.ownerId, ownerId)),

    setPaymentProof: async (id: string, documentId: string) => {
      await orm()
        .update(operations)
        .set({ paymentProofId: documentId, deferred: false })
        .where(eq(operations.id, id));
    },
    setDeferred: async (id: string, deferred: boolean) => {
      await orm().update(operations).set({ deferred }).where(eq(operations.id, id));
    },
    setDeactivated: async (id: string, at: string, reason: string) => {
      await orm()
        .update(operations)
        .set({ deactivatedAt: at, deactivatedReason: reason })
        .where(eq(operations.id, id));
    },
    setExternalRef: async (id: string, externalRef: string) => {
      await orm().update(operations).set({ externalRef }).where(eq(operations.id, id));
    },
    setLabel: async (id: string, labelId: string | null) => {
      await orm().update(operations).set({ labelId }).where(eq(operations.id, id));
    },
    reassignOwner: async (fromOwnerId: string, intoOwnerId: string) => {
      await orm().update(operations).set({ ownerId: intoOwnerId }).where(eq(operations.ownerId, fromOwnerId));
    },

    insertSnapshot: async (row: typeof payoutSnapshots.$inferInsert) => {
      await orm().insert(payoutSnapshots).values(row);
    },
    getSnapshot: async (operationId: string) =>
      (await orm().select().from(payoutSnapshots).where(eq(payoutSnapshots.operationId, operationId)))[0],
  };
}

export type SettlementsRepository = ReturnType<typeof createSettlementsRepository>;
