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
  /** A payout of the button (D-181): JSON `{ "<artistId>": cents, "": cents }`, what it took from which position ('' = the owner's own). */
  allocation: text('allocation'),
  /** The cut the operation is attributed to (D-198): it enters that cut and every later one whatever its date. */
  cutId: text('cut_id'),
});

// The opening balances of D-174 (`settlements.opening_balances`, migration 0020) stay in the database as the archive of
// the cabinet's numbers of 15.10.2026; since D-205 no code reads or writes them (the start became the cut «Кабинет 15.10»).

/** The payee of an owner (D-176): the channel and the reference in the cash register; one active per owner. */
export const payees = s.table('payees', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  channel: text('channel', { enum: ['tipalti', 'easystaff', 'other'] }).notNull(),
  payeeRef: text('payee_ref'),
  status: text('status', { enum: ['confirmed', 'proposed'] }).notNull(),
  basis: text('basis').notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  source: text('source'),
  createdAt: isoTimestamp('created_at').notNull(),
  deactivatedAt: isoTimestamp('deactivated_at'),
  deactivatedReason: text('deactivated_reason'),
});

/** A hold on the payouts of an owner (D-176): a decision, an artist's request, a question, a disputed history item. */
export const holds = s.table('holds', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  /** The book the hold acts in; null = every book. */
  labelId: text('label_id'),
  kind: text('kind', { enum: ['decision', 'artist_request', 'question', 'dispute'] }).notNull(),
  /** Closes the payout (a hold, a dispute that blocks the row) or informs only. */
  blocks: boolean('blocks').notNull(),
  reason: text('reason').notNull(),
  releaseWhen: text('release_when'),
  amountCents: bigint('amount_cents', { mode: 'number' }),
  period: text('period'),
  reviewOn: date('review_on', { mode: 'string' }),
  since: date('since', { mode: 'string' }).notNull(),
  source: text('source'),
  status: text('status', { enum: ['active', 'released'] }).notNull(),
  releasedAt: isoTimestamp('released_at'),
  releasedReason: text('released_reason'),
  createdAt: isoTimestamp('created_at').notNull(),
});

/** An answer «pay» to the check of a payout (D-176): valid for the same amount only. */
export const payoutAnswers = s.table('payout_answers', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  labelId: text('label_id'),
  dueCents: bigint('due_cents', { mode: 'number' }).notNull(),
  decision: text('decision', { enum: ['pay', 'pay_task'] }).notNull(),
  why: text('why').notNull(),
  about: text('about').notNull(),
  answeredBy: text('answered_by').notNull(),
  source: text('source'),
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

/**
 * The cuts (D-198): the state of a label's book at a moment, cumulative. The bounds are the first day of the first
 * month no longer inside (like `valid_to`, D-025). DDL: migrations/postgres/0031_cuts.sql; change both.
 */
export const cuts = s.table('cuts', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  labelId: text('label_id').notNull(),
  name: text('name').notNull(),
  /** The moment: operations dated up to this day are inside. */
  cutDate: date('cut_date', { mode: 'string' }).notNull(),
  /** Believe: report months before this first day are inside. */
  masterTo: date('master_to', { mode: 'string' }).notNull(),
  /** Publishing: report months before this first day are inside. */
  publishingTo: date('publishing_to', { mode: 'string' }).notNull(),
  /** Advertising: months before this first day are inside. */
  adsTo: date('ads_to', { mode: 'string' }).notNull(),
  comment: text('comment').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
  createdBy: text('created_by').notNull(),
});
