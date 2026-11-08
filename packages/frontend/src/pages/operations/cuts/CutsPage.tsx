import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { Cut } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { settlementQueries } from '../../../api/queries/settlements';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { useOwnLabels } from '../../../components/LabelSwitch';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { DateField } from '../../../components/fields/DateField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { useLabel, useWriteLabel } from '../../../lib/label';

const t = ru.cuts;

/**
 * P34 «Срезы» `/operations/cuts` (D-198): the cuts of the book of the switch (`GET /settlements/cuts`; under «Все» every
 * book, the create closed), a link to each cut (P35), its change and its delete (refused while operations are
 * attributed to it: the backend's toast).
 */
export function CutsPage() {
  const { labelId } = useLabel();
  const write = useWriteLabel();
  const own = useOwnLabels();
  const list = useQuery(settlementQueries.cuts(labelId));
  const [editing, setEditing] = useState<Cut | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Cut | null>(null);
  const nameOf = (id: string) => own.find((l) => l.id === id)?.name ?? id;
  const columns = useMemo<ColDef<Cut>[]>(
    () => [
      {
        colId: 'name',
        headerName: t.cols.name,
        valueGetter: (p) => p.data?.name,
        cellRenderer: (p: { data?: Cut }) =>
          p.data ? (
            <Link to={`/operations/cuts/${encodeURIComponent(p.data.id)}`} className="text-accent underline" data-testid={`cut-link-${p.data.id}`}>
              {p.data.name}
            </Link>
          ) : null,
      },
      { colId: 'cutDate', headerName: t.cols.cutDate, valueGetter: (p) => p.data?.cutDate },
      { colId: 'masterTo', headerName: t.cols.masterTo, valueGetter: (p) => p.data?.masterTo },
      { colId: 'publishingTo', headerName: t.cols.publishingTo, valueGetter: (p) => p.data?.publishingTo },
      { colId: 'adsTo', headerName: t.cols.adsTo, valueGetter: (p) => p.data?.adsTo },
      { colId: 'label', headerName: t.cols.label, valueGetter: (p) => (p.data ? nameOf(p.data.labelId) : '') },
      { colId: 'comment', headerName: t.cols.comment, valueGetter: (p) => p.data?.comment },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        minWidth: 220,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: Cut }) =>
          p.data ? (
            <div className="flex gap-1">
              <ActionButton name={`cut-edit-${p.data.id}`} op="PATCH /settlements/cuts/:id" compact variant="secondary" onPress={() => setEditing(p.data ?? null)}>
                {t.edit}
              </ActionButton>
              <ActionButton name={`cut-delete-${p.data.id}`} op="POST /settlements/cuts/:id/delete" compact variant="secondary" onPress={() => setDeleting(p.data ?? null)}>
                {t.remove}
              </ActionButton>
            </div>
          ) : null,
      },
    ],
    [own],
  );
  const remove = useAction((c: Cut) => api.settlements.deleteCut(c.id), { invalidate: 'all', success: (c) => fmt(t.deleted, { name: c.name }) });
  return (
    <div data-testid="cuts-page" data-label-id={labelId}>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="create-cut" op="POST /settlements/cuts" isDisabled={write.closed} reason={write.reason} onPress={() => setEditing('new')}>
            {t.create}
          </ActionButton>
        }
      />
      <p className="mb-3 text-sm" data-testid="cuts-label">
        {labelId ? fmt(t.labelLine, { name: nameOf(labelId) }) : t.allLabels}
      </p>
      <QueryView query={list}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="text-sm text-muted" data-testid="cuts-none">
              {t.none}
            </p>
          ) : (
            <DataGrid rowData={data.items} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `cut-${r.id}`} autoHeight />
          )
        }
      </QueryView>
      {editing ? <CutDialog cut={editing === 'new' ? null : editing} labelId={write.labelId} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(o) => (o ? null : setDeleting(null))}
        title={t.deleteTitle}
        lines={deleting ? [fmt(t.deleteText, { name: deleting.name })] : []}
        isPending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting, { onSettled: () => setDeleting(null) })}
      />
    </div>
  );
}

/** The create (under the label of the switch) or the change of a cut: only what changed is sent. */
function CutDialog(props: { cut: Cut | null; labelId: string; onClose: () => void }) {
  const c = props.cut;
  const [name, setName] = useState(c?.name ?? '');
  const [cutDate, setCutDate] = useState(c?.cutDate ?? '');
  const [masterTo, setMasterTo] = useState(c?.masterTo ?? '');
  const [publishingTo, setPublishingTo] = useState(c?.publishingTo ?? '');
  const [adsTo, setAdsTo] = useState(c?.adsTo ?? '');
  const [comment, setComment] = useState(c?.comment ?? '');
  // the change sends only what changed (the backend refuses an empty one)
  const changed = (v: string, was: string) => v.trim() !== '' && v.trim() !== was;
  const patch = c
    ? {
        ...(changed(name, c.name) ? { name: name.trim() } : {}),
        ...(changed(cutDate, c.cutDate) ? { cutDate } : {}),
        ...(changed(masterTo, c.masterTo) ? { masterTo: masterTo.trim() } : {}),
        ...(changed(publishingTo, c.publishingTo) ? { publishingTo: publishingTo.trim() } : {}),
        ...(changed(adsTo, c.adsTo) ? { adsTo: adsTo.trim() } : {}),
        ...(comment.trim() !== c.comment ? { comment: comment.trim() } : {}),
      }
    : {};
  const run = useAction(
    () => {
      if (!c)
        return api.settlements.createCut({
          labelId: props.labelId,
          name: name.trim(),
          cutDate,
          ...(masterTo.trim() ? { masterTo: masterTo.trim() } : {}),
          ...(publishingTo.trim() ? { publishingTo: publishingTo.trim() } : {}),
          ...(adsTo.trim() ? { adsTo: adsTo.trim() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        });
      return api.settlements.updateCut(c.id, patch);
    },
    { invalidate: 'all', success: (r) => fmt(c ? t.dialog.saved : t.dialog.created, { name: r.name }) },
  );
  const filled = name.trim() !== '' && cutDate !== '' && (!c || Object.keys(patch).length > 0);
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={c ? t.dialog.editTitle : t.dialog.createTitle}
      subtitle={c ? t.dialog.editSubtitle : t.dialog.subtitle}
      footer={
        <ActionButton
          name="cut-submit"
          op={c ? 'PATCH /settlements/cuts/:id' : 'POST /settlements/cuts'}
          isDisabled={!filled}
          reason={c && name.trim() !== '' && cutDate !== '' ? t.dialog.nothingChanged : ru.actions.hints.fillFields}
          isPending={run.isPending}
          onPress={() => run.mutate(undefined, { onSuccess: () => props.onClose() })}
        >
          {t.dialog.submit}
        </ActionButton>
      }
    >
      <TextField name="cut-name" label={t.dialog.name} value={name} onChange={setName} isRequired />
      <DateField name="cut-date" label={t.dialog.cutDate} value={cutDate} onChange={setCutDate} isRequired />
      <DateField name="cut-master-to" label={t.dialog.masterTo} value={masterTo} onChange={setMasterTo} />
      <DateField name="cut-publishing-to" label={t.dialog.publishingTo} value={publishingTo} onChange={setPublishingTo} />
      <DateField name="cut-ads-to" label={t.dialog.adsTo} value={adsTo} onChange={setAdsTo} />
      <TextField name="cut-comment" label={t.dialog.comment} value={comment} onChange={setComment} />
    </FormDialog>
  );
}
