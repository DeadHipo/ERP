import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Operation } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { settlementQueries } from '../../api/queries/settlements';
import { ActionButton } from '../../components/ActionButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EntityLink } from '../../components/EntityLink';
import { FormDialog } from '../../components/FormDialog';
import { Money } from '../../components/Money';
import { QueryView } from '../../components/PageState';
import { statusLabel } from '../../components/StatusChip';
import { DateField } from '../../components/fields/DateField';
import { TextField } from '../../components/fields/TextField';
import { formatMoney } from '../../lib/money';
import { fmt, ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';
import { SimpleTable, Td } from '../owners/components/Fact';

const t = ru.money.actions;

/** The dialog of one row action, opened by the grid (P10 Операции and P20 share it). */
export type OperationAction = { action: 'proof' | 'deactivate' | 'return' | 'snapshot'; op: Operation };

const amountText = (op: Operation) => formatMoney(centsToText(op.amountCents));
const opLine = (op: Operation) =>
  fmt(t.confirmLines.operation, { meaning: statusLabel('operationMeaning', op.meaning), amount: amountText(op), date: op.date });

/**
 * The buttons of an operation row. Which buttons a row shows follows its fields (an inactive operation has none, a
 * proof is for an active payout without one, a return and the snapshot are for a payout); whether the write is
 * accepted is the backend's answer, shown as it is.
 */
export function OperationButtons(props: { op: Operation; open: (a: OperationAction) => void }) {
  const op = props.op;
  const deferred = useAction((value: boolean) => api.settlements.deferred(op.id, { deferred: value }), {
    invalidate: 'all',
    success: (o) => fmt(t.deferredToast, { value: o.deferred ? ru.common.yes : ru.common.no }),
  });
  const out = op.direction === 'out';
  const payout = op.meaning === 'payout';
  return (
    <div className="flex flex-nowrap items-center gap-1">
      {op.active && out && !op.paymentProofId ? (
        <ActionButton name="proof" variant="secondary" onPress={() => props.open({ action: 'proof', op })}>
          {t.proof}
        </ActionButton>
      ) : null}
      {op.active && out ? (
        <ActionButton name="deferred" variant="secondary" isPending={deferred.isPending} onPress={() => deferred.mutate(!op.deferred)}>
          {op.deferred ? t.deferredOff : t.deferredOn}
        </ActionButton>
      ) : null}
      {op.active && payout ? (
        <ActionButton name="return" variant="secondary" onPress={() => props.open({ action: 'return', op })}>
          {t.returnPayout}
        </ActionButton>
      ) : null}
      {op.active ? (
        <ActionButton name="deactivate" variant="danger" onPress={() => props.open({ action: 'deactivate', op })}>
          {t.deactivate}
        </ActionButton>
      ) : null}
      {payout && !op.migration ? (
        <ActionButton name="snapshot" write={false} variant="tertiary" onPress={() => props.open({ action: 'snapshot', op })}>
          {t.snapshot}
        </ActionButton>
      ) : null}
    </div>
  );
}

export function OperationActionHost(props: { active: OperationAction; onClose: () => void }) {
  const { op, action } = props.active;
  switch (action) {
    case 'proof':
      return <ProofDialog op={op} onClose={props.onClose} />;
    case 'deactivate':
      return <DeactivateDialog op={op} onClose={props.onClose} />;
    case 'return':
      return <ReturnDialog op={op} onClose={props.onClose} />;
    case 'snapshot':
      return <SnapshotDialog op={op} onClose={props.onClose} />;
  }
}

function ProofDialog(props: { op: Operation; onClose: () => void }) {
  const [fileRef, setFileRef] = useState('');
  const [title, setTitle] = useState('');
  const run = useAction(
    () => api.settlements.proof(props.op.id, { fileRef: fileRef.trim(), title: title.trim() || undefined }),
    { invalidate: 'all', success: (o) => fmt(t.proofToast, { date: o.date }) },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.proofTitle}
      subtitle={t.proofSubtitle}
      footer={
        <ActionButton
          name="proof-submit"
          isDisabled={fileRef.trim() === ''}
          isPending={run.isPending}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.proof}
        </ActionButton>
      }
    >
      <div className="text-sm">{opLine(props.op)}</div>
      <TextField name="proof-file" label={t.fileRef} value={fileRef} onChange={setFileRef} isRequired />
      <TextField name="proof-title" label={t.proofTitleField} value={title} onChange={setTitle} />
    </FormDialog>
  );
}

