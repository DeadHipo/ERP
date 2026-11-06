import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { Member } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { authKeys } from '../../api/queries/auth';
import { orgQueries } from '../../api/queries/orgs';
import { ActionButton } from '../../components/ActionButton';
import { PageHeader } from '../../components/PageHeader';
import { notifyError } from '../../components/toast';
import { QueryView } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { formatDateTime } from '../../lib/datetime';
import { setWorkOrg } from '../../lib/session';
import { errorText } from '../../i18n/ru/errors';
import { fmt, ru } from '../../i18n/ru';
import { CreateMemberDialog, EditMemberDialog, labelNames } from '../users/member-dialogs';

const t = ru.system.org;

type Dialog = { kind: 'create' } | { kind: 'add' } | { kind: 'edit'; member: Member } | null;

/**
 * P25 «Организация» `/system/orgs/:id` (D-170, D-171): its counts and members (role, labels; `action-create-user`,
 * `action-add-member`, `action-edit-member`), and «Работать в организации»: `POST /orgs/:id/support/enter` under a live
 * support grant of its administrator, then `sessionStorage` `erp.org` (the client sends `X-Org`, this tab only); closed
 * with the sentence of `support_required` without a grant (`org-support`). No money.
 */
export function OrgPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const org = useQuery(orgQueries.detail(id));
  const users = useQuery(orgQueries.users(id));
  const labels = useQuery(orgQueries.labels(id));
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  useBreadcrumbLabel(org.data?.name);
  const own = labels.data?.map((l) => ({ id: l.id, name: l.name }));
  // the own labels are a read inside the organization: without a support grant the API refuses it (D-171)
  const labelsUnavailable = labels.error instanceof api.ApiError ? (errorText(labels.error.code) ?? labels.error.message) : undefined;
  const columns = useMemo<ColDef<Member>[]>(
    () => [
      { colId: 'login', headerName: t.cols.login, minWidth: 200, valueGetter: (p) => p.data?.login },
      { colId: 'role', headerName: t.cols.role, minWidth: 200, valueGetter: (p) => (p.data ? t.roles[p.data.role] : '') },
      { colId: 'labels', headerName: t.cols.labels, minWidth: 140, valueGetter: (p) => (p.data ? labelNames(p.data.labelIds, own) : '') },
      { colId: 'active', headerName: t.cols.active, maxWidth: 150, valueGetter: (p) => (p.data?.active ? ru.common.yes : ru.common.no) },
      { colId: 'createdAt', headerName: t.cols.createdAt, valueGetter: (p) => (p.data ? formatDateTime(p.data.createdAt) : '') },
      { colId: 'createdBy', headerName: t.cols.createdBy, valueGetter: (p) => p.data?.createdBy },
      { colId: 'disabled', headerName: t.cols.disabled, maxWidth: 130, valueGetter: (p) => (p.data?.disabled ? ru.common.yes : ru.common.no) },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: Member }) =>
          p.data ? (
            <ActionButton name="edit-member" op="PATCH /orgs/:id/users/:userId" variant="secondary" compact onPress={() => p.data && setDialog({ kind: 'edit', member: p.data })}>
              {t.edit}
            </ActionButton>
          ) : null,
      },
    ],
    [own],
  );
  // no invalidation (useAction would refetch `me` without the organization): the answer is the session in it
  const enter = useMutation<Awaited<ReturnType<typeof api.orgs.enterSupport>>, api.ApiError>({
    mutationFn: () => api.orgs.enterSupport(id),
    onError: notifyError,
    onSuccess: (me) => {
      // the data of another organization must not stay in the cache under the same keys; the session is support there
      // (`clear()` would leave the shell's observer of `me` on the removed query, with the old answer)
      setWorkOrg(id);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== authKeys.me()[0] });
      queryClient.setQueryData(authKeys.me(), me);
      void navigate('/');
    },
  });
  const work = () => enter.mutate();
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
                  <ActionButton
                    name="work-in-org"
                    op="POST /orgs/:id/support/enter"
                    variant="secondary"
                    isPending={enter.isPending}
                    isDisabled={o.support === null}
                    reason={errorText('support_required')}
                    onPress={work}
                  >
                    {t.work}
                  </ActionButton>
                  <ActionButton name="add-member" op="POST /orgs/:id/members" variant="secondary" onPress={() => setDialog({ kind: 'add' })}>
                    {ru.users.addMember}
                  </ActionButton>
                  <ActionButton name="create-user" op="POST /orgs/:id/users" onPress={() => setDialog({ kind: 'create' })}>
                    {t.createUser}
                  </ActionButton>
                </>
              }
            />
            <p className="mb-1 text-sm text-muted" data-testid="org-counts" title={t.workHint}>
              {fmt(t.counts, o.counts)}
            </p>
            <p className="mb-4 text-sm" data-testid="org-support" data-active={o.support !== null}>
              {o.support
                ? fmt(t.support, { until: formatDateTime(o.support.expiresAt), mode: o.support.write ? t.supportWrite : t.supportRead })
                : errorText('support_required')}
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
      {dialog?.kind === 'create' ? (
        <CreateMemberDialog op="POST /orgs/:id/users" labels={own} labelsUnavailable={labelsUnavailable} create={(body) => api.orgs.createUser(id, body)} onClose={close} />
      ) : null}
      {dialog?.kind === 'add' ? (
        <CreateMemberDialog
          op="POST /orgs/:id/members"
          existing
          labels={own}
          labelsUnavailable={labelsUnavailable}
          create={(body) => api.orgs.addMember(id, { login: body.login, role: body.role, labelIds: body.labelIds })}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <EditMemberDialog
          op="PATCH /orgs/:id/users/:userId"
          member={dialog.member}
          labels={own}
          labelsUnavailable={labelsUnavailable}
          update={(body) => api.orgs.updateMember(id, dialog.member.id, body)}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
