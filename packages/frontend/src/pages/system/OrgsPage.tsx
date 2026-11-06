import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import { Link } from 'react-router-dom';
import type { OrgSummary } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { orgQueries } from '../../api/queries/orgs';
import { ActionButton } from '../../components/ActionButton';
import { FormDialog } from '../../components/FormDialog';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { TextField } from '../../components/fields/TextField';
import { formatDateTime } from '../../lib/datetime';
import { fmt, ru } from '../../i18n/ru';

const t = ru.system.orgs;
const COUNTS = ['labels', 'files', 'statements', 'owners', 'users'] as const;

function CreateOrgDialog(props: { onClose: () => void }) {
  const [name, setName] = useState('');
  const run = useAction(() => api.orgs.create({ name: name.trim() }), {
    invalidate: 'reference',
    success: (o) => fmt(t.created, { name: o.name }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.create}
      subtitle={t.createSubtitle}
      footer={
        <ActionButton
          name="create-org-submit"
          isPending={run.isPending}
          isDisabled={name.trim() === ''}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {ru.common.create}
        </ActionButton>
      }
    >
      <TextField name="org-name" label={t.name} value={name} onChange={setName} isRequired />
    </FormDialog>
  );
}

/** P24 «Организации» `/system/orgs` (D-170): the organizations with their counts, for the system administrator; no money. */
export function OrgsPage() {
  const query = useQuery(orgQueries.list());
  const [creating, setCreating] = useState(false);
  const columns = useMemo<ColDef<OrgSummary>[]>(
    () => [
      {
        colId: 'name',
        headerName: t.cols.name,
        minWidth: 220,
        valueGetter: (p) => p.data?.name,
        cellRenderer: (p: { data?: OrgSummary }) =>
          p.data ? (
            <Link to={`/system/orgs/${encodeURIComponent(p.data.id)}`} className="text-accent hover:underline" data-testid={`org-link-${p.data.id}`}>
              {p.data.name}
            </Link>
          ) : null,
      },
      ...COUNTS.map(
        (c): ColDef<OrgSummary> => ({
          colId: c,
          headerName: t.cols[c],
          maxWidth: 150,
          valueGetter: (p) => p.data?.counts[c],
          cellRenderer: (p: { data?: OrgSummary }) => (p.data ? <span data-col={c}>{p.data.counts[c]}</span> : null),
        }),
      ),
      { colId: 'createdAt', headerName: t.cols.createdAt, valueGetter: (p) => (p.data ? formatDateTime(p.data.createdAt) : '') },
    ],
    [],
  );
  return (
    <div data-testid="orgs-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="create-org" onPress={() => setCreating(true)}>
            {t.create}
          </ActionButton>
        }
      />
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
        {(rows) => (
          <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `org-${r.id}`} gridStateKey="grid" autoHeight />
        )}
      </QueryView>
      {creating ? <CreateOrgDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
