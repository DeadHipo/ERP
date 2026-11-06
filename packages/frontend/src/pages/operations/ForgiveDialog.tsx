import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Operation } from '@erp/shared/api-responses';
import { KIND_DOCUMENT_KINDS } from '@erp/shared/operation-kinds';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { ownerQueries } from '../../api/queries/owners';
import { ActionButton } from '../../components/ActionButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormDialog } from '../../components/FormDialog';
import { Money } from '../../components/Money';
import { DateField } from '../../components/fields/DateField';
import { TextField } from '../../components/fields/TextField';
import { formatMoney } from '../../lib/money';
import { fmt, ru } from '../../i18n/ru';
import { DocumentStep, type ReadyDocument } from '../work/actions/DocumentStep';
import { centsToText } from '../owners/components/cents';

const t = ru.operations.forgive;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

/**
 * «Простить» of an active advance (D-173 §1.3, P20 and P10 Операции): the amount (at most the unrecouped part: the hint is
 * the position's `remaining` and `forgiven` from the owner's balance under the label of the advance), the date from which
 * the income no longer recoups it (not before the advance), the basis document (`KIND_DOCUMENT_KINDS.forgiveness`, of the
 * owner, under the label of the advance) and a comment → ConfirmDialog → `POST /settlements/operations/:id/forgive`.
 * The refusals (`forgiveness_exceeds` with the unrecouped amount, `forgiveness_before_advance`) are the backend's toasts.
 */
export function ForgiveDialog(props: { advance: Operation; onClose: () => void }) {
  const adv = props.advance;
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [comment, setComment] = useState('');
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [confirm, setConfirm] = useState(false);
  // the unrecouped part of this advance: its position in the book of its label (a money read of the dialog, once)
  const balance = useQuery({ ...ownerQueries.balance(adv.ownerId ?? '', {}, adv.labelId ?? ''), enabled: adv.ownerId !== null });
  const position = balance.data?.positions.find((p) => p.operationId === adv.id);
  const run = useAction(
    () => api.settlements.forgive(adv.id, { amount: amount.trim(), date, documentId: doc?.id ?? '', comment: comment.trim() }),
    { invalidate: 'all', success: (o) => fmt(t.toast, { amount: formatMoney(centsToText(o.amountCents)) }) },
  );
  const filled = AMOUNT.test(amount.trim()) && date !== '' && doc !== null && comment.trim() !== '';
  const advanceLine = fmt(t.lines.advance, {
    amount: formatMoney(centsToText(adv.amountCents)),
    date: adv.date,
    pseudonym: adv.pseudonym ? ` · ${adv.pseudonym}` : '',
  });
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.title}
        subtitle={t.subtitle}
        footer={
          <ActionButton
            name="forgive-submit"
            op="POST /settlements/operations/:id/forgive"
            isDisabled={!filled}
            reason={filled ? undefined : doc ? ru.actions.hints.fillFields : ru.actions.hints.pickFirst}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {t.submit}
          </ActionButton>
        }
      >
        <div className="text-sm">{advanceLine}</div>
        <div className="flex flex-wrap gap-4 text-sm" data-testid="forgive-position">
          <span data-col="remaining">
            {t.unrecouped}
            <Money value={position?.remaining} />
          </span>
          <span data-col="forgiven">
            {t.forgiven}
            <Money value={position?.forgiven} />
          </span>
        </div>
        <TextField name="forgive-amount" label={t.amount} value={amount} onChange={setAmount} isRequired placeholder="10.00" />
        <DateField name="forgive-date" label={t.date} value={date} onChange={setDate} isRequired />
        <div data-testid="field-forgive-document">
          <DocumentStep
            kinds={KIND_DOCUMENT_KINDS.forgiveness}
            ownerId={adv.ownerId}
            labelId={adv.labelId ?? undefined}
            defaultTitle={`${t.defaultTitle} ${adv.ownerName ?? ''}`.trim()}
            ready={doc}
            onReady={setDoc}
          />
        </div>
        <TextField name="forgive-comment" label={t.comment} value={comment} onChange={setComment} isRequired />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.confirmTitle}
        lines={[
          advanceLine,
          fmt(t.lines.amount, { amount: AMOUNT.test(amount.trim()) ? formatMoney(amount.trim()) : amount, date }),
          fmt(t.lines.document, { title: doc?.title ?? '' }),
        ]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}
