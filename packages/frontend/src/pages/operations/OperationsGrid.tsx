import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ColDef } from 'ag-grid-community';
import type { Operation } from '@erp/shared/api-responses';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { StatusChip, statusLabel } from '../../components/StatusChip';
import { DataGrid } from '../../components/grid/DataGrid';
import { OperatorNotice } from '../../components/ActionButton';
import { settlementQueries } from '../../api/queries/settlements';
import { useLabel } from '../../lib/label';
import { ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';
import { OperationActionHost, OperationButtons, type OperationAction } from './OperationActions';

const t = ru.money.operations;

/** The kinds with a payment proof (D-173 FIX-4): a payout, an advance, a buyout. */
const proofKind = (op: Operation) => op.kind === 'payout' || op.kind === 'advance' || op.kind === 'buyout';

const stateText = (op: Operation) =>
  [
    `${t.cols.proof}: ${proofKind(op) ? (op.paymentProofId ? t.proof.yes : t.proof.no) : t.proof.none}`,
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
 * The operations of P20 and of the owner's Операции tab: one grid, rows `operation-<id>`, the same row actions. Nothing is
 * cut (stage 3 product finding 3): «Смысл» and «Состояние» wrap, the action buttons wrap inside a wide column, and the
 * row grows to fit (autoHeight cells).
 */
export function OperationsGrid(props: { rows: Operation[]; showOwner?: boolean; gridStateKey?: string }) {
  const [active, setActive] = useState<OperationAction | null>(null);
  const columns = useMemo(() => operationColumns(setActive, props.showOwner !== false), [props.showOwner]);
  return (
    <>
      <OperatorNotice />
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
          minWidth: 150,
          valueGetter: (p) => p.data?.ownerName,
          cellRenderer: (p: P) =>
            p.data?.ownerId ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.ownerName ?? p.data.ownerId} /> : null,
        }
      : null,
    {
      colId: 'pseudonym',
      headerName: c.pseudonym,
      minWidth: 110,
      valueGetter: (p) => p.data?.pseudonym,
      cellRenderer: (p: P) =>
        p.data?.artistId ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym ?? p.data.artistId} /> : null,
    },
    {
      colId: 'kind',
      headerName: ru.operations.kind.field,
      minWidth: 150,
      wrapText: true,
      autoHeight: true,
      valueGetter: (p) => (p.data ? statusLabel('operationKind', p.data.kind) : ''),
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-col="kind" data-kind={p.data.kind} className="inline-flex flex-wrap items-center gap-1 py-1" title={t.direction[p.data.direction]}>
            <StatusChip kind="operationKind" value={p.data.kind} /> <span className="text-xs text-muted">{t.directionShort[p.data.direction]}</span>
            {p.data.area === 'publishing' ? <span className="text-xs text-muted" data-col="area">{ru.operations.kind.areas.publishing}</span> : null}
          </span>
        ) : null,
    },
    {
      colId: 'amount',
      headerName: c.amount,
      minWidth: 120,
      filter: false,
      valueGetter: (p) => p.data?.amountCents,
      cellRenderer: (p: P) => (p.data ? <span data-col="amount"><Money value={centsToText(p.data.amountCents)} /></span> : null),
    },
    { colId: 'scope', headerName: c.scope, minWidth: 100, valueGetter: (p) => (p.data ? scopeText(p.data) : '') },
    {
      colId: 'label',
      headerName: c.label,
      minWidth: 90,
      valueGetter: (p) => p.data?.labelName ?? '',
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-col="label" data-label-id={p.data.labelId ?? ''} className={p.data.labelId ? '' : 'text-muted'}>
            {p.data.labelName ?? ru.money.balance.unmappedLabel}
          </span>
        ) : null,
    },
    {
      colId: 'cut',
      headerName: ru.cuts.cols.name,
      minWidth: 90,
      valueGetter: (p) => p.data?.cutId ?? '',
      cellRenderer: (p: P) => (p.data?.cutId ? <CutName id={p.data.cutId} /> : null),
    },
    {
      colId: 'labelSource',
      headerName: ru.operations.labelSource.col,
      minWidth: 110,
      valueGetter: (p) => (p.data?.labelSource ? statusLabel('labelSource', p.data.labelSource) : ''),
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-col="labelSource" data-value={p.data.labelSource ?? ''}>
            {p.data.labelSource ? <StatusChip kind="labelSource" value={p.data.labelSource} /> : null}
          </span>
        ) : null,
    },
    {
      colId: 'state',
      headerName: c.state,
      minWidth: 170,
      autoHeight: true,
      sortable: false,
      valueGetter: (p) => (p.data ? stateText(p.data) : ''),
      cellRenderer: (p: P) =>
        p.data ? (
          <span className="flex flex-col py-1 text-xs leading-tight" title={stateText(p.data)}>
            <span data-col="proof" data-value={p.data.paymentProofId ? 'yes' : 'no'}>
              {t.short.proof}: {proofKind(p.data) ? (p.data.paymentProofId ? ru.common.yes : ru.common.no) : t.proof.none}
            </span>
            <span data-col="deferred" data-value={String(p.data.deferred)}>
              {t.short.deferred}: {p.data.deferred ? ru.common.yes : ru.common.no}
            </span>
            <span data-col="active" data-value={String(p.data.active)} className={p.data.active ? '' : 'text-danger'}>
              {p.data.active ? t.active.yes : t.active.no}
            </span>
          </span>
        ) : null,
    },
    {
      colId: 'actions',
      headerName: c.actions,
      minWidth: 300,
      flex: 2,
      autoHeight: true,
      sortable: false,
      filter: false,
      cellRenderer: (p: P) => (p.data ? <OperationButtons op={p.data} open={open} /> : null),
    },
    { colId: 'comment', headerName: c.comment, minWidth: 140, tooltipValueGetter: (p) => p.data?.comment, valueGetter: (p) => p.data?.comment },
  ];
  return cols.filter((x): x is ColDef<Operation> => x !== null);
}

/** The name of the cut an operation is attributed to (D-199), from the list of the cuts (no calculation). */
function CutName(props: { id: string }) {
  const { labelId } = useLabel(); // a manager reads the cuts of its label only
  const cuts = useQuery(settlementQueries.cuts(labelId));
  const cut = cuts.data?.items.find((c) => c.id === props.id);
  return (
    <span data-col="cut" data-cut-id={props.id}>
      {cut ? `${cut.name} · ${cut.cutDate}` : props.id}
    </span>
  );
}
