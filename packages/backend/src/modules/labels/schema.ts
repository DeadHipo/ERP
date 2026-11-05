import { date, numeric, pgSchema, text } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// Our labels, the imprint strings that are aliases of them and the sublabel rule per period.
// The DDL is migrations/postgres/0006_labels.sql and 0014_label_books.sql (schema `labels`); change both.

const s = pgSchema('labels');

export const labels = s.table('labels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['own', 'sublabel'] }).notNull(),
  ownLabelId: text('own_label_id'),
  createdAt: isoTimestamp('created_at').notNull(),
});

export const labelAliases = s.table('label_aliases', {
  aliasNorm: text('alias_norm').primaryKey(),
  alias: text('alias').notNull(),
  labelId: text('label_id').notNull(),
});

export const labelRules = s.table('label_rules', {
  id: text('id').primaryKey(),
  labelId: text('label_id').notNull(),
  percent: numeric('percent', { precision: 9, scale: 6 }).notNull(),
  recipientArtistId: text('recipient_artist_id').notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  documentId: text('document_id'),
  note: text('note'),
  createdAt: isoTimestamp('created_at').notNull(),
});

/** The Believe accounts of an own label (D-168): an account belongs to one label. */
export const labelAccounts = s.table('label_accounts', {
  account: text('account').primaryKey(),
  labelId: text('label_id').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
});
