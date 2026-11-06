import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../shared/errors';
import type { AuthService, SessionUser } from './service';
import { localPrincipal, principalOfUser, systemKeyPrincipal, type Principal } from './abilities';
import { assertSecret, TOKEN_TTL_SECONDS, verifyToken, type TokenClaims } from './token';

// Who is asking (D-170, D-171). `AUTH_MODE=on` (the default): the session cookie (a JWT `{ sub, sid }`; the session,
// the user and the membership are read on every request) or the header `X-System-Key` (= SYSTEM_ADMIN_KEY; unset =
// the path is off). `AUTH_MODE=off` (tests, scripts, the local stand only): no cookie, the organization is
// ERP_DEFAULT_ORG, the operator comes from `X-Operator`. Every write passes the `Origin` check (`originGuard`).

/** The cookie name without `AUTH_COOKIE_SECURE=1` (http: the development stand, the LAN, e2e). */
export const SESSION_COOKIE = 'erp_session';
/** The cookie name with `AUTH_COOKIE_SECURE=1` (only behind https): the `__Host-` prefix needs `Secure`. */
export const SECURE_SESSION_COOKIE = '__Host-erp_session';

export interface AuthConfig {
  mode: 'on' | 'off';
  /** HS256 secret, at least 32 bytes; required in `on`. */
  secret?: string;
  /** SYSTEM_ADMIN_KEY: unset = no system access by key. */
  systemKey?: string;
  /** ERP_DEFAULT_ORG: the organization of every request in `off`. */
  defaultOrg?: string;
  /** AUTH_COOKIE_SECURE=1: the cookie is `__Host-erp_session` with `Secure` (one name per process). */
  cookieSecure?: boolean;
  /** AUTH_LOGIN_LIMIT: failed logins per login and minute (env default 5; unset here or 0 = off). */
  loginLimit?: number;
  /** AUTH_IP_LIMIT: failed logins per client IP and minute (env default 20; unset here or 0 = off). */
  ipLimit?: number;
  /**
   * TRUST_PROXY: Express `trust proxy` (`req.ip`), and `X-Forwarded-Host` / `-Proto` in the `Origin` check. `1` /
   * `true` = one hop (`req.ip` = the address the last proxy saw), a number = that many hops, else Express's own value.
   */
  trustProxy?: boolean | number | string;
  /** APP_ORIGIN: extra origins a write may come from (comma separated), besides the request's own. */
  appOrigins?: string[];
}

const limitOf = (raw: string | undefined, fallback: number, name: string): number => {
  const v = raw?.trim();
  if (v === undefined || v === '') return fallback;
  if (!/^[0-9]{1,6}$/.test(v)) throw new Error(`${name} must be a whole number (0 = off), not "${v}"`);
  return Number.parseInt(v, 10);
};

function trustProxyOf(raw: string | undefined): AuthConfig['trustProxy'] {
  const v = raw?.trim();
  if (!v || v === '0' || v === 'false') return undefined;
  if (v === '1' || v === 'true') return 1; // one hop (the reverse proxy in front), never Express `true` (= trust all)
  if (/^[0-9]{1,2}$/.test(v)) return Number.parseInt(v, 10);
  return v; // 'loopback', a list of addresses
}

/** The settings of the process; throws a readable error when `on` has no valid secret or a value is malformed. */
export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const mode = env.AUTH_MODE?.trim() || 'on';
  if (mode !== 'on' && mode !== 'off') throw new Error(`AUTH_MODE must be "on" or "off", not "${mode}"`);
  const secret = env.AUTH_SECRET || undefined;
  if (mode === 'on') assertSecret(secret);
  const appOrigins = (env.APP_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s !== '');
  return {
    mode,
    secret,
    systemKey: env.SYSTEM_ADMIN_KEY || undefined,
    defaultOrg: env.ERP_DEFAULT_ORG?.trim() || undefined,
    cookieSecure: env.AUTH_COOKIE_SECURE === '1',
    loginLimit: limitOf(env.AUTH_LOGIN_LIMIT, 5, 'AUTH_LOGIN_LIMIT'),
    ipLimit: limitOf(env.AUTH_IP_LIMIT, 20, 'AUTH_IP_LIMIT'),
    trustProxy: trustProxyOf(env.TRUST_PROXY),
    ...(appOrigins.length ? { appOrigins } : {}),
  };
}

/** The one session cookie name of the process (reading, setting, clearing, OpenAPI). */
export const sessionCookieName = (config: Pick<AuthConfig, 'cookieSecure'>): string =>
  config.cookieSecure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;

/** The paths under /api/v1 that need no session. */
const PUBLIC = new Set(['/api/v1/health', '/api/v1/openapi.json', '/api/v1/auth/login', '/api/v1/auth/logout']);
const isPublic = (path: string) => PUBLIC.has(path) || path === '/api/v1/docs' || path.startsWith('/api/v1/docs/');

