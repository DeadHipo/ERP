import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { OrgUser } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { orgQueries } from '../../api/queries/orgs';
import { ActionButton } from '../../components/ActionButton';
import { FormDialog } from '../../components/FormDialog';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { TextField } from '../../components/fields/TextField';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { formatDateTime } from '../../lib/datetime';
import { setWorkOrg } from '../../lib/session';
import { fmt, ru } from '../../i18n/ru';

const t = ru.system.org;

function CreateUserDialog(props: { orgId: string; onClose: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const run = useAction(() => api.orgs.createUser(props.orgId, { login: login.trim(), password }), {
    invalidate: 'reference',
    success: (u) => fmt(t.userCreated, { login: u.login }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.createUser}
      subtitle={t.createUserSubtitle}
      footer={
        <ActionButton
          name="create-user-submit"
          isPending={run.isPending}
          isDisabled={login.trim() === '' || password === ''}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {ru.common.create}
        </ActionButton>
      }
    >
      <TextField name="user-login" label={t.login} placeholder={t.loginHint} value={login} onChange={setLogin} autoComplete="off" isRequired />
      <TextField name="user-password" label={t.password} type="password" value={password} onChange={setPassword} autoComplete="new-password" isRequired />
    </FormDialog>
  );
}

/**
 * P25 «Организация» `/system/orgs/:id` (D-170): its counts and users, `action-create-user`, and «Работать в организации»
 * (`sessionStorage` `erp.org`: the client then sends `X-Org`, this tab only). No money.
 */
export function OrgPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const org = useQuery(orgQueries.detail(id));
  const users = useQuery(orgQueries.users(id));
  const [creating, setCreating] = useState(false);
  useBreadcrumbLabel(org.data?.name);
  const columns = useMemo<ColDef<OrgUser>[]>(
    () => [
      { colId: 'login', headerName: t.cols.login, minWidth: 200, valueGetter: (p) => p.data?.login },
      { colId: 'createdAt', headerName: t.cols.createdAt, valueGetter: (p) => (p.data ? formatDateTime(p.data.createdAt) : '') },
      { colId: 'createdBy', headerName: t.cols.createdBy, valueGetter: (p) => p.data?.createdBy },
      { colId: 'disabled', headerName: t.cols.disabled, maxWidth: 130, valueGetter: (p) => (p.data?.disabled ? ru.common.yes : ru.common.no) },
    ],
    [],
  );
  const work = () => {
    // the data of another organization must not stay in the cache under the same keys
    setWorkOrg(id);
    queryClient.clear();
    void navigate('/');
  };
  return (
    <div data-testid="org-page" data-org-id={id}>
      <QueryView query={org}>
        {(o) => (
          <>
            <PageHeader
              title={o.name}
              subtitle={t.subtitle}
              toolbar={
                <>
                  <ActionButton name="work-in-org" write={false} variant="secondary" onPress={work}>
                    {t.work}
                  </ActionButton>
                  <ActionButton name="create-user" onPress={() => setCreating(true)}>
                    {t.createUser}
                  </ActionButton>
                </>
              }
            />
            <p className="mb-4 text-sm text-muted" data-testid="org-counts" title={t.workHint}>
              {fmt(t.counts, o.counts)}
            </p>
          </>
        )}
      </QueryView>
      <h2 className="mb-2 text-lg font-semibold">{t.users}</h2>
      <QueryView query={users} isEmpty={(d) => d.length === 0} emptyMessage={t.usersEmpty}>
        {(rows) => (
          <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `org-user-${r.login}`} gridStateKey="users" autoHeight />
        )}
      </QueryView>
      {creating ? <CreateUserDialog orgId={id} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
