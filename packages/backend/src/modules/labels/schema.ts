import { date, numeric, pgSchema, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// Our labels, the imprint strings that are aliases of them and the sublabel rule per period.
// The DDL is migrations/postgres/0006_labels.sql and 0014_label_books.sql, 0016_organizations.sql (schema `labels`); change both.

const s = pgSchema('labels');

export const labels = s.table('labels', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['own', 'sublabel'] }).notNull(),
  ownLabelId: text('own_label_id'),
  createdAt: isoTimestamp('created_at').notNull(),
}, (t) => [unique('labels_org_name').on(t.orgId, t.name)]);

export const labelAliases = s.table('label_aliases', {
  orgId: text('org_id').notNull(),
  aliasNorm: text('alias_norm').notNull(),
  alias: text('alias').notNull(),
  labelId: text('label_id').notNull(),
}, (t) => [primaryKey({ columns: [t.orgId, t.aliasNorm] })]);

export const labelRules = s.table('label_rules', {
  orgId: text('org_id').notNull(),
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
  orgId: text('org_id').notNull(),
  account: text('account').notNull(),
  labelId: text('label_id').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.orgId, t.account] })]);
