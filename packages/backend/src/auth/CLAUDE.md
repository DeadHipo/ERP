# auth: notes for agents

Users, memberships, sessions and the rule table of rights (D-170, D-171). Global, not a module of the facade: not
opened under an organization (a login is looked up across all of them), never imported by the modules or the facade
(`tests/boundaries.test.ts`). The facade has its own `Viewer` type (`src/facade/viewer.ts`) for record-dependent rights.

- `schema.ts` (migrations 0016, 0017): `auth.users` (`login` lower case `^[a-z0-9._-]{3,64}$` unique, `password_hash`,
  `is_system_admin`, `created_by`, `disabled_at`; no `org_id` since 0017); `auth.memberships (user_id, org_id, role
  org_admin | label_manager, disabled_at)` (suspending one membership leaves the others); `auth.user_labels (user_id,
  org_id, label_id)` (own labels of a manager; none for an `org_admin`); `auth.sessions (id, user_id, org_id null only
  for a system administrator, expires_at, revoked_at)`; `auth.support_grants (org_id, user_id, write, granted_by,
  expires_at, revoked_at, revoked_by)`. `org_id` has no foreign key to `orgs.organizations` (the service checks).
- `repository.ts`: all SQL of the schema (Drizzle). `service.ts`:
  - `login(login, password, orgId?)`: one `refused` for unknown / wrong / disabled (an unknown login against
    `dummyHash()`); a system administrator = no organization; one active membership = it; several without a valid
    `orgId` = `choose` (`409 org_choice_required` with `details.orgs`); none = `no_membership` (403). An old hash is
    rehashed only if it is still the verified one (`replacePasswordHash`).
  - `openSession` writes the session in a write transaction that reads the user again (disabled or a changed hash since
    the check = `401 invalid_credentials`); old expired rows (> 7 days) are deleted there.
  - `sessionUser(sub, sid)` runs on every request: live session of this user, user not disabled, membership active;
    role and labels as they are now (no cache). Anything else = 401.
  - `changeOwnPassword` (revokes the other sessions), `createUser` (system administrator or member with role and
    labels; `409 login_taken`), `addMembership`, `members`, `memberships`, `resetPassword` / `setDisabled` (revoke
    every session); `meOf` builds `GET /auth/me` (`role`, `labels`, `allLabels`, `memberships`, `support`, `abilities`).
  - Commit 4 (in progress): `updateMember` (`409 last_org_admin`; `active: false` revokes the sessions of that
    organization), `setMemberPassword` (`403 forbidden` for a member of another organization too), `systemUsers`,
    `grantSupport` (default 24 h, ≤ 7 days, a login that is not an active system administrator = 404),
    `supportGrants`, `revokeSupport` (idempotent), `supportState` (`live` / `expired` / `none`, read per request).
- `abilities.ts` (pure, no express, no database): `Action` (`read`, `read_money`, `write`, `approve`, `pay`, `admin`,
  `system`, `self`), `Scope` (`label`, `record`, `org`), `Principal` (`org_admin`, `label_manager`, `support`, `system`,
  `local` = `AUTH_MODE=off`, acts as `org_admin`), the one table `RULES` (`supportPrincipal` with commit 4), `can(principal, ability, requestLabels)`
  (`forbidden`, `support_required`, `support_read_only`, then `label_forbidden` for any label not the principal's, then
  `label_required`), `allowedOperations()` (for `me.abilities`), `principalOfUser`, `localPrincipal`,
  `systemKeyPrincipal`. Own table, no CASL (D-171): change rules here only together with the plan and the frozen
  manager table `tests/helpers/manager-answers.ts`.
- `password.ts`: scrypt N=32768 (2^15), r=8, p=1, 16-byte salt, 64-byte key, `scrypt$N$r$p$<salt>$<hash>` (a stage-2
  N=16384 hash still verifies; `needsRehash`), at most 4 derivations at once, `timingSafeEqual`; `dummyHash()` on the
  same parameters. No password policy.
- `token.ts`: JWT HS256 by `node:crypto`, header exactly `{"alg":"HS256","typ":"JWT"}`, body `{ sub, sid, iat, exp }`
  (a token without `sid` is refused), 12 h, no renewal; `assertSecret` (`AUTH_SECRET` ≥ 32 bytes, not `change_me…`).
- `limits.ts`: failed logins per login (`AUTH_LOGIN_LIMIT`, 5) and per IP (`AUTH_IP_LIMIT`, 20) in a sliding minute;
  `begin` records the attempt as a failure before the password is checked, `succeeded` takes it back; over the limit
  `429 too_many_attempts` with `Retry-After`; 0 = off. One counter per app instance (made in `createServerApp`).
  A known login can be locked out for a minute by anyone (by design).
- The read token (D-177): `MCP_READ_TOKEN`, `Authorization: Bearer`, checked first in both modes, principal `reader` (`read`, `read_money` of `ERP_DEFAULT_ORG`); `tests/read-token.test.ts`.
- `middleware.ts`: `authConfigFromEnv` (`AUTH_MODE`, `AUTH_SECRET`, `SYSTEM_ADMIN_KEY`, `MCP_READ_TOKEN`, `ERP_DEFAULT_ORG`,
  `AUTH_COOKIE_SECURE`, `AUTH_LOGIN_LIMIT`, `AUTH_IP_LIMIT`, `TRUST_PROXY` (`1` = one hop), `APP_ORIGIN`),
  `sessionCookieName` (`erp_session`, or `__Host-erp_session` with `Secure` when `AUTH_COOKIE_SECURE=1`; one name per
  process), `authenticateOrSystemKey` (public paths pass; the session or `X-System-Key`; else 401), `requireUser`
  (`self` operations), `requestPrincipal` (outside an organization), `originGuard` (writes: `Sec-Fetch-Site`
  same-origin / none, `Origin` = `APP_ORIGIN` or the raw `Host`; else `403 csrf`), `noStore`. **`requireSystem` is
  gone**: the system routes ask `can()` through `authorizeRoute` (`src/api/authorize.ts`).
- Inside an organization the principal is built by `resolveOrg` (`src/orgs/middleware.ts`) and checked by `authorize`
  (`src/api/authorize.ts`) after `labelGuard`; routes pass `viewerOf(res)` (`src/api/viewer.ts`) to the facade.
- Users are created by `scripts/create-user.ts` (`--org <id> --role … --label …`, `--system`, `--reset-password`,
  `--disable`, `--enable`) or through the API (`POST /orgs/:id/users`; commit 4: `/users*`, `/system/users*`).
  Tests: `auth.test.ts`, `sessions.test.ts`, `abilities.test.ts` (commit 4: `users.test.ts`, `support.test.ts`).
