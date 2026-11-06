import { Router, type Request, type Response } from 'express';
import * as S from '@erp/shared/api-schemas';
import { allowedOperations, localPrincipal, principalOfUser } from '../../auth/abilities';
import type { LoginLimiter } from '../../auth/limits';
import {
  clearedSessionCookie,
  requireUser,
  sessionClaimsOf,
  sessionCookie,
  sessionUserOf,
  type AuthConfig,
} from '../../auth/middleware';
import { meOf, noMembership, OrgChoiceRequiredError, type AuthService, type MeRole, type SessionUser } from '../../auth/service';
import { nowSeconds, signToken, TOKEN_TTL_SECONDS } from '../../auth/token';
import type { Facade } from '../../facade';
import type { OrgsService } from '../../orgs/service';
import { TooManyAttemptsError, UnauthenticatedError, ValidationError } from '../../shared/errors';
import { selfTrace } from '../audit';
import { parse } from '../http';
import { API_OPERATIONS, operationKey } from '../operations';
import { requestIdOf } from '../request-id';

/** Every operation with its ability, for `me.abilities` (D-171). */
const OPERATION_ABILITIES = API_OPERATIONS.map((o) => ({ key: operationKey(o), ability: o.ability }));

/**
 * The login (D-170, D-171): `POST /auth/login` picks the organization (several memberships: `409 org_choice_required`
 * until `orgId` names one), opens a session row and sets the cookie; `POST /auth/logout` revokes the session of the
 * cookie and clears it (always 200); `GET /auth/me` says who is asking; `POST /auth/password` changes the user's own
 * password and revokes their other sessions. Login and logout are public (no `X-Operator`, no audit row).
 */
export function authRouter(deps: {
  auth: AuthService;
  config: AuthConfig;
  orgs: OrgsService;
  facadeOf: (orgId: string) => Promise<Facade>;
  limiter: LoginLimiter;
}) {
  const { auth, config, orgs, facadeOf, limiter } = deps;
  const r = Router();

  /** The own labels of an organization, by name. */
  async function ownLabels(orgId: string): Promise<{ id: string; name: string }[]> {
    const all = await (await facadeOf(orgId)).modules.labels.listLabels();
    return all
      .filter((l) => l.kind === 'own')
      .map((l) => ({ id: l.id, name: l.name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async function me(user: SessionUser | undefined) {
    const orgId = config.mode === 'off' ? config.defaultOrg : (user?.orgId ?? undefined);
    const org = orgId ? await orgs.findOrganization(orgId) : undefined;
    let role: MeRole | null = null;
    let labels: { id: string; name: string }[] = [];
    let allLabels = false;
    if (config.mode === 'off') {
      role = 'local';
      allLabels = true;
      if (org) labels = await ownLabels(org.id);
    } else if (user?.isSystemAdmin) {
      role = 'system';
    } else if (user && org) {
      role = user.role;
      const own = await ownLabels(org.id);
      allLabels = user.role === 'org_admin';
      labels = allLabels ? own : own.filter((l) => user.labelIds.includes(l.id));
    }
    const memberships = user && config.mode === 'on' ? await auth.memberships(user.id) : [];
    // the abilities of the principal, without a request label (a manager's label operations count with one label)
    const principal = config.mode === 'off' ? localPrincipal(org?.id ?? null) : user ? principalOfUser(user) : undefined;
    const abilities = principal ? allowedOperations(principal, OPERATION_ABILITIES) : [];
    return meOf({ mode: config.mode, user, org, role, labels, allLabels, memberships, abilities });
  }

  const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const log = (res: Response, login: string, outcome: string) =>
    console.info(`[${requestIdOf(res) ?? 'none'}] login ${JSON.stringify(login)}: ${outcome}`);

  r.post('/auth/login', async (req, res) => {
    if (!req.is('application/json')) throw new ValidationError('The login takes a JSON body');
    const body = parse(S.loginBody, req.body);
    const ip = clientIp(req);
    // counted as a failure before the password is checked (parallel attempts cannot pass together); a right one
    // takes it back below, anything that throws stays counted
    const attempt = limiter.begin(body.login, ip);
    if ('wait' in attempt) {
      log(res, body.login, 'limited');
      res.setHeader('Retry-After', String(attempt.wait));
      throw new TooManyAttemptsError(attempt.wait);
    }
    const result = await auth.login(body.login, body.password, body.orgId);
    if (result.kind === 'refused') {
      log(res, body.login, 'refused');
      throw new UnauthenticatedError('Wrong login or password', 'invalid_credentials');
    }
    limiter.succeeded(body.login, ip, attempt.stamp);
    if (result.kind === 'no_membership') {
      log(res, body.login, 'no membership');
      throw noMembership();
    }
    if (result.kind === 'choose') {
      log(res, body.login, 'organization to choose');
      throw new OrgChoiceRequiredError(result.orgs);
    }
    log(res, body.login, 'ok');
    const user = result.user;
    if (config.secret) {
      const now = nowSeconds();
      // 401 when the password changed or the user was disabled since it was checked
      const sid = await auth.openSession(user, new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString(), result.verifiedHash);
      res.setHeader('Set-Cookie', sessionCookie(signToken(user.id, sid, config.secret, now), config));
      user.sessionId = sid;
    }
    res.json(await me(user));
  });

  r.post('/auth/logout', async (req, res) => {
    const claims = sessionClaimsOf(req, config);
    if (claims) await auth.revokeSession(claims.sid, claims.sub);
    res.setHeader('Set-Cookie', clearedSessionCookie(config));
    res.json({ ok: true });
  });

  r.get('/auth/me', requireUser(config), async (_req, res) => {
    res.json(await me(config.mode === 'on' ? sessionUserOf(res) : undefined));
  });

  r.post('/auth/password', requireUser(config), selfTrace(facadeOf), async (req, res) => {
    const user = sessionUserOf(res);
    if (!user) throw new UnauthenticatedError(); // `off` has no user to change
    const body = parse(S.changeOwnPasswordBody, req.body);
    await auth.changeOwnPassword(user, body.current, body.next);
    res.json({ ok: true });
  });

  return r;
}
