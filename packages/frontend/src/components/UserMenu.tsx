import { Button } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@erp/shared/api-responses';
import * as api from '../api/client';
import { orgQueries } from '../api/queries/orgs';
import { setOperator } from '../lib/operator';
import { setWorkOrg, useWorkOrg } from '../lib/session';
import { ru } from '../i18n/ru';

const t = ru.shell.user;

/**
 * The user of the session in the header (D-170, `AUTH_MODE=on`; replaces `OperatorField`): the login and the name of
 * the organization, «Выйти». A system administrator sees the organization they work in (`erp.org`, P25) and may leave it.
 */
export function UserMenu({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const workOrg = useWorkOrg();
  const admin = me.user?.isSystemAdmin === true;
  const chosen = useQuery({ ...orgQueries.detail(workOrg), enabled: admin && workOrg !== '' });
  const orgName = admin ? (workOrg ? (chosen.data?.name ?? '…') : t.noOrg) : (me.org?.name ?? t.noOrg);

  const logout = async () => {
    try {
      await api.auth.logout();
    } finally {
      setOperator('');
      setWorkOrg('');
      queryClient.clear();
      window.location.assign('/login');
    }
  };
  const leaveOrg = () => {
    setWorkOrg('');
    queryClient.clear();
    window.location.assign('/system/orgs');
  };

  return (
    <div className="flex items-center gap-2" data-testid="user-menu" data-login={me.user?.login ?? ''}>
      <div className="flex flex-col text-right leading-tight">
        <span className="text-sm font-medium" data-testid="user-login">
          {me.user?.login}
        </span>
        <span className="text-xs text-muted" data-testid="user-org" data-org-id={admin ? workOrg : (me.org?.id ?? '')}>
          {orgName}
          {admin ? ` · ${t.systemAdmin}` : ''}
        </span>
      </div>
      {admin && workOrg ? (
        <Button size="sm" variant="tertiary" data-testid="action-leave-org" onPress={leaveOrg}>
          {t.leaveOrg}
        </Button>
      ) : null}
      <Button size="sm" variant="secondary" data-testid="action-logout" onPress={() => void logout()}>
        {t.logout}
      </Button>
    </div>
  );
}
