import { createHmac, timingSafeEqual } from 'node:crypto';

// The session token (D-170): a JWT signed with HS256 through node:crypto. The header is exactly
// {"alg":"HS256","typ":"JWT"} (any other header is refused, `alg: none` included), the body only { sub, sid, iat, exp }
// (D-171): `sid` names the row of `auth.sessions`, read on every request with the user and the membership (revoked,
// expired, disabled = 401). A stage-2 token without `sid` is refused. 12 hours, no renewal.

export const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

export interface TokenClaims {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
}

/** Whole seconds since the epoch (exact integer arithmetic, no float rounding). */
export const nowSeconds = (ms = Date.now()): number => (ms - (ms % 1000)) / 1000;

const sign = (input: string, secret: string) => createHmac('sha256', secret).update(input).digest();

/** The secret must have at least 32 bytes and must not be a placeholder (`change_me…`). */
export function assertSecret(secret: string | undefined): asserts secret is string {
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) throw new Error('AUTH_SECRET must have at least 32 bytes');
  if (/^change_me/i.test(secret)) throw new Error('AUTH_SECRET is a placeholder: set a random value');
}

export function signToken(sub: string, sid: string, secret: string, now = nowSeconds()): string {
  assertSecret(secret);
  const claims: TokenClaims = { sub, sid, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${HEADER}.${body}`;
  return `${input}.${sign(input, secret).toString('base64url')}`;
}

/** The claims of a valid, unexpired token; null for anything else. */
export function verifyToken(token: string, secret: string, now = nowSeconds()): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  if (header !== HEADER) return null;
  const expected = sign(`${header}.${body}`, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: Partial<TokenClaims>;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<TokenClaims>;
  } catch {
    return null;
  }
  const { sub, sid, iat, exp } = claims;
  if (typeof sub !== 'string' || !sub || typeof sid !== 'string' || !sid) return null;
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return null;
  if ((exp as number) <= now) return null;
  return { sub, sid, iat: iat as number, exp: exp as number };
}
