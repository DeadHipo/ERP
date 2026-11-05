import { useState } from 'react';
import type { z } from 'zod';
import type { scopeSchema } from '@erp/shared/api-schemas';
import type { Operation, OwnerDetail } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { ActionButton } from '../../components/ActionButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormDialog } from '../../components/FormDialog';
import { statusLabel } from '../../components/StatusChip';
import { DateField } from '../../components/fields/DateField';
import { EntityPicker } from '../../components/fields/EntityPicker';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { formatMoney } from '../../lib/money';
import { LabelField, useLabelChoice } from '../../components/fields/LabelField';
import { fmt, ru } from '../../i18n/ru';
import { DocumentStep, type ReadyDocument } from '../work/actions/DocumentStep';
import { centsToText } from '../owners/components/cents';

const t = ru.money.actions;
type ScopeKind = z.output<typeof scopeSchema>['kind'];
const OUT_SCOPES: readonly ScopeKind[] = ['any', 'master', 'publishing', 'master_publishing', 'isrcs'];
const AMOUNT = /^-?\d+(\.\d{1,2})?$/;

/**
 * «Аванс / вычет / кредит» (17 §6): direction, amount, pseudonym of the owner, date, scope (an advance always has
 * one: a payout of earned money is the payout button, so the form has no "out without scope"), the basis document
 * (pick or create + approve), an optional payment proof, comment → ConfirmDialog → `POST /settlements/operations`.
 */
export function CreateOperationDialog(props: { detail: OwnerDetail; existing: Operation[]; onClose: () => void }) {
  const owner = props.detail.owner;
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [artistId, setArtistId] = useState<string | null>(props.detail.artists[0]?.id ?? null);
  const [date, setDate] = useState('');
  const [scope, setScope] = useState<ScopeKind | 'none'>('any');
  const [isrcs, setIsrcs] = useState('');
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [proof, setProof] = useState<{ id: string; label: string } | null>(null);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  // the operation belongs to an own label (D-168): the switch of the header is the default
  const { labelId, setLabelId, labelName } = useLabelChoice();

  const isrcList = isrcs
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const scopeBody = scope === 'none' ? null : scope === 'isrcs' ? { kind: scope, isrcs: isrcList } : { kind: scope };
  const run = useAction(
    () =>
      api.settlements.create({
        direction,
        amount: amount.trim(),
        artistId,
        date,
        scope: scopeBody,
        documentId: doc?.id ?? null,
        paymentProofId: direction === 'out' ? (proof?.id ?? null) : null,
        comment: comment.trim(),
        labelId,
      }),
    {
      invalidate: 'all',
      success: (o) =>
        fmt(t.createToast, { meaning: statusLabel('operationMeaning', o.meaning), amount: formatMoney(centsToText(o.amountCents)) }),
    },
  );
  const pseudonym = props.detail.artists.find((x) => x.id === artistId)?.pseudonym ?? '';
  const scopeLabel = scope === 'isrcs' ? `${t.scopes.isrcs}: ${isrcList.join(', ')}` : t.scopes[scope];
  const filled =
    AMOUNT.test(amount.trim()) &&
    artistId !== null &&
    date !== '' &&
    comment.trim() !== '' &&
    doc !== null &&
    labelId !== '' &&
    (scope !== 'isrcs' || isrcList.length > 0);
  // The dialog warns when an equal operation exists with this date (17 §6): same direction, pseudonym, date and the
  // same formatted amount (both are texts of the API / the operator; nothing is computed).
  const sameToday =
    filled &&
    props.existing.some(
      (o) =>
        o.active &&
        o.direction === direction &&
        o.artistId === artistId &&
        o.date === date &&
        formatMoney(centsToText(o.amountCents)) === formatMoney(amount.trim()),
    );
  const scopes = direction === 'out' ? OUT_SCOPES : (['none', ...OUT_SCOPES] as const);

  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.createTitle}
        subtitle={t.createSubtitle}
        footer={
          <ActionButton
            name="operation-submit"
            isDisabled={!filled}
            reason={filled ? undefined : doc ? ru.actions.hints.fillFields : ru.actions.hints.pickFirst}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {t.submit}
          </ActionButton>
        }
      >
        <div className="text-sm">
          {ru.actions.fields.owner}: <b>{owner.name}</b>
        </div>
        <SelectField
          name="op-direction"
          label={t.direction}
          value={direction}
          onChange={(v) => {
            const d = v === 'in' ? 'in' : 'out';
            setDirection(d);
            setDoc(null);
            if (d === 'out' && scope === 'none') setScope('any');
            if (d === 'in') setScope('none');
          }}
          options={[
            { id: 'out', label: ru.money.operations.direction.out },
            { id: 'in', label: ru.money.operations.direction.in },
          ]}
        />
        <TextField name="op-amount" label={t.amount} value={amount} onChange={setAmount} isRequired placeholder="40.00" />
        <SelectField
          name="op-artist"
          label={t.artist}
          value={artistId}
          onChange={setArtistId}
          options={props.detail.artists.map((x) => ({ id: x.id, label: x.pseudonym }))}
        />
        <DateField name="op-date" label={t.date} value={date} onChange={setDate} isRequired />
        <LabelField name="op-label" label={t.label} value={labelId} onChange={setLabelId} isRequired />
        <SelectField
          name="op-scope"
          label={t.scope}
          value={scope}
          onChange={(v) => setScope(scopes.find((s) => s === v) ?? scope)}
          options={scopes.map((s) => ({ id: s, label: t.scopes[s] }))}
        />
        {scope === 'isrcs' ? <TextField name="op-isrcs" label={t.isrcs} value={isrcs} onChange={setIsrcs} isRequired /> : null}
        <DocumentStep
          key={direction}
          kinds={direction === 'out' ? ['advance_basis', 'contract'] : ['adjustment_basis', 'contract', 'other']}
          ownerId={owner.id}
          defaultTitle={`${direction === 'out' ? 'Основание аванса' : 'Основание корректировки'} ${owner.name}`}
          ready={doc}
          onReady={setDoc}
        />
        {direction === 'out' ? (
          <EntityPicker
            name="op-proof"
            label={t.proofDoc}
            kind="documents"
            value={proof?.id ?? null}
            accept={(i) => i.kind === 'payment_proof'}
            onChange={(id, label) => setProof(id ? { id, label } : null)}
          />
        ) : null}
        <TextField name="op-comment" label={t.comment} value={comment} onChange={setComment} isRequired />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.createConfirmTitle}
        lines={[
          fmt(t.createLines.direction, { direction: ru.money.operations.direction[direction] }),
          fmt(t.createLines.amount, { amount: AMOUNT.test(amount.trim()) ? formatMoney(amount.trim()) : amount }),
          fmt(t.createLines.artist, { pseudonym }),
          fmt(t.createLines.scope, { scope: scopeLabel }),
          fmt(t.createLines.document, { title: doc?.title ?? '' }),
          fmt(t.createLines.label, { label: labelName }),
          ...(sameToday ? [t.createLines.sameToday] : []),
        ]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}
