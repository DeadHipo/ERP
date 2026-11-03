import { useState } from 'react';
import type { AdView } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { ActionButton } from '../../components/ActionButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormDialog } from '../../components/FormDialog';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { formatMoney } from '../../lib/money';
import { fmt, ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';

const t = ru.ads;
export const AD_SCOPES = ['any', 'publishing', 'isrc'] as const;
export type AdScopeKind = (typeof AD_SCOPES)[number];
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const PERCENT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISRC = /^[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}$/;

const scopeOf = (v: string): AdScopeKind => AD_SCOPES.find((s) => s === v) ?? 'any';
const expenseLine = (ad: AdView) =>
  fmt(t.edit.lines.expense, { month: ad.month, isrc: ad.isrc ?? '—', amount: formatMoney(centsToText(ad.amountCents)) });

/** «Добавить расход»: one record (ISRC, month, amount, recovery %, scope, comment) → ConfirmDialog → `POST /ads`. */
export function CreateAdDialog(props: { onClose: () => void }) {
  const [isrc, setIsrc] = useState('');
  const [month, setMonth] = useState('');
  const [amount, setAmount] = useState('');
  const [percent, setPercent] = useState('100');
  const [scope, setScope] = useState<AdScopeKind>('any');
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  const run = useAction(
    () =>
      api.ads.create({
        items: [
          {
            isrc: isrc.trim(),
            month: month.trim(),
            amount: amount.trim(),
            recoveryPercent: percent.trim(),
            scope,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          },
        ],
      }),
    {
      invalidate: 'all',
      success: (r) =>
        r.created[0] ? fmt(t.create.toast, { amount: formatMoney(centsToText(r.created[0].amountCents)) }) : t.create.skippedToast,
    },
  );
  const filled =
    ISRC.test(isrc.trim()) && MONTH.test(month.trim()) && AMOUNT.test(amount.trim()) && PERCENT.test(percent.trim());
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.create.title}
        subtitle={t.create.subtitle}
        footer={
          <ActionButton
            name="ad-create-submit"
            isDisabled={!filled}
            reason={filled ? undefined : ru.actions.hints.fillFields}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {t.create.submit}
          </ActionButton>
        }
      >
        <TextField name="ad-isrc" label={t.create.isrc} value={isrc} onChange={setIsrc} isRequired />
        <TextField name="ad-month" label={t.create.month} value={month} onChange={setMonth} isRequired placeholder="2026-10" />
        <TextField name="ad-amount" label={t.create.amount} value={amount} onChange={setAmount} isRequired placeholder="40.00" />
        <TextField name="ad-percent" label={t.create.percent} value={percent} onChange={setPercent} isRequired />
        <SelectField
          name="ad-scope"
          label={t.create.scope}
          value={scope}
          onChange={(v) => setScope(scopeOf(v))}
          options={AD_SCOPES.map((s) => ({ id: s, label: t.scopes[s] }))}
        />
        <TextField name="ad-comment" label={t.create.comment} value={comment} onChange={setComment} />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.create.confirmTitle}
        lines={[
          fmt(t.create.lines.isrc, { isrc: isrc.trim().toUpperCase() }),
          fmt(t.create.lines.month, { month: month.trim() }),
          fmt(t.create.lines.amount, { amount: AMOUNT.test(amount.trim()) ? formatMoney(amount.trim()) : amount }),
          fmt(t.create.lines.percent, { percent: percent.trim() }),
          fmt(t.create.lines.scope, { scope: t.scopes[scope] }),
        ]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

/** «Процент и область»: `PATCH /ads/:id` after a confirmation that says the balances are recalculated. */
export function EditAdDialog(props: { ad: AdView; onClose: () => void }) {
  const ad = props.ad;
  const [percent, setPercent] = useState(ad.recoveryPercent);
  const [scope, setScope] = useState<AdScopeKind>(ad.scope);
  const [confirm, setConfirm] = useState(false);
  const run = useAction(() => api.ads.update(ad.id, { recoveryPercent: percent.trim(), scope }), {
    invalidate: 'all',
    success: () => t.edit.toast,
  });
  const scopes = ad.isrc ? AD_SCOPES : AD_SCOPES.filter((s) => s !== 'isrc');
  const filled = PERCENT.test(percent.trim());
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.edit.title}
        footer={
          <ActionButton name="ad-edit-submit" isDisabled={!filled} isPending={run.isPending} onPress={() => setConfirm(true)}>
            {t.edit.submit}
          </ActionButton>
        }
      >
        <div className="text-sm">{expenseLine(ad)}</div>
        <TextField name="ad-edit-percent" label={t.edit.percent} value={percent} onChange={setPercent} isRequired />
        <SelectField
          name="ad-edit-scope"
          label={t.edit.scope}
          value={scope}
          onChange={(v) => setScope(scopeOf(v))}
          options={scopes.map((s) => ({ id: s, label: t.scopes[s] }))}
        />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.edit.confirmTitle}
        lines={[
          expenseLine(ad),
          fmt(t.edit.lines.percent, { from: ad.recoveryPercent, to: percent.trim() }),
          fmt(t.edit.lines.scope, { from: t.scopes[ad.scope], to: t.scopes[scope] }),
          t.edit.lines.recalc,
        ]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

/** «Отменить»: a reason, then `POST /ads/:id/deactivate`. */
export function DeactivateAdDialog(props: { ad: AdView; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const run = useAction(() => api.ads.deactivate(props.ad.id, { reason: reason.trim() }), {
    invalidate: 'all',
    success: () => t.deactivate.toast,
  });
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.deactivate.title}
        footer={
          <ActionButton
            name="ad-deactivate-submit"
            variant="danger"
            isDisabled={reason.trim() === ''}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {t.deactivate.submit}
          </ActionButton>
        }
      >
        <div className="text-sm">{expenseLine(props.ad)}</div>
        <TextField name="ad-deactivate-reason" label={t.deactivate.reason} value={reason} onChange={setReason} isRequired />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.deactivate.title}
        lines={[
          expenseLine(props.ad),
          fmt(t.deactivate.lines.reason, { reason: reason.trim() }),
          t.deactivate.lines.irreversible,
        ]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}
