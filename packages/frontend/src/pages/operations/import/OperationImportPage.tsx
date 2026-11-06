import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { OperationImport } from '@erp/shared/api-responses';
import { OPERATION_IMPORT_COLUMNS } from '@erp/shared/operation-import';
import { isOperationKind } from '@erp/shared/operation-kinds';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { useOwnLabels } from '../../../components/LabelSwitch';
import { PageHeader } from '../../../components/PageHeader';
import { statusLabel } from '../../../components/StatusChip';
import { DataGrid } from '../../../components/grid/DataGrid';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { UploadForm } from '../../../components/fields/UploadForm';
import { notifyError } from '../../../components/toast';
import { fmt, ru } from '../../../i18n/ru';
import { formatMoney } from '../../../lib/money';
import { useWriteLabel } from '../../../lib/label';
import { importColumns } from './import-grid';
import { downloadTemplate } from './template';

const t = ru.operations.import;
const TOTALS = ['rows', 'create', 'unchanged', 'errors', 'warnings'] as const;

/**
 * P29 «Импорт операций» `/operations/import` (D-173 §1.5): file → preview → result, as P28. The preview is
 * `POST /settlements/operations/import?dryRun=1` (nothing written, no audit row); the file stays in the page until the
 * apply (`dryRun=0`, all or nothing, every row `migration: true` = paid outside the ERP; `useAction` invalidates
 * everything). A repeated file is `unchanged` row by row. Under «Все» the form is closed (`useWriteLabel`); a new label
 * drops the preview. Entered from P20 only (no sidebar item).
 */
export function OperationImportPage() {
  const write = useWriteLabel();
  const own = useOwnLabels();
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [preview, setPreview] = useState<OperationImport | null>(null);
  const [result, setResult] = useState<OperationImport | null>(null);
  // the preview belongs to the label it was made under
  useEffect(() => {
    setPreview(null);
    setResult(null);
    setFile(null);
  }, [write.labelId]);
  const previewRun = useMutation({
    mutationFn: (f: File) => api.settlements.importFile(f, write.labelId, true, documentId ?? undefined),
    onError: (e) => notifyError(e),
  });
  const apply = useAction((f: File) => api.settlements.importFile(f, write.labelId, false, documentId ?? undefined), {
    invalidate: 'all',
    success: (r) => fmt(t.applied, { operations: r.result?.operationIds.length ?? 0, proofs: r.result?.proofIds.length ?? 0 }),
  });
  const columns = useMemo(() => importColumns(), []);
  const labelName = own.find((l) => l.id === write.labelId)?.name ?? '';
  const required = OPERATION_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.name);
  const totals = preview?.totals;
  const nothing = totals !== undefined && totals.create === 0;
  const byKind = totals
    ? Object.entries(totals.byKind)
        .map(([k, v]) => `${isOperationKind(k) ? statusLabel('operationKind', k) : k} ${formatMoney(v)}`)
        .join(', ')
    : '';
  return (
    <div data-testid="operation-import-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <Link to="/operations" className="text-sm text-accent hover:underline" data-testid="link-back-operations">
            {t.back}
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton name="operation-import-template" write={false} variant="secondary" onPress={downloadTemplate}>
              {t.template}
            </ActionButton>
            <span className="text-xs text-muted">
              {fmt(t.templateHint, { columns: OPERATION_IMPORT_COLUMNS.map((c) => c.name).join(', '), required: required.join(', ') })}
            </span>
          </div>
          {write.closed ? (
            <p className="text-sm text-muted" data-testid="upload-closed-reason">
              {write.reason}
            </p>
          ) : (
            <p className="text-sm" data-testid="operation-import-label" data-label-id={write.labelId}>
              {fmt(t.label, { name: labelName })}
            </p>
          )}
          <div className="w-96">
            <EntityPicker
              name="operation-import-document"
              label={t.document}
              kind="documents"
              value={documentId}
              onChange={(id) => {
                setDocumentId(id);
                setPreview(null);
              }}
            />
          </div>
          <UploadForm
            testId="operation-import-upload"
            field="operation-import-file"
            action="operation-import-preview"
            op="POST /settlements/operations/import"
            label={t.file}
            accept=".csv"
            submitText={t.preview}
            isPending={previewRun.isPending}
            closed={write.closed}
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
        </section>
        {result ? <ImportResult result={result} /> : null}
        {preview && totals ? (
          <section className="flex flex-col gap-3" data-testid="operation-import-preview">
            <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-5" data-testid="operation-import-totals">
              {TOTALS.map((k) => (
                <div key={k} className="rounded-lg border border-border px-3 py-2" data-col={k}>
                  <dt className="text-xs text-muted">{t.totals[k]}</dt>
                  <dd className={k === 'errors' && totals.errors > 0 ? 'font-semibold text-danger' : 'font-semibold'} data-value={totals[k]}>
                    {totals[k]}
                  </dd>
                </div>
              ))}
            </dl>
            {byKind ? (
              <p className="text-sm" data-testid="operation-import-by-kind">
                {fmt(t.byKind, { list: byKind })}
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <ActionButton
                name="operation-import-apply"
                op="POST /settlements/operations/import"
                isPending={apply.isPending}
                isDisabled={totals.errors > 0 || nothing || file === null || write.closed}
                reason={totals.errors > 0 ? undefined : nothing ? t.nothing : undefined}
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
                {t.apply}
              </ActionButton>
              {totals.errors > 0 ? (
                <span className="text-sm text-danger" data-testid="import-blocked-reason">
                  {fmt(t.blocked, { errors: totals.errors })}
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
      </div>
    </div>
  );
}

/** The result of an apply: the counts of the response and a link to P20 (the operations of the label). */
function ImportResult({ result }: { result: OperationImport }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-success/40 bg-success/5 p-3 text-sm" data-testid="operation-import-result">
      <h2 className="font-medium">{t.result}</h2>
      <p data-col="operations" data-value={result.result?.operationIds.length ?? 0}>
        {fmt(t.resultText, { operations: result.result?.operationIds.length ?? 0, proofs: result.result?.proofIds.length ?? 0 })}
      </p>
      <Link to="/operations" className="text-accent hover:underline" data-testid="link-import-operations">
        {t.toOperations}
      </Link>
    </section>
  );
}
