import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { Member, SupportGrant } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { labelQueries } from '../../api/queries/labels';
import { userQueries } from '../../api/queries/users';
import { ActionButton } from '../../components/ActionButton';
import { CardTabs } from '../../components/EntityCard';
import { FormDialog } from '../../components/FormDialog';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { TextField } from '../../components/fields/TextField';
import { formatDateTime } from '../../lib/datetime';
import { fmt, ru } from '../../i18n/ru';
import { CreateMemberDialog, EditMemberDialog, SetPasswordDialog, labelNames } from './member-dialogs';

const t = ru.users;
const s = t.support;

type Dialog = { kind: 'create' } | { kind: 'edit'; member: Member } | { kind: 'password'; member: Member } | { kind: 'grant' } | null;

/** The own labels of the organization of the session: the labels a manager may get. */
function useOwn() {
  const labels = useQuery(labelQueries.list());
  return labels.data?.filter((l) => l.kind === 'own').map((l) => ({ id: l.id, name: l.name }));
}

/** `YYYY-MM-DDTHH:mm` of a `datetime-local` input → an ISO timestamp with its offset (the browser's zone). */
function isoOfLocal(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return date.toString() === 'Invalid Date' ? undefined : date.toISOString();
}

/** «Выдать доступ поддержки» (`POST /support`): a system administrator's login, until when, writes or not. */
function GrantSupportDialog(props: { onClose: () => void }) {
  const [login, setLogin] = useState('');
  const [expires, setExpires] = useState('');
  const [write, setWrite] = useState(false);
  const run = useAction(() => api.support.grant({ login: login.trim(), expiresAt: isoOfLocal(expires), write }), {
    invalidate: 'reference',
    success: (g) => fmt(s.granted, { login: g.login }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={s.grant}
      subtitle={s.grantSubtitle}
      footer={
        <ActionButton
          name="grant-support-submit"
          op="POST /support"
          isPending={run.isPending}
          isDisabled={login.trim() === ''}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {s.grant}
        </ActionButton>
      }
    >
      <TextField name="support-login" label={s.login} value={login} onChange={setLogin} autoComplete="off" isRequired />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{s.expires}</span>
        <input
          type="datetime-local"
          data-testid="field-support-expires"
          className="rounded-lg border border-border bg-field px-3 py-1.5"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
        />
        <span className="text-xs text-muted">{s.expiresHint}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="field-support-write" checked={write} onChange={(e) => setWrite(e.target.checked)} />
        {s.write}
      </label>
    </FormDialog>
  );
}

function RevokeButton({ grant }: { grant: SupportGrant }) {
  const run = useAction(() => api.support.revoke(grant.id), { invalidate: 'reference', success: () => s.revoked });
  return (
    <ActionButton name="revoke-support" op="POST /support/:id/revoke" variant="danger" compact isPending={run.isPending} onPress={() => run.mutate(undefined)}>
      {s.revoke}
    </ActionButton>
  );
}

const stateOf = (g: SupportGrant): keyof typeof s.states => (g.active ? 'active' : g.revokedAt ? 'revoked' : 'expired');

function SupportTab({ onGrant }: { onGrant: () => void }) {
  const grants = useQuery(userQueries.support());
  const columns = useMemo<ColDef<SupportGrant>[]>(
    () => [
      { colId: 'login', headerName: s.cols.login, minWidth: 180, valueGetter: (p) => p.data?.login },
      { colId: 'write', headerName: s.cols.write, maxWidth: 110, valueGetter: (p) => (p.data?.write ? ru.common.yes : ru.common.no) },
      { colId: 'expiresAt', headerName: s.cols.expiresAt, valueGetter: (p) => (p.data ? formatDateTime(p.data.expiresAt) : '') },
      {
        colId: 'state',
        headerName: s.cols.state,
        maxWidth: 140,
        valueGetter: (p) => (p.data ? s.states[stateOf(p.data)] : ''),
        cellRenderer: (p: { data?: SupportGrant }) => (p.data ? <span data-state={stateOf(p.data)}>{s.states[stateOf(p.data)]}</span> : null),
      },
      { colId: 'grantedBy', headerName: s.cols.grantedBy, valueGetter: (p) => p.data?.grantedBy },
      { colId: 'grantedAt', headerName: s.cols.grantedAt, valueGetter: (p) => (p.data ? formatDateTime(p.data.grantedAt) : '') },
      {
        colId: 'actions',
        headerName: s.cols.actions,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: SupportGrant }) => (p.data?.active ? <RevokeButton grant={p.data} /> : null),
      },
    ],
    [],
  );
  return (
    <div data-testid="support-tab">
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-sm text-muted">{s.subtitle}</p>
        <ActionButton name="grant-support" op="POST /support" onPress={onGrant}>
          {s.grant}
        </ActionButton>
      </div>
      <QueryView query={grants} isEmpty={(d) => d.length === 0} emptyMessage={s.empty}>
        {(rows) => (
          <div data-testid="support-grid">
            <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `support-${r.id}`} gridStateKey="support" autoHeight />
          </div>
        )}
      </QueryView>
    </div>
  );
}

