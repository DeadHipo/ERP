import { randomUUID } from 'node:crypto';
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from '../shared/errors';
import type { Db } from '../shared/pg-db';
import { dummyHash, hashPassword, needsRehash, verifyPassword } from './password';
import { createAuthRepository, type MembershipRow, type SupportGrantRow, type UserRow } from './repository';
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

/** A user as the system administrator sees it (D-171). */
export interface SystemUser extends PublicUser {
  memberships: { orgId: string; orgName: string; role: Role; active: boolean }[];
}

/** A support grant of an organization to a system administrator (D-171). */
export interface SupportGrant {
  id: string;
  orgId: string;
  login: string;
  write: boolean;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  /** Not revoked and not expired. */
  active: boolean;
}

/** The support access of a system administrator to an organization: a live grant, only expired ones, or none. */
export type SupportState =
  | { state: 'live'; write: boolean; expiresAt: string }
  | { state: 'expired' }
  | { state: 'none' };

/** The longest support grant (D-171 В12) and the default one. */
export const SUPPORT_MAX_MS = 7 * 24 * 3600 * 1000;
export const SUPPORT_DEFAULT_MS = 24 * 3600 * 1000;

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

  const grantOf = (g: SupportGrantRow, login: string, active: boolean): SupportGrant => ({
    id: g.id,
    orgId: g.orgId,
    login,
    write: g.write,
    grantedBy: g.grantedBy,
    grantedAt: g.grantedAt,
    expiresAt: g.expiresAt,
    revokedAt: g.revokedAt,
    revokedBy: g.revokedBy,
    active,
  });

  /** The membership of a user in an organization, or 404 (a user of another organization is unknown here). */
  async function membershipOrNotFound(orgId: string, userId: string): Promise<MembershipRow> {
    const m = await repo.membership(userId, orgId);
    if (!m) throw new NotFoundError('Member', userId);
    return m;
  }

  async function userById(id: string): Promise<UserRow> {
    const row = await repo.byId(id);
    if (!row) throw new NotFoundError('User', id);
    return row;
  }

  async function disable(row: UserRow, disabled: boolean): Promise<PublicUser> {
    return db.transaction(async () => {
      const out = publicOf((await repo.setDisabled(row.id, disabled)) as UserRow);
      if (disabled) await repo.revokeSessionsOf(row.id);
      return out;
    });
  }

  async function newPassword(row: UserRow, password: string): Promise<PublicUser> {
    if (!password) throw new ValidationError('A password is required');
    const hash = await hashPassword(password);
    return db.transaction(async () => {
      const out = publicOf((await repo.setPasswordHash(row.id, hash)) as UserRow);
      await repo.revokeSessionsOf(row.id);
      return out;
    });
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
    setDisabled: async (login: string, disabled: boolean): Promise<PublicUser> => disable(await existing(login), disabled),

    /** A new password by the administrator; every session of the user is revoked. */
    async resetPassword(login: string, password: string): Promise<PublicUser> {
      if (!password) throw new ValidationError('A password is required');
      return newPassword(await existing(login), password);
    },

    // ---- the members of an organization (D-171: `/users*` of its org_admin, `/orgs/:id/users*` of the system) ----

    /** One member of an organization (404 for a user who is not one). */
    member: (orgId: string, userId: string): Promise<Member> => member(orgId, userId),

    /**
     * Changes a membership: the role, the labels of a manager (replaced as a whole; the caller checks they are own
     * labels of the organization), `active` (false suspends it and ends the user's sessions in this organization).
     * 404 for a user who is not a member; 409 `last_org_admin` when the change leaves the organization without an
     * active administrator (the first appointment is always allowed: nothing is taken away then).
     */
    async updateMember(
      orgId: string,
      userId: string,
      patch: { role?: Role; labelIds?: string[]; active?: boolean },
      by: string,
    ): Promise<Member> {
      await db.transaction(async () => {
        const m = await membershipOrNotFound(orgId, userId);
        const current = m.role === 'label_manager' ? ((await repo.labelsOf(orgId, [userId])).get(userId) ?? []) : [];
        const role = patch.role ?? m.role;
        const labelIds = patch.labelIds ?? (role === 'org_admin' ? [] : current);
        const active = patch.active ?? m.disabledAt === null;
        assertRoleLabels(role, labelIds);
        const wasAdmin = m.role === 'org_admin' && m.disabledAt === null;
        const staysAdmin = role === 'org_admin' && active;
        if (wasAdmin && !staysAdmin && (await repo.countOtherActiveAdmins(orgId, userId)) === 0)
          throw new ConflictError('The organization keeps at least one administrator', 'last_org_admin');
        await repo.updateMembership(userId, orgId, {
          ...(role !== m.role ? { role } : {}),
          ...(active !== (m.disabledAt === null) ? { disabled: !active } : {}),
        });
        await repo.deleteUserLabels(userId, orgId);
        await repo.insertUserLabels([...new Set(labelIds)].map((labelId) => ({ userId, orgId, labelId, createdBy: by })));
        if (!active) await repo.revokeSessionsOf(userId, { orgId });
      });
      return member(orgId, userId);
    },

    /**
     * A new password of a member set by the organization's administrator; every session of the user ends. 404 for a
     * user who is not a member; 403 `forbidden` when the user is also a member of another organization (only the
     * system administrator may reset it then, D-171 В2).
     */
    async setMemberPassword(orgId: string, userId: string, password: string): Promise<void> {
      await membershipOrNotFound(orgId, userId);
      if ((await repo.allMembershipsOf(userId)).some((m) => m.orgId !== orgId))
        throw new ForbiddenError('The user is a member of another organization: only the system administrator resets the password');
      await newPassword(await userById(userId), password);
    },

    // ---- every user (the system administrator, D-171) ----

    /** Every user with the memberships (never a hash), by login. */
    async systemUsers(): Promise<SystemUser[]> {
      const { users: all, memberships: rows } = await repo.usersWithMemberships();
      return all.map((u) => ({
        ...publicOf(u),
        memberships: rows
          .filter((m) => m.userId === u.id)
          .map((m) => ({ orgId: m.orgId, orgName: m.orgName, role: m.role, active: m.disabledAt === null })),
      }));
    },
    async systemUser(id: string): Promise<SystemUser> {
      const found = (await service.systemUsers()).find((u) => u.id === id);
      if (!found) throw new NotFoundError('User', id);
      return found;
    },
    /** Disables or enables a user by id everywhere (disabling ends every session). */
    setDisabledById: async (id: string, disabled: boolean): Promise<PublicUser> => disable(await userById(id), disabled),
    /** A new password by id; every session ends. */
    resetPasswordById: async (id: string, password: string): Promise<PublicUser> => newPassword(await userById(id), password),

    // ---- support grants (D-171) ----

    /**
     * The organization's administrator lets a system administrator (by login) in until `expiresAt` (ISO; default 24 h,
     * at most 7 days ahead, in the future: else 400 `validation_error`); `write` allows writes. A login that is not an
     * active system administrator is 404 `not_found`, the same answer as an unknown one.
     */
    async grantSupport(input: { orgId: string; login: string; expiresAt?: string; write: boolean; grantedBy: string }): Promise<SupportGrant> {
      const row = await repo.byLogin(normLogin(input.login));
      if (!row || !row.isSystemAdmin || row.disabledAt !== null) throw new NotFoundError('User', input.login);
      const now = Date.now();
      const until = input.expiresAt !== undefined ? new Date(input.expiresAt).getTime() : now + SUPPORT_DEFAULT_MS;
      if (!Number.isFinite(until) || until <= now) throw new ValidationError('The support access must end in the future');
      if (until > now + SUPPORT_MAX_MS) throw new ValidationError('The support access lasts at most 7 days');
      const g = await db.transaction(() =>
        repo.insertGrant({
          id: randomUUID(),
          orgId: input.orgId,
          userId: row.id,
          write: input.write,
          grantedBy: input.grantedBy,
          expiresAt: new Date(until).toISOString(),
        }),
      );
      return grantOf(g, row.login, true);
    },

    /** The grants of an organization (expired and revoked too), the 50 newest. */
    supportGrants: async (orgId: string): Promise<SupportGrant[]> =>
      (await repo.grantsOf(orgId, 50)).map((r) => grantOf(r.grant, r.login, r.active)),

    /** Revokes a grant of the organization (404 for another's or an unknown id); idempotent. */
    async revokeSupport(orgId: string, id: string, by: string): Promise<SupportGrant> {
      if (!(await repo.grantOf(orgId, id))) throw new NotFoundError('Support grant', id);
      await db.transaction(() => repo.revokeGrant(id, by));
      const r = await repo.grantOf(orgId, id);
      if (!r) throw new NotFoundError('Support grant', id);
      return grantOf(r.grant, r.login, r.active);
    },

    /**
     * The support access of a system administrator to an organization, read on every request: the live grants (the
     * latest end; write if any of them allows it), else `expired` when a grant ran out unrevoked, else `none`.
     */
    async supportState(orgId: string, userId: string): Promise<SupportState> {
      const live = await repo.liveGrants(orgId, userId);
      if (live.length) {
        const expiresAt = live.map((g) => g.expiresAt).sort().at(-1) as string;
        return { state: 'live', write: live.some((g) => g.write), expiresAt };
      }
      return (await repo.hasExpiredGrant(orgId, userId)) ? { state: 'expired' } : { state: 'none' };
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
  /** The live support grant a system administrator works under (D-171). */
  support?: { orgId: string; expiresAt: string; write: boolean } | null;
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
    support: input.support ?? null,
    abilities: input.abilities,
  };
}
