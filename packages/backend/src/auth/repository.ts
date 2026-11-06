import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../shared/pg-db';
import { users } from './schema';

export type UserRow = typeof users.$inferSelect;

/**
 * All SQL of the users (schema `auth`, D-170). Global, not under an organization: a login is looked up before the
 * organization is known (exempt by name from the organization checks of `tests/org-scope.test.ts`).
 */
export function createAuthRepository(db: Db) {
  const orm = () => db.orm();
  return {
    byLogin: async (login: string): Promise<UserRow | undefined> =>
      (await orm().select().from(users).where(eq(users.login, login)))[0],
    byId: async (id: string): Promise<UserRow | undefined> =>
      (await orm().select().from(users).where(eq(users.id, id)))[0],
    insert: async (row: typeof users.$inferInsert): Promise<UserRow> =>
      (await orm().insert(users).values(row).returning())[0] as UserRow,
    /** The users of an organization, oldest first. */
    orgUsers: (orgId: string): Promise<UserRow[]> =>
      orm().select().from(users).where(eq(users.orgId, orgId)).orderBy(asc(users.createdAt), asc(users.id)),
    setDisabled: async (id: string, disabled: boolean): Promise<UserRow | undefined> =>
      (
        await orm()
          .update(users)
          .set({ disabledAt: disabled ? sql`now()` : null })
          .where(eq(users.id, id))
          .returning()
      )[0],
    setPasswordHash: async (id: string, passwordHash: string): Promise<UserRow | undefined> =>
      (await orm().update(users).set({ passwordHash }).where(eq(users.id, id)).returning())[0],
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
