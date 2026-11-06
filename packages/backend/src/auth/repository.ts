import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../shared/pg-db';
import { organizations } from '../orgs/schema';
import { memberships, sessions, supportGrants, userLabels, users, type Role } from './schema';

export type UserRow = typeof users.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SupportGrantRow = typeof supportGrants.$inferSelect;

/**
 * All SQL of the users, memberships and sessions (schema `auth`, D-170, D-171). Global, not under an organization: a
 * login is looked up before the organization is known (exempt by name from the organization checks of
 * `tests/org-scope.test.ts`); the organization of a membership or a session is a column of the row.
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
    /** Replaces the hash only if it is still `old` (the rehash at a login); true when it did. */
    replacePasswordHash: async (id: string, old: string, passwordHash: string): Promise<boolean> =>
      (
        await orm()
          .update(users)
          .set({ passwordHash })
          .where(and(eq(users.id, id), eq(users.passwordHash, old)))
          .returning({ id: users.id })
      ).length === 1,

    // ---- memberships and the labels of a manager ----
    insertMembership: async (row: typeof memberships.$inferInsert): Promise<MembershipRow> =>
      (await orm().insert(memberships).values(row).returning())[0] as MembershipRow,
    insertUserLabels: async (rows: (typeof userLabels.$inferInsert)[]): Promise<void> => {
      if (rows.length) await orm().insert(userLabels).values(rows);
    },
    membership: async (userId: string, orgId: string): Promise<MembershipRow | undefined> =>
      (
        await orm()
          .select()
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
      )[0],
    /** The active memberships of a user with the names of their organizations, by name. */
    activeMembershipsOf: (userId: string) =>
      orm()
        .select({ orgId: memberships.orgId, orgName: organizations.name, role: memberships.role })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.orgId))
        .where(and(eq(memberships.userId, userId), isNull(memberships.disabledAt)))
        .orderBy(asc(organizations.name), asc(memberships.orgId)),
    /** The members of an organization (active or not) with their users, oldest first. */
    membersOf: (orgId: string) =>
      orm()
        .select({ user: users, membership: memberships })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.orgId, orgId))
        .orderBy(asc(memberships.createdAt), asc(users.id)),
    /** The label ids of the members of an organization, `userId -> labelIds` (sorted). */
    labelsOf: async (orgId: string, userIds: string[]): Promise<Map<string, string[]>> => {
      const out = new Map<string, string[]>();
      if (!userIds.length) return out;
      const rows = await orm()
        .select({ userId: userLabels.userId, labelId: userLabels.labelId })
        .from(userLabels)
        .where(and(eq(userLabels.orgId, orgId), inArray(userLabels.userId, userIds)))
        .orderBy(asc(userLabels.labelId));
      for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r.labelId]);
      return out;
    },
    /** Every membership of a user (active or not), any organization. */
    allMembershipsOf: (userId: string) => orm().select().from(memberships).where(eq(memberships.userId, userId)),
    /** Every user with the memberships (active or not) and the organization names, by login (system screens). */
    usersWithMemberships: async () => {
      const all = await orm().select().from(users).orderBy(asc(users.login));
      const rows = await orm()
        .select({ userId: memberships.userId, orgId: memberships.orgId, orgName: organizations.name, role: memberships.role, disabledAt: memberships.disabledAt })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.orgId))
        .orderBy(asc(organizations.name), asc(memberships.orgId));
      return { users: all, memberships: rows };
    },
    updateMembership: async (userId: string, orgId: string, set: { role?: Role; disabled?: boolean }): Promise<void> => {
      if (set.role === undefined && set.disabled === undefined) return;
      await orm()
        .update(memberships)
        .set({
          ...(set.role !== undefined ? { role: set.role } : {}),
          ...(set.disabled !== undefined ? { disabledAt: set.disabled ? sql`now()` : null } : {}),
        })
        .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
    },
    deleteUserLabels: async (userId: string, orgId: string): Promise<void> => {
      await orm().delete(userLabels).where(and(eq(userLabels.userId, userId), eq(userLabels.orgId, orgId)));
    },
    /** The active `org_admin` memberships of an organization other than `exceptUserId`, whose users are not disabled. */
    countOtherActiveAdmins: async (orgId: string, exceptUserId: string): Promise<number> =>
      (
        await orm()
          .select({ n: sql<number>`count(*)::int` })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.orgId, orgId),
              eq(memberships.role, 'org_admin'),
              isNull(memberships.disabledAt),
              isNull(users.disabledAt),
              ne(memberships.userId, exceptUserId),
            ),
          )
      )[0]?.n ?? 0,
    countActiveMembers: async (orgId: string): Promise<number> =>
      (
        await orm()
          .select({ n: sql<number>`count(*)::int` })
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), isNull(memberships.disabledAt)))
      )[0]?.n ?? 0,

    // ---- support grants (D-171) ----
    insertGrant: async (row: typeof supportGrants.$inferInsert): Promise<SupportGrantRow> =>
      (await orm().insert(supportGrants).values(row).returning())[0] as SupportGrantRow,
    /** The grants of an organization with the login of the grantee, newest first (at most `limit`). */
    grantsOf: (orgId: string, limit: number) =>
      orm()
        .select({ grant: supportGrants, login: users.login, active: sql<boolean>`(${supportGrants.revokedAt} IS NULL AND ${supportGrants.expiresAt} > now())` })
        .from(supportGrants)
        .innerJoin(users, eq(users.id, supportGrants.userId))
        .where(eq(supportGrants.orgId, orgId))
        .orderBy(desc(supportGrants.grantedAt), desc(supportGrants.id))
        .limit(limit),
    grantOf: async (orgId: string, id: string) =>
      (
        await orm()
          .select({ grant: supportGrants, login: users.login, active: sql<boolean>`(${supportGrants.revokedAt} IS NULL AND ${supportGrants.expiresAt} > now())` })
          .from(supportGrants)
          .innerJoin(users, eq(users.id, supportGrants.userId))
          .where(and(eq(supportGrants.orgId, orgId), eq(supportGrants.id, id)))
      )[0],
    revokeGrant: async (id: string, by: string): Promise<void> => {
      await orm()
        .update(supportGrants)
        .set({ revokedAt: sql`now()`, revokedBy: by })
        .where(and(eq(supportGrants.id, id), isNull(supportGrants.revokedAt)));
    },
    /** The live grants (not revoked, not expired) of an organization to a user. */
    liveGrants: (orgId: string, userId: string) =>
      orm()
        .select()
        .from(supportGrants)
        .where(and(eq(supportGrants.orgId, orgId), eq(supportGrants.userId, userId), isNull(supportGrants.revokedAt), gt(supportGrants.expiresAt, sql`now()`))),
    /** Is there a grant that ran out (not revoked, expired) of an organization to a user? */
    hasExpiredGrant: async (orgId: string, userId: string): Promise<boolean> =>
      (
        await orm()
          .select({ id: supportGrants.id })
          .from(supportGrants)
          .where(and(eq(supportGrants.orgId, orgId), eq(supportGrants.userId, userId), isNull(supportGrants.revokedAt), lte(supportGrants.expiresAt, sql`now()`)))
          .limit(1)
      ).length > 0,

    // ---- sessions ----
    insertSession: async (row: { id: string; userId: string; orgId: string | null; expiresAt: string }): Promise<void> => {
      await orm().insert(sessions).values(row);
    },
    /** The session if it is not revoked and not expired. */
    liveSession: async (id: string): Promise<SessionRow | undefined> =>
      (
        await orm()
          .select()
          .from(sessions)
          .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
      )[0],
    revokeSession: async (id: string, userId: string): Promise<void> => {
      await orm()
        .update(sessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    },
    /** Revokes every live session of a user, except `keep`, optionally only those of one organization. */
    revokeSessionsOf: async (userId: string, opts: { keep?: string; orgId?: string } = {}): Promise<void> => {
      await orm()
        .update(sessions)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
            ...(opts.keep ? [ne(sessions.id, opts.keep)] : []),
            ...(opts.orgId ? [eq(sessions.orgId, opts.orgId)] : []),
          ),
        );
    },
    /** Removes the sessions expired more than 7 days ago (one DELETE at a login). */
    deleteOldSessions: async (): Promise<void> => {
      await orm()
        .delete(sessions)
        .where(lt(sessions.expiresAt, sql`now() - interval '7 days'`));
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
export type { Role };
