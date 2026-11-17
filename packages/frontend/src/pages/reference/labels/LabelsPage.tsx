import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { LabelListItem } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { labelQueries } from '../../../api/queries/labels';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { FormDialog } from '../../../components/FormDialog';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.reference.labels;

/** An own label (D-232: the only kind; a sublabel is P36 «Саблейблы»). */
function CreateLabelDialog(props: { onClose: () => void }) {
  const [name, setName] = useState('');
  const run = useAction(() => api.labels.create({ name: name.trim() }), {
    invalidate: 'all',
    success: (l) => fmt(t.created, { name: l.name }),
  });
  const ready = name.trim() !== '';
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.create}
      subtitle={t.createSubtitle}
      footer={
        <ActionButton name="create-label-submit" op="POST /labels" isPending={run.isPending} isDisabled={!ready} reason={ru.actions.hints.fillFields} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {ru.common.create}
        </ActionButton>
      }
    >
      <TextField name="label-name" label={t.name} value={name} onChange={setName} isRequired />
    </FormDialog>
  );
}

/** P17 «Лейблы» `/labels`: `GET /labels` (a reference list without money). */
export function LabelsPage() {
  const query = useQuery(labelQueries.list());
  const [creating, setCreating] = useState(false);
  const columns = useMemo<ColDef<LabelListItem>[]>(
    () => [
      { colId: 'name', headerName: t.cols.name, minWidth: 200, valueGetter: (p) => p.data?.name, cellRenderer: (p: { data?: LabelListItem }) => (p.data ? <EntityLink kind="label" id={p.data.id} label={p.data.name} /> : null) },
      { colId: 'aliases', headerName: t.cols.aliases, maxWidth: 130, valueGetter: (p) => p.data?.aliases.length },
      { colId: 'accounts', headerName: t.accounts, maxWidth: 160, valueGetter: (p) => p.data?.accounts.length },
    ],
    [],
  );
  return (
    <div data-testid="labels-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="create-label" op="POST /labels" onPress={() => setCreating(true)}>
            {t.create}
          </ActionButton>
        }
      />
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
        {(rows) => <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `label-${r.id}`} gridStateKey="grid" />}
      </QueryView>
      {creating ? <CreateLabelDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
