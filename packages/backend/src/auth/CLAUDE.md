# auth: notes for agents

The minimal login of stage 2 (D-170). Global, not a module of the facade: not opened under an organization (a login is
looked up across all of them), never imported by the modules or the facade (`tests/boundaries.test.ts`).

- `schema.ts`: `auth.users` (migration 0016): `login` (lower case, `^[a-z0-9._-]{3,64}$`, unique), `password_hash`,
  `org_id` (null only for a system administrator), `is_system_admin`, `created_by`, `disabled_at`.
- `password.ts`: scrypt N=16384, r=8, p=1, 16-byte salt, 64-byte key, `scrypt$N$r$p$<salt>$<hash>`, `timingSafeEqual`;
  `dummyHash()` for an unknown login (same time). No password policy yet.
- `token.ts`: JWT HS256 by `node:crypto`, header exactly `{"alg":"HS256","typ":"JWT"}`, body `{ sub, iat, exp }`, 12 h;
  `assertSecret`: `AUTH_SECRET` ≥ 32 bytes, not `change_me…`.
- `service.ts`: `login` (one `null` for unknown / wrong / disabled), `sessionUser(id)` (the row is re-read on every
  request: organization and system flag come from it, never from the token), `createUser` (`409 login_taken`),
  `orgUsers`, `resetPassword`, `setDisabled`; `meOf` builds the `/auth/me` answer.
- `middleware.ts`: `authConfigFromEnv` (`AUTH_MODE` on by default, `AUTH_SECRET`, `SYSTEM_ADMIN_KEY`,
  `ERP_DEFAULT_ORG`, `AUTH_COOKIE_SECURE`), `authenticateOrSystemKey` (public paths pass; cookie `erp_session` or
  `X-System-Key`; else 401), `requireUser`, `requireSystem` (403), the cookie strings (`HttpOnly; SameSite=Strict;
  Path=/; Max-Age=43200`, `Secure` on request).
- Users are created by `scripts/create-user.ts` (a system administrator only there) or `POST /orgs/:id/users`.
  Roles, memberships, sessions with revocation, rate limits: stage 3. Tests: `tests/auth.test.ts`.
