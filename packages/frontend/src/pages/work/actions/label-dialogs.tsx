import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { LabelField, useLabelChoice } from '../../../components/fields/LabelField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.money.actions;

/**
 * «Задать лейбл» of an operation without one (P21 `operationsWithoutLabel`, D-168): the operator picks the own label,
 * `PATCH /settlements/operations/:id`. The switch of the header is the default. An advance under a label is then
 * recouped from that label's income only.
 */
export function SetOperationLabelDialog(props: { operationId: string; onClose: () => void }) {
  const { labelId, setLabelId, labelName: name } = useLabelChoice();
  const run = useAction(() => api.settlements.setLabel(props.operationId, { labelId }), {
    invalidate: 'all',
    success: () => fmt(t.setLabelToast, { label: name }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.setLabelTitle}
      subtitle={t.setLabelSubtitle}
      footer={
        <ActionButton
          name="set-label-submit"
          isDisabled={labelId === ''}
          reason={labelId === '' ? ru.actions.hints.fillFields : undefined}
          isPending={run.isPending}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.setLabel}
        </ActionButton>
      }
    >
      <LabelField name="op-label" label={t.setLabelField} value={labelId} onChange={setLabelId} isRequired />
    </FormDialog>
  );
}
