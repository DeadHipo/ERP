import { randomUUID } from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from '../shared/errors';
import type { Db } from '../shared/pg-db';
import { dummyHash, hashPassword, needsRehash, verifyPassword } from './password';
import { createAuthRepository, type MembershipRow, type UserRow } from './repository';
import { ROLES, type Role } from './schema';

// Users, memberships and sessions (D-170, D-171). Not a module of the facade: global, above the facade and the
// modules. A user is a member of organizations with a role (`org_admin`, `label_manager` + own labels) or a system
// administrator (never a member). A session belongs to one organization (none for a system administrator); its row,
// the user and the membership are read on every request.

export type { Role };
export { ROLES };

/** What a request knows of its user: read from the rows on every request (the token carries only ids). */
export interface SessionUser {
  id: string;
  login: string;
  isSystemAdmin: boolean;
  /** The organization of the session (null for a system administrator, or without a session in `off`). */
  orgId: string | null;
  /** The role of the membership of the session's organization; null for a system administrator. */
  role: Role | null;
  /** The own labels of a `label_manager` in that organization; empty for anyone else. */
  labelIds: string[];
  /** The session row (null when no session was made: `off` without a secret). */
  sessionId: string | null;
}

/** A member of an organization as the API shows it: never the password hash. */
export interface Member {
  id: string;
  login: string;
  role: Role;
  labelIds: string[];
  /** The membership is not suspended. */
  active: boolean;
  /** The user is disabled (everywhere). */
  disabled: boolean;
  createdAt: string;
  createdBy: string;
}

/** A user found by a script (no hash). */
export interface PublicUser {
  id: string;
  login: string;
  isSystemAdmin: boolean;
  disabled: boolean;
}

/** An organization the user may choose at the login (`409 org_choice_required`). */
export interface OrgChoice {
  id: string;
  name: string;
  role: Role;
}

/** The answer of `login`: refused (one answer for all reasons), a choice, no membership, or signed in. */
export type LoginResult =
  | { kind: 'refused' }
  | { kind: 'choose'; orgs: OrgChoice[] }
  | { kind: 'no_membership' }
  | { kind: 'ok'; user: SessionUser; verifiedHash: string };

const LOGIN = /^[a-z0-9._-]{3,64}$/;
const normLogin = (login: string) => login.trim().toLowerCase();

const publicOf = (u: UserRow): PublicUser => ({
  id: u.id,
  login: u.login,
  isSystemAdmin: u.isSystemAdmin,
  disabled: u.disabledAt !== null,
});

function assertRoleLabels(role: Role, labelIds: string[]): void {
  if (!ROLES.includes(role)) throw new ValidationError(`Unknown role "${String(role)}"`);
  if (role === 'label_manager' && labelIds.length === 0)
    throw new ValidationError('A label manager needs at least one label');
  if (role === 'org_admin' && labelIds.length > 0)
    throw new ValidationError('An organization administrator has every label: give no labels');
}

