import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { abilityName, can, type Ability, type Decision, type Principal } from '../auth/abilities';
import { AppError, ForbiddenError, UnauthenticatedError, ValidationError } from '../shared/errors';
import { requestLabelsOf } from './label-guard';
import { API_OPERATIONS, operationOf } from './operations';
import { drain } from './upload';

// The right of a request (D-171): the operation it reaches carries its `ability`, the principal of the request
// (`res.locals.principal`, built once by `resolveOrg`, or the `local` one of `AUTH_MODE=off`) and the labels the
// request names go to `can()` (`auth/abilities.ts`, the one table of rules). Routes never see roles.

/** The principal of the request; absent = the chain did not build one (fail closed). */
export const principalOf = (res: Response): Principal | undefined => res.locals.principal as Principal | undefined;

/** The error of a refusal. */
function refusalError(d: Exclude<Decision, { ok: true }>, ability: Ability): AppError {
  switch (d.code) {
    case 'label_required':
      return new ValidationError('Choose a label: ?label= or labelId', undefined, 'label_required');
    case 'label_forbidden':
      return new ForbiddenError('No access to this label', 'label_forbidden');
    case 'support_required':
      return new ForbiddenError('The organization administrator has to grant support access', 'support_required');
    case 'support_read_only':
      return new ForbiddenError('Support access is read-only', 'support_read_only');
    default:
      return new ForbiddenError('Not allowed for this role', 'forbidden', { ability: abilityName(ability) });
  }
}

/** `404 not_found` for a request that reaches no operation: the same answer as `unknownApiRoute`. */
const unknownRoute = () => new AppError('Unknown API route', 404, 'not_found');

/**
 * Mount in the router of an organization after `labelGuard` (D-171): the operation of the request (`operationOf`,
 * matched as Express matches; none, or not an operation of an organization = `404 not_found`), then `can()` with the
 * labels of the request: `400 label_required`, `403 label_forbidden`, `403 forbidden`, `403 support_*`. The body of
 * a refused upload is drained first.
 */
export function authorize(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    let refusal: AppError | undefined;
    try {
      const op = operationOf(req.method, req.path);
      const principal = principalOf(res);
      if (!op || op.access !== 'org') refusal = unknownRoute();
      else if (!principal) refusal = new UnauthenticatedError();
      else {
        const d = can(principal, op.ability, requestLabelsOf(req));
        if (!d.ok) refusal = refusalError(d, op.ability);
      }
    } catch (e) {
      refusal = e instanceof AppError ? e : unknownRoute();
    }
    if (refusal) {
      await drain(req);
      throw refusal;
    }
    next();
  };
}

/**
 * A route-level check for the system router (`/orgs*`, D-171): the operation of the matched route (`req.route.path`)
 * and `can()` for the principal `principalOfRequest` builds. Only the system administrator and the system key pass a
 * `system` operation; anyone else is `403 forbidden`.
 */
export function authorizeRoute(principalOfRequest: (res: Response) => Principal | undefined): RequestHandler {
  return (req, res, next) => {
    const route = (req.route as { path?: unknown } | undefined)?.path;
    const op = API_OPERATIONS.find((o) => o.method === req.method.toLowerCase() && o.path === route);
    if (!op?.ability) throw unknownRoute();
    const principal = principalOfRequest(res);
    if (!principal) throw new UnauthenticatedError();
    const d = can(principal, op.ability, { labelIds: [] });
    if (!d.ok) throw refusalError(d, op.ability);
    next();
  };
}
