import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { PayableItem } from '@erp/shared/api-responses';
import { ownerQueries } from '../../api/queries/owners';
import { ActionButton } from '../../components/ActionButton';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { StatusChip } from '../../components/StatusChip';
import { DataGrid } from '../../components/grid/DataGrid';
import { compareDecimal } from '../../lib/money';
import { ru } from '../../i18n/ru';
import { usePeriod } from '../work/OverviewPage';
import { CreateOwnerDialog } from './components/CreateOwnerDialog';
import { PeriodBar } from './components/PeriodBar';

const t = ru.money.owners;

/**
 * P9 Владельцы `/owners` and its view Выплаты `/owners?view=payouts`: which owners exist, are they confirmed, how much
 * is payable, and who is blocked and why? One `GET /owners/payables` (period in the URL); the payouts view filters the
 * loaded rows to `payout.allowed` or `payout_blocked` and orders them by `payout.amountCents` (the API's integer).
 */
export function OwnersPage() {
  const [params] = useSearchParams();
  const payouts = params.get('view') === 'payouts';
  const [period, setPeriod] = usePeriod();
  const query = useQuery(ownerQueries.payables(period));
  const [creating, setCreating] = useState(false);
  const columns = useMemo(() => payableColumns(), []);
  const rowsOf = (items: PayableItem[]) =>
    payouts
      ? items
          .filter((i) => i.payout.allowed || i.payout.reason === 'payout_blocked')
          .sort((a, b) => (a.payout.amountCents === b.payout.amountCents ? 0 : a.payout.amountCents > b.payout.amountCents ? -1 : 1))
      : items;
  return (
    <div data-testid="owners-page" data-view={payouts ? 'payouts' : 'owners'}>
      <PageHeader
        title={payouts ? ru.nav.items.payouts : t.title}
        subtitle={payouts ? t.payoutsSubtitle : t.subtitle}
        toolbar={
          <>
            <PeriodBar period={period} onApply={setPeriod} />
            <ActionButton name="create-owner" onPress={() => setCreating(true)}>
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
      <QueryView
        query={query}
        money
        isEmpty={(d) => rowsOf(d.items).length === 0}
        emptyMessage={payouts ? t.payoutsEmpty : t.empty}
      >
        {(data) => (
          <DataGrid
            key={payouts ? 'payouts' : 'owners'}
            rowData={rowsOf(data.items)}
            columnDefs={columns}
            getRowId={(r) => r.ownerId}
            rowTestId={(r) => `owner-${r.ownerId}`}
            gridStateKey="grid"
          />
        )}
      </QueryView>
      {creating ? <CreateOwnerDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

type P = { data?: PayableItem };
const money = (colId: keyof PayableItem & string, headerName: string): ColDef<PayableItem> => ({
  colId,
  headerName,
  filter: false,
  // Wide enough for the largest amounts (e.g. «1 114 884,25»): money is never cut with an ellipsis (stage 4 walk F9).
  minWidth: 150,
  headerTooltip: headerName,
  wrapHeaderText: true,
  autoHeaderHeight: true,
  comparator: compareDecimal,
  valueGetter: (p) => p.data?.[colId],
  cellRenderer: (p: P) => (p.data ? <span data-col={colId}><Money value={p.data[colId] as string} /></span> : null),
});

function payableColumns(): ColDef<PayableItem>[] {
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
      wrapHeaderText: true,
      autoHeaderHeight: true,
      valueGetter: (p) => (p.data ? (p.data.payout.reason ?? 'allowed') : ''),
      cellRenderer: (p: P) =>
        p.data ? (
          <span className="flex items-center gap-2">
            <GateChip allowed={p.data.payout.allowed} reason={p.data.payout.reason} />
            <span className="text-xs text-muted" title={`${c.blocking} / ${c.pending}`}>
              <span data-col="blocking">{p.data.blockingPayouts}</span> / <span data-col="pending">{p.data.pendingOperations}</span>
            </span>
          </span>
        ) : null,
    },
    money('payableShown', c.payableShown),
    money('payable', c.payable),
    money('earned', c.earned),
    money('waiting', c.waiting),
    money('recouped', c.recouped),
    money('paid', c.paid),
    {
      colId: 'status',
      headerName: c.status,
      minWidth: 140,
      valueGetter: (p) => p.data?.status,
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-col="confirmed" data-value={String(p.data.confirmed)}>
            <StatusChip kind="ownerStatus" value={p.data.status} />
          </span>
        ) : null,
    },
    { colId: 'lastPayout', headerName: c.lastPayout, minWidth: 170, valueGetter: (p) => p.data?.lastPayoutDate ?? '' },
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
