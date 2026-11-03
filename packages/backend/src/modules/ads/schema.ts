import { bigint, boolean, date, numeric, pgSchema, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// Advertising expenses (D-155, D-156): one immutable record per arrival of data; only the recovery percent, the
// scope and the deactivation change. The DDL is migrations/postgres/0012_ads.sql (schema `ads`); change both.

const s = pgSchema('ads');

export const expenses = s.table('expenses', {
  id: text('id').primaryKey(),
  isrc: text('isrc'),
  /** First day of the month of the expense. */
  month: date('month', { mode: 'string' }).notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  recoveryPercent: numeric('recovery_percent').notNull(),
  scope: text('scope', { enum: ['any', 'publishing', 'isrc'] }).notNull(),
  /** An expense already allocated to one pseudonym (Main history); otherwise the ISRC's split decides. */
  artistId: text('artist_id'),
  externalRef: text('external_ref'),
  source: text('source').notNull(),
  migration: boolean('migration').notNull(),
  comment: text('comment').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
  deactivatedAt: isoTimestamp('deactivated_at'),
  deactivatedReason: text('deactivated_reason'),
});
