import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ArtistBalance, CReason } from '@erp/shared/api-responses';
import { settlementQueries } from '../../api/queries/settlements';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { statusLabel } from '../../components/StatusChip';
import { formatMoney } from '../../lib/money';
import { fmt, ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';
import { Fact, Section, SimpleTable, Td } from '../owners/components/Fact';

const t = ru.money.artist.money;
const b = ru.money.balance;
const pendingWhy = (why: string) => (Object.hasOwn(b.pendingWhy, why) ? b.pendingWhy[why] : undefined) ?? why;

/**
 * P12 Деньги: the artist row of the owner balance as fields (all-time and for the period), waiting by reason, by label
 * of record, per ISRC, the positions (advances) and the advertising charged to this pseudonym. Every number is the
 * backend's (R1); the payout and the payable are the owner's (the owner link in the header).
 */
export function ArtistBalanceTab(props: { balance: ArtistBalance }) {
  const m = props.balance;
  const waiting = (Object.entries(m.period.waitingBreakdown) as [CReason, string][]).filter(([, v]) => v !== undefined);
  const ops = useQuery({ ...settlementQueries.operations({ artistId: m.artistId }), enabled: m.pendingOperations.length > 0 });
  const opText = (id: string) => {
    const op = (ops.data ?? []).find((o) => o.id === id);
    return op
      ? fmt(b.operationLine, { date: op.date, meaning: statusLabel('operationMeaning', op.meaning), amount: formatMoney(centsToText(op.amountCents)), pseudonym: '' })
      : id;
  };
  return (
    <div className="flex flex-col gap-4" data-testid="balance-tab" data-label={m.label?.id ?? ''}>
      <div className="text-sm" data-testid="balance-label">
        {b.labelView}: <b>{m.label ? m.label.name : b.allLabels}</b>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t.total} testId="balance-total">
          <Fact testId="balance-earned" label={t.earned} value={m.total.earned} strong />
          <Fact testId="balance-waiting" label={t.waiting} value={m.total.waiting} />
          <Fact testId="balance-recouped" label={t.recouped} value={m.total.recouped} />
          <Fact testId="balance-unrecouped" label={t.unrecouped} value={m.total.unrecouped} />
          <Fact testId="balance-recoupedFromMaster" label={t.recoupedFromMaster} value={m.total.recoupedFromMaster} />
          <Fact testId="balance-adsCharged" label={t.adsCharged} value={m.total.adsCharged} />
          <Fact testId="balance-paid" label={t.paid} value={m.total.paid} />
          <p className="text-xs text-muted" data-testid="owner-note">
            {t.ownerNote}{' '}
            {m.owner ? <EntityLink kind="owner" id={m.owner.id} label={m.owner.name} /> : null}
          </p>
        </Section>
        <Section title={t.period} testId="balance-period">
          <Fact testId="balance-received" label={t.received} value={m.period.received} />
          <Fact testId="balance-periodEarned" label={t.periodEarned} value={m.period.earned} />
          <Fact testId="balance-periodWaiting" label={t.periodWaiting} value={m.period.waiting} />
          <p className="text-xs text-muted">{b.calculatedFor}</p>
        </Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={b.waitingByReason} testId="waiting-by-reason">
          {waiting.length === 0 ? (
            <span className="text-sm text-muted">{b.waitingEmpty}</span>
          ) : (
            <ul className="text-sm">
              {waiting.map(([reason, amount]) => (
                <li key={reason} data-testid={`waiting-${reason}`} className="flex justify-between gap-4 py-0.5">
                  <Link className="text-accent hover:underline" to={m.ownerId ? `/queue/${reason}?ownerId=${encodeURIComponent(m.ownerId)}` : `/queue/${reason}`}>
                    {ru.reasons[reason]}
                  </Link>
                  <Money value={amount} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={b.byLabel} testId="by-label">
          <SimpleTable head={[b.bookCols.label, b.bookCols.earned, b.bookCols.waiting, b.bookCols.recouped, b.bookCols.adsCharged, b.bookCols.paid]}>
            {Object.entries(m.byLabel).map(([label, v]) => (
              <tr key={label} data-testid={`by-label-${label}`} data-label-id={v.labelId ?? ''}>
                <Td>{label === '?' ? b.unmappedLabel : label}</Td>
                {(['earned', 'waiting', 'recouped', 'adsCharged', 'paid'] as const).map((k) => (
                  <Td key={k} col={k}>
                    <Money value={v[k]} />
                  </Td>
                ))}
              </tr>
            ))}
          </SimpleTable>
        </Section>
      </div>
      <Section title={t.tracks} testId="balance-tracks">
        {m.tracks.length === 0 ? (
          <span className="text-sm text-muted">{b.none}</span>
        ) : (
          <SimpleTable head={[b.isrc, b.net, b.earned, b.waiting]}>
            {m.tracks.map((tr) => (
              <tr key={tr.isrc} data-testid={`balance-track-${tr.isrc}`}>
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
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      <Section title={b.positions} testId="positions">
        {m.positions.length === 0 ? (
          <span className="text-sm text-muted">{b.none}</span>
        ) : (
          <SimpleTable head={[b.date, b.positionAmount, ru.money.owners.cols.recouped, b.remaining, b.scope]}>
            {m.positions.map((p) => (
              <tr key={p.operationId} data-testid={`position-${p.operationId}`}>
                <Td>{p.date}</Td>
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
      <Section title={ru.ads.balance.title} testId="balance-ads">
        {m.ads.length === 0 ? (
          <span className="text-sm text-muted">{ru.ads.balance.none}</span>
        ) : (
          <SimpleTable head={[ru.ads.balance.month, ru.ads.balance.isrc, ru.ads.balance.role, ru.ads.balance.amount]}>
            {m.ads.map((p) => (
              <tr key={`${p.adId}-${p.role}`} data-testid={`ad-position-${p.adId}-${p.role}`}>
                <Td>
                  <EntityLink kind="ad" id={p.adId} label={p.month} />
                </Td>
                <Td>{p.isrc ? <EntityLink kind="isrc" id={p.isrc} /> : '—'}</Td>
                <Td col="role">{ru.ads.balance.roles[p.role]}</Td>
                <Td col="amount">
                  <Money value={p.amount} />
                </Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      {m.pendingOperations.length > 0 ? (
        <Section title={t.pending} testId="pending-operations">
          <ul className="list-disc pl-5 text-sm">
            {m.pendingOperations.map((p) => (
              <li key={p.operationId} data-testid={`pending-${p.operationId}`} title={p.operationId}>
                {opText(p.operationId)}: <span data-why={p.why}>{pendingWhy(p.why)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
