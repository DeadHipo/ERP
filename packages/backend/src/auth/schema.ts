import { boolean, pgSchema, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { isoTimestamp } from '../shared/pg-db';

// The users of the minimal login (stage 2, D-170; the code that uses it comes in the next commit). Global, not under
// an organization: the login is looked up before the organization is known. The login is stored in lower case. The
// DDL is migrations/postgres/0016_organizations.sql (schema `auth`); change both.

const s = pgSchema('auth');

export const users = s.table('users', {
  id: text('id').primaryKey(),
  login: text('login').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** null only for a system administrator (`users_org`). */
  orgId: text('org_id'),
  isSystemAdmin: boolean('is_system_admin').notNull().default(false),
  createdAt: isoTimestamp('created_at').notNull().default(sql`now()`),
  createdBy: text('created_by').notNull(),
  disabledAt: isoTimestamp('disabled_at'),
});
