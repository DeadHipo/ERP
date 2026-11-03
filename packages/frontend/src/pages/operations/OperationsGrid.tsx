import { useMemo, useState } from 'react';
import type { ColDef } from 'ag-grid-community';
import type { Operation } from '@erp/shared/api-responses';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { StatusChip } from '../../components/StatusChip';
import { DataGrid } from '../../components/grid/DataGrid';
import { ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';
import { OperationActionHost, OperationButtons, type OperationAction } from './OperationActions';

const t = ru.money.operations;

const stateText = (op: Operation) =>
  [
    `${t.cols.proof}: ${op.direction === 'out' ? (op.paymentProofId ? t.proof.yes : t.proof.no) : t.proof.none}`,
    `${t.cols.deferred}: ${op.deferred ? ru.common.yes : ru.common.no}`,
    `${t.cols.active}: ${op.active ? t.active.yes : t.active.no}`,
  ].join(' · ');

const scopeText = (op: Operation) => {
  if (!op.scope) return '—';
  const kind = op.scope.kind as keyof typeof ru.money.actions.scopes;
  const label = ru.money.actions.scopes[kind] ?? op.scope.kind;
  return op.scope.isrcs?.length ? `${label}: ${op.scope.isrcs.join(', ')}` : label;
};

/**
 * The operations of P20 and of the owner's Операции tab: one grid, rows `operation-<id>`, the same row actions. The
 * actions follow the amount (one line of buttons, never wrapped: a row keeps its height and stays in view).
 */
export function OperationsGrid(props: { rows: Operation[]; showOwner?: boolean; gridStateKey?: string }) {
  const [active, setActive] = useState<OperationAction | null>(null);
  const columns = useMemo(() => operationColumns(setActive, props.showOwner !== false), [props.showOwner]);
  return (
    <>
      <DataGrid
        rowData={props.rows}
        columnDefs={columns}
        getRowId={(o) => o.id}
        rowTestId={(o) => `operation-${o.id}`}
        autoHeight
        pageSize={100}
        gridStateKey={props.gridStateKey}
      />
      {active ? <OperationActionHost active={active} onClose={() => setActive(null)} /> : null}
    </>
  );
}

type P = { data?: Operation };

function operationColumns(open: (a: OperationAction) => void, showOwner: boolean): ColDef<Operation>[] {
  const c = t.cols;
  const cols: (ColDef<Operation> | null)[] = [
    { colId: 'date', headerName: c.date, minWidth: 100, maxWidth: 120, valueGetter: (p) => p.data?.date, cellRenderer: (p: P) => <span data-col="date">{p.data?.date}</span> },
    showOwner
      ? {
          colId: 'owner',
          headerName: c.owner,
          minWidth: 120,
          valueGetter: (p) => p.data?.ownerName,
          cellRenderer: (p: P) =>
            p.data?.ownerId ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.ownerName ?? p.data.ownerId} /> : null,
        }
      : null,
    {
      colId: 'pseudonym',
      headerName: c.pseudonym,
      minWidth: 80,
      valueGetter: (p) => p.data?.pseudonym,
      cellRenderer: (p: P) =>
        p.data?.artistId ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym ?? p.data.artistId} /> : null,
    },
    {
      colId: 'meaning',
      headerName: c.meaning,
      minWidth: 120,
      valueGetter: (p) => p.data?.meaning,
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-col="meaning" title={t.direction[p.data.direction]}>
            <StatusChip kind="operationMeaning" value={p.data.meaning} /> <span className="text-xs text-muted">{t.directionShort[p.data.direction]}</span>
          </span>
        ) : null,
    },
    {
      colId: 'amount',
      headerName: c.amount,
      minWidth: 90,
      sortable: false,
      filter: false,
      valueGetter: (p) => p.data?.amountCents,
      cellRenderer: (p: P) => (p.data ? <span data-col="amount"><Money value={centsToText(p.data.amountCents)} /></span> : null),
    },
    {
      colId: 'actions',
      headerName: c.actions,
      minWidth: 480,
      sortable: false,
      filter: false,
      cellRenderer: (p: P) => (p.data ? <OperationButtons op={p.data} open={open} /> : null),
    },
    { colId: 'scope', headerName: c.scope, minWidth: 100, valueGetter: (p) => (p.data ? scopeText(p.data) : '') },
    {
      colId: 'state',
      headerName: c.state,
      minWidth: 230,
      sortable: false,
      valueGetter: (p) => (p.data ? stateText(p.data) : ''),
      cellRenderer: (p: P) =>
        p.data ? (
          <span className="text-xs" title={stateText(p.data)}>
            <span data-col="proof" data-value={p.data.paymentProofId ? 'yes' : 'no'}>
              {t.short.proof}: {p.data.direction === 'out' ? (p.data.paymentProofId ? ru.common.yes : ru.common.no) : t.proof.none}
            </span>
            {' · '}
            <span data-col="deferred" data-value={String(p.data.deferred)}>
              {t.short.deferred}: {p.data.deferred ? ru.common.yes : ru.common.no}
            </span>
            {' · '}
            <span data-col="active" data-value={String(p.data.active)} className={p.data.active ? '' : 'text-danger'}>
              {p.data.active ? t.active.yes : t.active.no}
            </span>
          </span>
        ) : null,
    },
    { colId: 'comment', headerName: c.comment, minWidth: 80, valueGetter: (p) => p.data?.comment },
  ];
  return cols.filter((x): x is ColDef<Operation> => x !== null);
}
