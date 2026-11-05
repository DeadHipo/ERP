import { bigint, boolean, date, pgSchema, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// Settlements and payouts: every balance change is an operation `in` or `out` with a signed amount in integer cents.
// There are no operation types; optional fields (artist, period, scope, document, payment proof, operation ref) say
// what an operation is.
// The DDL is migrations/postgres/0004_settlements.sql and 0014_label_books.sql (schema `settlements`); change both.

const s = pgSchema('settlements');

export const operations = s.table('operations', {
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
});

export const payoutSnapshots = s.table('payout_snapshots', {
  operationId: text('operation_id').primaryKey(),
  createdAt: isoTimestamp('created_at').notNull(),
  /** The snapshot JSON exactly as written (text, not jsonb, so it is kept byte for byte). */
  payload: text('payload').notNull(),
});
