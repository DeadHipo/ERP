import { Router, type RequestHandler, type Response } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { AuthService } from '../../auth/service';
import type { Facade } from '../../facade';
import { assertOwnLabels } from '../../orgs/service';
import { param, parse } from '../http';

const operator = (res: Response) => String(res.locals.operator);

/**
 * The members of the request's organization, managed by its `org_admin` (D-171; the right is `admin:users`, checked by
 * `guard`): the list, a new user as a member (a manager's labels are own labels of the organization), a change of the
 * role, the labels or the membership's `active`, a new password (403 for a user who is also a member of another
 * organization). Disabling a user everywhere is the system administrator's (`/system/users`).
 */
export function usersRouter(deps: { auth: AuthService; facadeOf: (res: Response) => Facade; guard: RequestHandler[] }) {
  const { auth, facadeOf, guard } = deps;
  const r = Router();
  const orgOf = (res: Response) => facadeOf(res).orgId;

  r.get('/users', ...guard, async (_req, res) => {
    res.json(await auth.members(orgOf(res)));
  });

  r.post('/users', ...guard, async (req, res) => {
    const body = parse(S.createMemberUserBody, req.body);
    await assertOwnLabels(facadeOf(res), body.labelIds);
    res.status(201).json(await auth.createMemberUser({ ...body, orgId: orgOf(res), createdBy: operator(res) }));
  });

  r.patch('/users/:id', ...guard, async (req, res) => {
    const body = parse(S.updateMemberBody, req.body);
    if (body.labelIds) await assertOwnLabels(facadeOf(res), body.labelIds);
    res.json(await auth.updateMember(orgOf(res), param(req, 'id'), body, operator(res)));
  });

  r.post('/users/:id/password', ...guard, async (req, res) => {
    const body = parse(S.setPasswordBody, req.body);
    await auth.setMemberPassword(orgOf(res), param(req, 'id'), body.password);
    res.json({ ok: true });
  });

  return r;
}
