import { Router, type RequestHandler, type Response } from 'express';
import type { AuthService } from '../auth/service';
import type { Facade } from '../facade';
import { operatorTrace } from './audit';
import { authorize } from './authorize';
import { supportRouter } from './routes/support';
import { usersRouter } from './routes/users';
import { onboardingOrgRouter } from './routes/onboarding-org';

/**
 * The operations of an organization that live in the auth service, not in its facade (D-171): `/users*` and
 * `/support*`. Mounted after `resolveOrg` (or the `local` principal of `AUTH_MODE=off`) and before the router of the
 * organization; each route runs the same chain as the organization's routes: the operator's trace into the audit of
 * the request's organization, then `authorize` (the operation's ability). Labels are named by `labelIds` (own labels,
 * checked by the route through the facade), so the label guard has nothing to check.
 */
export function createOrgAdminRouter(deps: { auth: AuthService; facadeOf: (res: Response) => Facade }): Router {
  const guard: RequestHandler[] = [(req, res, next) => operatorTrace(deps.facadeOf(res))(req, res, next), authorize()];
  const r = Router();
  r.use(usersRouter({ ...deps, guard }));
  r.use(supportRouter({ ...deps, guard }));
  r.use(onboardingOrgRouter({ ...deps, guard }));
  return r;
}
