import { queryOptions, useQuery } from '@tanstack/react-query';
import * as api from '../client';
import { setOperator } from '../../lib/operator';
import { setSessionSystemAdmin } from '../../lib/session';

export const authKeys = { me: () => ['auth', 'me'] as const };

/**
 * `GET /auth/me`, once per load (D-170). On the answer, before any page asks anything: a system administrator may send
 * `X-Org`, and with the login on the operator of every write (`X-Operator`, R5) is the login of the session.
 */
async function loadMe() {
  const me = await api.auth.me();
  setSessionSystemAdmin(me.user?.isSystemAdmin ?? false);
  if (me.authMode === 'on' && me.user) setOperator(me.user.login);
  return me;
}

export const authQueries = {
  me: () => queryOptions({ queryKey: authKeys.me(), queryFn: loadMe, staleTime: Infinity }),
};

/** The session: the mode, the user and the organization. */
export function useMe() {
  return useQuery(authQueries.me());
}

/** D-194: publishing v2 is the source of the money: the links and terms are written on /publishing-v2. */
export function usePublishingV2(): boolean {
  return useMe().data?.publishingSource === 'v2';
}
