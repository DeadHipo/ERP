import { bigint, boolean, date, pgSchema, text } from 'drizzle-orm/pg-core';
import { LABEL_SOURCES, OPERATION_KINDS } from '@erp/shared/operation-kinds';
import { isoTimestamp } from '../../shared/pg-db';

// Settlements and payouts: every balance change is an operation `in` or `out` with a signed amount in integer cents.
// The kind of an operation is stored (D-173, migration 0019: the history got the kind its fields gave, `kindOf`) and
// its fields fit it (the CHECK `operations_kind_rules`); before D-173 there was no kind and the fields alone said it.
// The DDL is migrations/postgres/0004_settlements.sql, 0014_label_books.sql and 0019_operation_kinds.sql (schema
// `settlements`); change both.

const s = pgSchema('settlements');

export const operations = s.table('operations', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  direction: text('direction', { enum: ['in', 'out'] }).notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  ownerId: text('owner_id'),
  artistId: text('artist_id'),
  date: date('date', { mode: 'string' }).notNull(),
  period: text('period'),
  /** JSON text of the recoup scope. */
  scope: text('scope'),
  documentId: text('document_id'),
  paymentProofId: text('payment_proof_id'),
  operationRef: text('operation_ref'),
  deferred: boolean('deferred').notNull(),
  migration: boolean('migration').notNull(),
  comment: text('comment').notNull(),
  externalRef: text('external_ref'),
  createdAt: isoTimestamp('created_at').notNull(),
  deactivatedAt: isoTimestamp('deactivated_at'),
  deactivatedReason: text('deactivated_reason'),
  /** The own label the operation belongs to (D-168); null = without a label (the history before the split). */
  labelId: text('label_id'),
  /** The kind (D-173): one of `OPERATION_KINDS`. */
  kind: text('kind', { enum: OPERATION_KINDS }).notNull(),
  /** Who set the label (D-173): `LABEL_SOURCES`; null until `assign-operation-labels.ts --mark-source`. */
  labelSource: text('label_source', { enum: LABEL_SOURCES }),
  /** The payment channel, free text (D-173). */
  channel: text('channel'),
  /** The area of the book (D-173): `master` (the history) or `publishing`. */
  area: text('area', { enum: ['master', 'publishing'] }).notNull().default('master'),
});

/**
 * The opening balances (D-174): the approved position of a pseudonym in the book of a label at the cut, instead of the
 * recalculated history. `start` = the cabinet snapshot (master and publishing in cents), `adjustment` = an approved
 * correction with its basis. DDL: migrations/postgres/0020_opening_balances.sql; change both.
 */
export const openingBalances = s.table('opening_balances', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  labelId: text('label_id').notNull(),
  artistId: text('artist_id').notNull(),
  kind: text('kind', { enum: ['start', 'adjustment'] }).notNull(),
  /** The last report month inside the start, as its first day (read as 'YYYY-MM-DD'). */
  cutoffMonth: date('cutoff_month', { mode: 'string' }).notNull(),
  /** The boundary of the movements: operations of the book dated up to this day are inside the start. */
  syncedAt: isoTimestamp('synced_at').notNull(),
  masterCents: bigint('master_cents', { mode: 'number' }).notNull(),
  publishingCents: bigint('publishing_cents', { mode: 'number' }).notNull(),
  /** The cabinet gave no amount: not a zero, the payout is closed (`start_missing`). */
  missing: boolean('missing').notNull(),
  basis: text('basis').notNull(),
  documentId: text('document_id'),
  /** An advance before the cut kept alive after it (reopened). */
  operationRef: text('operation_ref'),
  comment: text('comment').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
  deactivatedAt: isoTimestamp('deactivated_at'),
  deactivatedReason: text('deactivated_reason'),
});

export const payoutSnapshots = s.table('payout_snapshots', {
  orgId: text('org_id').notNull(),
  operationId: text('operation_id').primaryKey(),
  createdAt: isoTimestamp('created_at').notNull(),
  /** The snapshot JSON exactly as written (text, not jsonb, so it is kept byte for byte). */
  payload: text('payload').notNull(),
});
