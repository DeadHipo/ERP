import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { StartImport } from '@erp/shared/api-responses';
import { START_IMPORT_COLUMNS } from '@erp/shared/start-import';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { settlementQueries } from '../../../api/queries/settlements';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { useOwnLabels } from '../../../components/LabelSwitch';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { TextField } from '../../../components/fields/TextField';
import { UploadForm } from '../../../components/fields/UploadForm';
import { notifyError } from '../../../components/toast';
import { fmt, ru } from '../../../i18n/ru';
import { useLabel, useWriteLabel } from '../../../lib/label';
import { formatMoney } from '../../../lib/money';
import { importColumns, startColumns, type StartRow } from './start-grid';
import { downloadTemplate } from './template';

const t = ru.operations.start;
const TOTALS = ['rows', 'create', 'unchanged', 'errors', 'warnings', 'starts', 'adjustments', 'missing'] as const;
const LIST_TOTALS = ['starts', 'adjustments', 'missing', 'inactive'] as const;
const DEFAULT_CUTOFF = '2026-08';
const DEFAULT_SYNCED = '2026-10-15T15:09:49Z';

/**
 * P30 «Старт 15.10» `/operations/start` (D-174): the opening balances of the book of the switch (`GET /settlements/start`:
 * the list with its sums, a row may be deactivated with a reason), and their import as P29: file + the cut (month,
 * synchronisation moment, default basis) → preview (`dryRun=1`, nothing written) → apply (`dryRun=0`, all or nothing;
 * `useAction` invalidates everything, the balances change). Under «Все» the list shows every book and the import is
 * closed (`useWriteLabel`); a new label drops the preview.
 */
export function StartPage() {
  const { labelId } = useLabel();
  const write = useWriteLabel();
  const own = useOwnLabels();
  const [showInactive, setShowInactive] = useState(false);
  const list = useQuery(settlementQueries.start({ ...(labelId ? { label: labelId } : {}), ...(showInactive ? { active: 'false' as const } : {}) }));
  const labelName = own.find((l) => l.id === labelId)?.name ?? '';
  const columns = useMemo(() => startColumns(), []);
  const [deactivating, setDeactivating] = useState<StartRow | null>(null);
  return (
    <div data-testid="start-page" data-label-id={labelId}>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3" data-testid="start-list">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span data-testid="start-label">{labelId ? fmt(t.labelLine, { name: labelName }) : t.allLabels}</span>
            <label className="flex items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} data-testid="field-start-show-inactive" />
              {t.showInactive}
            </label>
          </div>
          <QueryView query={list}>
            {(data) => (
              <>
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-7" data-testid="start-totals">
                  {LIST_TOTALS.map((k) => (
                    <div key={k} className="rounded-lg border border-border px-3 py-2" data-col={k}>
                      <dt className="text-xs text-muted">{t.totals[k]}</dt>
                      <dd className="font-semibold" data-value={data.totals[k]}>
                        {data.totals[k]}
                      </dd>
                    </div>
                  ))}
                  {(['master', 'publishing', 'total'] as const).map((k) => (
                    <div key={k} className="rounded-lg border border-border px-3 py-2" data-col={k}>
                      <dt className="text-xs text-muted">{t.totals[k]}</dt>
                      <dd className="font-semibold" data-value={data.totals[k]}>
                        <Money value={data.totals[k]} />
                      </dd>
                    </div>
                  ))}
                </dl>
                {data.totals.cutoffMonths.length > 0 ? (
                  <p className="text-xs text-muted" data-testid="start-cutoffs">
                    {fmt(t.cutoffMonths, { months: data.totals.cutoffMonths.join(', ') })}
                  </p>
                ) : null}
                {data.rows.length === 0 ? (
                  <p className="text-sm text-muted" data-testid="start-none">
                    {t.none}
                  </p>
                ) : (
                  <DataGrid
                    rowData={data.rows}
                    columnDefs={[
                      ...columns,
                      {
                        colId: 'actions',
                        headerName: t.cols.actions,
                        maxWidth: 140,
                        sortable: false,
                        cellRenderer: (p: { data?: StartRow }) =>
                          p.data?.active ? (
                            <ActionButton name={`start-deactivate-${p.data.id}`} op="POST /settlements/start/:id/deactivate" compact variant="secondary" onPress={() => setDeactivating(p.data ?? null)}>
                              {t.deactivate}
                            </ActionButton>
                          ) : null,
                      },
                    ]}
                    getRowId={(r) => r.id}
                    rowTestId={(r) => `start-row-${r.id}`}
                    rowAttributes={(r) => ({ 'data-kind': r.kind, 'data-active': String(r.active), 'data-artist-id': r.artistId })}
                    autoHeight
                    pageSize={100}
                  />
                )}
              </>
            )}
          </QueryView>
        </section>
        <StartImport labelId={write.labelId} closed={write.closed} closedReason={write.reason} labelName={labelName} />
      </div>
      <DeactivateDialog row={deactivating} onClose={() => setDeactivating(null)} />
    </div>
  );
}