function DeactivateDialog(props: { op: Operation; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const run = useAction(
    () => api.settlements.deactivate(props.op.id, { reason: reason.trim(), transferFailed: failed || undefined }),
    { invalidate: 'all', success: () => t.deactivateToast },
  );
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.deactivateTitle}
        footer={
          <ActionButton name="deactivate-submit" variant="danger" isDisabled={reason.trim() === ''} isPending={run.isPending} onPress={() => setConfirm(true)}>
            {t.deactivate}
          </ActionButton>
        }
      >
        <div className="text-sm">{opLine(props.op)}</div>
        <TextField name="deactivate-reason" label={t.reason} value={reason} onChange={setReason} isRequired />
        {props.op.meaning === 'payout' ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid="field-transfer-failed" checked={failed} onChange={(e) => setFailed(e.target.checked)} />
            {t.transferFailed}
          </label>
        ) : null}
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.deactivateTitle}
        lines={[
          opLine(props.op),
          fmt(t.confirmLines.reason, { reason: reason.trim() }),
          ...(failed ? [t.confirmLines.transferFailed] : []),
          t.confirmLines.irreversible,
        ]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

function ReturnDialog(props: { op: Operation; onClose: () => void }) {
  const [fileRef, setFileRef] = useState('');
  const [date, setDate] = useState(props.op.date);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  const run = useAction(
    () => api.settlements.returnPayout(props.op.id, { fileRef: fileRef.trim(), date, comment: comment.trim() }),
    { invalidate: 'all', success: (o) => fmt(t.returnToast, { amount: formatMoney(centsToText(o.amountCents)) }) },
  );
  const filled = fileRef.trim() !== '' && date !== '' && comment.trim() !== '';
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.returnTitle}
        footer={
          <ActionButton name="return-submit" isDisabled={!filled} isPending={run.isPending} onPress={() => setConfirm(true)}>
            {t.returnPayout}
          </ActionButton>
        }
      >
        <div className="text-sm">{opLine(props.op)}</div>
        <TextField name="return-file" label={t.fileRef} value={fileRef} onChange={setFileRef} isRequired />
        <DateField name="return-date" label={t.returnDate} value={date} onChange={setDate} isRequired />
        <TextField name="return-comment" label={t.returnComment} value={comment} onChange={setComment} isRequired />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.returnTitle}
        lines={[
          fmt(t.confirmLines.returnOf, { amount: amountText(props.op), date: props.op.date }),
          fmt(t.confirmLines.returnDate, { date }),
          t.confirmLines.irreversible,
        ]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

/** The snapshot stored with a button payout (N15), as per-artist rows. */
function SnapshotDialog(props: { op: Operation; onClose: () => void }) {
  const query = useQuery(settlementQueries.snapshot(props.op.id));
  return (
    <FormDialog isOpen onOpenChange={(o) => (o ? null : props.onClose())} title={t.snapshotTitle} subtitle={opLine(props.op)}>
      <div data-testid="snapshot">
        <QueryView query={query}>
          {(s) => (
            <div className="flex flex-col gap-3 text-sm">
              <div>
                {t.snapshotWhen}: {s.computedAt}
              </div>
              <div data-testid="snapshot-amount">
                {t.snapshotAmount}: <Money value={centsToText(s.amountCents)} />
              </div>
              <div data-testid="snapshot-payable">
                {t.snapshotPayable}: <Money value={s.payableExact} />
              </div>
              <div className="font-medium">{t.snapshotByArtist}</div>
              <SimpleTable head={[ru.money.balance.pseudonym, ru.money.balance.net, t.snapshotShare]}>
                {s.payoutByArtist.map((p) => (
                  <tr key={p.key} data-testid={`snapshot-share-${p.key}`}>
                    <Td>{p.label}</Td>
                    <Td col="net">
                      <Money value={p.net} />
                    </Td>
                    <Td col="share">
                      <Money value={p.shareOfPayout} />
                    </Td>
                  </tr>
                ))}
              </SimpleTable>
              <div className="font-medium">{t.snapshotPerArtist}</div>
              <SimpleTable head={[ru.money.balance.pseudonym, ru.money.balance.earned, ru.money.owners.cols.recouped, ru.money.balance.unrecouped, ru.money.balance.waiting]}>
                {s.perArtist.map((p) => (
                  <tr key={p.artistId} data-testid={`snapshot-artist-${p.artistId}`}>
                    <Td>
                      <EntityLink kind="artist" id={p.artistId} label={p.pseudonym} />
                    </Td>
                    <Td col="earned">
                      <Money value={p.earned} />
                    </Td>
                    <Td col="recouped">
                      <Money value={p.recouped} />
                    </Td>
                    <Td col="unrecouped">
                      <Money value={p.unrecouped} />
                    </Td>
                    <Td col="waiting">
                      <Money value={p.waiting} />
                    </Td>
                  </tr>
                ))}
              </SimpleTable>
              <div className="text-muted">{fmt(t.snapshotFiles, { believe: s.files.believe.length, b17: s.files.b17.length })}</div>
            </div>
          )}
        </QueryView>
      </div>
    </FormDialog>
  );
}