function MembersTab(props: { labels: { id: string; name: string }[] | undefined; open: (d: Dialog) => void }) {
  const members = useQuery(userQueries.list());
  const { labels, open } = props;
  const columns = useMemo<ColDef<Member>[]>(
    () => [
      { colId: 'login', headerName: t.cols.login, minWidth: 180, valueGetter: (p) => p.data?.login },
      { colId: 'role', headerName: t.cols.role, minWidth: 200, valueGetter: (p) => (p.data ? t.roles[p.data.role] : '') },
      { colId: 'labels', headerName: t.cols.labels, minWidth: 160, valueGetter: (p) => (p.data ? labelNames(p.data.labelIds, labels) : '') },
      { colId: 'active', headerName: t.cols.active, maxWidth: 120, valueGetter: (p) => (p.data?.active ? ru.common.yes : ru.common.no) },
      { colId: 'disabled', headerName: t.cols.disabled, maxWidth: 140, valueGetter: (p) => (p.data?.disabled ? ru.common.yes : ru.common.no) },
      { colId: 'createdAt', headerName: t.cols.createdAt, valueGetter: (p) => (p.data ? formatDateTime(p.data.createdAt) : '') },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        minWidth: 260,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: Member }) =>
          p.data ? (
            <div className="flex gap-1">
              <ActionButton name="edit-user" op="PATCH /users/:id" variant="secondary" compact onPress={() => p.data && open({ kind: 'edit', member: p.data })}>
                {t.edit}
              </ActionButton>
              <ActionButton name="reset-password" op="POST /users/:id/password" variant="secondary" compact onPress={() => p.data && open({ kind: 'password', member: p.data })}>
                {t.resetPassword}
              </ActionButton>
            </div>
          ) : null,
      },
    ],
    [labels, open],
  );
  return (
    <QueryView query={members} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
      {(rows) => (
        <div data-testid="users-grid">
          <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `user-${r.login}`} gridStateKey="users" autoHeight />
        </div>
      )}
    </QueryView>
  );
}

/**
 * P26 «Пользователи» `/users` (D-171, the organization's administrator only): who works in the organization, with
 * which role and labels (`action-create-user`, `action-edit-user`, `action-reset-password`), and the tab «Поддержка»
 * (`?tab=support`): the support grants of system administrators (`action-grant-support`, `action-revoke-support`).
 * No money.
 */
export function UsersPage() {
  const labels = useOwn();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  return (
    <div data-testid="users-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="create-user" op="POST /users" onPress={() => setDialog({ kind: 'create' })}>
            {t.create}
          </ActionButton>
        }
      />
      <CardTabs
        tabs={[
          { id: 'members', label: t.tabs.members, content: <MembersTab labels={labels} open={setDialog} /> },
          { id: 'support', label: t.tabs.support, content: <SupportTab onGrant={() => setDialog({ kind: 'grant' })} /> },
        ]}
      />
      {dialog?.kind === 'create' ? <CreateMemberDialog op="POST /users" labels={labels} create={api.users.create} onClose={close} /> : null}
      {dialog?.kind === 'edit' ? (
        <EditMemberDialog
          op="PATCH /users/:id"
          member={dialog.member}
          labels={labels}
          update={(body) => api.users.update(dialog.member.id, body)}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'password' ? (
        <SetPasswordDialog
          op="POST /users/:id/password"
          login={dialog.member.login}
          set={(password) => api.users.setPassword(dialog.member.id, { password })}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'grant' ? <GrantSupportDialog onClose={close} /> : null}
    </div>
  );
}
