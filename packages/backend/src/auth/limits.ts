// The limit of login attempts (D-171): only FAILED attempts count (a wrong password, an unknown login, a disabled
// user), per login and per client IP, in a sliding window of one minute. Over the limit the next attempt is refused
// before the password is checked (`429 too_many_attempts` with `Retry-After`). A limit of 0 is off (tests, the e2e
// stand). The counter belongs to ONE app instance (`createServerApp` / `createApp` make it): several processes would
// need a table (В7).
//
// Every attempt is counted as a failure BEFORE the password is checked (`begin`), synchronously, so parallel requests
// cannot all pass the check while the slow scrypt runs; an attempt that turns out right (`succeeded`) clears the
// counter of its login and takes its own stamp back from the address. Anything that throws stays counted.
//
// NOTE (by design): the per-login counter lets anyone lock a known login out for a minute with wrong passwords; the
// owner still signs in after the window. Accepted at this size (no captcha, no per-device trust).

export const LOGIN_WINDOW_MS = 60_000;
/** Above this many tracked keys the expired ones are swept on the next attempt. */
const SWEEP_AT = 10_000;

export interface LoginLimits {
  /** Failed attempts per login and window (AUTH_LOGIN_LIMIT, 0 = off). */
  perLogin: number;
  /** Failed attempts per client IP and window (AUTH_IP_LIMIT, 0 = off). */
  perIp: number;
  windowMs?: number;
}

/** The stamp of an attempt in progress (`begin` → `succeeded`). */
export interface AttemptStamp {
  at: number;
}

export function createLoginLimiter(limits: LoginLimits, now: () => number = Date.now) {
  const windowMs = limits.windowMs ?? LOGIN_WINDOW_MS;
  const failures = new Map<string, AttemptStamp[]>();

  const recent = (key: string, t: number): AttemptStamp[] => {
    const list = (failures.get(key) ?? []).filter((s) => s.at > t - windowMs);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };
  /** Seconds until the oldest failure in the window expires, when the key is at its limit; else 0. */
  const wait = (key: string, limit: number, t: number): number => {
    if (limit <= 0) return 0;
    const list = recent(key, t);
    if (list.length < limit) return 0;
    const oldest = (list[list.length - limit] as AttemptStamp).at;
    const ms = oldest + windowMs - t;
    // whole seconds, rounded up, in integer arithmetic (no float rounding in src: rules-coverage)
    return Math.max(1, (ms - (ms % 1000)) / 1000 + (ms % 1000 > 0 ? 1 : 0));
  };
  const loginKey = (login: string) => `l:${login}`;
  const ipKey = (ip: string) => `i:${ip}`;

  return {
    /**
     * Starts an attempt: over the limit `{ wait }` (seconds, nothing recorded); else the attempt is recorded as a
     * failure of the login and the address at once and its `stamp` is returned.
     */
    begin(login: string, ip: string): { wait: number } | { stamp: AttemptStamp } {
      const t = now();
      const w = Math.max(wait(loginKey(login), limits.perLogin, t), wait(ipKey(ip), limits.perIp, t));
      if (w > 0) return { wait: w };
      if (failures.size > SWEEP_AT) for (const k of [...failures.keys()]) recent(k, t);
      const stamp: AttemptStamp = { at: t };
      for (const [key, limit] of [[loginKey(login), limits.perLogin], [ipKey(ip), limits.perIp]] as const) {
        if (limit <= 0) continue;
        failures.set(key, [...recent(key, t), stamp]);
      }
      return { stamp };
    },
    /** The attempt was right: the login's counter is cleared, the address loses only this attempt's stamp. */
    succeeded(login: string, ip: string, stamp: AttemptStamp): void {
      failures.delete(loginKey(login));
      const list = failures.get(ipKey(ip));
      if (!list) return;
      const rest = list.filter((s) => s !== stamp);
      if (rest.length) failures.set(ipKey(ip), rest);
      else failures.delete(ipKey(ip));
    },
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
