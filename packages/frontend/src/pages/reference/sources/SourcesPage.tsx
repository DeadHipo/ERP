import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { sourceFileSchema, statementSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { sourceQueries } from '../../../api/queries/sources';
import { ActionButton } from '../../../components/ActionButton';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { StatusChip } from '../../../components/StatusChip';
import { DataGrid } from '../../../components/grid/DataGrid';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { useUrlParam } from '../../catalog/components/url';

const t = ru.reference.sources;
type BelieveFile = z.output<typeof sourceFileSchema>;
type Statement = z.output<typeof statementSchema>;

/** One upload form: a file input and a button; `POST` through the client (multipart, `X-Operator`); a 409 is a toast with its code. */
function UploadForm(props: { name: 'believe' | 'b17'; label: string; accept: string; send: (file: File) => Promise<{ fileName: string }> }) {
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(0);
  const run = useAction((f: File) => props.send(f), {
    invalidate: 'all',
    success: (_r, f) => fmt(props.name === 'believe' ? t.uploaded : t.uploadedB17, { name: f.name }),
  });
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid={`upload-${props.name}`}>
      <label className="text-sm">
        {props.label}{' '}
        <input key={key} type="file" accept={props.accept} data-testid={`field-upload-${props.name}`} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <ActionButton
        name={`upload-${props.name}`}
        isPending={run.isPending}
        isDisabled={file === null}
        reason={ru.actions.hints.fillFields}
        onPress={() => file && run.mutate(file, { onSettled: () => { setFile(null); setKey((k) => k + 1); } })}
      >
        {t.upload}
      </ActionButton>
    </div>
  );
}

/** P19 «Отчёты» `/sources`: the Believe files and the B17 statements with the upload forms. */
export function SourcesPage() {
  const query = useQuery(sourceQueries.files());
  const [q, setQ] = useUrlParam('q');
  const needle = q.trim().toLocaleLowerCase('ru');
  const believeCols = useMemo<ColDef<BelieveFile>[]>(
    () => [
      { colId: 'account', headerName: t.cols.account, valueGetter: (p) => p.data?.account },
      { colId: 'month', headerName: t.cols.month, valueGetter: (p) => p.data?.reportingMonth },
      { colId: 'fileName', headerName: t.cols.fileName, minWidth: 260, valueGetter: (p) => p.data?.fileName },
      { colId: 'status', headerName: t.cols.status, valueGetter: (p) => p.data?.status, cellRenderer: (p: { data?: BelieveFile }) => (p.data ? <StatusChip kind="fileStatus" value={p.data.status} /> : null) },
      { colId: 'lineCount', headerName: t.cols.lineCount, valueGetter: (p) => p.data?.lineCount },
      { colId: 'net', headerName: t.cols.net, valueGetter: (p) => p.data?.netTotal, cellRenderer: (p: { data?: BelieveFile }) => (p.data ? <span data-col="net"><Money value={p.data.netTotal} /></span> : null) },
      { colId: 'createdAt', headerName: t.cols.createdAt, valueGetter: (p) => p.data?.createdAt.slice(0, 19).replace('T', ' ') },
    ],
    [],
  );
  const b17Cols = useMemo<ColDef<Statement>[]>(
    () => [
      { colId: 'periods', headerName: t.cols.periods, valueGetter: (p) => p.data?.periods.join(', ') },
      { colId: 'fileName', headerName: t.cols.fileName, minWidth: 260, valueGetter: (p) => p.data?.fileName },
      { colId: 'status', headerName: t.cols.status, valueGetter: (p) => p.data?.status },
      { colId: 'lineCount', headerName: t.cols.lineCount, valueGetter: (p) => p.data?.lineCount },
      { colId: 'totalPayable', headerName: t.cols.totalPayable, valueGetter: (p) => p.data?.totalPayable, cellRenderer: (p: { data?: Statement }) => (p.data ? <span data-col="totalPayable"><Money value={p.data.totalPayable} /></span> : null) },
      { colId: 'warnings', headerName: t.cols.warnings, minWidth: 200, valueGetter: (p) => p.data?.warnings.join('; ') },
    ],
    [],
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
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t.believe}</h2>
          <UploadForm name="believe" label={t.uploadBelieve} accept=".csv,.zip" send={(f) => api.sources.uploadBelieve(f).then((r) => ({ fileName: (r as { fileName?: string } | null)?.fileName ?? f.name }))} />
          <QueryView query={query} isEmpty={(d) => d.believe.length === 0} emptyMessage={t.noBelieve}>
            {(d) => <DataGrid rowData={d.believe.filter((f) => needle === '' || [f.account, f.reportingMonth, f.fileName].some((x) => x.toLocaleLowerCase('ru').includes(needle)))} columnDefs={believeCols} getRowId={(f) => f.id} rowTestId={(f) => `source-file-${f.id}`} gridStateKey="believe" height="360px" />}
          </QueryView>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">{t.b17}</h2>
          <UploadForm name="b17" label={t.uploadB17} accept=".xlsx" send={(f) => api.publishing.uploadB17(f).then((r) => ({ fileName: r.statement.fileName }))} />
          <QueryView query={query} isEmpty={(d) => d.b17.length === 0} emptyMessage={t.noB17}>
            {(d) => <DataGrid rowData={d.b17.filter((f) => needle === '' || [f.fileName, ...f.periods].some((x) => x.toLocaleLowerCase('ru').includes(needle)))} columnDefs={b17Cols} getRowId={(f) => f.id} rowTestId={(f) => `statement-${f.id}`} gridStateKey="b17" height="260px" />}
          </QueryView>
        </section>
      </div>
    </div>
  );
}
