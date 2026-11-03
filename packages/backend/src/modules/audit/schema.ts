import { jsonb, pgSchema, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { isoTimestamp } from '../../shared/pg-db';

// The trail of the operator's writes. The DDL is migrations/postgres/0011_audit_search.sql (schema `audit`); change both.

const s = pgSchema('audit');

export const actions = s.table('actions', {
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
});
