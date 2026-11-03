import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Balance, CReason, Operation } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { settlementQueries } from '../../api/queries/settlements';
import { statusLabel } from '../../components/StatusChip';
import { ActionButton } from '../../components/ActionButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { formatMoney } from '../../lib/money';
import { fmt, ru } from '../../i18n/ru';
import { centsToText } from './components/cents';
import { Fact, Section, SimpleTable, Td } from './components/Fact';
import { GateChip } from './OwnersPage';

const t = ru.money.balance;

/** One operation as the operator reads it: date · meaning · amount · pseudonym (from `GET /settlements/operations`). */
function operationText(op: Operation | undefined, id: string): string {
  if (!op) return id;
  return fmt(t.operationLine, {
    date: op.date,
    meaning: statusLabel('operationMeaning', op.meaning),
    amount: formatMoney(centsToText(op.amountCents)),
    pseudonym: op.pseudonym ? ` · ${op.pseudonym}` : '',
  });
}

const pendingWhy = (why: string) => (Object.hasOwn(t.pendingWhy, why) ? t.pendingWhy[why] : undefined) ?? why;

/** P10 Баланс: the formula as fields, the gate and the payout button, waiting by reason, by label, per pseudonym and ISRC, positions. */
export function BalanceTab(props: { ownerId: string; balance: Balance }) {
  const b = props.balance;
  const waiting = (Object.entries(b.period.waitingBreakdown) as [CReason, string][]).filter(([, v]) => v !== undefined);
  // The blocking and pending operations are named by their date, meaning, amount and pseudonym (the owner's operations
  // list, the same cached query as the Операции tab; not a money call), never by their id.
  const listed = b.blockingPayouts.length > 0 || b.pendingOperations.length > 0;
  const ops = useQuery({ ...settlementQueries.operations({ ownerId: props.ownerId }), enabled: listed });
  const opById = new Map((ops.data ?? []).map((o) => [o.id, o]));
  return (
    <div className="flex flex-col gap-4" data-testid="balance-tab">
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t.formula} testId="balance-formula">
          <Fact testId="balance-earned" label={t.earned} value={b.total.earned} />
          <Fact testId="balance-recouped" label={t.recouped} value={b.total.recouped} />
          <Fact testId="balance-adsCharged" label={ru.ads.balance.adsCharged} value={b.total.adsCharged} />
          <Fact testId="balance-paid" label={t.paid} value={b.total.paid} />
          <Fact testId="balance-returns" label={t.returns} value={b.total.returns} />
          <Fact testId="balance-credits" label={t.credits} value={b.total.credits} />
          <Fact testId="balance-payable" label={t.payable} value={b.total.payable} strong />
          <Fact testId="balance-payableShown" label={t.payableShown} value={b.total.payableShown} />
          {b.total.payableNegative ? (
            <div data-testid="payable-negative" className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-sm text-danger">
              {t.negative}
              <Money value={b.total.payable} />
            </div>
          ) : null}
          <Fact testId="balance-waiting" label={t.waiting} value={b.total.waiting} />
        </Section>
        <Section title={t.gate} testId="payout-gate">
          <div className="flex flex-wrap items-center gap-2" data-allowed={String(b.payout.allowed)} data-reason={b.payout.reason ?? ''}>
            <GateChip allowed={b.payout.allowed} reason={b.payout.reason} />
            <Money value={b.total.payableShown} />
          </div>
          <PayButton ownerId={props.ownerId} balance={b} />
          {b.blockingPayouts.length > 0 ? (
            <div className="text-sm" data-testid="blocking-payouts">
              {t.blocking}:{' '}
              {b.blockingPayouts.map((id) => (
                <span key={id} data-testid={`blocking-${id}`} className="mr-2" title={id}>
                  {operationText(opById.get(id), id)}
                </span>
              ))}
            </div>
          ) : null}
          {b.pendingOperations.length > 0 ? (
            <div className="text-sm" data-testid="pending-operations">
              <div className="font-medium">{t.pending}</div>
              <ul className="list-disc pl-5">
                {b.pendingOperations.map((p) => (
                  <li key={p.operationId} data-testid={`pending-${p.operationId}`} title={p.operationId}>
                    {operationText(opById.get(p.operationId), p.operationId)}: <span data-why={p.why}>{pendingWhy(p.why)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t.waitingByReason} testId="waiting-by-reason">
          {waiting.length === 0 ? (
            <span className="text-sm text-muted">{t.waitingEmpty}</span>
          ) : (
            <ul className="text-sm">
              {waiting.map(([reason, amount]) => (
                <li key={reason} data-testid={`waiting-${reason}`} className="flex justify-between gap-4 py-0.5">
                  <Link className="text-accent hover:underline" to={`/queue/${reason}?ownerId=${encodeURIComponent(b.owner.id)}`}>
                    {ru.reasons[reason]}
                  </Link>
                  <Money value={amount} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t.byLabel} testId="by-label">
          <SimpleTable head={[t.label, t.earned, t.waiting]}>
            {Object.entries(b.byLabel).map(([label, v]) => (
              <tr key={label} data-testid={`by-label-${label}`}>
                <Td>{label === '?' ? t.unmappedLabel : label}</Td>
                <Td col="earned">
                  <Money value={v.earned} />
                </Td>
                <Td col="waiting">
                  <Money value={v.waiting} />
                </Td>
              </tr>
            ))}
          </SimpleTable>
        </Section>
      </div>
      <Section title={t.artists} testId="balance-artists">
        <SimpleTable head={[t.pseudonym, t.isrc, t.net, t.earned, t.waiting, ru.money.owners.cols.recouped, t.unrecouped]}>
          {b.artists.flatMap((a) => [
            <tr key={a.artistId} data-testid={`balance-artist-${a.artistId}`} className="font-medium">
              <Td>
                <EntityLink kind="artist" id={a.artistId} label={a.pseudonym} />
              </Td>
              <Td />
              <Td />
              <Td col="earned">
                <Money value={a.earned} />
              </Td>
              <Td col="waiting">
                <Money value={a.waiting} />
              </Td>
              <Td col="recouped">
                <Money value={a.recouped} />
              </Td>
              <Td col="unrecouped">
                <Money value={a.unrecouped} />
              </Td>
            </tr>,
            ...a.tracks.map((tr) => (
              <tr key={`${a.artistId}-${tr.isrc}`} data-testid={`balance-track-${a.artistId}-${tr.isrc}`}>
                <Td />
                <Td>
                  <EntityLink kind="isrc" id={tr.isrc} />
                </Td>
                <Td col="net">
                  <Money value={tr.net} />
                </Td>
                <Td col="earned">
                  <Money value={tr.amount} />
                </Td>
                <Td col="waiting">
                  <Money value={tr.waiting} />
                </Td>
                <Td />
                <Td />
              </tr>
            )),
          ])}
        </SimpleTable>
      </Section>
      <Section title={t.positions} testId="positions">
        {b.positions.length === 0 ? (
          <span className="text-sm text-muted">{t.none}</span>
        ) : (
          <SimpleTable head={[t.date, t.pseudonym, t.positionAmount, ru.money.owners.cols.recouped, t.remaining, t.scope]}>
            {b.positions.map((p) => (
              <tr key={p.operationId} data-testid={`position-${p.operationId}`}>
                <Td>{p.date}</Td>
                <Td>{b.artists.find((a) => a.artistId === p.artistId)?.pseudonym ?? p.artistId}</Td>
                <Td col="amount">
                  <Money value={p.amount} />
                </Td>
                <Td col="recouped">
                  <Money value={p.recouped} />
                </Td>
                <Td col="remaining">
                  <Money value={p.remaining} />
                </Td>
                <Td>{ru.money.actions.scopes[p.scope.kind as keyof typeof ru.money.actions.scopes] ?? p.scope.kind}</Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      <AdsSection balance={b} />
    </div>
  );
}

/** P10 Реклама: the advertising charged to the owner's pseudonyms (`balance.ads`), taken off payable at once (D-157). */
function AdsSection(props: { balance: Balance }) {
  const b = props.balance;
  const a = ru.ads.balance;
  return (
    <Section title={a.title} testId="balance-ads">
      {b.ads.length === 0 ? (
        <span className="text-sm text-muted">{a.none}</span>
      ) : (
        <SimpleTable head={[a.month, a.isrc, a.pseudonym, a.role, a.amount]}>
          {b.ads.map((p) => (
            <tr key={`${p.adId}-${p.artistId}-${p.role}`} data-testid={`ad-position-${p.adId}-${p.role}`}>
              <Td>{p.month}</Td>
              <Td>{p.isrc ? <EntityLink kind="isrc" id={p.isrc} label={p.isrc} /> : '—'}</Td>
              <Td>{b.artists.find((x) => x.artistId === p.artistId)?.pseudonym ?? p.artistId}</Td>
              <Td col="role">{a.roles[p.role]}</Td>
              <Td col="amount">
                <Money value={p.amount} />
              </Td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </Section>
  );
}

/**
 * «Выплатить» (17 §6): enabled only by `balance.payout.allowed` (else the reason beside it) → ConfirmDialog with the
 * formula fields, the pseudonyms and «снимок будет сохранён» → `POST /owners/:id/payouts`; the toast shows the
 * response's `amountCents`.
 */
function PayButton(props: { ownerId: string; balance: Balance }) {
  const b = props.balance;
  const [open, setOpen] = useState(false);
  const run = useAction(() => api.owners.payout(props.ownerId, {}), {
    invalidate: 'all',
    success: (o) => fmt(ru.money.pay.toast, { amount: formatMoney(centsToText(o.amountCents)), date: o.date }),
  });
  const l = ru.money.pay.lines;
  const m = formatMoney;
  const lines = [
    fmt(l.payable, { amount: m(b.total.payableShown), cents: b.payout.amountCents }),
    fmt(l.formula, {
      earned: m(b.total.earned),
      recouped: m(b.total.recouped),
      paid: m(b.total.paid),
      returns: m(b.total.returns),
      credits: m(b.total.credits),
    }),
    ...b.artists.map((a) => fmt(l.artist, { pseudonym: a.pseudonym, earned: m(a.earned), recouped: m(a.recouped) })),
    l.snapshot,
    l.deferred,
  ];
  return (
    <>
      <ActionButton
        name="pay"
        isDisabled={!b.payout.allowed}
        reason={b.payout.reason ? ru.status.payoutGate[b.payout.reason] : undefined}
        isPending={run.isPending}
        onPress={() => setOpen(true)}
      >
        {t.pay}
      </ActionButton>
      <ConfirmDialog
        isOpen={open}
        onOpenChange={setOpen}
        title={ru.money.pay.title}
        lines={lines}
        isPending={run.isPending}
        confirmLabel={t.pay}
        onConfirm={() => run.mutate(undefined, { onSettled: () => setOpen(false) })}
      />
    </>
  );
}
