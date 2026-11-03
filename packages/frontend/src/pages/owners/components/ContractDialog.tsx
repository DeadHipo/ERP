import { useState } from 'react';
import type { OwnerDetail } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { TextField } from '../../../components/fields/TextField';
import { ru } from '../../../i18n/ru';
import { DocumentStep, type ReadyDocument } from '../../work/actions/DocumentStep';

const t = ru.money.documents;
const a = ru.actions;

/**
 * «Создать договор» (17 §6): an approved contract document (pick or create + approve) → the pseudonyms it confirms
 * (all of the owner's by default) → ConfirmDialog («владелец становится подтверждённым») → `POST /contracts`.
 */
export function ContractDialog(props: { detail: OwnerDetail; onClose: () => void }) {
  const owner = props.detail.owner;
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [chosen, setChosen] = useState<string[]>(props.detail.artists.map((x) => x.id));
  const [number, setNumber] = useState('');
  const [confirm, setConfirm] = useState(false);
  const run = useAction(
    (documentId: string) =>
      api.documents.createContract({ ownerId: owner.id, documentId, number: number.trim() || null, artistIds: chosen }),
    { invalidate: 'all', success: () => a.toast.contract },
  );
  const names = props.detail.artists.filter((x) => chosen.includes(x.id)).map((x) => x.pseudonym).join(', ');
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.contractTitle}
        subtitle={t.contractSubtitle}
        footer={
          <ActionButton
            name="contract-submit"
            isDisabled={!doc}
            reason={doc ? undefined : a.hints.pickFirst}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {t.contract}
          </ActionButton>
        }
      >
        <fieldset className="flex flex-col gap-1 text-sm" data-testid="contract-artists">
          <legend className="mb-1 font-medium">{t.contractArtists}</legend>
          {props.detail.artists.map((x) => (
            <label key={x.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid={`contract-artist-${x.id}`}
                checked={chosen.includes(x.id)}
                onChange={(e) => setChosen((prev) => (e.target.checked ? [...prev, x.id] : prev.filter((p) => p !== x.id)))}
              />
              {x.pseudonym}
            </label>
          ))}
        </fieldset>
        <TextField name="contract-number" label={t.contractNumber} value={number} onChange={setNumber} />
        <DocumentStep kinds={['contract']} ownerId={owner.id} defaultTitle={`Договор ${owner.name}`} ready={doc} onReady={setDoc} />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={a.confirm.contractTitle}
        lines={[...a.confirm.contractLines(owner.name, names, doc?.title ?? '')]}
        isPending={run.isPending}
        onConfirm={() => doc && run.mutate(doc.id, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}
