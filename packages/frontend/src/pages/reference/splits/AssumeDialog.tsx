import { useState } from 'react';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { LabelField, useLabelChoice } from '../../../components/fields/LabelField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.reference.splits;

/**
 * «Принять как допущение» (D-172, `POST /splits/assume`): one `assumption` document under an own label (default the
 * switch) with the reason as its title, set on the splits of the group that have no document; the backend decides which
 * (`assigned`, `skipped`), the dialog only names how many candidates it sees. The group is every split of an ISRC (P6)
 * or one split (P15). Hooks: `field-assume-label`, `field-assume-reason`, `assume-preview`, `action-assume-submit`.
 */
export function AssumeDialog(props: { group: { isrcs: string[] } | { splitIds: string[] }; candidates: number; title?: string; onClose: () => void }) {
  const { labelId, setLabelId } = useLabelChoice();
  const [reason, setReason] = useState('');
  const short = reason.trim().length < 3;
  const run = useAction(() => api.splits.assume({ labelId, reason: reason.trim(), ...props.group }), {
    invalidate: 'all',
    success: (r) => fmt(t.assumed, { assigned: r.assigned.length, skipped: r.skipped.length }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.assumeTitle}
      subtitle={t.assumeSubtitle}
      footer={
        <ActionButton
          name="assume-submit"
          op="POST /splits/assume"
          isPending={run.isPending}
          isDisabled={labelId === '' || short}
          reason={labelId === '' ? ru.actions.hints.fillFields : short ? t.reasonShort : undefined}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.assumeSubmit}
        </ActionButton>
      }
    >
      {props.title ? <p className="text-sm">{props.title}</p> : null}
      <p className="text-sm" data-testid="assume-preview" data-count={props.candidates}>
        {fmt(t.assumePreview, { n: props.candidates })}
      </p>
      <LabelField name="assume-label" label={t.assumeLabel} value={labelId} onChange={setLabelId} isRequired />
      <TextField name="assume-reason" label={t.assumeReason} value={reason} onChange={setReason} isRequired />
    </FormDialog>
  );
}
