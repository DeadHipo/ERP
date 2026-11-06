import { pgSchema, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { isoTimestamp } from '../shared/pg-db';

// The organizations (stage 2, D-170): the tenant key of every row of the modules (`org_id`). Not a module of the
// facade: it sits above the facade and the modules and is never opened under an organization. The DDL is
// migrations/postgres/0016_organizations.sql (schema `orgs`); change both.

const s = pgSchema('orgs');

export const organizations = s.table('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: isoTimestamp('created_at').notNull().default(sql`now()`),
  createdBy: text('created_by').notNull(),
});
