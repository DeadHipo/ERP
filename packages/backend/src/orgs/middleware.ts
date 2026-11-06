import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { localPrincipal, principalOfUser, readerPrincipal, supportPrincipal, type Principal } from '../auth/abilities';
import type { SupportState } from '../auth/service';
import { hasReadToken, hasSystemKey, sessionUserOf, type AuthConfig } from '../auth/middleware';
import { ForbiddenError, ValidationError } from '../shared/errors';
import type { OrgEntry } from './facades';

/** The `X-Org` header of a request, trimmed (the only reader of it, D-170); undefined when absent or empty. */
export const xOrgOf = (req: Request): string | undefined => req.header('x-org')?.trim() || undefined;

/** The support access of a system administrator to an organization (`auth.supportState`, D-171). */
export type SupportOf = (orgId: string, userId: string) => Promise<SupportState>;

/**
 * The organization of a request (D-170, D-171), the only reader of `X-Org`: a member works in the organization of
 * their session, whose membership `authenticateOrSystemKey` has just checked (`X-Org` from them = 403 `forbidden`);
 * the system administrator names it with `X-Org` (none = 400 `org_required`) and works in it only as `support`,
 * under a live grant of its administrator (read; write with a write grant): none = 403 `support_required`, only
 * expired ones = 403 `support_expired`; the system key never works in an organization (403 `support_required`); in
 * `AUTH_MODE=off` it is ERP_DEFAULT_ORG and `X-Org` is ignored. Then the facade of the organization (404
 * `org_not_found`, before the grant) goes to `res.locals.entry`, whose router serves the request; the principal to
 * `res.locals.principal`, a live grant to `res.locals.support`. The read token (D-177) works in ERP_DEFAULT_ORG in both
 * modes, as `reader`; `X-Org` of another organization is 403 `forbidden`.
 */
export function resolveOrg(
  facades: { get(orgId: string): Promise<OrgEntry> },
  config: Pick<AuthConfig, 'mode' | 'defaultOrg'>,
  supportOf?: SupportOf,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    let orgId: string | undefined;
    let principal: Principal | undefined;
    let entry: OrgEntry | undefined;
    if (hasReadToken(res)) {
      orgId = config.defaultOrg;
      if (!orgId) throw new ValidationError('ERP_DEFAULT_ORG is not set', undefined, 'org_required');
      const xOrg = xOrgOf(req);
      if (xOrg !== undefined && xOrg !== orgId) throw new ForbiddenError('The read token works in one organization');
      principal = readerPrincipal(orgId);
    } else if (config.mode === 'off') {
      orgId = config.defaultOrg;
      if (!orgId) throw new ValidationError('ERP_DEFAULT_ORG is not set', undefined, 'org_required');
      principal = localPrincipal(orgId);
    } else {
      const user = sessionUserOf(res);
      const xOrg = req.header('x-org')?.trim();
      if (user && !user.isSystemAdmin) {
        if (xOrg !== undefined) throw new ForbiddenError('X-Org is for the system administrator');
        orgId = user.orgId ?? undefined;
        principal = principalOfUser(user);
      } else if (user?.isSystemAdmin) {
        orgId = xOrg || undefined;
        if (!orgId) throw new ValidationError('Choose an organization: the X-Org header', undefined, 'org_required');
        entry = await facades.get(orgId);
        const grant = supportOf ? await supportOf(orgId, user.id) : ({ state: 'none' } as const);
        if (grant.state === 'expired')
          throw new ForbiddenError('The support access of this organization has expired', 'support_expired');
        if (grant.state !== 'live')
          throw new ForbiddenError('The organization administrator has to grant support access', 'support_required');
        res.locals.support = { orgId, expiresAt: grant.expiresAt, write: grant.write };
        principal = supportPrincipal(user, orgId, grant.write);
      } else if (hasSystemKey(res)) {
        throw new ForbiddenError('The system key works in no organization', 'support_required');
      }
      if (!orgId) throw new ValidationError('Choose an organization: the X-Org header', undefined, 'org_required');
    }
    res.locals.org = orgId;
    res.locals.principal = principal;
    res.locals.entry = entry ?? (await facades.get(orgId));
    next();
  };
}

/** Serves the request with the routes of the organization `resolveOrg` chose. */
export function orgRoutes(req: Request, res: Response, next: NextFunction): void {
  (res.locals.entry as OrgEntry).router(req, res, next);
}
