import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import {
  clearedSessionCookie,
  requireUser,
  sessionCookie,
  sessionUserOf,
  type AuthConfig,
} from '../../auth/middleware';
import { meOf, type AuthService, type SessionUser } from '../../auth/service';
import { signToken } from '../../auth/token';
import type { OrgsService } from '../../orgs/service';
import { UnauthenticatedError } from '../../shared/errors';
import { parse } from '../http';
import { requestIdOf } from '../request-id';

/**
 * The minimal login (D-170): `POST /auth/login` sets the session cookie, `POST /auth/logout` clears it (always 200),
 * `GET /auth/me` says who is asking. Login and logout are public (no `X-Operator`, no audit row: no organization yet).
 */
export function authRouter(deps: { auth: AuthService; config: AuthConfig; orgs: OrgsService }) {
  const { auth, config, orgs } = deps;
  const r = Router();

  async function me(user: SessionUser | undefined) {
    const orgId = config.mode === 'off' ? config.defaultOrg : (user?.orgId ?? undefined);
    const org = orgId ? await orgs.findOrganization(orgId) : undefined;
    return meOf(config.mode, user, org);
  }

  r.post('/auth/login', async (req, res) => {
    const body = parse(S.loginBody, req.body);
    const user = await auth.login(body.login, body.password);
    console.info(`[${requestIdOf(res) ?? 'none'}] login ${JSON.stringify(body.login)}: ${user ? 'ok' : 'refused'}`);
    if (!user) throw new UnauthenticatedError('Wrong login or password', 'invalid_credentials');
    if (config.secret) res.setHeader('Set-Cookie', sessionCookie(signToken(user.id, config.secret), config));
    res.json(await me(user));
  });

  r.post('/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearedSessionCookie(config));
    res.json({ ok: true });
  });

  r.get('/auth/me', requireUser(config), async (_req, res) => {
    res.json(await me(config.mode === 'on' ? sessionUserOf(res) : undefined));
  });

  return r;
}
