import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../shared/errors';
import type { Db } from '../shared/pg-db';
import { dummyHash, hashPassword, verifyPassword } from './password';
import { createAuthRepository, type UserRow } from './repository';

// The minimal login (stage 2, D-170): users with a login and a scrypt password, each of one organization or a system
// administrator. Not a module of the facade: global, above the facade and the modules.

/** What a request knows of its user: read from the row on every request (the token carries only the id). */
export interface SessionUser {
  id: string;
  login: string;
  orgId: string | null;
  isSystemAdmin: boolean;
}

/** A user as the API shows it: never the password hash. */
export interface PublicUser extends SessionUser {
  createdAt: string;
  createdBy: string;
  disabled: boolean;
}

const LOGIN = /^[a-z0-9._-]{3,64}$/;

const sessionOf = (u: UserRow): SessionUser => ({
  id: u.id,
  login: u.login,
  orgId: u.orgId,
  isSystemAdmin: u.isSystemAdmin,
});
const publicOf = (u: UserRow): PublicUser => ({
  ...sessionOf(u),
  createdAt: u.createdAt,
  createdBy: u.createdBy,
  disabled: u.disabledAt !== null,
});

export function createAuthService(db: Db) {
  const repo = createAuthRepository(db);

  async function existing(login: string): Promise<UserRow> {
    const row = await repo.byLogin(login.trim().toLowerCase());
    if (!row) throw new NotFoundError('User', login);
    return row;
  }

  return {
    /**
     * The user of a login and password, or null: an unknown login, a wrong password and a disabled user are the same
     * answer, and an unknown login is checked against a dummy hash so that it takes as long.
     */
    async login(login: string, password: string): Promise<SessionUser | null> {
      const row = await repo.byLogin(login.trim().toLowerCase());
      const ok = await verifyPassword(password, row?.passwordHash ?? (await dummyHash()));
      if (!row || !ok || row.disabledAt !== null) return null;
      return sessionOf(row);
    },

    /** The active user of a session id; undefined when it is removed or disabled. */
    async sessionUser(id: string): Promise<SessionUser | undefined> {
      const row = await repo.byId(id);
      return row && row.disabledAt === null ? sessionOf(row) : undefined;
    },

    /** A user of an organization (`orgId`) or a system administrator (`system`); 409 `login_taken` (any case). */
    async createUser(input: {
      login: string;
      password: string;
      orgId?: string;
      system?: boolean;
      createdBy: string;
    }): Promise<PublicUser> {
      const login = input.login.trim().toLowerCase();
      if (!LOGIN.test(login)) throw new ValidationError('A login is 3-64 characters of a-z, 0-9, ".", "_", "-"');
      if (!input.password) throw new ValidationError('A password is required');
      if (!input.system && !input.orgId) throw new ValidationError('A user belongs to an organization');
      const passwordHash = await hashPassword(input.password);
      try {
        return publicOf(
          await repo.insert({
            id: randomUUID(),
            login,
            passwordHash,
            orgId: input.system ? null : (input.orgId as string),
            isSystemAdmin: !!input.system,
            createdBy: input.createdBy,
          }),
        );
      } catch (e) {
        const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
        const pgErr = err.cause ?? err;
        if (pgErr.code === '23505' && pgErr.constraint === 'users_login_key')
          throw new ConflictError('This login is taken', 'login_taken');
        throw e;
      }
    },

    /** The users of an organization, without password hashes. */
    orgUsers: async (orgId: string): Promise<PublicUser[]> => (await repo.orgUsers(orgId)).map(publicOf),

    /** The user of a login (scripts), or undefined. */
    findByLogin: async (login: string): Promise<PublicUser | undefined> => {
      const row = await repo.byLogin(login.trim().toLowerCase());
      return row ? publicOf(row) : undefined;
    },

    async setDisabled(login: string, disabled: boolean): Promise<PublicUser> {
      const row = await existing(login);
      return publicOf((await repo.setDisabled(row.id, disabled)) as UserRow);
    },

    async resetPassword(login: string, password: string): Promise<PublicUser> {
      if (!password) throw new ValidationError('A password is required');
      const row = await existing(login);
      return publicOf((await repo.setPasswordHash(row.id, await hashPassword(password))) as UserRow);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

/** The answer of `GET /auth/me` and `POST /auth/login`: the mode, the user (none in `off`), the organization. */
export function meOf(
  mode: 'on' | 'off',
  user: SessionUser | undefined,
  org: { id: string; name: string } | undefined,
) {
  return {
    authMode: mode,
    user: user ? { id: user.id, login: user.login, isSystemAdmin: user.isSystemAdmin, orgId: user.orgId } : null,
    org: org ? { id: org.id, name: org.name } : null,
  };
}