/** The import form of P30: the cut fields, the file, the preview and the apply (as P29). */
function StartImport(props: { labelId: string; closed: boolean; closedReason: string; labelName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [cutoff, setCutoff] = useState(DEFAULT_CUTOFF);
  const [syncedAt, setSyncedAt] = useState(DEFAULT_SYNCED);
  const [basis, setBasis] = useState('');
  const [preview, setPreview] = useState<StartImport | null>(null);
  const [result, setResult] = useState<StartImport | null>(null);
  // the preview belongs to the label and the cut it was made under
  useEffect(() => {
    setPreview(null);
    setResult(null);
    setFile(null);
  }, [props.labelId]);
  const query = () => ({ labelId: props.labelId, cutoff, syncedAt, ...(basis.trim() ? { basis: basis.trim() } : {}) });
  const previewRun = useMutation({
    mutationFn: (f: File) => api.settlements.importStart(f, query(), true),
    onError: (e) => notifyError(e),
  });
  const apply = useAction((f: File) => api.settlements.importStart(f, query(), false), {
    invalidate: 'all',
    success: (r) => fmt(t.import.applied, { rows: r.result?.ids.length ?? 0 }),
  });
  const columns = useMemo(() => importColumns(), []);
  const totals = preview?.totals;
  const nothing = totals !== undefined && totals.create === 0;
  const i = t.import;
  return (
    <section className="flex flex-col gap-3" data-testid="start-import">
      <h2 className="text-lg font-medium">{t.tabs.import}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton name="start-import-template" write={false} variant="secondary" onPress={downloadTemplate}>
          {i.template}
        </ActionButton>
        <span className="text-xs text-muted">{fmt(i.templateHint, { columns: START_IMPORT_COLUMNS.map((c) => c.name).join(', ') })}</span>
      </div>
      {props.closed ? (
        <p className="text-sm text-muted" data-testid="upload-closed-reason">
          {props.closedReason}
        </p>
      ) : (
        <p className="text-sm" data-testid="start-import-label" data-label-id={props.labelId}>
          {fmt(t.labelLine, { name: props.labelName })}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          name="start-cutoff"
          label={i.cutoff}
          type="month"
          value={cutoff}
          onChange={(v) => {
            setCutoff(v);
            setPreview(null);
          }}
          isRequired
        />
        <TextField
          name="start-synced-at"
          label={i.syncedAt}
          value={syncedAt}
          onChange={(v) => {
            setSyncedAt(v);
            setPreview(null);
          }}
          placeholder="2026-10-15T15:09:49Z"
          isRequired
        />
        <TextField
          name="start-basis"
          label={i.basis}
          value={basis}
          onChange={(v) => {
            setBasis(v);
            setPreview(null);
          }}
        />
      </div>
      <UploadForm
        testId="start-import-upload"
        field="start-import-file"
        action="start-import-preview"
        op="POST /settlements/start/import"
        label={i.file}
        accept=".csv"
        submitText={i.preview}
        isPending={previewRun.isPending}
        closed={props.closed}
        onSubmit={(f) => {
          setResult(null);
          previewRun.mutate(f, {
            onSuccess: (r) => {
              setFile(f);
              setPreview(r);
            },
          });
        }}
      />
      {result ? (
        <section className="flex flex-col gap-2 rounded-xl border border-success/40 bg-success/5 p-3 text-sm" data-testid="start-import-result">
          <h3 className="font-medium">{i.result}</h3>
          <p data-col="rows" data-value={result.result?.ids.length ?? 0}>
            {fmt(i.resultText, { rows: result.result?.ids.length ?? 0 })}
          </p>
        </section>
      ) : null}
      {preview && totals ? (
        <section className="flex flex-col gap-3" data-testid="start-import-preview">
          <dl className="grid grid-cols-4 gap-2 text-sm lg:grid-cols-8" data-testid="start-import-totals">
            {TOTALS.map((k) => (
              <div key={k} className="rounded-lg border border-border px-3 py-2" data-col={k}>
                <dt className="text-xs text-muted">{i.totals[k]}</dt>
                <dd className={k === 'errors' && totals.errors > 0 ? 'font-semibold text-danger' : 'font-semibold'} data-value={totals[k]}>
                  {totals[k]}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm" data-testid="start-import-sums">
            {fmt(i.sums, { master: formatMoney(totals.master), publishing: formatMoney(totals.publishing) })}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <ActionButton
              name="start-import-apply"
              op="POST /settlements/start/import"
              isPending={apply.isPending}
              isDisabled={totals.errors > 0 || nothing || file === null || props.closed}
              reason={totals.errors > 0 ? undefined : nothing ? i.nothing : undefined}
              onPress={() =>
                file &&
                apply.mutate(file, {
                  onSuccess: (r) => {
                    setResult(r);
                    setPreview(null);
                    setFile(null);
                  },
                })
              }
            >
              {i.apply}
            </ActionButton>
            {totals.errors > 0 ? (
              <span className="text-sm text-danger" data-testid="import-blocked-reason">
                {fmt(i.blocked, { errors: totals.errors })}
              </span>
            ) : null}
          </div>
          <DataGrid
            rowData={preview.rows}
            columnDefs={columns}
            getRowId={(r) => String(r.line)}
            rowTestId={(r) => `import-row-${r.line}`}
            rowAttributes={(r) => ({ 'data-action': r.action })}
            autoHeight
            pageSize={100}
          />
        </section>
      ) : null}
    </section>
  );
}

/** The soft rollback of a row (D-174): a reason, then `POST /settlements/start/:id/deactivate`. */
function DeactivateDialog(props: { row: StartRow | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [props.row?.id]);
  const run = useAction((row: StartRow) => api.settlements.deactivateStart(row.id, { reason: reason.trim() }), { invalidate: 'all', success: () => t.deactivated });
  return (
    <FormDialog
      isOpen={props.row !== null}
      onOpenChange={(open) => !open && props.onClose()}
      title={t.deactivateTitle}
      subtitle={t.deactivateSubtitle}
      footer={
        <ActionButton
          name="start-deactivate-submit"
          op="POST /settlements/start/:id/deactivate"
          isPending={run.isPending}
          isDisabled={reason.trim() === '' || props.row === null}
          onPress={() => props.row && run.mutate(props.row, { onSuccess: () => props.onClose() })}
        >
          {t.deactivate}
        </ActionButton>
      }
    >
      {props.row ? (
        <p className="text-sm" data-testid="start-deactivate-row">
          {props.row.pseudonym} · {props.row.kind === 'start' ? t.kinds.start : t.kinds.adjustment} · {props.row.cutoffMonth}
        </p>
      ) : null}
      <TextField name="start-deactivate-reason" label={t.deactivateReason} value={reason} onChange={setReason} isRequired />
    </FormDialog>
  );
}
