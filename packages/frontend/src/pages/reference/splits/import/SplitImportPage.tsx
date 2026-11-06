import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { SPLIT_IMPORT_COLUMNS } from '@erp/shared/split-import';
import * as api from '../../../../api/client';
import { useAction } from '../../../../api/queries/core';
import { ActionButton } from '../../../../components/ActionButton';
import { useOwnLabels } from '../../../../components/LabelSwitch';
import { PageHeader } from '../../../../components/PageHeader';
import { DataGrid } from '../../../../components/grid/DataGrid';
import { SelectField } from '../../../../components/fields/SelectField';
import { UploadForm } from '../../../../components/fields/UploadForm';
import { notifyError } from '../../../../components/toast';
import { fmt, ru } from '../../../../i18n/ru';
import { useWriteLabel } from '../../../../lib/label';
import { importColumns, type PreviewRow } from './import-grid';
import { downloadTemplate } from './template';
import type { SplitImport } from './types';

const t = ru.splitImport;
type Show = 'all' | 'errors' | 'warnings';

/**
 * P28 «Импорт сплитов» `/splits/import` (D-172): file → preview → result. The preview is `POST /splits/import?dryRun=1`
 * (nothing written, no audit row); the file stays in the page until the apply (`dryRun=0`, all or nothing, `useAction`
 * invalidates everything). Under «Все» the form is closed (`useWriteLabel`); a new label drops the preview. Entered from
 * P15 only (no sidebar item, О11).
 */
export function SplitImportPage() {
  const write = useWriteLabel();
  const own = useOwnLabels();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SplitImport | null>(null);
  const [result, setResult] = useState<SplitImport | null>(null);
  const [show, setShow] = useState<Show>('all');
  // the preview belongs to the label it was made under
  useEffect(() => {
    setPreview(null);
    setResult(null);
    setFile(null);
  }, [write.labelId]);
  const previewRun = useMutation({
    mutationFn: (f: File) => api.splits.importFile(f, write.labelId, true),
    onError: (e) => notifyError(e),
  });
  const apply = useAction((f: File) => api.splits.importFile(f, write.labelId, false), {
    invalidate: 'all',
    success: (r) => fmt(t.applied, { splits: r.result?.splitIds.length ?? 0, artists: r.result?.artistIds.length ?? 0, owners: r.result?.ownerIds.length ?? 0 }),
  });
  const columns = useMemo(() => importColumns(), []);
  const rows = useMemo<PreviewRow[]>(() => {
    if (!preview) return [];
    const actionOf = new Map(preview.groups.map((g) => [g.key, g.action]));
    return preview.rows
      .map((r) => ({ ...r, action: actionOf.get(r.group) ?? 'blocked' }))
      .filter((r) => show === 'all' || r.issues.some((i) => i.severity === (show === 'errors' ? 'error' : 'warning')));
  }, [preview, show]);
  const labelName = own.find((l) => l.id === write.labelId)?.name ?? '';
  const required = SPLIT_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.name);
  const totals = preview?.totals;
  const nothing = totals !== undefined && totals.create === 0 && totals.change === 0;
  return (
    <div data-testid="split-import-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <Link to="/splits" className="text-sm text-accent hover:underline" data-testid="link-back-splits">
            {t.back}
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton name="split-import-template" write={false} variant="secondary" onPress={downloadTemplate}>
              {t.template}
            </ActionButton>
            <span className="text-xs text-muted">
              {fmt(t.templateHint, { columns: SPLIT_IMPORT_COLUMNS.map((c) => c.name).join(', '), required: required.join(', ') })}
            </span>
          </div>
          {write.closed ? (
            <p className="text-sm text-muted" data-testid="upload-closed-reason">
              {write.reason}
            </p>
          ) : (
            <p className="text-sm" data-testid="split-import-label" data-label-id={write.labelId}>
              {fmt(t.label, { name: labelName })}
            </p>
          )}
          <UploadForm
            testId="split-import-upload"
            field="split-import-file"
            action="split-import-preview"
            op="POST /splits/import"
            label={t.file}
            accept=".csv,.xlsx"
            submitText={t.preview}
            isPending={previewRun.isPending}
            closed={write.closed}
            onSubmit={(f) => {
              setResult(null);
              previewRun.mutate(f, {
                onSuccess: (r) => {
                  setFile(f);
                  setPreview(r);
                  setShow('all');
                },
              });
            }}
          />
        </section>
        {result ? <ImportResult result={result} /> : null}
        {preview && totals ? (
          <section className="flex flex-col gap-3" data-testid="split-import-preview">
            <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-5 lg:grid-cols-9" data-testid="split-import-totals">
              {(Object.keys(t.totals) as (keyof typeof t.totals)[]).map((k) => (
                <div key={k} className="rounded-lg border border-border px-3 py-2" data-col={k}>
                  <dt className="text-xs text-muted">{t.totals[k]}</dt>
                  <dd className={k === 'errors' && totals.errors > 0 ? 'font-semibold text-danger' : 'font-semibold'} data-value={totals[k]}>
                    {totals[k]}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-60">
                <SelectField
                  name="import-show"
                  label={t.show}
                  value={show}
                  onChange={(v) => setShow(v === 'errors' || v === 'warnings' ? v : 'all')}
                  options={[
                    { id: 'all', label: t.showAll },
                    { id: 'errors', label: t.showErrors },
                    { id: 'warnings', label: t.showWarnings },
                  ]}
                />
              </div>
              <ActionButton
                name="split-import-apply"
                op="POST /splits/import"
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
              rowData={rows}
              columnDefs={columns}
              getRowId={(r) => String(r.line)}
              rowTestId={(r) => `import-row-${r.line}`}
              rowAttributes={(r) => ({ 'data-action': r.action, 'data-group': r.group })}
              autoHeight
              pageSize={100}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** The result of an apply: the counts of the response and a link to P15 per ISRC of a created or changed group. */
function ImportResult({ result }: { result: SplitImport }) {
  const isrcs = [...new Set(result.groups.filter((g) => g.action === 'create' || g.action === 'change').map((g) => g.isrc))];
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-success/40 bg-success/5 p-3 text-sm" data-testid="split-import-result">
      <h2 className="font-medium">{t.result}</h2>
      <p>
        {fmt(t.resultText, {
          splits: result.result?.splitIds.length ?? 0,
          artists: result.result?.artistIds.length ?? 0,
          owners: result.result?.ownerIds.length ?? 0,
        })}
      </p>
      <ul className="flex flex-wrap gap-3">
        {isrcs.map((isrc) => (
          <li key={isrc}>
            <Link to={`/splits?isrc=${encodeURIComponent(isrc)}`} className="text-accent hover:underline" data-testid="link-import-splits" data-isrc={isrc}>
              {fmt(t.toSplits, { isrc })}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
