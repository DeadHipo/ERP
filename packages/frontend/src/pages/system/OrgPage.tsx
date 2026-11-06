import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { Member } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { orgQueries } from '../../api/queries/orgs';
import { ActionButton } from '../../components/ActionButton';
import { FormDialog } from '../../components/FormDialog';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { formatDateTime } from '../../lib/datetime';
import { setWorkOrg } from '../../lib/session';
import { fmt, ru } from '../../i18n/ru';

const t = ru.system.org;

type MemberRole = Member['role'];

/**
 * A new user of the organization with a role (D-171): an `org_admin` sees every own label; a `label_manager` gets one own
 * label of this organization here (several, and the change of a member, come with P26).
 */
function CreateUserDialog(props: { orgId: string; onClose: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<MemberRole>('org_admin');
  const [labelId, setLabelId] = useState<string | null>(null);
  const labels = useQuery({ ...orgQueries.labels(props.orgId), enabled: role === 'label_manager' });
  const manager = role === 'label_manager';
  const run = useAction(
    () =>
      api.orgs.createUser(props.orgId, {
        login: login.trim(),
        password,
        role,
        labelIds: manager && labelId ? [labelId] : [],
      }),
    {
      invalidate: 'reference',
      success: (u) => fmt(t.userCreated, { login: u.login }),
    },
  );
  const roleOptions = (['org_admin', 'label_manager'] as const).map((r) => ({ id: r, label: t.roles[r] }));
  const labelOptions = (labels.data ?? []).map((l) => ({ id: l.id, label: l.name }));
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
          isDisabled={login.trim() === '' || password === '' || (manager && !labelId)}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {ru.common.create}
        </ActionButton>
      }
    >
      <TextField name="user-login" label={t.login} placeholder={t.loginHint} value={login} onChange={setLogin} autoComplete="off" isRequired />
      <TextField name="user-password" label={t.password} type="password" value={password} onChange={setPassword} autoComplete="new-password" isRequired />
      <SelectField name="user-role" label={t.role} value={role} onChange={(v) => setRole(v as MemberRole)} options={roleOptions} isRequired />
      {manager ? (
        labels.data && labelOptions.length === 0 ? (
          <p className="text-sm text-warning" data-testid="user-no-labels">
            {t.noLabels}
          </p>
        ) : (
          <SelectField name="user-label" label={t.label} placeholder={t.labelHint} value={labelId} onChange={setLabelId} options={labelOptions} isRequired />
        )
      ) : null}
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
  const columns = useMemo<ColDef<Member>[]>(
    () => [
      { colId: 'login', headerName: t.cols.login, minWidth: 200, valueGetter: (p) => p.data?.login },
      { colId: 'role', headerName: t.cols.role, minWidth: 200, valueGetter: (p) => (p.data ? t.roles[p.data.role] : '') },
      { colId: 'labels', headerName: t.cols.labels, maxWidth: 120, valueGetter: (p) => (p.data?.role === 'label_manager' ? p.data.labelIds.length : '') },
      { colId: 'active', headerName: t.cols.active, maxWidth: 150, valueGetter: (p) => (p.data?.active ? ru.common.yes : ru.common.no) },
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
