import { useMemo, useState } from 'react';
import type { ReleaseApply, ReleasePreview } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { ActionButton } from '../../components/ActionButton';
import { FormDialog } from '../../components/FormDialog';
import { LabelField, useLabelChoice } from '../../components/fields/LabelField';
import { UploadForm } from '../../components/fields/UploadForm';
import { fmt, ru } from '../../i18n/ru';
import { formatLocalDateTime } from '../../lib/datetime';

const t = ru.catalog.releases;
/** The rows of the preview drawn at once; every accepted change is still sent. */
const SHOWN = 300;

type Item = ReleasePreview['items'][number];
const TOTALS = ['rows', 'create', 'update', 'unchanged', 'error', 'duplicate', 'missing'] as const;

const shown = (field: string, v: string | null) => (v === null ? '—' : field === 'releasedAt' ? formatLocalDateTime(v) : v);

/**
 * «Загрузить реестр релизов» (D-195): step 1 previews the export of one own label (default the switch) against its
 * registry, nothing written (`POST /releases/preview`); step 2 applies the new and changed releases the operator
 * leaves checked (`POST /releases/preview/apply`), all or nothing. Navigation, no money.
 */
export function ReleaseImportDialog(props: { onClose: () => void }) {
  const { labelId, setLabelId } = useLabelChoice();
  const [preview, setPreview] = useState<ReleasePreview | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ReleaseApply | null>(null);
  const changes = useMemo(() => (preview?.items ?? []).filter((i) => (i.action === 'create' || i.action === 'update') && i.upc), [preview]);
  const read = useAction((file: File) => api.releases.preview(file, labelId), {
    invalidate: 'reference',
    success: (p) => fmt(t.previewed, { create: p.totals.create, update: p.totals.update, error: p.totals.error }),
  });
  const apply = useAction(
    () =>
      api.releases.apply(labelId, {
        changes: changes
          .filter((i) => accepted.has(i.upc as string))
          .map((i) => ({ upc: i.upc as string, action: i.action as 'create' | 'update', release: i.release as NonNullable<Item['release']>, before: i.before })),
      }),
    { invalidate: 'all', success: (r) => fmt(t.applied, { created: r.created, updated: r.updated }) },
  );
  const onPreview = (p: ReleasePreview) => {
    setPreview(p);
    setResult(null);
    setAccepted(new Set(p.items.flatMap((i) => ((i.action === 'create' || i.action === 'update') && i.upc ? [i.upc] : []))));
  };
  const toggle = (upc: string) =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(upc)) next.delete(upc);
      else next.add(upc);
      return next;
    });
  return (
    <FormDialog isOpen onOpenChange={(o) => (o ? null : props.onClose())} title={t.importTitle} subtitle={t.importSubtitle}>
      <LabelField
        name="releases-label"
        label={ru.catalog.catalogLabel.label}
        value={labelId}
        onChange={(v) => {
          setLabelId(v);
          setPreview(null);
        }}
        isRequired
      />
      <UploadForm
        testId="releases-upload"
        field="releases-file"
        action="releases-preview"
        op="POST /releases/preview"
        label={t.importFile}
        submitText={t.previewAction}
        accept=".csv"
        isPending={read.isPending}
        closed={labelId === ''}
        closedReason={ru.shell.label.pick}
        onSubmit={(file, reset) => {
          setPreview(null);
          read.mutate(file, { onSuccess: onPreview, onSettled: reset });
        }}
      />
      {preview ? (
        <div className="flex flex-col gap-3" data-testid="release-preview" data-file={preview.fileName}>
          <dl className="grid grid-cols-4 gap-2 text-sm sm:grid-cols-7" data-testid="release-preview-totals">
            {TOTALS.map((k) => (
              <div key={k} className="rounded-lg border border-border px-3 py-2" data-col={k}>
                <dt className="text-xs text-muted">{t.totals[k]}</dt>
                <dd className="font-semibold" data-value={preview.totals[k]}>
                  {preview.totals[k]}
                </dd>
              </div>
            ))}
          </dl>
          {changes.length > 0 ? (
            <div className="flex gap-2 text-sm">
              <button type="button" className="underline" data-testid="release-accept-all" onClick={() => setAccepted(new Set(changes.map((i) => i.upc as string)))}>
                {t.acceptAll}
              </button>
              <button type="button" className="underline" data-testid="release-accept-none" onClick={() => setAccepted(new Set())}>
                {t.acceptNone}
              </button>
            </div>
          ) : null}
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto text-sm" data-testid="release-preview-items">
            {preview.items.slice(0, SHOWN).map((i) => (
              <li key={i.line} className="rounded-lg px-2 py-1 hover:bg-default/50" data-testid={`release-item-${i.line}`} data-action={i.action} data-upc={i.upc ?? ''}>
                <label className="flex items-start gap-2">
                  {i.action === 'create' || i.action === 'update' ? (
                    <input type="checkbox" className="mt-1" data-testid={`release-accept-${i.upc ?? ''}`} checked={accepted.has(i.upc ?? '')} onChange={() => toggle(i.upc ?? '')} />
                  ) : (
                    <span className="w-4" />
                  )}
                  <span>
                    <span className={i.action === 'error' ? 'text-danger' : 'text-muted'}>{t.actions[i.action]}</span> · {fmt(t.line, { line: i.line })} ·{' '}
                    <span className="tabular-nums">{i.upc ?? '—'}</span>
                    {i.release ? ` · ${i.release.releaseTitle}${i.release.version ? ` (${i.release.version})` : ''}` : ''}
                    {i.action === 'create' && i.release?.releasedAt ? ` · ${formatLocalDateTime(i.release.releasedAt)}` : ''}
                    {i.changes.map((c) => (
                      <span key={c.field} className="block text-xs" data-testid={`release-change-${i.upc ?? ''}-${c.field}`}>
                        {t.fields[c.field as keyof typeof t.fields] ?? c.field}: {shown(c.field, c.before)} → {shown(c.field, c.after)}
                      </span>
                    ))}
                    {i.codes.length > 0 ? <span className="block text-xs text-danger">{i.codes.map((c) => t.codes[c]).join(', ')}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {preview.items.length > SHOWN ? <p className="text-xs text-muted">{fmt(t.shownFirst, { shown: SHOWN, all: preview.items.length })}</p> : null}
          {preview.missing.length > 0 ? (
            <details className="text-sm" data-testid="release-missing">
              <summary>{fmt(t.missingTitle, { count: preview.missing.length })}</summary>
              <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-muted">
                {preview.missing.slice(0, SHOWN).map((m) => (
                  <li key={m.upc}>
                    {m.upc} · {m.releaseTitle}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <ActionButton
            name="releases-apply"
            op="POST /releases/preview/apply"
            isPending={apply.isPending}
            isDisabled={accepted.size === 0}
            reason={t.nothingToApply}
            onPress={() =>
              apply.mutate(undefined, {
                onSuccess: (r) => {
                  setResult(r);
                  setPreview(null);
                },
              })
            }
          >
            {fmt(t.applyAction, { count: accepted.size })}
          </ActionButton>
        </div>
      ) : null}
      {result ? (
        <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="release-apply-result">
          {(['created', 'updated'] as const).map((k) => (
            <div key={k} className="rounded-lg border border-border px-3 py-2" data-col={k}>
              <dt className="text-xs text-muted">{t.result[k]}</dt>
              <dd className="font-semibold">{result[k]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </FormDialog>
  );
}
