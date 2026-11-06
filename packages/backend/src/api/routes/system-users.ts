import { Router, type Response } from 'express';
import * as S from '@erp/shared/api-schemas';
import { requestPrincipal, type AuthConfig } from '../../auth/middleware';
import type { AuthService } from '../../auth/service';
import { noOrgTrace } from '../audit';
import { authorizeRoute } from '../authorize';
import { param, parse } from '../http';
import { requestIdOf } from '../request-id';

/**
 * Every user, for the system administrator only (D-171): the list with the memberships (never a hash), disable or
 * enable a user everywhere (disabling ends every session), a new password (every session ends). No organization, so
 * no audit row: the server log keeps the request id, the target login and the outcome (never the password).
 */
export function systemUsersRouter(deps: { auth: AuthService; config: AuthConfig }) {
  const { auth, config } = deps;
  const r = Router();
  const system = authorizeRoute((res) => requestPrincipal(res, config));
  const trace = noOrgTrace();
  const log = (res: Response, login: string, outcome: string) =>
    console.info(`[${requestIdOf(res) ?? 'none'}] system user ${JSON.stringify(login)}: ${outcome} by ${JSON.stringify(String(res.locals.operator))}`);

  r.get('/system/users', system, async (_req, res) => {
    res.json(await auth.systemUsers());
  });

  r.patch('/system/users/:id', system, trace, async (req, res) => {
    const body = parse(S.updateSystemUserBody, req.body);
    const user = await auth.setDisabledById(param(req, 'id'), body.disabled);
    log(res, user.login, body.disabled ? 'disabled' : 'enabled');
    res.json(await auth.systemUser(user.id));
  });

  r.post('/system/users/:id/password', system, trace, async (req, res) => {
    const body = parse(S.setPasswordBody, req.body);
    const user = await auth.resetPasswordById(param(req, 'id'), body.password);
    log(res, user.login, 'password reset');
    res.json({ ok: true });
  });

  return r;
}
