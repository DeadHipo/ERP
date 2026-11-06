import { Router, type Response } from 'express';
import * as S from '@erp/shared/api-schemas';
import { requestPrincipal, sessionUserOf, type AuthConfig } from '../../auth/middleware';
import type { AuthService } from '../../auth/service';
import { ForbiddenError } from '../../shared/errors';
import type { Facade } from '../../facade';
import { assertOwnLabels, orgCounts, type Organization, type OrgsService } from '../../orgs/service';
import { systemTrace } from '../audit';
import { authorizeRoute } from '../authorize';
import { param, parse } from '../http';
import { createMe } from '../me';

const orgView = (o: Organization) => ({ id: o.id, name: o.name, createdAt: o.createdAt, createdBy: o.createdBy });
const operator = (res: Response) => String(res.locals.operator);

/**
 * The organizations, for the system administrator only (D-170): list with counts (no money) and the asking
 * administrator's live support grant, create (the id comes from the server), one, its members, create a member (a new
 * user with a role and, for a manager, own labels), add an existing user, change a membership, enter as support under
 * a live grant (D-171). Writes leave a row in the audit of the target organization.
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

  const me = createMe(deps);

  const summary = async (o: Organization, res: Response) => {
    const user = sessionUserOf(res);
    const grant = user?.isSystemAdmin ? await auth.supportState(o.id, user.id) : undefined;
    return {
      ...orgView(o),
      counts: await orgCounts(await facadeOf(o.id), await auth.countMembers(o.id)),
      support: grant?.state === 'live' ? { expiresAt: grant.expiresAt, write: grant.write } : null,
    };
  };

  r.get('/orgs', system, async (_req, res) => {
    const list = await orgs.listOrganizations();
    res.json(await Promise.all(list.map((o) => summary(o, res))));
  });

  r.post('/orgs', system, trace, async (req, res) => {
    const body = parse(S.createOrgBody, req.body);
    res.status(201).json(orgView(await orgs.createOrganization({ name: body.name, createdBy: operator(res) })));
  });

  r.get('/orgs/:id', system, async (req, res) => {
    res.json(await summary(await orgs.getOrganization(param(req, 'id')), res));
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

  r.post('/orgs/:id/members', system, trace, async (req, res) => {
    const org = await orgs.getOrganization(param(req, 'id'));
    const body = parse(S.addMemberBody, req.body);
    await assertOwnLabels(await facadeOf(org.id), body.labelIds);
    res.status(201).json(await auth.addMembership({ ...body, orgId: org.id, createdBy: operator(res) }));
  });

  r.patch('/orgs/:id/users/:userId', system, trace, async (req, res) => {
    const org = await orgs.getOrganization(param(req, 'id'));
    const body = parse(S.updateMemberBody, req.body);
    if (body.labelIds) await assertOwnLabels(await facadeOf(org.id), body.labelIds);
    res.json(await auth.updateMember(org.id, param(req, 'userId'), body, operator(res)));
  });

  // the system administrator enters an organization as support under a live grant of its administrator (D-171); the
  // system key has no user to grant to
  r.post('/orgs/:id/support/enter', system, trace, async (req, res) => {
    const org = await orgs.getOrganization(param(req, 'id'));
    const user = sessionUserOf(res);
    if (!user?.isSystemAdmin) throw new ForbiddenError('The organization administrator has to grant support access', 'support_required');
    const grant = await auth.supportState(org.id, user.id);
    if (grant.state === 'expired') throw new ForbiddenError('The support access of this organization has expired', 'support_expired');
    if (grant.state !== 'live') throw new ForbiddenError('The organization administrator has to grant support access', 'support_required');
    res.json(await me(user, { orgId: org.id, expiresAt: grant.expiresAt, write: grant.write }));
  });

  return r;
}
