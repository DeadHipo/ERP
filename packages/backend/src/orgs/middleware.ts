import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { hasSystemKey, sessionUserOf, type AuthConfig } from '../auth/middleware';
import { ForbiddenError, ValidationError } from '../shared/errors';
import type { OrgEntry } from './facades';

/**
 * The organization of a request (D-170), the only reader of `X-Org`: a user works in the organization of their row
 * (`X-Org` from them = 403 `forbidden`); a system administrator (session or system key) names it with `X-Org` (none =
 * 400 `org_required`); in `AUTH_MODE=off` it is ERP_DEFAULT_ORG and `X-Org` is ignored. Then the facade of the
 * organization (404 `org_not_found`) goes to `res.locals.entry`, whose router serves the request.
 */
export function resolveOrg(
  facades: { get(orgId: string): Promise<OrgEntry> },
  config: Pick<AuthConfig, 'mode' | 'defaultOrg'>,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    let orgId: string | undefined;
    if (config.mode === 'off') {
      orgId = config.defaultOrg;
      if (!orgId) throw new ValidationError('ERP_DEFAULT_ORG is not set', undefined, 'org_required');
    } else {
      const user = sessionUserOf(res);
      const xOrg = req.header('x-org')?.trim();
      if (user && !user.isSystemAdmin) {
        if (xOrg !== undefined) throw new ForbiddenError('X-Org is for the system administrator');
        orgId = user.orgId ?? undefined;
      } else if (user?.isSystemAdmin || hasSystemKey(res)) {
        orgId = xOrg || undefined;
      }
      if (!orgId) throw new ValidationError('Choose an organization: the X-Org header', undefined, 'org_required');
    }
    res.locals.org = orgId;
    res.locals.entry = await facades.get(orgId);
    next();
  };
}

/** Serves the request with the routes of the organization `resolveOrg` chose. */
export function orgRoutes(req: Request, res: Response, next: NextFunction): void {
  (res.locals.entry as OrgEntry).router(req, res, next);
}
