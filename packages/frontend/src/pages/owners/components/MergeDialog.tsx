import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OwnerDetail } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.money.merge;

/**
 * «Слить в другого владельца» (17 §6): the target owner and the reason → ConfirmDialog (from → into, the pseudonyms
 * and documents that move, «необратимо») → `POST /owners/merge` → the target's card. The direction rules
 * (`merge_direction`, `merge_kind_mismatch`) are the backend's: its refusal is shown as it is.
 */
export function MergeDialog(props: { detail: OwnerDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const from = props.detail.owner;
  const [into, setInto] = useState<{ id: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const run = useAction((intoId: string) => api.owners.merge({ fromId: from.id, intoId, reason: reason.trim() }), {
    invalidate: 'all',
    success: (o) => fmt(t.toast, { name: o.name }),
  });
  const pseudonyms = props.detail.artists.map((a) => a.pseudonym).join(', ') || '—';
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.title}
        footer={
          <ActionButton
            name="merge-submit"
            isDisabled={!into || reason.trim() === ''}
            reason={!into || reason.trim() === '' ? ru.actions.hints.fillFields : undefined}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {t.submit}
          </ActionButton>
        }
      >
        <div className="text-sm">
          {ru.actions.fields.owner}: <b>{from.name}</b> · {pseudonyms}
        </div>
        <EntityPicker
          name="merge-into"
          label={t.into}
          kind="owners"
          value={into?.id ?? null}
          accept={(i) => i.id !== from.id}
          onChange={(id, label) => setInto(id ? { id, label } : null)}
        />
        <TextField name="merge-reason" label={t.reason} value={reason} onChange={setReason} isRequired />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.confirmTitle}
        lines={[
          fmt(t.lines.from, { name: from.name }),
          fmt(t.lines.into, { name: into?.label ?? '' }),
          fmt(t.lines.pseudonyms, { list: pseudonyms }),
          fmt(t.lines.documents, { n: props.detail.documents.length }),
          t.lines.irreversible,
        ]}
        isPending={run.isPending}
        onConfirm={() =>
          into &&
          run.mutate(into.id, {
            onSuccess: (o) => {
              props.onClose();
              void navigate(`/owners/${encodeURIComponent(o.id)}`);
            },
            onSettled: () => setConfirm(false),
          })
        }
      />
    </>
  );
}
