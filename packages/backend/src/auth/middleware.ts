import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../shared/errors';
import type { AuthService, SessionUser } from './service';
import { assertSecret, TOKEN_TTL_SECONDS, verifyToken } from './token';

// Who is asking (D-170). `AUTH_MODE=on` (the default): the session cookie `erp_session` (a JWT, the user row read on
// every request) or the header `X-System-Key` (= SYSTEM_ADMIN_KEY; unset = the path is off). `AUTH_MODE=off` (tests,
// scripts, the local stand only): no cookie, the organization is ERP_DEFAULT_ORG, the operator comes from `X-Operator`.

export const SESSION_COOKIE = 'erp_session';

export interface AuthConfig {
  mode: 'on' | 'off';
  /** HS256 secret, at least 32 bytes; required in `on`. */
  secret?: string;
  /** SYSTEM_ADMIN_KEY: unset = no system access by key. */
  systemKey?: string;
  /** ERP_DEFAULT_ORG: the organization of every request in `off`. */
  defaultOrg?: string;
  /** AUTH_COOKIE_SECURE=1: the cookie gets `Secure`. */
  cookieSecure?: boolean;
}

/** The settings of the process; throws a readable error when `on` has no valid secret or the mode is unknown. */
export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const mode = env.AUTH_MODE?.trim() || 'on';
  if (mode !== 'on' && mode !== 'off') throw new Error(`AUTH_MODE must be "on" or "off", not "${mode}"`);
  const secret = env.AUTH_SECRET || undefined;
  if (mode === 'on') assertSecret(secret);
  return {
    mode,
    secret,
    systemKey: env.SYSTEM_ADMIN_KEY || undefined,
    defaultOrg: env.ERP_DEFAULT_ORG?.trim() || undefined,
    cookieSecure: env.AUTH_COOKIE_SECURE === '1',
  };
}

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
 * Mount on `/api`: public paths pass; otherwise the cookie gives `res.locals.user`, or a right `X-System-Key` gives
 * `res.locals.systemKey`; neither = 401 `unauthenticated` (in `off` the request passes), a wrong key = 403 `forbidden`.
 */
export function authenticateOrSystemKey(auth: AuthService, config: AuthConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isPublic(req.baseUrl + req.path)) return next();
    if (config.mode === 'on' && config.secret) {
      const token = cookieOf(req, SESSION_COOKIE);
      const claims = token ? verifyToken(token, config.secret) : null;
      const user = claims ? await auth.sessionUser(claims.sub) : undefined;
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

/** `user` operations (`/auth/me`): a session in `on`; anyone in `off`. */
export function requireUser(config: AuthConfig): RequestHandler {
  return (_req, res, next) => {
    if (config.mode === 'on' && !sessionUserOf(res)) throw new UnauthenticatedError();
    next();
  };
}

/** `system` operations (`/orgs*`): a system administrator's session or the system key; otherwise 403 `forbidden`. */
export function requireSystem(config: AuthConfig): RequestHandler {
  return (_req, res, next) => {
    if (hasSystemKey(res) || sessionUserOf(res)?.isSystemAdmin) return next();
    if (config.mode === 'on' && !sessionUserOf(res)) throw new UnauthenticatedError();
    throw new ForbiddenError('Only a system administrator may do this');
  };
}

/** The `Set-Cookie` value of a new session. */
export function sessionCookie(token: string, config: AuthConfig): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TOKEN_TTL_SECONDS}${config.cookieSecure ? '; Secure' : ''}`;
}

/** The `Set-Cookie` value that ends the session. */
export function clearedSessionCookie(config: AuthConfig): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.cookieSecure ? '; Secure' : ''}`;
}
