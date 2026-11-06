import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Passwords (D-170, D-171): scrypt N=32768, r=8, p=1 (128·N·r = 32 MiB, maxmem 64 MiB), a 16-byte salt, a 64-byte
// key, stored as `scrypt$32768$8$1$<salt base64>$<hash base64>`; compared in constant time. The string describes its
// own parameters: an older hash (N=16384 of stage 2) is checked by its own and rehashed at the next login
// (`needsRehash`). At most 4 derivations run at once (a burst of logins cannot take all the memory). No password policy.

const PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_PARALLEL = 4;

let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); // the slot passes to the next waiter
    else running--;
  }
}

function derive(password: string, salt: Buffer, keyLength: number, opts: ScryptOptions): Promise<Buffer> {
  return withSlot(
    () =>
      new Promise((resolve, reject) =>
        scrypt(password, salt, keyLength, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) =>
          err ? reject(err) : resolve(key),
        ),
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

/** True when a stored string was made with other parameters than a new hash (rehash it after a right password). */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6) return true;
  const key = Buffer.from(parts[5] as string, 'base64');
  return (
    parts[1] !== String(PARAMS.N) ||
    parts[2] !== String(PARAMS.r) ||
    parts[3] !== String(PARAMS.p) ||
    key.length !== KEY_LENGTH
  );
}

/**
 * A hash nobody's password matches, computed once on the parameters of a new hash: an unknown login is checked
 * against it, so that the answer takes as long as for a known login with a wrong password.
 */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword(randomBytes(32).toString('hex')));
