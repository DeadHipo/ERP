import { useMe } from '../api/queries/auth';
import type { OperationKey } from '../api/coverage';

/**
 * May the session call this operation (D-171)? The backend's one rule table answers it in `me.abilities` (the keys
 * `METHOD /path`, without the data); the frontend only reads the list (R4). With the login off (`local`) and before
 * `GET /auth/me` answered, everything is allowed: the API still refuses what it refuses.
 */
export function isAllowed(me: { authMode: 'on' | 'off'; abilities: readonly string[] } | undefined, op: OperationKey): boolean {
  if (!me || me.authMode !== 'on') return true;
  return me.abilities.includes(op);
}

/** `isAllowed` for the session of the page. */
export function useAllowed(op: OperationKey | null | undefined): boolean {
  const me = useMe();
  return op ? isAllowed(me.data, op) : true;
}
