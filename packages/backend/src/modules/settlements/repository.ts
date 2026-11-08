import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { LabelSource, OperationKind } from '@erp/shared/operation-kinds';
import type { Db } from '../../shared/pg-db';
import { orgFree, orgRow, orgWhere, type OrgFree, type OrgScope } from '../../shared/org-scope';
import { cuts, holds, openingBalances, operations, payees, payoutAnswers, payoutSnapshots } from './schema';

export type OperationRow = OrgFree<typeof operations.$inferSelect>;
export type OpeningBalanceRow = OrgFree<typeof openingBalances.$inferSelect>;
export type PayeeRow = OrgFree<typeof payees.$inferSelect>;
export type HoldRow = OrgFree<typeof holds.$inferSelect>;
export type PayoutAnswerRow = OrgFree<typeof payoutAnswers.$inferSelect>;
export type CutRow = OrgFree<typeof cuts.$inferSelect>;

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
  const C = { operations: orgFree(operations), payoutSnapshots: orgFree(payoutSnapshots), openingBalances: orgFree(openingBalances), payees: orgFree(payees), holds: orgFree(holds), payoutAnswers: orgFree(payoutAnswers), cuts: orgFree(cuts) };
  return {
    // ---- the admission (D-176): payees, holds, answers ----
    insertPayee: async (row: OrgFree<typeof payees.$inferInsert>) => {
      await orm().insert(payees).values(orgRow(org, row));
    },
    getPayee: async (id: string): Promise<PayeeRow | undefined> => (await orm().select(C.payees).from(payees).where(orgWhere(org, payees, eq(payees.id, id))))[0],
    listPayees: (f: { ownerId?: string; active?: boolean } = {}) =>
      orm()
        .select(C.payees)
        .from(payees)
        .where(orgWhere(org, payees, f.ownerId ? eq(payees.ownerId, f.ownerId) : undefined, f.active === undefined ? undefined : f.active ? isNull(payees.deactivatedAt) : sql`${payees.deactivatedAt} is not null`))
        .orderBy(payees.createdAt, payees.id),
    setPayeeDeactivated: async (id: string, at: string, reason: string) => {
      await orm().update(payees).set({ deactivatedAt: at, deactivatedReason: reason }).where(orgWhere(org, payees, eq(payees.id, id)));
    },
    insertHold: async (row: OrgFree<typeof holds.$inferInsert>) => {
      await orm().insert(holds).values(orgRow(org, row));
    },
    getHold: async (id: string): Promise<HoldRow | undefined> => (await orm().select(C.holds).from(holds).where(orgWhere(org, holds, eq(holds.id, id))))[0],
    listHolds: (f: { ownerId?: string; status?: 'active' | 'released' } = {}) =>
      orm()
        .select(C.holds)
        .from(holds)
        .where(orgWhere(org, holds, f.ownerId ? eq(holds.ownerId, f.ownerId) : undefined, f.status ? eq(holds.status, f.status) : undefined))
        .orderBy(holds.since, holds.createdAt, holds.id),
    setHoldReleased: async (id: string, at: string, reason: string) => {
      await orm().update(holds).set({ status: 'released', releasedAt: at, releasedReason: reason }).where(orgWhere(org, holds, eq(holds.id, id)));
    },
    insertAnswer: async (row: OrgFree<typeof payoutAnswers.$inferInsert>) => {
      await orm().insert(payoutAnswers).values(orgRow(org, row));
    },
    getAnswer: async (id: string): Promise<PayoutAnswerRow | undefined> =>
      (await orm().select(C.payoutAnswers).from(payoutAnswers).where(orgWhere(org, payoutAnswers, eq(payoutAnswers.id, id))))[0],
    listAnswers: (f: { ownerId?: string; active?: boolean } = {}) =>
      orm()
        .select(C.payoutAnswers)
        .from(payoutAnswers)
        .where(
          orgWhere(
            org,
            payoutAnswers,
            f.ownerId ? eq(payoutAnswers.ownerId, f.ownerId) : undefined,
            f.active === undefined ? undefined : f.active ? isNull(payoutAnswers.deactivatedAt) : sql`${payoutAnswers.deactivatedAt} is not null`,
          ),
        )
        .orderBy(payoutAnswers.createdAt, payoutAnswers.id),
    setAnswerDeactivated: async (id: string, at: string, reason: string) => {
      await orm().update(payoutAnswers).set({ deactivatedAt: at, deactivatedReason: reason }).where(orgWhere(org, payoutAnswers, eq(payoutAnswers.id, id)));
    },

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

    // the cuts (D-198)
    insertCut: async (row: OrgFree<typeof cuts.$inferInsert>) => {
      await orm().insert(cuts).values(orgRow(org, row));
    },
    getCut: async (id: string): Promise<CutRow | undefined> => (await orm().select(C.cuts).from(cuts).where(orgWhere(org, cuts, eq(cuts.id, id))))[0],
    /** By label, then date. */
    listCuts: (f: { labelId?: string } = {}): Promise<CutRow[]> =>
      orm()
        .select(C.cuts)
        .from(cuts)
        .where(orgWhere(org, cuts, f.labelId ? eq(cuts.labelId, f.labelId) : undefined))
        .orderBy(cuts.labelId, cuts.cutDate, cuts.id),
    updateCut: async (id: string, set: Partial<Pick<CutRow, 'name' | 'cutDate' | 'masterTo' | 'publishingTo' | 'adsTo' | 'comment'>>) => {
      await orm().update(cuts).set(set).where(orgWhere(org, cuts, eq(cuts.id, id)));
    },
    deleteCut: async (id: string) => {
      await orm().delete(cuts).where(orgWhere(org, cuts, eq(cuts.id, id)));
    },
    /** The operations attributed to a cut, active or not. */
    countCutOperations: async (cutId: string): Promise<number> =>
      (await orm().select({ n: sql<number>`count(*)::int` }).from(operations).where(orgWhere(org, operations, eq(operations.cutId, cutId))))[0]?.n ?? 0,

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
