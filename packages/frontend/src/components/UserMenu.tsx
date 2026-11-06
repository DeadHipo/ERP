import { useState } from 'react';
import { Button } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@erp/shared/api-responses';
import * as api from '../api/client';
import { useAction } from '../api/queries/core';
import { orgQueries } from '../api/queries/orgs';
import { ActionButton } from './ActionButton';
import { FormDialog } from './FormDialog';
import { TextField } from './fields/TextField';
import { setOperator } from '../lib/operator';
import { setWorkOrg, useWorkOrg } from '../lib/session';
import { ru } from '../i18n/ru';

const t = ru.shell.user;

/** «Сменить пароль» (D-171): the current one and the new one; the other sessions of the user end. */
function ChangePasswordDialog(props: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const run = useAction(() => api.auth.changePassword({ current, next }), { invalidate: 'reference', success: () => t.passwordChanged });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.changePassword}
      subtitle={t.changePasswordSubtitle}
      footer={
        <ActionButton
          name="change-password-submit"
          op="POST /auth/password"
          isPending={run.isPending}
          isDisabled={current === '' || next === ''}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {ru.common.save}
        </ActionButton>
      }
    >
      <TextField name="current-password" label={t.currentPassword} type="password" value={current} onChange={setCurrent} autoComplete="current-password" isRequired />
      <TextField name="new-password" label={t.newPassword} type="password" value={next} onChange={setNext} autoComplete="new-password" isRequired />
    </FormDialog>
  );
}

/**
 * The user of the session in the header (D-170, `AUTH_MODE=on`; replaces `OperatorField`): the login and the name of
 * the organization, «Выйти». A system administrator sees the organization they work in (`erp.org`, P25) and may leave it.
 */
export function UserMenu({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const workOrg = useWorkOrg();
  const admin = me.user?.isSystemAdmin === true;
  const chosen = useQuery({ ...orgQueries.detail(workOrg), enabled: admin && workOrg !== '' });
  const orgName = admin ? (workOrg ? (chosen.data?.name ?? me.org?.name ?? '…') : t.noOrg) : (me.org?.name ?? t.noOrg);
  const [changing, setChanging] = useState(false);

  const logout = async () => {
    try {
      await api.auth.logout();
    } finally {
      api.leaveToLogin();
      setOperator('');
      setWorkOrg('');
      queryClient.clear();
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
          {admin ? ` · ${me.role === 'support' ? t.support : t.systemAdmin}` : ''}
        </span>
      </div>
      {admin && workOrg ? (
        <Button size="sm" variant="tertiary" data-testid="action-leave-org" onPress={leaveOrg}>
          {t.leaveOrg}
        </Button>
      ) : null}
      <ActionButton name="change-password" op="POST /auth/password" variant="tertiary" onPress={() => setChanging(true)}>
        {t.changePassword}
      </ActionButton>
      <Button size="sm" variant="secondary" data-testid="action-logout" onPress={() => void logout()}>
        {t.logout}
      </Button>
      {changing ? <ChangePasswordDialog onClose={() => setChanging(false)} /> : null}
    </div>
  );
}
