import { Router, type RequestHandler, type Response } from 'express';
import type { AuthService } from '../../auth/service';
import type { Facade } from '../../facade';

/**
 * The onboarding checklist of the organization (D-172; the right is `admin:users`, checked by `guard`): the facade
 * counts the labels and accounts, the members come from the auth service (the facade never imports it): the active
 * memberships of users that are not disabled, and how many of them are `org_admin`.
 */
export function onboardingOrgRouter(deps: { auth: AuthService; facadeOf: (res: Response) => Facade; guard: RequestHandler[] }) {
  const { auth, facadeOf, guard } = deps;
  const r = Router();
  r.get('/onboarding/organization', ...guard, async (_req, res) => {
    const facade = facadeOf(res);
    const active = (await auth.members(facade.orgId)).filter((m) => m.active && !m.disabled);
    const { steps } = await facade.organizationChecklist({
      members: active.length,
      admins: active.filter((m) => m.role === 'org_admin').length,
    });
    res.json({ org: { id: facade.orgId }, steps });
  });
  return r;
}
