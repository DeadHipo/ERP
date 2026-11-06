import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { PayableItem } from '@erp/shared/api-responses';
import { ownerQueries } from '../../api/queries/owners';
import { ActionButton } from '../../components/ActionButton';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { QueryView, StaleBadge } from '../../components/PageState';
import { StatusChip } from '../../components/StatusChip';
import { DataGrid } from '../../components/grid/DataGrid';
import { compareDecimal } from '../../lib/money';
import { useLabel } from '../../lib/label';
import { ru } from '../../i18n/ru';
import { usePeriod } from '../work/OverviewPage';
import { useUrlParam } from '../catalog/components/url';
import { CreateOwnerDialog } from './components/CreateOwnerDialog';
import { PeriodBar } from './components/PeriodBar';

const t = ru.money.owners;
/** `MAX_IDS_PER_REQUEST` of the API: the most owner ids one `GET /owners/payables?ids=` takes. */
const IDS_PER_REQUEST = 200;

/** A row of P9: the owner without money (the list) and, once asked, its payables item. */
type OwnerRow = Pick<PayableItem, 'ownerId' | 'name' | 'kind' | 'status'> & { money?: PayableItem };

const rowOfItem = (i: PayableItem): OwnerRow => ({ ownerId: i.ownerId, name: i.name, kind: i.kind, status: i.status, money: i });

type MoneyCol = 'payableShown' | 'payable' | 'earned' | 'waiting' | 'recouped' | 'paid';

/**
 * P9 Владельцы `/owners` and its view Выплаты `/owners?view=payouts` (period in the URL): which owners exist, are they
 * confirmed, how much is payable, and who is blocked and why? The owners list comes in two phases (D-163): the rows from
 * `GET /owners` (no money) and the money of the rows on the screen from `GET /owners/payables?ids=` (one calculation
 * of the units of their reach); «Посчитать все» or the payouts view is one `GET /owners/payables` of every owner, as
 * before: the payouts view filters the loaded rows to `payout.allowed` or `payout_blocked` and orders them by
 * `payout.amountCents` (the API's integer), so it needs every owner's money.
 */