export function createAuthService(db: Db) {
  const repo = createAuthRepository(db);

  async function existing(login: string): Promise<UserRow> {
    const row = await repo.byLogin(normLogin(login));
    if (!row) throw new NotFoundError('User', login);
    return row;
  }

  async function addMembershipRows(
    userId: string,
    orgId: string,
    role: Role,
    labelIds: string[],
    createdBy: string,
  ): Promise<void> {
    await repo.insertMembership({ userId, orgId, role, createdBy });
    await repo.insertUserLabels([...new Set(labelIds)].map((labelId) => ({ userId, orgId, labelId, createdBy })));
  }

  function rethrowLoginTaken(e: unknown): never {
    const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const pgErr = err.cause ?? err;
    if (pgErr.code === '23505' && pgErr.constraint === 'users_login_key')
      throw new ConflictError('This login is taken', 'login_taken');
    throw e;
  }

  async function member(orgId: string, userId: string): Promise<Member> {
    const rows = (await repo.membersOf(orgId)).filter((r) => r.user.id === userId);
    const labels = await repo.labelsOf(orgId, [userId]);
    const r = rows[0];
    if (!r) throw new NotFoundError('Member', userId);
    return memberOf(r.user, r.membership, labels.get(userId) ?? []);
  }

  const memberOf = (u: UserRow, m: MembershipRow, labelIds: string[]): Member => ({
    id: u.id,
    login: u.login,
    role: m.role,
    labelIds,
    active: m.disabledAt === null,
    disabled: u.disabledAt !== null,
    createdAt: m.createdAt,
    createdBy: m.createdBy,
  });

  /** The session user of a user row in an organization (or none for a system administrator). */
  async function sessionUserOf(u: UserRow, orgId: string | null, sessionId: string | null): Promise<SessionUser | undefined> {
    if (orgId === null) {
      if (!u.isSystemAdmin) return undefined;
      return { id: u.id, login: u.login, isSystemAdmin: true, orgId: null, role: null, labelIds: [], sessionId };
    }
    const m = await repo.membership(u.id, orgId);
    if (!m || m.disabledAt !== null) return undefined;
    const labelIds = m.role === 'label_manager' ? ((await repo.labelsOf(orgId, [u.id])).get(u.id) ?? []) : [];
    return { id: u.id, login: u.login, isSystemAdmin: false, orgId, role: m.role, labelIds, sessionId };
  }

  const service = {
    /**
     * Checks a login and a password and picks the organization (D-171): an unknown login, a wrong password and a
     * disabled user are one answer (`refused`; an unknown login is checked against a dummy hash so that it takes as
     * long). A right password: a system administrator signs in without an organization; a member with one active
     * membership into it; with several, `orgId` must name one of them, else `choose` (also for an `orgId` that is not
     * theirs); none: `no_membership`. An old hash is rehashed. No session is made here (`openSession`).
     */
    async login(login: string, password: string, orgId?: string): Promise<LoginResult> {
      const row = await repo.byLogin(normLogin(login));
      const ok = await verifyPassword(password, row?.passwordHash ?? (await dummyHash()));
      if (!row || !ok || row.disabledAt !== null) return { kind: 'refused' };
      // the rehash replaces only the hash that was verified: a concurrent change or reset is never written over
      let verifiedHash = row.passwordHash;
      if (needsRehash(row.passwordHash)) {
        const fresh = await hashPassword(password);
        if (await repo.replacePasswordHash(row.id, row.passwordHash, fresh)) verifiedHash = fresh;
      }
      if (row.isSystemAdmin)
        return { kind: 'ok', user: (await sessionUserOf(row, null, null)) as SessionUser, verifiedHash };
      const all = await repo.activeMembershipsOf(row.id);
      if (all.length === 0) return { kind: 'no_membership' };
      const chosen = orgId !== undefined ? all.find((m) => m.orgId === orgId) : all.length === 1 ? all[0] : undefined;
      if (!chosen) return { kind: 'choose', orgs: all.map((m) => ({ id: m.orgId, name: m.orgName, role: m.role })) };
      return { kind: 'ok', user: (await sessionUserOf(row, chosen.orgId, null)) as SessionUser, verifiedHash };
    },

    /**
     * A new session row of a signed-in user until `expiresAt` (ISO); old expired rows are removed. In one write
     * transaction (serialized with a password change, a reset and disabling) the user is read again: disabled since
     * the check, or a password hash other than `verifiedHash` (changed or reset meanwhile), is 401
     * `invalid_credentials` and no session is made, so a login racing a revocation never outlives it.
     */
    async openSession(user: Pick<SessionUser, 'id' | 'orgId'>, expiresAt: string, verifiedHash: string): Promise<string> {
      return db.transaction(async () => {
        const row = await repo.byId(user.id);
        if (!row || row.disabledAt !== null || row.passwordHash !== verifiedHash)
          throw new UnauthenticatedError('Wrong login or password', 'invalid_credentials');
        await repo.deleteOldSessions();
        const id = randomUUID();
        await repo.insertSession({ id, userId: user.id, orgId: user.orgId, expiresAt });
        return id;
      });
    },

    /**
     * The user of a session (D-171), read on every request: the session is live (not revoked, not expired) and of
     * this user, the user is not disabled, the membership of its organization is active (role and labels as they are
     * now). Otherwise undefined (= 401).
     */
    async sessionUser(userId: string, sessionId: string): Promise<SessionUser | undefined> {
      const s = await repo.liveSession(sessionId);
      if (!s || s.userId !== userId) return undefined;
      const u = await repo.byId(userId);
      if (!u || u.disabledAt !== null) return undefined;
      return sessionUserOf(u, s.orgId, s.id);
    },

    /** Ends a session (logout): only a session of that user; idempotent. */
    revokeSession: (sessionId: string, userId: string): Promise<void> => repo.revokeSession(sessionId, userId),

    /**
     * The user's own new password (D-171): 401 `invalid_credentials` for a wrong current one; every other session of
     * the user is revoked, the current one stays.
     */
    async changeOwnPassword(user: Pick<SessionUser, 'id' | 'sessionId'>, current: string, next: string): Promise<void> {
      if (!next) throw new ValidationError('A password is required');
      const row = await repo.byId(user.id);
      if (!row || !(await verifyPassword(current, row.passwordHash)))
        throw new UnauthenticatedError('Wrong current password', 'invalid_credentials');
      const hash = await hashPassword(next);
      await db.transaction(async () => {
        await repo.setPasswordHash(row.id, hash);
        await repo.revokeSessionsOf(row.id, user.sessionId ? { keep: user.sessionId } : {});
      });
    },

    /**
     * A new user: a system administrator (`system`, scripts only) or a member of `orgId` with a role (default
     * `org_admin`) and, for a `label_manager`, labels (own labels of the organization: the caller checks them through
     * the organization's facade). 409 `login_taken` (any case).
     */
    async createUser(input: {
      login: string;
      password: string;
      orgId?: string;
      role?: Role;
      labelIds?: string[];
      system?: boolean;
      createdBy: string;
    }): Promise<PublicUser> {
      const login = normLogin(input.login);
      if (!LOGIN.test(login)) throw new ValidationError('A login is 3-64 characters of a-z, 0-9, ".", "_", "-"');
      if (!input.password) throw new ValidationError('A password is required');
      if (!input.system && !input.orgId) throw new ValidationError('A user belongs to an organization');
      if (input.system && input.orgId) throw new ValidationError('A system administrator is a member of no organization');
      const role = input.role ?? 'org_admin';
      const labelIds = input.labelIds ?? [];
      if (!input.system) assertRoleLabels(role, labelIds);
      const passwordHash = await hashPassword(input.password);
      try {
        return publicOf(
          await db.transaction(async () => {
            const row = await repo.insert({
              id: randomUUID(),
              login,
              passwordHash,
              isSystemAdmin: !!input.system,
              createdBy: input.createdBy,
            });
            if (input.orgId) await addMembershipRows(row.id, input.orgId, role, labelIds, input.createdBy);
            return row;
          }),
        );
      } catch (e) {
        rethrowLoginTaken(e);
      }
    },

    /** A member of an organization made of a new user (`POST /orgs/:id/users`). */
    async createMemberUser(input: {
      orgId: string;
      login: string;
      password: string;
      role: Role;
      labelIds: string[];
      createdBy: string;
    }): Promise<Member> {
      const user = await service.createUser(input);
      return member(input.orgId, user.id);
    },

    /**
     * An existing user becomes a member (scripts): 404 for an unknown login, 400 for a system administrator, 409
     * `already_member`.
     */
    async addMembership(input: { login: string; orgId: string; role: Role; labelIds: string[]; createdBy: string }): Promise<Member> {
      const row = await existing(input.login);
      if (row.isSystemAdmin) throw new ValidationError('A system administrator is a member of no organization');
      assertRoleLabels(input.role, input.labelIds);
      if (await repo.membership(row.id, input.orgId)) throw new ConflictError('The user is already a member', 'already_member');
      await db.transaction(() => addMembershipRows(row.id, input.orgId, input.role, input.labelIds, input.createdBy));
      return member(input.orgId, row.id);
    },

    /** The members of an organization (active or suspended), without password hashes. */
    async members(orgId: string): Promise<Member[]> {
      const rows = await repo.membersOf(orgId);
      const labels = await repo.labelsOf(orgId, rows.map((r) => r.user.id));
      return rows.map((r) => memberOf(r.user, r.membership, labels.get(r.user.id) ?? []));
    },

    /** The number of active members (the counts of `/orgs`). */
    countMembers: (orgId: string): Promise<number> => repo.countActiveMembers(orgId),

    /** The active memberships of a user with the organization names (`/auth/me`). */
    memberships: async (userId: string): Promise<{ orgId: string; orgName: string; role: Role }[]> =>
      repo.activeMembershipsOf(userId),

    /** The user of a login (scripts), or undefined. */
    findByLogin: async (login: string): Promise<PublicUser | undefined> => {
      const row = await repo.byLogin(normLogin(login));
      return row ? publicOf(row) : undefined;
    },

    /** Disables or enables a user everywhere; disabling revokes every session. */
    async setDisabled(login: string, disabled: boolean): Promise<PublicUser> {
      const row = await existing(login);
      return db.transaction(async () => {
        const out = publicOf((await repo.setDisabled(row.id, disabled)) as UserRow);
        if (disabled) await repo.revokeSessionsOf(row.id);
        return out;
      });
    },

    /** A new password by the administrator; every session of the user is revoked. */
    async resetPassword(login: string, password: string): Promise<PublicUser> {
      if (!password) throw new ValidationError('A password is required');
      const row = await existing(login);
      const hash = await hashPassword(password);
      return db.transaction(async () => {
        const out = publicOf((await repo.setPasswordHash(row.id, hash)) as UserRow);
        await repo.revokeSessionsOf(row.id);
        return out;
      });
    },
  };
  return service;
}

