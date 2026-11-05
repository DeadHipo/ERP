import { useState } from 'react';
import type { AdView } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { ActionButton } from '../../components/ActionButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormDialog } from '../../components/FormDialog';
import { EntityPicker } from '../../components/fields/EntityPicker';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { formatMoney } from '../../lib/money';
import { LabelField, useLabelChoice } from '../../components/fields/LabelField';
import { fmt, ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';
import { SimpleTable, Td } from '../owners/components/Fact';
import { parseBatch } from './parse-batch';

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

type Target = 'split' | 'artist';

/**
 * «Добавить расход»: one record → ConfirmDialog → `POST /ads`. By the split of an ISRC, or whole on one pseudonym (the
 * ISRC is then optional). `isrc` / `artistId` preset the dialog when it opens from a track or a pseudonym.
 */
export function CreateAdDialog(props: { onClose: () => void; isrc?: string; artistId?: string; pseudonym?: string }) {
  const [target, setTarget] = useState<Target>(props.artistId ? 'artist' : 'split');
  const [artist, setArtist] = useState<{ id: string; label: string } | null>(
    props.artistId ? { id: props.artistId, label: props.pseudonym ?? props.artistId } : null,
  );
  const [isrc, setIsrc] = useState(props.isrc ?? '');
  const [month, setMonth] = useState('');
  const [amount, setAmount] = useState('');
  const [percent, setPercent] = useState('100');
  const [scope, setScope] = useState<AdScopeKind>('any');
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  // a record without an ISRC belongs to an own label explicitly (D-168); the switch of the header is the default
  const { labelId, setLabelId, labelName } = useLabelChoice();
  const onArtist = target === 'artist';
  const typedIsrc = isrc.trim();
  const run = useAction(
    () =>
      api.ads.create({
        items: [
          {
            ...(typedIsrc ? { isrc: typedIsrc } : {}),
            ...(onArtist && artist ? { artistId: artist.id } : {}),
            month: month.trim(),
            amount: amount.trim(),
            recoveryPercent: percent.trim(),
            scope,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
            ...(labelId ? { labelId } : {}),
          },
        ],
      }),
    {
      invalidate: 'all',
      success: (r) =>
        r.created[0] ? fmt(t.create.toast, { amount: formatMoney(centsToText(r.created[0].amountCents)) }) : t.create.skippedToast,
    },
  );
  const whoOk = onArtist ? artist !== null && (typedIsrc === '' || ISRC.test(typedIsrc)) : ISRC.test(typedIsrc);
  const scopeOk = scope !== 'isrc' || ISRC.test(typedIsrc);
  const labelOk = typedIsrc !== '' || labelId !== '';
  const filled = whoOk && scopeOk && labelOk && MONTH.test(month.trim()) && AMOUNT.test(amount.trim()) && PERCENT.test(percent.trim());
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
        <SelectField
          name="ad-target"
          label={t.create.target}
          value={target}
          onChange={(v) => setTarget(v === 'artist' ? 'artist' : 'split')}
          options={[
            { id: 'split', label: t.create.targets.split },
            { id: 'artist', label: t.create.targets.artist },
          ]}
        />
        {onArtist ? (
          <EntityPicker
            name="ad-artist"
            label={t.create.artist}
            kind="artists"
            value={artist?.id ?? null}
            onChange={(id, label) => setArtist(id ? { id, label } : null)}
          />
        ) : null}
        <TextField
          name="ad-isrc"
          label={onArtist ? t.create.isrcOptional : t.create.isrc}
          value={isrc}
          onChange={setIsrc}
          isRequired={!onArtist}
        />
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
        <span className="text-xs text-muted">{t.create.scopeHint}</span>
        <LabelField name="ad-label" label={t.create.label} value={labelId} onChange={setLabelId} isRequired={typedIsrc === ''} />
        <span className="text-xs text-muted">{t.create.labelHint}</span>
        <TextField name="ad-comment" label={t.create.comment} value={comment} onChange={setComment} />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.create.confirmTitle}
        lines={[
          ...(onArtist && artist ? [fmt(t.create.lines.artist, { pseudonym: artist.label })] : []),
          ...(typedIsrc ? [fmt(t.create.lines.isrc, { isrc: typedIsrc.toUpperCase() })] : []),
          fmt(t.create.lines.month, { month: month.trim() }),
          fmt(t.create.lines.amount, { amount: AMOUNT.test(amount.trim()) ? formatMoney(amount.trim()) : amount }),
          fmt(t.create.lines.percent, { percent: percent.trim() }),
          fmt(t.create.lines.scope, { scope: t.scopes[scope] }),
          ...(labelId ? [fmt(t.create.lines.label, { label: labelName })] : []),
        ]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

const PREVIEW_ROWS = 100;

/** «Добавить списком»: pasted lines checked in place → ConfirmDialog → one `POST /ads` (a known link is skipped). */
export function BatchAdDialog(props: { onClose: () => void }) {
  const b = t.batch;
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(false);
  const rows = parseBatch(text);
  const good = rows.filter((r) => r.error === null);
  const bad = rows.filter((r) => r.error !== null);
  const run = useAction(
    () =>
      api.ads.create({
        items: good.map((r) => ({
          isrc: r.isrc,
          month: r.month,
          amount: r.amount,
          recoveryPercent: r.recoveryPercent,
          source: 'batch',
          ...(r.externalRef ? { externalRef: r.externalRef } : {}),
          ...(r.comment ? { comment: r.comment } : {}),
        })),
      }),
    {
      invalidate: 'all',
      success: (r) => fmt(b.toast, { created: r.created.length, skipped: r.skipped.length }),
    },
  );
  const ready = good.length > 0 && bad.length === 0;
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={b.title}
        subtitle={b.subtitle}
        footer={
          <ActionButton
            name="ad-batch-submit"
            isDisabled={!ready}
            reason={ready ? undefined : ru.actions.hints.fillFields}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {b.submit}
          </ActionButton>
        }
      >
        <label className="flex flex-col gap-1 text-sm">
          {b.text}
          <textarea
            data-testid="field-ad-batch"
            className="min-h-32 rounded-lg border border-border bg-transparent p-2 font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'QZTST2600001;2026-10;40.00;100;https://…;промо'}
          />
        </label>
        {rows.length > 0 ? (
          <div className="flex flex-col gap-1 text-sm">
            <span data-testid="ad-batch-counts">
              {fmt(b.good, { n: good.length })} · <span className={bad.length > 0 ? 'text-danger' : ''}>{fmt(b.bad, { n: bad.length })}</span>
            </span>
            <SimpleTable head={[b.cols.line, b.cols.isrc, b.cols.month, b.cols.amount, b.cols.percent, b.cols.error]} testId="ad-batch-preview">
              {[...bad, ...good].slice(0, PREVIEW_ROWS).map((r) => (
                <tr key={r.line} data-testid={`ad-batch-row-${r.line}`}>
                  <Td>{r.line}</Td>
                  <Td>{r.isrc}</Td>
                  <Td>{r.month}</Td>
                  <Td>{r.amount}</Td>
                  <Td>{r.recoveryPercent}</Td>
                  <Td>{r.error ? <span className="text-danger">{b.errors[r.error]}</span> : b.ok}</Td>
                </tr>
              ))}
            </SimpleTable>
          </div>
        ) : null}
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={b.confirmTitle}
        lines={[fmt(b.lines.count, { n: good.length }), b.lines.effect]}
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
