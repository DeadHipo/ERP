import { Router, type Response } from 'express';
import * as S from '@erp/shared/api-schemas';
import { requestPrincipal, type AuthConfig } from '../../auth/middleware';
import type { AuthService } from '../../auth/service';
import type { Facade } from '../../facade';
import { assertOwnLabels, orgCounts, type Organization, type OrgsService } from '../../orgs/service';
import { systemTrace } from '../audit';
import { authorizeRoute } from '../authorize';
import { param, parse } from '../http';

const orgView = (o: Organization) => ({ id: o.id, name: o.name, createdAt: o.createdAt, createdBy: o.createdBy });
const operator = (res: Response) => String(res.locals.operator);

/**
 * The organizations, for the system administrator only (D-170): list with counts (no money), create (the id comes from
 * the server), one, its members, create a member (a new user with a role and, for a manager, own labels; D-171).
 * Writes leave a row in the audit of the target organization.
 */
export function orgsRouter(deps: {
  auth: AuthService;
  config: AuthConfig;
  orgs: OrgsService;
  facadeOf: (orgId: string) => Promise<Facade>;
}) {
  const { auth, config, orgs, facadeOf } = deps;
  const r = Router();
  // the system operations: `can()` with the ability of the route (D-171): the system administrator or the key only
  const system = authorizeRoute((res) => requestPrincipal(res, config));
  const trace = systemTrace(facadeOf);

  const summary = async (o: Organization) => ({
    ...orgView(o),
    counts: await orgCounts(await facadeOf(o.id), await auth.countMembers(o.id)),
  });

  r.get('/orgs', system, async (_req, res) => {
    const list = await orgs.listOrganizations();
    res.json(await Promise.all(list.map(summary)));
  });

  r.post('/orgs', system, trace, async (req, res) => {
    const body = parse(S.createOrgBody, req.body);
    res.status(201).json(orgView(await orgs.createOrganization({ name: body.name, createdBy: operator(res) })));
  });

  r.get('/orgs/:id', system, async (req, res) => {
    res.json(await summary(await orgs.getOrganization(param(req, 'id'))));
  });

  r.get('/orgs/:id/users', system, async (req, res) => {
    const org = await orgs.getOrganization(param(req, 'id'));
    res.json(await auth.members(org.id));
  });

  r.post('/orgs/:id/users', system, trace, async (req, res) => {
    const org = await orgs.getOrganization(param(req, 'id'));
    const body = parse(S.createMemberUserBody, req.body);
    await assertOwnLabels(await facadeOf(org.id), body.labelIds);
    const member = await auth.createMemberUser({ ...body, orgId: org.id, createdBy: operator(res) });
    res.status(201).json(member);
  });

  return r;
}
