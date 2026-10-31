import { desc, eq } from 'drizzle-orm';
import type { ModuleDb } from '../../shared/db';
import { operations, payoutSnapshots, settlementsSchema } from './schema';

export type SettlementsDb = ModuleDb<typeof settlementsSchema>;
export type OperationRow = typeof operations.$inferSelect;

/** All SQL of the settlements module lives here. */
export function createSettlementsRepository(db: SettlementsDb) {
  const { orm } = db;
  return {
    transaction<T>(fn: () => T): T {
      return db.sqlite.transaction(fn)();
    },

    insertOperation: (row: typeof operations.$inferInsert) => orm.insert(operations).values(row).run(),
    getOperation: (id: string) => orm.select().from(operations).where(eq(operations.id, id)).get(),
    /** Newest first. */
    listOperations: () =>
      orm.select().from(operations).orderBy(desc(operations.date), desc(operations.createdAt)).all(),
    allOperations: () => orm.select().from(operations).all(),
    /** Operations that refer to the given payout (returns), active or not. */
    operationsReferring: (operationRef: string) =>
      orm.select().from(operations).where(eq(operations.operationRef, operationRef)).all(),
    operationsOfOwner: (ownerId: string) =>
      orm.select().from(operations).where(eq(operations.ownerId, ownerId)).all(),

    setPaymentProof: (id: string, documentId: string) =>
      orm
        .update(operations)
        .set({ paymentProofId: documentId, deferred: false })
        .where(eq(operations.id, id))
        .run(),
    setDeferred: (id: string, deferred: boolean) =>
      orm.update(operations).set({ deferred }).where(eq(operations.id, id)).run(),
    setDeactivated: (id: string, at: string, reason: string) =>
      orm
        .update(operations)
        .set({ deactivatedAt: at, deactivatedReason: reason })
        .where(eq(operations.id, id))
        .run(),
    setExternalRef: (id: string, externalRef: string) =>
      orm.update(operations).set({ externalRef }).where(eq(operations.id, id)).run(),
    reassignOwner: (fromOwnerId: string, intoOwnerId: string) =>
      orm.update(operations).set({ ownerId: intoOwnerId }).where(eq(operations.ownerId, fromOwnerId)).run(),

    insertSnapshot: (row: typeof payoutSnapshots.$inferInsert) =>
      orm.insert(payoutSnapshots).values(row).run(),
    getSnapshot: (operationId: string) =>
      orm.select().from(payoutSnapshots).where(eq(payoutSnapshots.operationId, operationId)).get(),
  };
}

export type SettlementsRepository = ReturnType<typeof createSettlementsRepository>;
