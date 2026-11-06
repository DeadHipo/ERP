import { useState } from 'react';
import type { ReleaseImport } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { FormDialog } from '../../components/FormDialog';
import { LabelField, useLabelChoice } from '../../components/fields/LabelField';
import { UploadForm } from '../../components/fields/UploadForm';
import { fmt, ru } from '../../i18n/ru';

const t = ru.catalog.releases;

/**
 * «Загрузить реестр релизов» (D-172, `POST /releases/import?label=`): the Believe release export of one own label (default
 * the switch) on the shared `UploadForm` (`field-releases-file`, `action-releases-import-submit`); all or nothing, the
 * counts of the answer in `release-import-result` (`data-col="rows|inserted|updated|unchanged"`). Navigation, no money.
 */
export function ReleaseImportDialog(props: { onClose: () => void }) {
  const { labelId, setLabelId } = useLabelChoice();
  const [result, setResult] = useState<ReleaseImport | null>(null);
  const run = useAction((file: File) => api.releases.importFile(file, labelId), {
    invalidate: 'all',
    success: (r) => fmt(t.imported, { rows: r.rows, inserted: r.inserted, updated: r.updated }),
  });
  return (
    <FormDialog isOpen onOpenChange={(o) => (o ? null : props.onClose())} title={t.importTitle} subtitle={t.importSubtitle}>
      <LabelField name="releases-label" label={ru.catalog.catalogLabel.label} value={labelId} onChange={setLabelId} isRequired />
      <UploadForm
        testId="releases-upload"
        field="releases-file"
        action="releases-import-submit"
        op="POST /releases/import"
        label={t.importFile}
        accept=".csv"
        isPending={run.isPending}
        closed={labelId === ''}
        closedReason={ru.shell.label.pick}
        onSubmit={(file, reset) => {
          setResult(null);
          run.mutate(file, { onSuccess: setResult, onSettled: reset });
        }}
      />
      {result ? (
        <dl className="grid grid-cols-4 gap-2 text-sm" data-testid="release-import-result">
          {(['rows', 'inserted', 'updated', 'unchanged'] as const).map((k) => (
            <div key={k} className="rounded-lg border border-border px-3 py-2" data-col={k}>
              <dt className="text-xs text-muted">{t.importResult[k]}</dt>
              <dd className="font-semibold">{result[k]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </FormDialog>
  );
}
