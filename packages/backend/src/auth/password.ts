import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Passwords (D-170): scrypt N=16384, r=8, p=1, a 16-byte salt, a 64-byte key, stored as
// `scrypt$16384$8$1$<salt base64>$<hash base64>`; compared in constant time. No password policy at stage 2.

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, keyLength: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keyLength, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** The stored string of a new password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, KEY_LENGTH, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

const parseIntStrict = (s: string | undefined): number | undefined =>
  s !== undefined && /^[1-9][0-9]{0,6}$/.test(s) ? Number.parseInt(s, 10) : undefined;

/** True when `password` matches the stored string; a malformed stored string never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = [parseIntStrict(parts[1]), parseIntStrict(parts[2]), parseIntStrict(parts[3])];
  if (N === undefined || r === undefined || p === undefined) return false;
  const salt = Buffer.from(parts[4] as string, 'base64');
  const expected = Buffer.from(parts[5] as string, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const key = await derive(password, salt, expected.length, { N, r, p });
  return timingSafeEqual(key, expected);
}

/**
 * A hash nobody's password matches, computed once: an unknown login is checked against it, so that the answer takes
 * as long as for a known login with a wrong password.
 */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword(randomBytes(32).toString('hex')));
