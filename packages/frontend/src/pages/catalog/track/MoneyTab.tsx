import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@heroui/react';
import type { TrackMoney } from '@erp/shared/api-responses';
import { trackQueries } from '../../../api/queries/tracks';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { Money } from '../../../components/Money';
import { PageState } from '../../../components/PageState';
import { StatusChip } from '../../../components/StatusChip';
import { fmt, ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../components/MoneyTable';
import { monthKey, monthRowId, type Allocation, type Layer, type Month } from './types';

const t = ru.catalog.track;
const m = ru.catalog.money;

/** The `data-book` of a month row: the label its file was loaded under (D-169), '?' without one (the API's book key). */
const bookOf = (month: Month) => month.bookLabelName ?? '?';

/** The months of the ISRC (account × UPC × report month); a month expands into allocations, layers and the breakdown. */
export function MoneyTab({ isrc, data }: { isrc: string; data: TrackMoney }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // A shortfall names its participation by the recipient's pseudonym (the rule id is the participation id).
  const pseudonyms = new Map(data.participations.map((p) => [p.id, p.pseudonym]));
  if (data.months.length === 0) return <PageState variant="empty" message={t.noMonths} />;
  const c = t.cols;
  return (
    <SimpleTable
      testId="track-months"
      headers={[c.expand, c.account, c.upc, c.reportingMonth, c.salesMonth, c.book, c.labelName, m.net, m.labelShare, m.ours, c.status]}
    >
      {data.months.map((month) => {
        const id = monthRowId(month);
        const isOpen = open[id] === true;
        return (
          <Fragment key={id}>
            <MonthRow month={month} isOpen={isOpen} onToggle={() => setOpen((o) => ({ ...o, [id]: !isOpen }))} />
            {isOpen ? (
              <tr
                data-testid={`month-detail-${monthKey(month)}`}
                data-sales-month={month.salesMonth}
                data-label={month.labelName}
                data-book={bookOf(month)}
                data-row-id={id}
                className="bg-default/30"
              >
                <td colSpan={11} className="px-3 py-3">
                  <MonthDetail isrc={isrc} month={month} pseudonyms={pseudonyms} />
                </td>
              </tr>
            ) : null}
          </Fragment>
        );
      })}
    </SimpleTable>
  );
}

function MonthRow({ month, isOpen, onToggle }: { month: Month; isOpen: boolean; onToggle: () => void }) {
  return (
    <tr
      data-testid={`month-${monthKey(month)}`}
      data-sales-month={month.salesMonth}
      data-label={month.labelName}
      data-book={bookOf(month)}
      data-row-id={monthRowId(month)}
      className="border-t border-border"
    >
      <Td>
        <ActionButton name="expand-month" write={false} variant="tertiary" onPress={onToggle}>
          {isOpen ? t.collapse : t.expand}
        </ActionButton>
      </Td>
      <Td col="account">{month.account}</Td>
      <Td col="upc">
        <EntityLink kind="upc" id={month.upc} />
      </Td>
      <Td col="reportingMonth">{month.reportingMonth}</Td>
      <Td col="salesMonth">{month.salesMonth}</Td>
      <Td col="book">
        <span data-testid="month-book" title={t.bookHint}>
          {month.bookLabelName ?? t.noBook}
        </span>
      </Td>
      <Td col="label">
        <div data-testid="label-string">{month.labelName}</div>
        <div className="text-xs text-muted">
          → <span data-testid="label-of-record">{month.ourLabelName ?? '—'}</span>
          {month.sublabelName ? (
            <>
              {' · '}
              <span data-testid="sublabel">{month.sublabelName}</span>
              {month.rule ? (
                <>
                  {' · '}
                  <Link to="?tab=rules" className="text-accent hover:underline" data-testid="label-rule-link">
                    {t.rule}
                  </Link>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </Td>
      <Td col="net">
        <Money value={month.net} />
      </Td>
      <Td col="labelShare">
        <Money value={month.labelShare} />
      </Td>
      <Td col="ours">
        <Money value={month.ours} />
        {month.labelShareCategory !== 'ours' ? (
          <div className="mt-1">
            <StatusChip kind="cReason" value={month.labelShareCategory} />
          </div>
        ) : null}
      </Td>
      <Td col="status">
        <span data-value={month.status}>{t.statuses[month.status]}</span>
      </Td>
    </tr>
  );
}

function MonthDetail({ isrc, month, pseudonyms }: { isrc: string; month: Month; pseudonyms: Map<string, string> }) {
  const [breakdown, setBreakdown] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-2 text-sm font-medium">{t.allocations}</h3>
        <Allocations month={month} />
        {month.shortfalls.map((s) => (
          <p key={s.ruleId} className="mt-2 text-sm text-warning" data-testid={`shortfall-${s.ruleId}`}>
            {fmt(t.shortfall, { who: pseudonyms.get(s.ruleId) ?? t.unknownParticipant, why: whyText(s.why) })}: <Money value={s.missing} />
          </p>
        ))}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-medium">{t.layers}</h3>
        <Layers month={month} />
      </section>
      <section className="flex flex-col gap-2">
        <div>
          <ActionButton name="breakdown" write={false} variant="secondary" onPress={() => setBreakdown(true)} isDisabled={breakdown}>
            {t.breakdown}
          </ActionButton>
        </div>
        {breakdown ? <Breakdown isrc={isrc} month={month} /> : null}
      </section>
    </div>
  );
}

const whyText = (why: string) => (why in ru.signalsPage.why ? ru.signalsPage.why[why as keyof typeof ru.signalsPage.why] : why);

const basisLabel = (a: Allocation) => (a.assumption ? ru.signalsPage.basis[a.assumption] : '');

function Allocations({ month }: { month: Month }) {
  if (month.allocations.length === 0) return <p className="text-sm text-muted">{t.noAllocations}</p>;
  const c = t.alloc;
  return (
    <SimpleTable
      testId="allocations"
      headers={[c.pseudonym, c.owner, c.layer, c.kind, c.percent, c.amount, c.category, c.reason, c.document, c.basis]}
    >
      {month.allocations.map((a, i) => (
        <tr
          key={`${a.ruleId}-${a.artistId}-${i}`}
          data-testid={`alloc-${a.ruleId}-${a.artistId}`}
          data-pseudonym={a.pseudonym}
          className="border-t border-border"
        >
          <Td col="pseudonym">
            <EntityLink kind="artist" id={a.artistId} label={a.pseudonym} />
          </Td>
          <Td col="owner">{a.ownerId ? <EntityLink kind="owner" id={a.ownerId} label={a.ownerName ?? a.ownerId} /> : '—'}</Td>
          <Td col="layer">{t.allocLayer[a.layer]}</Td>
          <Td col="kind">
            <Link to="?tab=rules" className="hover:underline">
              {t.allocKind[a.kind]}
            </Link>
          </Td>
          <Td col="percent">{a.percent}</Td>
          <Td col="amount">
            <Money value={a.amount} />
          </Td>
          <Td col="category">
            <StatusChip kind="category" value={a.category} />
          </Td>
          <Td col="reason">{a.reason ? <StatusChip kind="cReason" value={a.reason} /> : null}</Td>
          <Td col="document">
            {a.documentId ? (
              <span className="flex items-center gap-1">
                <EntityLink kind="document" id={a.documentId} label="→" />
                <StatusChip kind="documentStatus" value={a.documentStatus} />
              </span>
            ) : (
              <StatusChip kind="documentStatus" value={a.documentStatus} />
            )}
          </Td>
          <Td col="basis">{basisLabel(a)}</Td>
        </tr>
      ))}
    </SimpleTable>
  );
}

/** Allocations of a layer that are new or changed (amount or category) since the previous layer (text compare only). */
function addedIn(layer: Layer, previous: Layer | undefined) {
  const id = (a: Layer['allocations'][number]) => `${a.ruleId}|${a.artistId}|${a.kind}`;
  const state = (a: Layer['allocations'][number]) => `${a.amount}|${a.category}`;
  const before = new Map((previous?.allocations ?? []).map((a) => [id(a), state(a)]));
  return layer.allocations.filter((a) => before.get(id(a)) !== state(a));
}

function Layers({ month }: { month: Month }) {
  const c = t.layerCols;
  const names = new Map(month.allocations.map((a) => [a.artistId, a.pseudonym]));
  const layerName = (name: string) => (name in t.layerNames ? t.layerNames[name as keyof typeof t.layerNames] : name);
  return (
    <SimpleTable testId="layers" headers={[c.layer, c.status, c.scaledNet, c.labelShare, c.added]}>
      {month.layers.map((layer, i) => (
        <tr key={`${layer.layer}-${i}`} data-testid={`layer-${layer.layer}`} className="border-t border-border">
          <Td col="layer">{layerName(layer.layer)}</Td>
          <Td col="status">{t.statuses[layer.status]}</Td>
          <Td col="scaledNet">
            <Money value={layer.scaledNet} />
          </Td>
          <Td col="labelShare">
            <Money value={layer.labelShare} />
            {layer.labelShareCategory !== 'ours' ? (
              <span className="ml-1">
                <StatusChip kind="cReason" value={layer.labelShareCategory} />
              </span>
            ) : null}
          </Td>
          <Td col="added">
            <ul className="flex flex-col gap-0.5">
              {addedIn(layer, month.layers[i - 1]).map((a) => (
                <li key={`${a.ruleId}-${a.artistId}`} data-testid={`layer-alloc-${a.ruleId}-${a.artistId}`} data-pseudonym={names.get(a.artistId) ?? a.artistId}>
                  {names.get(a.artistId) ?? a.artistId}: <Money value={a.amount} /> ({a.category})
                </li>
              ))}
            </ul>
          </Td>
        </tr>
      ))}
    </SimpleTable>
  );
}

/** The platform × country rows of the report month (one call per month; the UPC and sales month of this row only). */
function Breakdown({ isrc, month }: { isrc: string; month: Month }) {
  const query = useQuery(trackQueries.breakdown(isrc, month.reportingMonth));
  if (query.isError) return <PageState variant="error" error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Spinner aria-label={ru.common.loading} />;
  // The rows of this month row only: its UPC and its sales month (a report month has a row per sales month).
  const rows = query.data.rows.filter((r) => r.upc === month.upc && r.salesMonth === month.salesMonth);
  if (rows.length === 0) return <p className="text-sm text-muted">{t.breakdownEmpty}</p>;
  const c = t.breakdownCols;
  return (
    <SimpleTable testId="breakdown" headers={[c.platform, c.country, c.subscriptionType, c.salesType, c.salesMonth, c.quantity, c.net]}>
      {rows.map((r, i) => (
        <tr key={i} data-testid="breakdown-row" className="border-t border-border">
          <Td col="platform">{r.platform}</Td>
          <Td col="country">{r.country}</Td>
          <Td>{r.subscriptionType}</Td>
          <Td>{r.salesType}</Td>
          <Td>{r.salesMonth}</Td>
          <Td>{r.quantity}</Td>
          <Td col="net">
            <Money value={r.net} />
          </Td>
        </tr>
      ))}
    </SimpleTable>
  );
}
