import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PAYROLL_SHEETS } from '@erp/shared/api-schemas';
import * as api from '../../../api/client';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { useOwnLabels } from '../../../components/LabelSwitch';
import { SelectField } from '../../../components/fields/SelectField';
import { notifyError, notifySuccess } from '../../../components/toast';
import { fmt, ru } from '../../../i18n/ru';
import { saveBlob } from '../../../lib/download';
import { useLabel } from '../../../lib/label';

const t = ru.operations.payroll;
type Sheet = (typeof PAYROLL_SHEETS)[number];
type Area = 'master' | 'publishing' | 'all';
const AREAS: readonly Area[] = ['master', 'publishing', 'all'];

/**
 * «Выгрузить ведомость» of P9 (D-173 §1.4): the payroll is the book of one own label, so the button is closed under «Все»
 * («выберите лейбл»). The dialog chooses the area (master by default, as the payout button) and the sheet; the file is
 * `GET /owners/payroll?format=csv` as the server names it, with the cut `asOf` of the page.
 */
export function PayrollExportButton(props: { asOf: string }) {
  const { labelId } = useLabel();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton
        name="payroll-export"
        write={false}
        op="GET /owners/payroll"
        variant="secondary"
        isDisabled={labelId === ''}
        reason={labelId === '' ? ru.shell.label.pick : undefined}
        onPress={() => setOpen(true)}
      >
        {t.action}
      </ActionButton>
      {open ? <PayrollExportDialog labelId={labelId} asOf={props.asOf} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PayrollExportDialog(props: { labelId: string; asOf: string; onClose: () => void }) {
  const own = useOwnLabels();
  const [area, setArea] = useState<Area>('master');
  const [sheet, setSheet] = useState<Sheet>('payroll');
  // a read, not a write (nothing to invalidate): a plain mutation for the pending state and the toasts, as the P28 preview
  const run = useMutation({
    mutationFn: () => api.owners.payrollCsv({ label: props.labelId, area, sheet, ...(props.asOf ? { asOf: props.asOf } : {}) }),
    onSuccess: (r) => {
      saveBlob(r.fileName, r.blob);
      notifySuccess(fmt(t.done, { name: r.fileName }));
    },
    onError: (e) => notifyError(e),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <ActionButton
          name="payroll-download"
          write={false}
          op="GET /owners/payroll"
          isPending={run.isPending}
          onPress={() => run.mutate()}
        >
          {t.download}
        </ActionButton>
      }
    >
      <div className="text-sm" data-testid="payroll-label" data-label-id={props.labelId}>
        {fmt(t.label, { name: own.find((l) => l.id === props.labelId)?.name ?? '' })}
      </div>
      <div className="text-sm" data-testid="payroll-as-of" data-value={props.asOf}>
        {props.asOf ? fmt(t.asOf, { asOf: props.asOf }) : t.noAsOf}
      </div>
      <SelectField
        name="payroll-area"
        label={t.area}
        value={area}
        onChange={(v) => setArea(AREAS.find((a) => a === v) ?? 'master')}
        options={AREAS.map((a) => ({ id: a, label: ru.operations.kind.areas[a] }))}
      />
      <SelectField
        name="payroll-sheet"
        label={t.sheet}
        value={sheet}
        onChange={(v) => setSheet(PAYROLL_SHEETS.find((s) => s === v) ?? 'payroll')}
        options={PAYROLL_SHEETS.map((s) => ({ id: s, label: t.sheets[s] }))}
      />
    </FormDialog>
  );
}
