import type { ReactNode } from 'react';
import type { ColDef } from 'ag-grid-community';
import type { Signals } from '@erp/shared/api-responses';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { Money } from '../../../components/Money';
import { PageState } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { compareDecimal } from '../../../lib/money';
import { fmt, ru } from '../../../i18n/ru';
import type { SignalName } from '../actions/action-table';
import { ACTION_OPS, type RowAction } from '../actions/action-ops';

// The parts every list of P21 is built from: the grid with its count line and the column helpers (one copy, used by
// `SignalsPage.tsx` and `label-signals.tsx`).

export const t = ru.signalsPage;
export const c = t.cols;

export type Open = (dialog: ReactNode) => void;

/** What a list renderer gets: the one `GET /signals` answer, the full count of its list and the dialog slot of the page. */
export type ListProps = { data: Signals; count: number; open: Open; close: () => void };

export function Grid<T>(props: {
  name: SignalName;
  rows: readonly T[];
  columns: ColDef<T>[];
  /** The key of the test hook `signal-row-<name>-<key>` (D-145). */
  rowKey: (r: T) => string;
  /** The grid's row id when the key is not unique (unfunded: one row per sales month). */
  rowId?: (r: T) => string;
  count: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm" data-testid="signal-total">
        {t.count}: {props.count}
        {props.rows.length < props.count ? ` · ${fmt(t.shown, { limit: props.rows.length, count: props.count })}` : ''}
      </div>
      {props.rows.length === 0 ? (
        <PageState variant="empty" message={t.empty} />
      ) : (
        <DataGrid
          rowData={props.rows}
          columnDefs={props.columns}
          getRowId={props.rowId ?? props.rowKey}
          rowTestId={(r) => `signal-row-${props.name}-${props.rowKey(r)}`}
          autoHeight
          pageSize={100}
          gridStateKey="grid"
        />
      )}
    </div>
  );
}

export const isrcCol = <T,>(get: (r: T) => string | null): ColDef<T> => ({
  colId: 'isrc',
  headerName: c.isrc,
  valueGetter: (p) => (p.data ? get(p.data) : null),
  cellRenderer: (p: { data?: T }) => {
    const v = p.data ? get(p.data) : null;
    return v ? <EntityLink kind="isrc" id={v} /> : <span className="text-muted">—</span>;
  },
});
export const moneyCol = <T,>(colId: string, headerName: string, get: (r: T) => string): ColDef<T> => ({
  colId,
  headerName,
  minWidth: 120,
  comparator: compareDecimal,
  valueGetter: (p) => (p.data ? get(p.data) : null),
  cellRenderer: (p: { data?: T }) => (p.data ? <span data-col={colId}><Money value={get(p.data)} /></span> : null),
});
export const textCol = <T,>(colId: string, headerName: string, get: (r: T) => string): ColDef<T> => ({
  colId,
  headerName,
  valueGetter: (p) => (p.data ? get(p.data) : ''),
});
export const actionCol = <T,>(render: (r: T) => ReactNode): ColDef<T> => ({
  colId: 'action',
  headerName: c.action,
  minWidth: 300,
  autoHeight: true,
  wrapText: true,
  sortable: false,
  filter: false,
  cellRenderer: (p: { data?: T }) => (p.data ? <div className="flex flex-wrap items-center gap-1 py-1">{render(p.data)}</div> : null),
});
export const btn = (name: RowAction, label: string, onPress: () => void) => (
  <ActionButton key={name} name={name} op={ACTION_OPS[name]} variant="secondary" compact onPress={onPress}>
    {label}
  </ActionButton>
);
export const info = (text: string) => <span className="text-xs text-muted">{text}</span>;
