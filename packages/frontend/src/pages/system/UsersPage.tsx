import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { SystemUser } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { userQueries } from '../../api/queries/users';
import { ActionButton } from '../../components/ActionButton';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { fmt, ru } from '../../i18n/ru';
import { SetPasswordDialog } from '../users/member-dialogs';

const t = ru.system.users;

/** Disable (every session ends) or enable a user everywhere. */
function DisableButton({ user }: { user: SystemUser }) {
  const run = useAction(() => api.systemUsers.update(user.id, { disabled: !user.disabled }), {
    invalidate: 'reference',
    success: (u) => fmt(u.disabled ? t.disabledDone : t.enabledDone, { login: u.login }),
  });
  return (
    <ActionButton
      name={user.disabled ? 'enable-user' : 'disable-user'}
      op="PATCH /system/users/:id"
      variant={user.disabled ? 'secondary' : 'danger'}
      compact
      isPending={run.isPending}
      onPress={() => run.mutate(undefined)}
    >
      {user.disabled ? t.enable : t.disable}
    </ActionButton>
  );
}

const membershipsText = (u: SystemUser) =>
  u.memberships.length === 0
    ? '—'
    : u.memberships
        .map((m) => `${m.orgName}: ${ru.users.roles[m.role]}${m.active ? '' : ` (${t.suspended})`}`)
        .join('; ');

/**
 * P27 «Пользователи» `/system/users` (D-171, the system administrator only): every user with the memberships, disable
 * or enable everywhere (`action-disable-user` / `action-enable-user`, the sessions end), set a password
 * (`action-reset-password`). Users are created inside an organization (P25); no money.
 */
export function SystemUsersPage() {
  const query = useQuery(userQueries.system());
  const [password, setPassword] = useState<SystemUser | null>(null);
  const columns = useMemo<ColDef<SystemUser>[]>(
    () => [
      { colId: 'login', headerName: t.cols.login, minWidth: 180, valueGetter: (p) => p.data?.login },
      { colId: 'kind', headerName: t.cols.kind, maxWidth: 200, valueGetter: (p) => (p.data?.isSystemAdmin ? t.systemAdmin : t.member) },
      { colId: 'memberships', headerName: t.cols.memberships, minWidth: 300, flex: 1, valueGetter: (p) => (p.data ? membershipsText(p.data) : '') },
      { colId: 'disabled', headerName: t.cols.disabled, maxWidth: 130, valueGetter: (p) => (p.data?.disabled ? ru.common.yes : ru.common.no) },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        minWidth: 260,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: SystemUser }) =>
          p.data ? (
            <div className="flex gap-1">
              <DisableButton user={p.data} />
              <ActionButton name="reset-password" op="POST /system/users/:id/password" variant="secondary" compact onPress={() => p.data && setPassword(p.data)}>
                {ru.users.resetPassword}
              </ActionButton>
            </div>
          ) : null,
      },
    ],
    [],
  );
  return (
    <div data-testid="system-users-page">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
        {(rows) => (
          <div data-testid="system-users-grid">
            <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `system-user-${r.login}`} gridStateKey="grid" autoHeight />
          </div>
        )}
      </QueryView>
      {password ? (
        <SetPasswordDialog
          op="POST /system/users/:id/password"
          login={password.login}
          set={(pw) => api.systemUsers.setPassword(password.id, { password: pw })}
          onClose={() => setPassword(null)}
        />
      ) : null}
    </div>
  );
}
