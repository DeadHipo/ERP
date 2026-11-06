import { useState } from 'react';
import type { z } from 'zod';
import type { scopeSchema } from '@erp/shared/api-schemas';
import type { Operation, OwnerDetail } from '@erp/shared/api-responses';
import { KIND_DIRECTION, KIND_DOCUMENT_KINDS, KIND_SIGN, KIND_WITH_SCOPE, type OperationKind } from '@erp/shared/operation-kinds';
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
const k = ru.operations.kind;
type ScopeKind = z.output<typeof scopeSchema>['kind'];
const SCOPES: readonly ScopeKind[] = ['any', 'master', 'publishing', 'master_publishing', 'isrcs'];
const AMOUNT = /^\d+(\.\d{1,2})?$/;

/** The kinds the dialog records (D-173): a payout is the button, a return and a forgiveness are actions of a row. */
export const DIALOG_KINDS = ['advance', 'deduction', 'credit', 'buyout', 'writeoff', 'adjustment'] as const satisfies readonly OperationKind[];
type Kind = (typeof DIALOG_KINDS)[number];
/** The kinds of a pseudonym (the position or the credit is the pseudonym's); the others are the owner's (D-173 §1.1). */
const ARTIST_KINDS: readonly Kind[] = ['advance', 'deduction', 'credit'];
const hasScope = (kind: Kind) => (KIND_WITH_SCOPE as readonly string[]).includes(kind);

/**
 * «Операция» (17 §6, D-173): the kind first (`field-op-kind`), then the fields of that kind from the shared rule lists
 * (`@erp/shared/operation-kinds`): the pseudonym of an advance, deduction or credit, the owner of the others; the recoup
 * scope of an advance (required) or a deduction (`none` = no scope); the sign of an adjustment (`field-op-sign`; the sign
 * of the other kinds is fixed, the amount is typed without it); the area of the book (a write-off is publishing); the
 * basis document of the kinds of `KIND_DOCUMENT_KINDS` (pick or create + approve); an optional payment proof of an advance
 * or a buyout; comment → ConfirmDialog → `POST /settlements/operations` with the explicit `kind`. The backend decides.
 */
