import { useState } from 'react';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { useOwnLabels } from '../../../components/LabelSwitch';
import { LabelField, useLabelChoice } from '../../../components/fields/LabelField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.money.actions;
const r = ru.operations.relabel;

/**
 * «Задать лейбл» / «Сменить лейбл» of an operation (P21 `operationsWithoutLabel` and `operationsDefaultLabel`, a P20 row;
 * D-168, D-173): the operator picks the own label and says why (`field-op-label-reason`, required: 400 `reason_required`
 * otherwise) → `PATCH /settlements/operations/:id`; the label source becomes `operator` and the audit keeps the reason and
 * the previous label (`fromLabelId` of the answer, named in the toast). The switch of the header is the default. An
 * advance under a label is then recouped from that label's income only.
 */
export function SetOperationLabelDialog(props: { operationId: string; currentLabel?: string | null; onClose: () => void }) {
  const { labelId, setLabelId, labelName: name } = useLabelChoice();
  const own = useOwnLabels();
  const [reason, setReason] = useState('');
  const run = useAction(() => api.settlements.setLabel(props.operationId, { labelId, reason: reason.trim() }), {
    invalidate: 'all',
    success: (o) =>
      o.fromLabelId
        ? fmt(r.toast, { from: own.find((l) => l.id === o.fromLabelId)?.name ?? o.fromLabelId, label: name })
        : fmt(t.setLabelToast, { label: name }),
  });
  const filled = labelId !== '' && reason.trim() !== '';
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.setLabelTitle}
      subtitle={t.setLabelSubtitle}
      footer={
        <ActionButton
          name="set-label-submit" op="PATCH /settlements/operations/:id"
          isDisabled={!filled}
          reason={filled ? undefined : ru.actions.hints.fillFields}
          isPending={run.isPending}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.setLabel}
        </ActionButton>
      }
    >
      {props.currentLabel !== undefined ? (
        <div className="text-sm" data-testid="op-label-current">
          {fmt(r.current, { label: props.currentLabel ?? r.noLabel })}
        </div>
      ) : null}
      <LabelField name="op-label" label={t.setLabelField} value={labelId} onChange={setLabelId} isRequired />
      <TextField name="op-label-reason" label={r.reason} value={reason} onChange={setReason} isRequired />
    </FormDialog>
  );
}
