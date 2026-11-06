import type { z } from 'zod';
import type { statementSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { FormDialog } from '../../../components/FormDialog';
import { UploadForm } from '../../../components/fields/UploadForm';
import { fmt, ru } from '../../../i18n/ru';
import { useWriteLabel } from '../../../lib/label';

const t = ru.operations.replace;
type Statement = z.output<typeof statementSchema>;

/**
 * «Заменить» of a loaded B17 statement (D-173 §1.6, P19): a corrected file of the same quarters under the same own label
 * (the switch; closed under «Все») on the shared `UploadForm` → `POST /publishing/statements/:id/replace?label=`. The old
 * statement becomes `superseded` (its lines and the payout snapshots stay), the new one is loaded; the refusals
 * (`periods_differ`, `replace_label_differs`, `replace_not_loaded`, `duplicate_file`) are the backend's toasts.
 */
export function ReplaceStatementDialog(props: { statement: Statement; onClose: () => void }) {
  const { labelId, closed, reason } = useWriteLabel();
  const run = useAction((f: File) => api.publishing.replaceStatement(props.statement.id, f, labelId), {
    invalidate: 'all',
    success: (r) => fmt(t.toast, { name: r.statement.fileName }),
  });
  return (
    <FormDialog isOpen onOpenChange={(o) => (o ? null : props.onClose())} title={t.title} subtitle={t.subtitle}>
      <div className="text-sm" data-testid="replace-statement-of" data-statement-id={props.statement.id}>
        {props.statement.fileName}
      </div>
      <div className="text-sm">{fmt(t.periods, { periods: props.statement.periods.join(', ') })}</div>
      <p className="text-sm text-warning" data-testid="replace-statement-note">
        {t.confirm}
      </p>
      <UploadForm
        testId="replace-statement"
        field="replace-statement-file"
        action="replace-statement-submit"
        op="POST /publishing/statements/:id/replace"
        label={t.file}
        accept=".xlsx"
        submitText={t.submit}
        isPending={run.isPending}
        closed={closed}
        closedReason={reason}
        onSubmit={(file, reset) => run.mutate(file, { onSuccess: props.onClose, onSettled: reset })}
      />
    </FormDialog>
  );
}
