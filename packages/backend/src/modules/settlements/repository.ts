import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../shared/pg-db';
import { operations, payoutSnapshots } from './schema';

export type OperationRow = typeof operations.$inferSelect;

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
    listOperations: () =>
      orm().select().from(operations).orderBy(desc(operations.date), desc(operations.createdAt)),
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
