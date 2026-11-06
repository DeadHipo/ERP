import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { LabelSource, OperationKind } from '@erp/shared/operation-kinds';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgRow, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { openingBalances, operations, payoutSnapshots } from './schema';

export type OperationRow = OrgFree<typeof operations.$inferSelect>;
export type OpeningBalanceRow = OrgFree<typeof openingBalances.$inferSelect>;

export interface OpeningBalanceFilter {
  labelId?: string;
  artistId?: string;
  kind?: 'start' | 'adjustment';
  active?: boolean;
}

export interface OperationFilter {
  ownerId?: string;
  artistId?: string;
  direction?: 'in' | 'out';
  /** The stored kind (D-173). */
  kind?: OperationKind;
  /** Who set the label (D-173); `null` = not marked yet. */
  labelSource?: LabelSource | null;
  /** A payout (out) still active without a payment proof. */
  needsProof?: boolean;
  active?: boolean;
  /** Inclusive dates YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Operations of one own label (D-168); `null` = the operations without a label. */
  labelId?: string | null;
}

/** All SQL of the settlements module lives here (schema `settlements`); every statement is of the organization `org` (D-170). */
export function createSettlementsRepository(db: Db, org: OrgScope) {
  const orm = () => db.orm();
  const C = { operations: orgFree(operations), payoutSnapshots: orgFree(payoutSnapshots), openingBalances: orgFree(openingBalances) };
  return {
    // ---- the opening balances (D-174) ----
    insertOpeningBalance: async (row: OrgFree<typeof openingBalances.$inferInsert>) => {
      await orm().insert(openingBalances).values(orgRow(org, row));
    },
    getOpeningBalance: async (id: string): Promise<OpeningBalanceRow | undefined> =>
      (await orm().select(C.openingBalances).from(openingBalances).where(orgWhere(org, openingBalances, eq(openingBalances.id, id))))[0],
    /** Oldest first (the order of the import), then by id. */
    listOpeningBalances: (f: OpeningBalanceFilter = {}) =>
      orm()
        .select(C.openingBalances)
        .from(openingBalances)
        .where(
          orgWhere(
            org,
            openingBalances,
            f.labelId ? eq(openingBalances.labelId, f.labelId) : undefined,
            f.artistId ? eq(openingBalances.artistId, f.artistId) : undefined,
            f.kind ? eq(openingBalances.kind, f.kind) : undefined,
            f.active === undefined ? undefined : f.active ? isNull(openingBalances.deactivatedAt) : sql`${openingBalances.deactivatedAt} is not null`,
          ),
        )
        .orderBy(openingBalances.createdAt, openingBalances.id),
    setOpeningBalanceDeactivated: async (id: string, at: string, reason: string) => {
      await orm()
        .update(openingBalances)
        .set({ deactivatedAt: at, deactivatedReason: reason })
        .where(orgWhere(org, openingBalances, eq(openingBalances.id, id)));
    },
    transaction: <T>(fn: () => Promise<T>): Promise<T> => db.transaction(fn),

    insertOperation: async (row: OrgFree<typeof operations.$inferInsert>) => {
      await orm().insert(operations).values(orgRow(org, row));
    },
    getOperation: async (id: string): Promise<OperationRow | undefined> =>
      (await orm().select(C.operations).from(operations).where(orgWhere(org, operations, eq(operations.id, id))))[0],
    /** Newest first. */
    listOperations: (f: OperationFilter = {}) => {
      return orm()
        .select(C.operations)
        .from(operations)
        .where(
          orgWhere(
            org,
            operations,
            f.ownerId ? eq(operations.ownerId, f.ownerId) : undefined,
            f.artistId ? eq(operations.artistId, f.artistId) : undefined,
            f.direction ? eq(operations.direction, f.direction) : undefined,
            f.kind ? eq(operations.kind, f.kind) : undefined,
            f.labelSource === undefined
              ? undefined
              : f.labelSource === null
                ? isNull(operations.labelSource)
                : eq(operations.labelSource, f.labelSource),
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
    allOperations: () => orm().select(C.operations).from(operations).where(orgWhere(org, operations)),
    /** Operations that refer to the given one (returns of a payout, forgivenesses of an advance), active or not. */
    operationsReferring: (operationRef: string) =>
      orm()
        .select(C.operations)
        .from(operations)
        .where(orgWhere(org, operations, eq(operations.operationRef, operationRef))),
    operationsOfOwner: (ownerId: string) =>
      orm().select(C.operations).from(operations).where(orgWhere(org, operations, eq(operations.ownerId, ownerId))),

    setPaymentProof: async (id: string, documentId: string) => {
      await orm()
        .update(operations)
        .set({ paymentProofId: documentId, deferred: false })
        .where(orgWhere(org, operations, eq(operations.id, id)));
    },
    setDeferred: async (id: string, deferred: boolean) => {
      await orm().update(operations).set({ deferred }).where(orgWhere(org, operations, eq(operations.id, id)));
    },
    setDeactivated: async (id: string, at: string, reason: string) => {
      await orm()
        .update(operations)
        .set({ deactivatedAt: at, deactivatedReason: reason })
        .where(orgWhere(org, operations, eq(operations.id, id)));
    },
    setExternalRef: async (id: string, externalRef: string) => {
      await orm().update(operations).set({ externalRef }).where(orgWhere(org, operations, eq(operations.id, id)));
    },
    setLabel: async (id: string, labelId: string | null, labelSource: LabelSource | null) => {
      await orm().update(operations).set({ labelId, labelSource }).where(orgWhere(org, operations, eq(operations.id, id)));
    },
    setLabelSource: async (id: string, labelSource: LabelSource) => {
      await orm().update(operations).set({ labelSource }).where(orgWhere(org, operations, eq(operations.id, id)));
    },
    reassignOwner: async (fromOwnerId: string, intoOwnerId: string) => {
      await orm().update(operations).set({ ownerId: intoOwnerId }).where(orgWhere(org, operations, eq(operations.ownerId, fromOwnerId)));
    },

    insertSnapshot: async (row: OrgFree<typeof payoutSnapshots.$inferInsert>) => {
      await orm().insert(payoutSnapshots).values(orgRow(org, row));
    },
    getSnapshot: async (operationId: string) =>
      (
        await orm()
          .select(C.payoutSnapshots)
          .from(payoutSnapshots)
          .where(orgWhere(org, payoutSnapshots, eq(payoutSnapshots.operationId, operationId)))
      )[0],
  };
}

export type SettlementsRepository = ReturnType<typeof createSettlementsRepository>;
