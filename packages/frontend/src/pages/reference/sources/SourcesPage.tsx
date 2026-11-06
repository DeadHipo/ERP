import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { sourceFileSchema, statementSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { sourceQueries } from '../../../api/queries/sources';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { StatusChip } from '../../../components/StatusChip';
import { DataGrid } from '../../../components/grid/DataGrid';
import { TextField } from '../../../components/fields/TextField';
import { UploadForm } from '../../../components/fields/UploadForm';
import { compareDecimal, formatCount } from '../../../lib/money';
import { useOwnLabels } from '../../../components/LabelSwitch';
import { detailParams } from '../../../components/toast';
import { fmt, ru } from '../../../i18n/ru';
import { useWriteLabel } from '../../../lib/label';
import { useUrlParam } from '../../catalog/components/url';
import { AddAccountDialog } from '../labels/AccountDialogs';

const t = ru.reference.sources;
type BelieveFile = z.output<typeof sourceFileSchema>;
type Statement = z.output<typeof statementSchema>;

/**
 * The upload of a Believe report or a B17 statement on the shared `UploadForm`: `POST` through the client (multipart,
 * `X-Operator`) under the label of the switch (D-169), closed under «Все»; a 409 is a toast with its code. With
 * `register` (Believe) the answer `account_unregistered` opens the dialog that registers the account of the file under
 * the label and repeats the upload.
 */
function SourceUpload(props: {
  name: 'believe' | 'b17';
  label: string;
  accept: string;
  send: (file: File, labelId: string) => Promise<{ fileName: string }>;
  register?: boolean;
}) {
  const { labelId, closed } = useWriteLabel();
  const own = useOwnLabels();
  const [unregistered, setUnregistered] = useState<{ file: File; account: string } | null>(null);
  const run = useAction((f: File) => props.send(f, labelId), {
    invalidate: 'all',
    success: (r) => fmt(props.name === 'believe' ? t.uploaded : t.uploadedB17, { name: r.fileName }),
    handled: (error, f) => {
      const account = detailParams(error.details)['account'];
      if (!props.register || error.code !== 'account_unregistered' || account === undefined) return false;
      setUnregistered({ file: f, account: String(account) });
      return true;
    },
  });
  const label = { id: labelId, name: own.find((l) => l.id === labelId)?.name ?? '' };
  return (
    <>
      <UploadForm
        testId={`upload-${props.name}`}
        field={`upload-${props.name}`}
        action={`upload-${props.name}`}
        op={props.name === 'believe' ? 'POST /sources/believe' : 'POST /publishing/b17'}
        label={props.label}
        accept={props.accept}
        isPending={run.isPending}
        closed={closed}
        onSubmit={(file, reset) => run.mutate(file, { onSettled: reset })}
      />
      {unregistered ? (
        <AddAccountDialog
          label={label}
          account={unregistered.account}
          onClose={() => setUnregistered(null)}
          onAdded={() => run.mutate(unregistered.file)}
        />
      ) : null}
    </>
  );
}

/** The «Лейбл» cell of a file or a statement (D-169): the name of the own label it was loaded under, empty before the labels. */
function LabelCell(props: { testId: string; labelId: string | null; names: Map<string, string> }) {
  return (
    <span data-testid={props.testId} data-col="label" data-label-id={props.labelId ?? ''}>
      {props.labelId === null ? '' : (props.names.get(props.labelId) ?? props.labelId)}
    </span>
  );
}

/** P19 «Отчёты» `/sources`: the Believe files and the B17 statements with the upload forms. */
export function SourcesPage() {
  const write = useWriteLabel();
  const query = useQuery(sourceQueries.files(write.labelId));
  const own = useOwnLabels();
  // the grids' columns are rebuilt only when the names change (useOwnLabels returns a new array every render)
  const ownKey = JSON.stringify(own.map((l) => [l.id, l.name]));
  const names = useMemo(() => new Map(JSON.parse(ownKey) as [string, string][]), [ownKey]);
  const [q, setQ] = useUrlParam('q');
  const needle = q.trim().toLocaleLowerCase('ru');
  const believeCols = useMemo<ColDef<BelieveFile>[]>(
    () => [
      { colId: 'account', headerName: t.cols.account, valueGetter: (p) => p.data?.account },
      { colId: 'label', headerName: t.cols.label, valueGetter: (p) => (p.data?.labelId ? (names.get(p.data.labelId) ?? p.data.labelId) : ''), cellRenderer: (p: { data?: BelieveFile }) => (p.data ? <LabelCell testId="file-label" labelId={p.data.labelId} names={names} /> : null) },
      { colId: 'month', headerName: t.cols.month, valueGetter: (p) => p.data?.reportingMonth },
      { colId: 'fileName', headerName: t.cols.fileName, minWidth: 260, valueGetter: (p) => p.data?.fileName },
      { colId: 'status', headerName: t.cols.status, valueGetter: (p) => p.data?.status, cellRenderer: (p: { data?: BelieveFile }) => (p.data ? <StatusChip kind="fileStatus" value={p.data.status} /> : null) },
      { colId: 'lineCount', headerName: t.cols.lineCount, valueGetter: (p) => p.data?.lineCount, valueFormatter: (p) => (typeof p.value === 'number' ? formatCount(p.value) : '') },
      { colId: 'net', headerName: t.cols.net, comparator: compareDecimal, valueGetter: (p) => p.data?.netTotal, cellRenderer: (p: { data?: BelieveFile }) => (p.data ? <span data-col="net"><Money value={p.data.netTotal} /></span> : null) },
      { colId: 'createdAt', headerName: t.cols.createdAt, valueGetter: (p) => p.data?.createdAt.slice(0, 19).replace('T', ' ') },
    ],
    [names],
  );
  const b17Cols = useMemo<ColDef<Statement>[]>(
    () => [
      { colId: 'periods', headerName: t.cols.periods, valueGetter: (p) => p.data?.periods.join(', ') },
      { colId: 'label', headerName: t.cols.label, valueGetter: (p) => (p.data?.labelId ? (names.get(p.data.labelId) ?? p.data.labelId) : ''), cellRenderer: (p: { data?: Statement }) => (p.data ? <LabelCell testId="statement-label" labelId={p.data.labelId} names={names} /> : null) },
      { colId: 'fileName', headerName: t.cols.fileName, minWidth: 260, valueGetter: (p) => p.data?.fileName },
      { colId: 'status', headerName: t.cols.status, valueGetter: (p) => p.data?.status, cellRenderer: (p: { data?: Statement }) => (p.data ? <StatusChip kind="fileStatus" value={p.data.status} /> : null) },
      { colId: 'lineCount', headerName: t.cols.lineCount, valueGetter: (p) => p.data?.lineCount, valueFormatter: (p) => (typeof p.value === 'number' ? formatCount(p.value) : '') },
      { colId: 'totalPayable', headerName: t.cols.totalPayable, comparator: compareDecimal, valueGetter: (p) => p.data?.totalPayable, cellRenderer: (p: { data?: Statement }) => (p.data ? <span data-col="totalPayable"><Money value={p.data.totalPayable} /></span> : null) },
      { colId: 'warnings', headerName: t.cols.warnings, minWidth: 200, valueGetter: (p) => p.data?.warnings.join('; ') },
    ],
    [names],
  );
  return (
    <div data-testid="sources-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <Link to="/sources/lines" className="text-sm text-accent hover:underline" data-testid="link-lines">
            {t.linesLink}
          </Link>
        }
      />
      <div className="mb-3 w-72">
        <TextField name="sources-q" label={t.q} value={q} onChange={setQ} type="search" />
      </div>
      {write.closed ? (
        <p className="mb-3 text-sm text-muted" data-testid="upload-closed-reason">
          {write.reason}
        </p>
      ) : null}
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t.believe}</h2>
          <SourceUpload name="believe" label={t.uploadBelieve} accept=".csv,.zip" register send={(f, labelId) => api.sources.uploadBelieve(f, labelId).then((r) => ({ fileName: r.fileName }))} />
          <QueryView query={query} isEmpty={(d) => d.believe.length === 0} emptyMessage={t.noBelieve}>
            {(d) => <DataGrid rowData={d.believe.filter((f) => needle === '' || [f.account, f.reportingMonth, f.fileName].some((x) => x.toLocaleLowerCase('ru').includes(needle)))} columnDefs={believeCols} getRowId={(f) => f.id} rowTestId={(f) => `source-file-${f.id}`} gridStateKey="believe" height="360px" />}
          </QueryView>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t.b17}</h2>
          <SourceUpload name="b17" label={t.uploadB17} accept=".xlsx" send={(f, labelId) => api.publishing.uploadB17(f, labelId).then((r) => ({ fileName: r.statement.fileName }))} />
          <QueryView query={query} isEmpty={(d) => d.b17.length === 0} emptyMessage={t.noB17}>
            {(d) => <DataGrid rowData={d.b17.filter((f) => needle === '' || [f.fileName, ...f.periods].some((x) => x.toLocaleLowerCase('ru').includes(needle)))} columnDefs={b17Cols} getRowId={(f) => f.id} rowTestId={(f) => `statement-${f.id}`} gridStateKey="b17" height="260px" />}
          </QueryView>
        </section>
      </div>
    </div>
  );
}
