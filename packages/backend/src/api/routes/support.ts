import { Router, type RequestHandler, type Response } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { AuthService } from '../../auth/service';
import type { Facade } from '../../facade';
import { param, parse } from '../http';

const operator = (res: Response) => String(res.locals.operator);

/**
 * The support grants of the request's organization (D-171; the right is `admin:support`, checked by `guard`): its
 * `org_admin` lets a system administrator in for at most 7 days (read, or write with `write: true`; never approve,
 * pay or admin), lists the grants (expired and revoked too) and revokes one.
 */
export function supportRouter(deps: { auth: AuthService; facadeOf: (res: Response) => Facade; guard: RequestHandler[] }) {
  const { auth, facadeOf, guard } = deps;
  const r = Router();
  const orgOf = (res: Response) => facadeOf(res).orgId;

  r.get('/support', ...guard, async (_req, res) => {
    res.json(await auth.supportGrants(orgOf(res)));
  });

  r.post('/support', ...guard, async (req, res) => {
    const body = parse(S.grantSupportBody, req.body);
    res.status(201).json(await auth.grantSupport({ ...body, orgId: orgOf(res), grantedBy: operator(res) }));
  });

  r.post('/support/:id/revoke', ...guard, async (req, res) => {
    res.json(await auth.revokeSupport(orgOf(res), param(req, 'id'), operator(res)));
  });

  return r;
}
