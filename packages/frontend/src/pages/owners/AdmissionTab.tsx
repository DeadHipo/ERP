import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Balance, Hold, OwnerDetail, Payee, PayoutAnswer } from '@erp/shared/api-responses';
import { ANSWER_DECISIONS, HOLD_KINDS, PAYEE_CHANNELS } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { settlementQueries } from '../../api/queries/settlements';
import { ActionButton } from '../../components/ActionButton';
import { FormDialog } from '../../components/FormDialog';
import { useOwnLabels } from '../../components/LabelSwitch';
import { Money } from '../../components/Money';
import { QueryView } from '../../components/PageState';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { fmt, ru } from '../../i18n/ru';
import { GateChip } from './OwnersPage';
import { centsToText } from './components/cents';
import { Section, SimpleTable, Td } from './components/Fact';
import { toInt } from '../reference/shared';

const t = ru.operations.admission;
const d = t.dialogs;
type Active =
  | { kind: 'payee' }
  | { kind: 'hold' }
  | { kind: 'answer' }
  | { kind: 'threshold' }
  | { kind: 'reason'; what: 'payee' | 'hold' | 'answer'; id: string };

/**
 * P10 Допуск (D-176, the owner's module 17): the payee and its channel, the holds (a decision, an artist's request, a
 * question, a disputed history item), the answers «pay» to the check of the first payout, the threshold of the
 * contract under the label; the gate of the balance beside them. One `GET /settlements/admission?ownerId=&active=false`
 * (not a money call); every write invalidates everything (the gate changes).
 */