export function CreateOperationDialog(props: { detail: OwnerDetail; existing: Operation[]; onClose: () => void }) {
  const owner = props.detail.owner;
  const [kind, setKind] = useState<Kind>('advance');
  const [amount, setAmount] = useState('');
  const [sign, setSign] = useState<'plus' | 'minus'>('plus');
  const [artistId, setArtistId] = useState<string | null>(props.detail.artists[0]?.id ?? null);
  const [date, setDate] = useState('');
  const [scope, setScope] = useState<ScopeKind | 'none'>('any');
  const [area, setArea] = useState<'master' | 'publishing'>('master');
  const [isrcs, setIsrcs] = useState('');
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [proof, setProof] = useState<{ id: string; label: string } | null>(null);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  // the operation belongs to an own label (D-168): the switch of the header is the default
  const { labelId, setLabelId, labelName } = useLabelChoice();

  const direction = KIND_DIRECTION[kind];
  const ofArtist = ARTIST_KINDS.includes(kind);
  const scoped = hasScope(kind);
  const bookArea = kind === 'writeoff' ? 'publishing' : area;
  const minus = KIND_SIGN[kind] === '-' || (KIND_SIGN[kind] === '±' && sign === 'minus');
  const typed = amount.trim();
  // the amount as the API takes it: the operator types it without a sign, the kind (or the adjustment's choice) gives it
  const signed = minus ? `-${typed}` : typed;
  const isrcList = isrcs
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const scopeBody = !scoped || scope === 'none' ? null : scope === 'isrcs' ? { kind: scope, isrcs: isrcList } : { kind: scope };
  const run = useAction(
    () =>
      api.settlements.create({
        kind,
        direction,
        amount: signed,
        ...(ofArtist ? { artistId } : { ownerId: owner.id }),
        date,
        scope: scopeBody,
        documentId: doc?.id ?? null,
        paymentProofId: direction === 'out' ? (proof?.id ?? null) : null,
        comment: comment.trim(),
        labelId,
        area: bookArea,
      }),
    {
      invalidate: 'all',
      success: (o) =>
        fmt(t.createToast, { meaning: statusLabel('operationKind', o.kind), amount: formatMoney(centsToText(o.amountCents)) }),
    },
  );
  const pseudonym = props.detail.artists.find((x) => x.id === artistId)?.pseudonym ?? '';
  const scopeLabel = scope === 'isrcs' ? `${t.scopes.isrcs}: ${isrcList.join(', ')}` : t.scopes[scope];
  const filled =
    AMOUNT.test(typed) &&
    (!ofArtist || artistId !== null) &&
    date !== '' &&
    comment.trim() !== '' &&
    doc !== null &&
    labelId !== '' &&
    (!scoped || scope !== 'isrcs' || isrcList.length > 0);
  // The dialog warns when an equal operation exists with this date (17 §6): same kind, pseudonym or owner, date and the
  // same formatted amount (both are texts of the API / the operator; nothing is computed).
  const sameToday =
    filled &&
    props.existing.some(
      (o) =>
        o.active &&
        o.kind === kind &&
        (ofArtist ? o.artistId === artistId : o.ownerId === owner.id) &&
        o.date === date &&
        formatMoney(centsToText(o.amountCents)) === formatMoney(signed),
    );
  const scopes = kind === 'advance' ? SCOPES : (['none', ...SCOPES] as const);
  const changeKind = (v: string) => {
    const next = DIALOG_KINDS.find((x) => x === v) ?? kind;
    setKind(next);
    setDoc(null);
    setScope(next === 'advance' ? 'any' : 'none');
    if (KIND_DIRECTION[next] === 'in') setProof(null);
  };

  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.createTitle}
        subtitle={t.createSubtitle}
        footer={
          <ActionButton
            name="operation-submit" op="POST /settlements/operations"
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
          name="op-kind"
          label={k.field}
          value={kind}
          onChange={changeKind}
          options={DIALOG_KINDS.map((x) => ({ id: x, label: statusLabel('operationKind', x) }))}
        />
        <p className="text-xs text-muted" data-testid="op-kind-hint" data-kind={kind}>
          {k.hints[kind]}
        </p>
        {KIND_SIGN[kind] === '±' ? (
          <SelectField
            name="op-sign"
            label={k.signField}
            value={sign}
            onChange={(v) => setSign(v === 'minus' ? 'minus' : 'plus')}
            options={[
              { id: 'plus', label: k.signs.plus },
              { id: 'minus', label: k.signs.minus },
            ]}
          />
        ) : null}
        <TextField name="op-amount" label={k.amount} value={amount} onChange={setAmount} isRequired placeholder="40.00" />
        {ofArtist ? (
          <SelectField
            name="op-artist"
            label={t.artist}
            value={artistId}
            onChange={setArtistId}
            options={props.detail.artists.map((x) => ({ id: x.id, label: x.pseudonym }))}
          />
        ) : null}
        <DateField name="op-date" label={t.date} value={date} onChange={setDate} isRequired />
        <LabelField name="op-label" label={t.label} value={labelId} onChange={setLabelId} isRequired />
        {kind === 'writeoff' ? (
          <div className="text-sm" data-testid="op-area-fixed">
            {k.area}: {k.areas.publishing}
          </div>
        ) : (
          <SelectField
            name="op-area"
            label={k.area}
            value={area}
            onChange={(v) => setArea(v === 'publishing' ? 'publishing' : 'master')}
            options={[
              { id: 'master', label: k.areas.master },
              { id: 'publishing', label: k.areas.publishing },
            ]}
          />
        )}
        {scoped ? (
          <SelectField
            name="op-scope"
            label={t.scope}
            value={scope}
            onChange={(v) => setScope(scopes.find((s) => s === v) ?? scope)}
            options={scopes.map((s) => ({ id: s, label: t.scopes[s] }))}
          />
        ) : null}
        {scoped && scope === 'isrcs' ? <TextField name="op-isrcs" label={t.isrcs} value={isrcs} onChange={setIsrcs} isRequired /> : null}
        <DocumentStep
          key={kind}
          kinds={KIND_DOCUMENT_KINDS[kind]}
          ownerId={owner.id}
          labelId={labelId}
          defaultTitle={`${statusLabel('operationKind', kind)}: основание ${owner.name}`}
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
          fmt(k.lines.kind, { kind: statusLabel('operationKind', kind) }),
          fmt(t.createLines.amount, { amount: AMOUNT.test(typed) ? formatMoney(signed) : signed }),
          ofArtist ? fmt(t.createLines.artist, { pseudonym }) : fmt(k.lines.owner, { owner: owner.name }),
          ...(scoped ? [fmt(t.createLines.scope, { scope: scopeLabel })] : []),
          fmt(k.lines.area, { area: k.areas[bookArea] }),
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