export type AuthService = ReturnType<typeof createAuthService>;

/** `409 org_choice_required`: the password is right, the organization is to be chosen (`details.orgs`). */
export class OrgChoiceRequiredError extends ConflictError {
  constructor(orgs: OrgChoice[]) {
    super('Choose an organization', 'org_choice_required', { orgs });
  }
}

/** `403 no_membership`: the password is right, the user is a member of no organization. */
export const noMembership = () => new ForbiddenError('No access to any organization', 'no_membership');

export type MeRole = Role | 'system' | 'support' | 'local';

/** The answer of `GET /auth/me` and `POST /auth/login` (D-171). */
export function meOf(input: {
  mode: 'on' | 'off';
  user: SessionUser | undefined;
  org: { id: string; name: string } | undefined;
  role: MeRole | null;
  labels: { id: string; name: string }[];
  allLabels: boolean;
  memberships: { orgId: string; orgName: string; role: Role }[];
  /** The operations the session may call (`allowedOperations`). */
  abilities: string[];
}) {
  const { user, org } = input;
  return {
    authMode: input.mode,
    user: user ? { id: user.id, login: user.login, isSystemAdmin: user.isSystemAdmin } : null,
    org: org ? { id: org.id, name: org.name } : null,
    role: input.role,
    labels: input.labels,
    allLabels: input.allLabels,
    memberships: input.memberships,
    support: null,
    abilities: input.abilities,
  };
}
