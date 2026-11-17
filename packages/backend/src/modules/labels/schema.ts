import { pgSchema, primaryKey, text, unique } from 'drizzle-orm/pg-core';
import { isoTimestamp } from '../../shared/pg-db';

// Our own labels, the imprint strings that are aliases of them, their Believe accounts and the register of sublabels.
// Since D-232 there is no kind and no sublabel rule (a sublabel is the register and its terms, D-217…D-230).
// The DDL is migrations/postgres/0006_labels.sql, 0014_label_books.sql, 0016_organizations.sql, 0033_sublabels.sql, 0036_labels_own_only.sql (schema `labels`); change both.

const s = pgSchema('labels');

export const labels = s.table('labels', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
}, (t) => [unique('labels_org_name').on(t.orgId, t.name)]);

export const labelAliases = s.table('label_aliases', {
  orgId: text('org_id').notNull(),
  aliasNorm: text('alias_norm').notNull(),
  alias: text('alias').notNull(),
  labelId: text('label_id').notNull(),
}, (t) => [primaryKey({ columns: [t.orgId, t.aliasNorm] })]);

/**
 * The sublabels (D-217): a register of names only, outside `labels` so the label of a track never comes from it. The
 * terms of a sublabel on a track are `links.sublabel_terms`. DDL: 0033_sublabels.sql; the name is unique per
 * organization without case (index `sublabels_org_name`).
 */
export const sublabels = s.table('sublabels', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
});

/** The Believe accounts of an own label (D-168): an account belongs to one label. */
export const labelAccounts = s.table('label_accounts', {
  orgId: text('org_id').notNull(),
  account: text('account').notNull(),
  labelId: text('label_id').notNull(),
  createdAt: isoTimestamp('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.orgId, t.account] })]);
