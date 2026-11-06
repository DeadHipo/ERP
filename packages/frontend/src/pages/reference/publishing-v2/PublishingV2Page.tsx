import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { pubV2FileSchema, pubV2SongwriterSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { publishingV2Queries } from '../../../api/queries/publishing';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { UploadForm } from '../../../components/fields/UploadForm';
import { fmt, ru } from '../../../i18n/ru';
import { useLabel, useWriteLabel } from '../../../lib/label';
import { compareDecimal, formatCount } from '../../../lib/money';

const t = ru.reference.publishingV2;
type Songwriter = z.output<typeof pubV2SongwriterSchema>;
type PubFile = z.output<typeof pubV2FileSchema>;

function Upload() {
  const { labelId, closed } = useWriteLabel();
  const [waiting, setWaiting] = useState<File | null>(null);
  const run = useAction((v: { file: File; replace: boolean }) => api.publishingV2.upload(v.file, labelId, v.replace), {
    invalidate: 'all',
    success: (r) => fmt(t.uploaded, { name: r.fileName }),
    handled: (error, v) => {
      if (error.code !== 'period_loaded') return false;
      setWaiting(v.file);
      return true;
    },
  });
  return (
    <>
      <UploadForm
        testId="upload-publishing-v2"
        field="upload-publishing-v2"
        action="upload-publishing-v2"
        op="POST /publishing-v2/files"
        label={t.upload}
        accept=".xlsx"
        isPending={run.isPending}
        closed={closed}
        onSubmit={(file, reset) => run.mutate({ file, replace: false }, { onSettled: reset })}
      />
      <ConfirmDialog
        isOpen={waiting !== null}
        onOpenChange={(open) => (open ? null : setWaiting(null))}
        title={t.replaceTitle}
        lines={[fmt(t.replaceLine, { name: waiting?.name ?? '' })]}
        confirmLabel={t.replaceConfirm}
        isPending={run.isPending}
        onConfirm={() => {
          if (waiting) run.mutate({ file: waiting, replace: true }, { onSettled: () => setWaiting(null) });
        }}
      />
    </>
  );
}

function RemoveDialog(props: { file: PubFile; onClose: () => void }) {
  const run = useAction(() => api.publishingV2.remove(props.file.id), { invalidate: 'all', success: () => t.removed });
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(open) => (open ? null : props.onClose())}
      title={t.removeTitle}
      lines={[fmt(t.removeLine, { name: props.file.fileName })]}
      confirmLabel={t.remove}
      isPending={run.isPending}
      onConfirm={() => run.mutate(undefined, { onSettled: props.onClose })}
    />
  );
}

/** P32 (D-182): the songwriters and the files of the report summaries; no owner link, no effect on money. */
export function PublishingV2Page() {
  const { labelId } = useLabel();
  const songwriters = useQuery(publishingV2Queries.songwriters(labelId));
  const files = useQuery(publishingV2Queries.files(labelId));
  const [removing, setRemoving] = useState<PubFile | null>(null);
  const writerColumns = useMemo<ColDef<Songwriter>[]>(
    () => [
      {
        colId: 'name',
        headerName: t.cols.name,
        minWidth: 280,
        valueGetter: (p) => p.data?.name,
        cellRenderer: (p: { data?: Songwriter }) => (p.data ? <Link className="text-accent hover:underline" to={`/publishing-v2/${p.data.id}`}>{p.data.name}</Link> : null),
      },
      { colId: 'songs', headerName: t.cols.songs, valueGetter: (p) => (p.data ? formatCount(p.data.songs) : '') },
      { colId: 'aliases', headerName: t.cols.aliases, valueGetter: (p) => (p.data ? formatCount(p.data.aliases.length) : '') },
      { colId: 'periods', headerName: t.cols.periods, minWidth: 240, valueGetter: (p) => p.data?.periods.join(', ') },
      {
        colId: 'payable',
        headerName: t.cols.payable,
        valueGetter: (p) => p.data?.payable,
        comparator: compareDecimal,
        cellRenderer: (p: { data?: Songwriter }) => (p.data ? <Money value={p.data.payable} /> : null),
      },
    ],
    [],
  );
  const fileColumns = useMemo<ColDef<PubFile>[]>(
    () => [
      { colId: 'file', headerName: t.cols.file, minWidth: 300, valueGetter: (p) => p.data?.fileName },
      { colId: 'periods', headerName: t.cols.periods, valueGetter: (p) => p.data?.periods.join(', ') },
      { colId: 'format', headerName: t.cols.format, valueGetter: (p) => p.data?.format },
      { colId: 'status', headerName: t.cols.status, valueGetter: (p) => (p.data ? t.status[p.data.status] : '') },
      { colId: 'rows', headerName: t.cols.rows, valueGetter: (p) => (p.data ? formatCount(p.data.rowCount) : '') },
      { colId: 'payable', headerName: t.cols.payable, cellRenderer: (p: { data?: PubFile }) => (p.data ? <Money value={p.data.payable} /> : null) },
      { colId: 'declared', headerName: t.cols.declared, cellRenderer: (p: { data?: PubFile }) => (p.data ? <Money value={p.data.declaredPayable} /> : null) },
      { colId: 'difference', headerName: t.cols.difference, cellRenderer: (p: { data?: PubFile }) => (p.data ? <Money value={p.data.difference} /> : null) },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: PubFile }) =>
          p.data ? (
            <ActionButton name="remove-file" op="POST /publishing-v2/files/:id/remove" variant="secondary" onPress={() => p.data && setRemoving(p.data)}>
              {t.remove}
            </ActionButton>
          ) : null,
      },
    ],
    [],
  );
  return (
    <div data-testid="publishing-v2-page">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <div className="flex flex-col gap-6">
        <section>
          <h2 className="mb-2 text-sm font-medium">{t.songwriters}</h2>
          <QueryView query={songwriters} isEmpty={(d) => d.length === 0} emptyMessage={t.noSongwriters}>
            {(rows) => <DataGrid rowData={rows} columnDefs={writerColumns} getRowId={(w) => w.id} rowTestId={(w) => `songwriter-${w.id}`} />}
          </QueryView>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t.files}</h2>
          <Upload />
          <QueryView query={files} isEmpty={(d) => d.length === 0} emptyMessage={t.noFiles}>
            {(rows) => <DataGrid rowData={rows} columnDefs={fileColumns} getRowId={(f) => f.id} rowTestId={(f) => `pub-file-${f.id}`} />}
          </QueryView>
        </section>
      </div>
      {removing ? <RemoveDialog file={removing} onClose={() => setRemoving(null)} /> : null}
    </div>
  );
}
