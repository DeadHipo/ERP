import { boolean, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { isoTimestamp } from '../shared/pg-db';

// The users, their memberships and sessions (D-170, D-171). Global, not under an organization: the login is looked up
// before the organization is known. The login is stored in lower case. The DDL is migrations/postgres/0016 (users)
// and 0017_roles.sql (the rest; `users.org_id` moved into `memberships`); change both.

const s = pgSchema('auth');

export const users = s.table('users', {
  id: text('id').primaryKey(),
  login: text('login').notNull(),
  passwordHash: text('password_hash').notNull(),
  isSystemAdmin: boolean('is_system_admin').notNull().default(false),
  createdAt: isoTimestamp('created_at').notNull().default(sql`now()`),
  createdBy: text('created_by').notNull(),
  disabledAt: isoTimestamp('disabled_at'),
});

export const ROLES = ['org_admin', 'label_manager'] as const;
export type Role = (typeof ROLES)[number];

/** A user in an organization with a role; `disabledAt` = the membership is suspended. */
export const memberships = s.table(
  'memberships',
  {
    userId: text('user_id').notNull(),
    orgId: text('org_id').notNull(),
    role: text('role').$type<Role>().notNull(),
    createdAt: isoTimestamp('created_at').notNull().default(sql`now()`),
    createdBy: text('created_by').notNull(),
    disabledAt: isoTimestamp('disabled_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

/** The own labels of a `label_manager` in an organization (an `org_admin` has none: all). */
export const userLabels = s.table(
  'user_labels',
  {
    userId: text('user_id').notNull(),
    orgId: text('org_id').notNull(),
    labelId: text('label_id').notNull(),
    createdAt: isoTimestamp('created_at').notNull().default(sql`now()`),
    createdBy: text('created_by').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId, t.labelId] })],
);

/** A session: the token carries `{ sub, sid }`; the row is read on every request. `orgId` null = system administrator. */
export const sessions = s.table('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  orgId: text('org_id'),
  issuedAt: isoTimestamp('issued_at').notNull().default(sql`now()`),
  expiresAt: isoTimestamp('expires_at').notNull(),
  revokedAt: isoTimestamp('revoked_at'),
});

/** A support grant of an organization to a system administrator (used from commit 4 of stage 3). */
export const supportGrants = s.table('support_grants', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  write: boolean('write').notNull().default(false),
  grantedBy: text('granted_by').notNull(),
  grantedAt: isoTimestamp('granted_at').notNull().default(sql`now()`),
  expiresAt: isoTimestamp('expires_at').notNull(),
  revokedAt: isoTimestamp('revoked_at'),
  revokedBy: text('revoked_by'),
});
