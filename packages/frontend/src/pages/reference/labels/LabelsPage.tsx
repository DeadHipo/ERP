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
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.reference.labels;

function CreateLabelDialog(props: { labels: readonly LabelListItem[]; onClose: () => void }) {
  const own = props.labels.filter((l) => l.kind === 'own');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'own' | 'sublabel'>('sublabel');
  const [ownId, setOwnId] = useState<string | null>(null);
  const run = useAction(() => api.labels.create({ name: name.trim(), kind, ownLabelId: kind === 'sublabel' ? ownId : null }), {
    invalidate: 'all',
    success: (l) => fmt(t.created, { name: l.name }),
  });
  const ready = name.trim() !== '' && (kind === 'own' || ownId !== null);
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.create}
      subtitle={t.createSubtitle}
      footer={
        <ActionButton name="create-label-submit" isPending={run.isPending} isDisabled={!ready} reason={ru.actions.hints.fillFields} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {ru.common.create}
        </ActionButton>
      }
    >
      <TextField name="label-name" label={t.name} value={name} onChange={setName} isRequired />
      <SelectField name="label-kind" label={t.kindField} value={kind} onChange={(v) => setKind(v === 'own' ? 'own' : 'sublabel')} options={[{ id: 'sublabel', label: t.kind.sublabel }, { id: 'own', label: t.kind.own }]} />
      {kind === 'sublabel' ? <SelectField name="label-own" label={t.ownLabel} value={ownId} onChange={setOwnId} options={own.map((l) => ({ id: l.id, label: l.name }))} /> : null}
    </FormDialog>
  );
}

/** P17 «Лейблы» `/labels`: `GET /labels` (a reference list without money). */
export function LabelsPage() {
  const query = useQuery(labelQueries.list());
  const [creating, setCreating] = useState(false);
  const columns = useMemo<ColDef<LabelListItem>[]>(() => {
    const byId = new Map((query.data ?? []).map((l) => [l.id, l.name]));
    return [
      { colId: 'name', headerName: t.cols.name, minWidth: 200, valueGetter: (p) => p.data?.name, cellRenderer: (p: { data?: LabelListItem }) => (p.data ? <EntityLink kind="label" id={p.data.id} label={p.data.name} /> : null) },
      { colId: 'kind', headerName: t.cols.kind, valueGetter: (p) => (p.data ? t.kind[p.data.kind] : '') },
      { colId: 'own', headerName: t.cols.own, valueGetter: (p) => (p.data?.ownLabelId ? (byId.get(p.data.ownLabelId) ?? '') : '') },
      { colId: 'aliases', headerName: t.cols.aliases, maxWidth: 130, valueGetter: (p) => p.data?.aliases.length },
      { colId: 'rules', headerName: t.cols.rules, maxWidth: 130, valueGetter: (p) => p.data?.rules.length },
    ];
  }, [query.data]);
  return (
    <div data-testid="labels-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="create-label" onPress={() => setCreating(true)}>
            {t.create}
          </ActionButton>
        }
      />
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
        {(rows) => <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `label-${r.id}`} gridStateKey="grid" />}
      </QueryView>
      {creating ? <CreateLabelDialog labels={query.data ?? []} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