export function AdmissionTab(props: { detail: OwnerDetail; balance: Balance | undefined; labelId: string }) {
  const ownerId = props.detail.owner.id;
  const list = useQuery(settlementQueries.admission({ ownerId, active: 'false' }));
  const [active, setActive] = useState<Active | null>(null);
  const own = useOwnLabels();
  const bookName = (id: string | null) => (id ? (own.find((l) => l.id === id)?.name ?? id) : d.everyBook);
  const adm = props.balance?.admission;
  const gate = props.balance?.payout;
  return (
    <div className="flex flex-col gap-4" data-testid="admission-tab" data-active={String(adm?.active ?? false)}>
      <p className="text-sm text-muted">{t.subtitle}</p>
      {adm && !adm.active ? (
        <p className="text-sm" data-testid="admission-inactive">
          {t.inactive}
        </p>
      ) : null}
      {gate ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="admission-gate" data-reason={gate.reason ?? ''}>
          <span>{t.gate}:</span>
          <GateChip allowed={gate.allowed} reason={gate.reason} />
          <Money value={centsToText(gate.amountCents)} />
          {adm ? <span className="text-xs text-muted">{adm.hadPayout ? t.hadPayout.yes : t.hadPayout.no}</span> : null}
        </div>
      ) : null}
      <QueryView query={list}>
        {(data) => {
          const payee = data.payees.find((p) => p.active) ?? null;
          return (
            <>
              <Section
                title={t.payee.title}
                testId="admission-payee"
                toolbar={
                  <ActionButton name="set-payee" op="POST /settlements/payees" variant="secondary" onPress={() => setActive({ kind: 'payee' })}>
                    {payee ? t.payee.replace : t.payee.set}
                  </ActionButton>
                }
              >
                {payee ? (
                  <SimpleTable head={[t.payee.cols.channel, t.payee.cols.ref, t.payee.cols.status, t.payee.cols.basis, t.payee.cols.validFrom, '']}>
                    <tr data-testid={`payee-${payee.id}`} data-channel={payee.channel}>
                      <Td col="channel">{t.channels[payee.channel]}</Td>
                      <Td col="ref">{payee.payeeRef ?? t.payee.byHistory}</Td>
                      <Td col="status">{t.payeeStatus[payee.status]}</Td>
                      <Td col="basis">{payee.basis}</Td>
                      <Td col="validFrom">{payee.validFrom}</Td>
                      <Td>
                        <ActionButton name="deactivate-payee" op="POST /settlements/payees/:id/deactivate" compact variant="secondary" onPress={() => setActive({ kind: 'reason', what: 'payee', id: payee.id })}>
                          {t.payee.deactivate}
                        </ActionButton>
                      </Td>
                    </tr>
                  </SimpleTable>
                ) : (
                  <span className="text-sm text-muted" data-testid="payee-none">
                    {t.payee.none}
                  </span>
                )}
              </Section>
              <Section
                title={t.holds.title}
                testId="admission-holds"
                toolbar={
                  <ActionButton name="create-hold" op="POST /settlements/holds" variant="secondary" onPress={() => setActive({ kind: 'hold' })}>
                    {t.holds.add}
                  </ActionButton>
                }
              >
                {data.holds.length === 0 ? (
                  <span className="text-sm text-muted" data-testid="holds-none">
                    {t.holds.none}
                  </span>
                ) : (
                  <SimpleTable head={[t.holds.cols.kind, t.holds.cols.blocks, t.holds.cols.reason, t.holds.cols.release, t.holds.cols.amount, t.holds.cols.period, t.holds.cols.reviewOn, t.holds.cols.since, t.holds.cols.label, t.holds.cols.status, '']}>
                    {data.holds.map((h) => (
                      <tr key={h.id} data-testid={`hold-${h.id}`} data-kind={h.kind} data-status={h.status} data-blocks={String(h.blocks)}>
                        <Td col="kind">{t.holdKinds[h.kind]}</Td>
                        <Td col="blocks">{h.blocks ? t.blocks.yes : t.blocks.no}</Td>
                        <Td col="reason">{h.reason}</Td>
                        <Td col="release">{h.releaseWhen ?? '—'}</Td>
                        <Td col="amount">{h.amountCents === null ? '—' : <Money value={centsToText(h.amountCents)} />}</Td>
                        <Td col="period">{h.period ?? '—'}</Td>
                        <Td col="reviewOn">{h.reviewOn ?? '—'}</Td>
                        <Td col="since">{h.since}</Td>
                        <Td col="label">{bookName(h.labelId)}</Td>
                        <Td col="status">{t.holdStatus[h.status]}{h.releasedReason ? ` · ${h.releasedReason}` : ''}</Td>
                        <Td>
                          {h.status === 'active' ? (
                            <ActionButton name={`release-hold-${h.id}`} op="POST /settlements/holds/:id/release" compact variant="secondary" onPress={() => setActive({ kind: 'reason', what: 'hold', id: h.id })}>
                              {t.holds.release}
                            </ActionButton>
                          ) : null}
                        </Td>
                      </tr>
                    ))}
                  </SimpleTable>
                )}
              </Section>
              <Section
                title={t.answers.title}
                testId="admission-answers"
                toolbar={
                  <ActionButton name="create-answer" op="POST /settlements/answers" variant="secondary" onPress={() => setActive({ kind: 'answer' })}>
                    {t.answers.add}
                  </ActionButton>
                }
              >
                {data.answers.length === 0 ? (
                  <span className="text-sm text-muted" data-testid="answers-none">
                    {t.answers.none}
                  </span>
                ) : (
                  <SimpleTable head={[t.answers.cols.due, t.answers.cols.decision, t.answers.cols.why, t.answers.cols.about, t.answers.cols.by, t.answers.cols.label, '']}>
                    {data.answers.map((a) => (
                      <tr key={a.id} data-testid={`answer-${a.id}`} data-active={String(a.active)} data-due={a.dueCents}>
                        <Td col="due">
                          <Money value={centsToText(a.dueCents)} />
                        </Td>
                        <Td col="decision">{t.decisions[a.decision]}</Td>
                        <Td col="why">{a.why}</Td>
                        <Td col="about">{a.about || '—'}</Td>
                        <Td col="by">{a.answeredBy}</Td>
                        <Td col="label">{bookName(a.labelId)}</Td>
                        <Td>
                          {a.active ? (
                            <ActionButton name={`deactivate-answer-${a.id}`} op="POST /settlements/answers/:id/deactivate" compact variant="secondary" onPress={() => setActive({ kind: 'reason', what: 'answer', id: a.id })}>
                              {t.answers.deactivate}
                            </ActionButton>
                          ) : (
                            <span className="text-xs text-muted">{a.deactivatedReason}</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </SimpleTable>
                )}
              </Section>
            </>
          );
        }}
      </QueryView>
      <Section
        title={t.threshold.title}
        testId="admission-threshold"
        toolbar={
          <ActionButton name="set-threshold" op="PATCH /contracts/:id" variant="secondary" isDisabled={props.detail.contracts.length === 0} onPress={() => setActive({ kind: 'threshold' })}>
            {t.threshold.set}
          </ActionButton>
        }
      >
        <span className="text-sm" data-testid="admission-threshold-value" data-cents={adm?.thresholdCents ?? ''}>
          {fmt(t.threshold.current, { value: adm?.thresholdCents === null || adm?.thresholdCents === undefined ? t.threshold.default : centsToText(adm.thresholdCents) })}
        </span>
      </Section>
      {active?.kind === 'payee' ? <PayeeDialog ownerId={ownerId} onClose={() => setActive(null)} /> : null}
      {active?.kind === 'hold' ? <HoldDialog ownerId={ownerId} labelId={props.labelId} onClose={() => setActive(null)} /> : null}
      {active?.kind === 'answer' ? <AnswerDialog ownerId={ownerId} labelId={props.labelId} due={gate ? centsToText(gate.amountCents) : ''} onClose={() => setActive(null)} /> : null}
      {active?.kind === 'threshold' ? <ThresholdDialog detail={props.detail} onClose={() => setActive(null)} /> : null}
      {active?.kind === 'reason' ? <ReasonDialog what={active.what} id={active.id} onClose={() => setActive(null)} /> : null}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function PayeeDialog(props: { ownerId: string; onClose: () => void }) {
  const [channel, setChannel] = useState<Payee['channel']>('tipalti');
  const [ref, setRef] = useState('');
  const [basis, setBasis] = useState('');
  const [validFrom, setValidFrom] = useState(today());
  const run = useAction(() => api.settlements.setPayee({ ownerId: props.ownerId, channel, payeeRef: ref.trim() || null, basis: basis.trim(), validFrom }), { invalidate: 'all', success: () => t.toasts.payee });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={d.payeeTitle}
      subtitle={d.payeeSubtitle}
      footer={
        <ActionButton name="payee-submit" op="POST /settlements/payees" isPending={run.isPending} isDisabled={basis.trim() === '' || validFrom === ''} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {d.submit}
        </ActionButton>
      }
    >
      <SelectField name="payee-channel" label={d.channel} value={channel} onChange={(v) => setChannel(v as Payee['channel'])} options={PAYEE_CHANNELS.map((c) => ({ id: c, label: t.channels[c] }))} />
      <TextField name="payee-ref" label={d.ref} value={ref} onChange={setRef} />
      <TextField name="payee-basis" label={d.basis} value={basis} onChange={setBasis} isRequired />
      <TextField name="payee-valid-from" label={d.validFrom} type="date" value={validFrom} onChange={setValidFrom} isRequired />
    </FormDialog>
  );
}

function HoldDialog(props: { ownerId: string; labelId: string; onClose: () => void }) {
  const [kind, setKind] = useState<Hold['kind']>('decision');
  const [blocks, setBlocks] = useState(true);
  const [reason, setReason] = useState('');
  const [releaseWhen, setReleaseWhen] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState('');
  const [reviewOn, setReviewOn] = useState('');
  const [since, setSince] = useState(today());
  const run = useAction(
    () =>
      api.settlements.createHold({
        ownerId: props.ownerId,
        labelId: props.labelId || null,
        kind,
        blocks,
        reason: reason.trim(),
        releaseWhen: releaseWhen.trim() || null,
        amount: amount.trim() || null,
        period: period.trim() || null,
        reviewOn: reviewOn || null,
        since,
      }),
    { invalidate: 'all', success: () => t.toasts.hold },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={d.holdTitle}
      subtitle={d.holdSubtitle}
      footer={
        <ActionButton name="hold-submit" op="POST /settlements/holds" isPending={run.isPending} isDisabled={reason.trim() === '' || since === ''} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {d.submit}
        </ActionButton>
      }
    >
      <SelectField name="hold-kind" label={d.kind} value={kind} onChange={(v) => { setKind(v as Hold['kind']); setBlocks(v !== 'dispute'); }} options={HOLD_KINDS.map((k) => ({ id: k, label: t.holdKinds[k] }))} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={blocks} onChange={(e) => setBlocks(e.target.checked)} data-testid="field-hold-blocks" />
        {d.blocks}
      </label>
      <TextField name="hold-reason" label={d.reason} value={reason} onChange={setReason} isRequired />
      <TextField name="hold-release" label={d.releaseWhen} value={releaseWhen} onChange={setReleaseWhen} />
      <TextField name="hold-amount" label={d.amount} value={amount} onChange={setAmount} />
      <TextField name="hold-period" label={d.period} value={period} onChange={setPeriod} />
      <TextField name="hold-review-on" label={d.reviewOn} type="date" value={reviewOn} onChange={setReviewOn} />
      <TextField name="hold-since" label={d.since} type="date" value={since} onChange={setSince} isRequired />
    </FormDialog>
  );
}

function AnswerDialog(props: { ownerId: string; labelId: string; due: string; onClose: () => void }) {
  const [due, setDue] = useState(props.due);
  const [decision, setDecision] = useState<PayoutAnswer['decision']>('pay');
  const [why, setWhy] = useState('');
  const [about, setAbout] = useState('');
  const [by, setBy] = useState('');
  const run = useAction(
    () => api.settlements.createAnswer({ ownerId: props.ownerId, labelId: props.labelId || null, due: due.trim(), decision, why: why.trim(), about: about.trim(), answeredBy: by.trim() }),
    { invalidate: 'all', success: () => t.toasts.answer },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={d.answerTitle}
      subtitle={d.answerSubtitle}
      footer={
        <ActionButton name="answer-submit" op="POST /settlements/answers" isPending={run.isPending} isDisabled={due.trim() === '' || why.trim() === '' || by.trim() === ''} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {d.submit}
        </ActionButton>
      }
    >
      <TextField name="answer-due" label={d.due} value={due} onChange={setDue} isRequired />
      <SelectField name="answer-decision" label={d.decision} value={decision} onChange={(v) => setDecision(v as PayoutAnswer['decision'])} options={ANSWER_DECISIONS.map((k) => ({ id: k, label: t.decisions[k] }))} />
      <TextField name="answer-why" label={d.why} value={why} onChange={setWhy} isRequired />
      <TextField name="answer-about" label={d.about} value={about} onChange={setAbout} />
      <TextField name="answer-by" label={d.answeredBy} value={by} onChange={setBy} isRequired />
    </FormDialog>
  );
}

function ThresholdDialog(props: { detail: OwnerDetail; onClose: () => void }) {
  const contracts = props.detail.contracts;
  const [contractId, setContractId] = useState(contracts[0]?.id ?? '');
  const [cents, setCents] = useState('');
  const run = useAction(() => api.settlements.setContractThreshold(contractId, { payoutThresholdCents: cents.trim() === '' ? null : toInt(cents) }), { invalidate: 'all', success: () => t.toasts.threshold });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={d.thresholdTitle}
      footer={
        <ActionButton name="threshold-submit" op="PATCH /contracts/:id" isPending={run.isPending} isDisabled={contractId === '' || (cents.trim() !== '' && !/^\d+$/.test(cents.trim()))} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {d.submit}
        </ActionButton>
      }
    >
      <SelectField name="threshold-contract" label={t.threshold.contract} value={contractId} onChange={setContractId} options={contracts.map((c) => ({ id: c.id, label: c.number ?? c.id }))} />
      <TextField name="threshold-cents" label={t.threshold.cents} value={cents} onChange={setCents} />
    </FormDialog>
  );
}

function ReasonDialog(props: { what: 'payee' | 'hold' | 'answer'; id: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const run = useAction(
    async (): Promise<unknown> => {
      const body = { reason: reason.trim() };
      if (props.what === 'payee') return api.settlements.deactivatePayee(props.id, body);
      if (props.what === 'hold') return api.settlements.releaseHold(props.id, body);
      return api.settlements.deactivateAnswer(props.id, body);
    },
    { invalidate: 'all', success: () => (props.what === 'payee' ? t.toasts.payeeOff : props.what === 'hold' ? t.toasts.released : t.toasts.answerOff) },
  );
  const op = props.what === 'payee' ? 'POST /settlements/payees/:id/deactivate' : props.what === 'hold' ? 'POST /settlements/holds/:id/release' : 'POST /settlements/answers/:id/deactivate';
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={d.reasonTitle}
      footer={
        <ActionButton name="admission-reason-submit" op={op} isPending={run.isPending} isDisabled={reason.trim() === ''} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {d.submit}
        </ActionButton>
      }
    >
      <TextField name="admission-reason" label={d.reasonTitle} value={reason} onChange={setReason} isRequired />
    </FormDialog>
  );
}