function cookieOf(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** The verified claims of the request's session cookie (signature and `exp` only; the row is not read). */
export function sessionClaimsOf(req: Request, config: AuthConfig): TokenClaims | null {
  if (!config.secret) return null;
  const token = cookieOf(req, sessionCookieName(config));
  return token ? verifyToken(token, config.secret) : null;
}

/** Constant-time comparison of two strings of any length. */
function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(h(a), h(b)) && a.length === b.length;
}

/** The user of the request (set by `authenticateOrSystemKey` from the session), if any. */
export const sessionUserOf = (res: Response): SessionUser | undefined => res.locals.user as SessionUser | undefined;
/** True when the request came with the right `X-System-Key`. */
export const hasSystemKey = (res: Response): boolean => res.locals.systemKey === true;

/**
 * Mount on `/api`: public paths pass; otherwise the cookie gives `res.locals.user` (a live session of an active user
 * with an active membership, D-171), or a right `X-System-Key` gives `res.locals.systemKey`; neither = 401
 * `unauthenticated` (in `off` the request passes), a wrong key = 403 `forbidden`.
 */
export function authenticateOrSystemKey(auth: AuthService, config: AuthConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isPublic(req.baseUrl + req.path)) return next();
    if (config.mode === 'on') {
      const claims = sessionClaimsOf(req, config);
      const user = claims ? await auth.sessionUser(claims.sub, claims.sid) : undefined;
      if (user) {
        res.locals.user = user;
        return next();
      }
    }
    const key = req.header('x-system-key');
    if (key !== undefined) {
      if (!config.systemKey || !sameSecret(key, config.systemKey)) throw new ForbiddenError('Wrong system key');
      res.locals.systemKey = true;
      return next();
    }
    if (config.mode === 'off') return next();
    throw new UnauthenticatedError();
  };
}

/** `user` operations (`/auth/me`, `/auth/password`): a session in `on`; anyone in `off`. */
export function requireUser(config: AuthConfig): RequestHandler {
  return (_req, res, next) => {
    if (config.mode === 'on' && !sessionUserOf(res)) throw new UnauthenticatedError();
    next();
  };
}

/**
 * The principal of a request outside an organization (D-171): a session user (a member or the system administrator),
 * the system key, or `local` in `off`; undefined = nobody (401). Inside an organization `resolveOrg` builds it.
 */
export function requestPrincipal(res: Response, config: Pick<AuthConfig, 'mode' | 'defaultOrg'>): Principal | undefined {
  const user = sessionUserOf(res);
  if (user) return principalOfUser(user);
  if (hasSystemKey(res)) return systemKeyPrincipal();
  if (config.mode === 'off') return localPrincipal(config.defaultOrg ?? null);
  return undefined;
}

const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const first = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() || undefined;

/** The origin of the request itself: `<scheme>://<raw Host header with its port>` (X-Forwarded-* only behind a trusted proxy). */
function ownOrigin(req: Request, config: AuthConfig): string | undefined {
  const trusted = config.trustProxy !== undefined && config.trustProxy !== false;
  const host = (trusted ? first(req.headers['x-forwarded-host']) : undefined) ?? req.headers.host;
  if (!host) return undefined;
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true;
  const proto = (trusted ? first(req.headers['x-forwarded-proto']) : undefined) ?? (encrypted ? 'https' : 'http');
  return `${proto.toLowerCase()}://${host.toLowerCase()}`;
}

/**
 * The CSRF rule of writes (D-171), on top of `SameSite=Strict` and the required non-simple `X-Operator`: an `Origin`,
 * when the request has one, equals one of `APP_ORIGIN` or the request's own origin (the raw `Host` header with its
 * port, never `req.hostname`); a `Sec-Fetch-Site`, when present, is `same-origin` or `none`. Otherwise `403 csrf`.
 * Scripts and supertest send no `Origin` and pass; the Vite proxy (no `changeOrigin`) keeps `Host: localhost:5173`,
 * which matches the browser's `Origin`. Applies to every write under /api, the login included, in both modes.
 */
export function originGuard(config: AuthConfig): RequestHandler {
  const allowed = new Set((config.appOrigins ?? []).map((o) => o.toLowerCase()));
  return (req, _res, next) => {
    if (!WRITES.has(req.method)) return next();
    const site = req.header('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none')
      throw new ForbiddenError('A request from another site is refused', 'csrf');
    const origin = req.header('origin');
    if (origin !== undefined) {
      const o = origin.trim().toLowerCase();
      if (!allowed.has(o) && o !== ownOrigin(req, config))
        throw new ForbiddenError('A request from another site is refused', 'csrf');
    }
    next();
  };
}

/** `Cache-Control: no-store` on every answer of /api (D-171). */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/** The `Set-Cookie` value of a new session. */
export function sessionCookie(token: string, config: AuthConfig): string {
  return `${sessionCookieName(config)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TOKEN_TTL_SECONDS}${config.cookieSecure ? '; Secure' : ''}`;
}

/** The `Set-Cookie` value that ends the session. */
export function clearedSessionCookie(config: AuthConfig): string {
  return `${sessionCookieName(config)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.cookieSecure ? '; Secure' : ''}`;
}
