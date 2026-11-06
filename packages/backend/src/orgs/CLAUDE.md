# orgs: notes for agents

Organizations, the isolation boundary of stage 2 (D-170). Above the facade and the modules (they never import it).

- `schema.ts` / `repository.ts` / `service.ts`: `orgs.organizations (id, name, created_at, created_by)`; the id is
  always a server UUID; the name is unique without regard to case (`409 org_name_taken`); `OrgNotFoundError` =
  `404 org_not_found`; `orgCounts` (labels, loaded files, statements, owners, users: no money) through the facade.
  No rename or delete (№1 of the live base has the fixed id `00000000-0000-4000-8000-000000000001`, renamed by SQL).
- `facades.ts`: `createOrgFacades({ stores, dataDir, payoutThresholdCents })` → `get(orgId)`: single-flight per
  organization, the row checked before the facade is opened (no directory for an unknown id), `{ facade, router }`
  kept (no own connections; the upload queues live in its services); `close()` closes the stores.
- `middleware.ts`: `resolveOrg`, the only reader of `X-Org` and `res.locals.org`: a user's organization comes from
  their row (`X-Org` from them = 403); a system administrator (session or key) must send `X-Org` (else
  `400 org_required`); `AUTH_MODE=off` = `ERP_DEFAULT_ORG`. `orgRoutes` serves the request with the chosen router.
- The routes `/orgs*` are in `src/api/routes/orgs.ts` (system access; writes audited into the target organization by
  `systemTrace`). Scripts resolve an organization with `connectOrg` / `resolveOrg` in `src/connect-sources.ts`.
