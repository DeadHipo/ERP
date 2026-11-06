import { jsonb, pgSchema, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { isoTimestamp } from '../../shared/pg-db';

// The trail of the operator's writes. The DDL is migrations/postgres/0011_audit_search.sql and 0015_label_books_2.sql (schema `audit`); change both.

const s = pgSchema('audit');

export const actions = s.table('actions', {
  orgId: text('org_id').notNull(),
  id: text('id').primaryKey(),
  at: isoTimestamp('at').notNull().default(sql`now()`),
  operator: text('operator').notNull(),
  method: text('method').notNull(),
  route: text('route').notNull(),
  entityIds: text('entity_ids')
    .array()
    .notNull()
    .default(sql`'{}'`),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
  /** The own label of the action (D-169, 0015); null = none. Written from stage 1 commit 4 on. */
  labelId: text('label_id'),
});
