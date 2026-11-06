# orgs: notes for agents

Organizations, the isolation boundary of stage 2 (D-170). Above the facade and the modules (they never import it).

- `schema.ts` / `repository.ts` / `service.ts`: `orgs.organizations (id, name, created_at, created_by)`; the id is
  always a server UUID; the name is unique without regard to case (`409 org_name_taken`); `OrgNotFoundError` =
  `404 org_not_found`; `orgCounts` (labels, loaded files, statements, owners, users: no money) through the facade.
  No rename or delete (№1 of the live base has the fixed id `00000000-0000-4000-8000-000000000001`, renamed by SQL).
- `facades.ts`: `createOrgFacades({ stores, dataDir, payoutThresholdCents })` → `get(orgId)`: single-flight per
  organization, the row checked before the facade is opened (no directory for an unknown id), `{ facade, router }`
  kept (no own connections; the upload queues live in its services); `close()` closes the stores.
- `middleware.ts`: `resolveOrg`, the only reader of `X-Org`, sets `res.locals.org` and `res.locals.principal` (D-171):
  a member's organization comes from the session (`auth.sessions.org_id`, the membership checked on every request;
  role and labels from it; `X-Org` from a member = `403 forbidden`); a system administrator (session or key) must send
  `X-Org` (else `400 org_required`); `AUTH_MODE=off` = `ERP_DEFAULT_ORG` with the `local` principal. `orgRoutes`
  serves the request with the chosen router (`operatorTrace → labelGuard → authorize → v1`).
- **Support (D-171, commit 4; commits 1–3 gave the transitional full access):** a system administrator with `X-Org`
  becomes the principal `support` only under a live grant of that organization's `org_admin` (`auth.support_grants`,
  ≤ 7 days, default 24 h, `write` false by default): no grant = `403 support_required`, only expired ones =
  `403 support_expired`; read and read money everything, write only with `write: true` (`403 support_read_only`),
  never approve / pay / admin. The system key with `X-Org` = `403 support_required`. Grants are managed by the
  organization (`GET /support`, `POST /support`, `POST /support/:id/revoke`); `POST /orgs/:id/support/enter` starts
  work in it; `me.support` names the grant; support writes are in the organization's audit with
  `summary.support = true`. `service.ts` `assertOwnLabels` (a manager's labels: own labels of the organization,
  `400 label_not_own`, a foreign one 404) is checked through the organization's facade.
- The routes `/orgs*` are in `src/api/routes/orgs.ts` (system access, `authorizeRoute` = `can()` of the system rule;
  writes audited into the target organization by `systemTrace`; members with role and labels). Scripts resolve an organization with `connectOrg` / `resolveOrg` in `src/connect-sources.ts`.