export function OwnersPage() {
  const [params] = useSearchParams();
  const payouts = params.get('view') === 'payouts';
  const [all, setAll] = useUrlParam('all');
  const [period, setPeriod] = usePeriod();
  // the label view (D-168): the owners visible under it, each the book of that label
  const { labelId } = useLabel();
  const full = payouts || all === '1';
  const payables = useQuery({ ...ownerQueries.payables(period, labelId), enabled: full });
  const list = useQuery({ ...ownerQueries.list(labelId), enabled: !full });
  const [visible, setVisible] = useState<readonly string[]>([]);
  const [asked, setAsked] = useState<readonly string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(visible), 150);
    return () => clearTimeout(timer);
  }, [visible]);
  // Owner ids are UUIDs: a page of 500 would not fit one request line, so a page asks in chunks of 200 (the API's cap).
  const chunks = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < asked.length; i += IDS_PER_REQUEST) out.push(asked.slice(i, i + IDS_PER_REQUEST));
    return out;
  }, [asked]);
  const pageMoney = useQueries({
    queries: chunks.map((ids) => ({ ...ownerQueries.payablesOf(ids, period, labelId), enabled: !full })),
    combine: (results) => ({
      items: results.flatMap((r) => r.data?.items ?? []),
      updatedAt: results.map((r) => r.dataUpdatedAt).join(','),
      isFetching: results.some((r) => r.isFetching),
    }),
  });
  const moneyRef = useRef(new Map<string, PayableItem>());
  const [moneyVersion, setMoneyVersion] = useState(0);
  useEffect(() => {
    if (pageMoney.items.length === 0) return;
    for (const i of pageMoney.items) moneyRef.current.set(i.ownerId, i);
    setMoneyVersion((v) => v + 1);
    // updatedAt: the chunks answered (the items array is rebuilt on every render)
  }, [pageMoney.updatedAt]);
  // A new period or label changes every row's money: forget what was seen under the old one.
  useEffect(() => {
    moneyRef.current.clear();
    setMoneyVersion((v) => v + 1);
  }, [period.from, period.to, period.basis, labelId]);
  const onVisibleRowsChanged = useCallback((rows: OwnerRow[]) => {
    const next = rows.map((r) => r.ownerId).sort();
    setVisible((prev) => (prev.join(',') === next.join(',') ? prev : next));
  }, []);
  const [creating, setCreating] = useState(false);
  const columns = useMemo(() => payableColumns(full), [full]);
  const fullRows = useMemo(() => {
    const items = payables.data?.items ?? [];
    return payouts
      ? items
          .filter((i) => i.payout.allowed || i.payout.reason === 'payout_blocked')
          .sort((a, b) => (a.payout.amountCents === b.payout.amountCents ? 0 : a.payout.amountCents > b.payout.amountCents ? -1 : 1))
          .map(rowOfItem)
      : items.map(rowOfItem);
  }, [payables.data, payouts]);
  const pagedRows = useMemo(
    () =>
      (list.data ?? []).map(
        (o): OwnerRow => ({ ownerId: o.id, name: o.name, kind: o.kind, status: o.status, money: moneyRef.current.get(o.id) }),
      ),
    // moneyVersion: the money of a page arrived (the map is a ref)
    [list.data, moneyVersion],
  );
  const grid = (rows: OwnerRow[]) => (
    <div className="flex flex-col gap-2">
      {!payouts ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {full ? (
            <>
              <span data-testid="owners-all-money">{t.allMoney}</span>
              <button type="button" className="text-accent hover:underline" data-testid="action-visible-only" onClick={() => setAll('')}>
                {t.visibleOnly}
              </button>
            </>
          ) : (
            <>
              <span data-testid="owners-visible-money">{t.visibleMoney}</span>
              <button type="button" className="text-accent hover:underline" data-testid="action-compute-all" onClick={() => setAll('1')}>
                {t.computeAll}
              </button>
              <StaleBadge show={pageMoney.isFetching} />
            </>
          )}
        </div>
      ) : null}
      <DataGrid
        key={payouts ? 'payouts' : full ? 'owners-all' : 'owners'}
        rowData={rows}
        columnDefs={columns}
        getRowId={(r) => r.ownerId}
        rowTestId={(r) => `owner-${r.ownerId}`}
        gridStateKey="grid"
        onVisibleRowsChanged={full ? undefined : onVisibleRowsChanged}
      />
    </div>
  );
  return (
    <div data-testid="owners-page" data-view={payouts ? 'payouts' : 'owners'}>
      <PageHeader
        title={payouts ? ru.nav.items.payouts : t.title}
        subtitle={payouts ? t.payoutsSubtitle : t.subtitle}
        toolbar={
          <>
            <PeriodBar period={period} onApply={setPeriod} />
            <ActionButton name="create-owner" op="POST /owners" onPress={() => setCreating(true)}>
              {t.create}
            </ActionButton>
          </>
        }
      />
      {payouts ? (
        <h2 className="mb-2 text-lg font-semibold" data-testid="payouts-header">
          {t.payoutsHeader}
        </h2>
      ) : null}
      {full ? (
        <QueryView query={payables} money isEmpty={() => fullRows.length === 0} emptyMessage={payouts ? t.payoutsEmpty : t.empty}>
          {() => grid(fullRows)}
        </QueryView>
      ) : (
        <QueryView query={list} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
          {() => grid(pagedRows)}
        </QueryView>
      )}
      {creating ? <CreateOwnerDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

type P = { data?: OwnerRow };
const pending = (col: string) => (
  <span data-col={col} data-testid="money-pending" className="text-muted">
    {t.moneyPending}
  </span>
);
const money = (colId: MoneyCol, headerName: string, sortable: boolean): ColDef<OwnerRow> => ({
  colId,
  headerName,
  filter: false,
  sortable,
  // Wide enough for the largest amounts (e.g. «1 114 884,25»): money is never cut with an ellipsis (stage 4 walk F9).
  minWidth: 150,
  headerTooltip: headerName,
  wrapHeaderText: true,
  autoHeaderHeight: true,
  comparator: compareDecimal,
  valueGetter: (p) => p.data?.money?.[colId],
  cellRenderer: (p: P) =>
    p.data ? (
      p.data.money ? (
        <span data-col={colId}>
          <Money value={p.data.money[colId]} />
        </span>
      ) : (
        pending(colId)
      )
    ) : null,
});

/** The money and gate columns sort only when every row has its money (`full`); by pages they are not sortable. */
function payableColumns(full: boolean): ColDef<OwnerRow>[] {
  const c = t.cols;
  // The columns an operator needs to decide a payout come first; the counts of blocking and pending operations sit
  // with the gate, the kind with the name, «подтверждён» with the status (a narrow screen scrolls the rest).
  return [
    {
      colId: 'name',
      headerName: c.name,
      minWidth: 170,
      valueGetter: (p) => p.data?.name,
      cellRenderer: (p: P) =>
        p.data ? (
          <span>
            <EntityLink kind="owner" id={p.data.ownerId} label={p.data.name} />{' '}
            <span className="text-xs text-muted">{t.kind[p.data.kind]}</span>
          </span>
        ) : null,
    },
    {
      colId: 'gate',
      headerName: c.gate,
      minWidth: 210,
      sortable: full,
      filter: full,
      wrapHeaderText: true,
      autoHeaderHeight: true,
      valueGetter: (p) => (p.data?.money ? (p.data.money.payout.reason ?? 'allowed') : ''),
      cellRenderer: (p: P) =>
        p.data ? (
          p.data.money ? (
            <span className="flex items-center gap-2">
              <GateChip allowed={p.data.money.payout.allowed} reason={p.data.money.payout.reason} />
              <span className="text-xs text-muted" title={`${c.blocking} / ${c.pending}`}>
                <span data-col="blocking">{p.data.money.blockingPayouts}</span> / <span data-col="pending">{p.data.money.pendingOperations}</span>
              </span>
            </span>
          ) : (
            pending('gate')
          )
        ) : null,
    },
    money('payableShown', c.payableShown, full),
    money('payable', c.payable, full),
    money('earned', c.earned, full),
    money('waiting', c.waiting, full),
    money('recouped', c.recouped, full),
    money('paid', c.paid, full),
    {
      colId: 'status',
      headerName: c.status,
      minWidth: 140,
      valueGetter: (p) => p.data?.status,
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-col="confirmed" data-value={p.data.money ? String(p.data.money.confirmed) : ''}>
            <StatusChip kind="ownerStatus" value={p.data.status} />
          </span>
        ) : null,
    },
    {
      colId: 'lastPayout',
      headerName: c.lastPayout,
      minWidth: 170,
      sortable: full,
      valueGetter: (p) => p.data?.money?.lastPayoutDate ?? '',
    },
  ];
}

/** The payout gate of the API (N19) as a chip: «можно выплатить» or the reason; `data-testid="gate-<allowed|reason>"`. */
export function GateChip(props: { allowed: boolean; reason: PayableItem['payout']['reason'] }) {
  const key = props.allowed ? 'allowed' : (props.reason ?? 'none');
  const label = props.allowed ? t.gateAllowed : props.reason ? ru.status.payoutGate[props.reason] : '—';
  return (
    <span
      data-testid={`gate-${key}`}
      className={`rounded-full px-2 py-0.5 text-xs ${props.allowed ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}
    >
      {label}
    </span>
  );
}
