import { useCallback, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import { useSearchParams } from 'react-router-dom';
import { GRID_THEME } from './theme';
import { AG_GRID_LOCALE_RU } from './locale-ru';

/** Page sizes of every list (the largest list is 26 k tracks, loaded once and paged on the client). */
export const PAGE_SIZES = [50, 100, 500];
const DEFAULT_COL_DEF: ColDef = { sortable: true, filter: true, resizable: true, flex: 1, minWidth: 90 };

// Sort and filter state in one URL parameter, compact JSON: {"s":[["colId","asc"]],"f":{"colId":{...}}}.
function readState(raw: string | null): { s?: [string, 'asc' | 'desc'][]; f?: Record<string, unknown> } {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { s?: [string, 'asc' | 'desc'][]; f?: Record<string, unknown> };
  } catch {
    return {};
  }
}

/**
 * The one list component (17 §5): AG Grid Community, one theme on the HeroUI variables, Russian texts, client-side
 * rows with pagination 50 / 100 / 500. Rows are addressable as `[row-id="<key>"]` (AG Grid's own `row-id` attribute on
 * `.ag-row`, set from `getRowId`). Sort and filter live in the URL under `gridStateKey` when it is given.
 */
export function DataGrid<T>(props: {
  rowData: readonly T[];
  columnDefs: ColDef<T>[];
  /** Required: the stable key of a row (ISRC, UPC, id, `account|month`, group key). */
  getRowId: (row: T) => string;
  onRowClicked?: (row: T) => void;
  /** URL parameter that keeps the sort and filter model; omit for a grid whose state is not shared. */
  gridStateKey?: string;
  /** CSS height of the grid box; the default fills the viewport under the page header. */
  height?: string;
  pageSize?: number;
  loading?: boolean;
  /** A `data-testid` for the row element (e.g. `queue-group-<kind>-<id>`), set when AG Grid creates the row. */
  rowTestId?: (row: T) => string;
  /** The grid grows with its rows (no inner scroll, every row of the page is in the DOM): for short lists. */
  autoHeight?: boolean;
  /** `false` for a list paged by the server (the page has its own pager): one pagination control per grid. */
  pagination?: boolean;
  /** The sort applied when the URL carries no grid state (e.g. the P1 drill-down sorts by B or ours). */
  defaultSort?: readonly [string, 'asc' | 'desc'];
}) {
  const [params, setParams] = useSearchParams();
  const apiRef = useRef<GridApi<T> | null>(null);
  const key = props.gridStateKey;

  const save = useCallback(() => {
    const api = apiRef.current;
    if (!api || !key) return;
    const sort = api
      .getColumnState()
      .filter((c) => c.sort)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
      .map((c) => [c.colId, c.sort] as [string, 'asc' | 'desc']);
    const filter = api.getFilterModel() as Record<string, unknown>;
    const empty = sort.length === 0 && Object.keys(filter).length === 0;
    const value = empty ? null : JSON.stringify({ s: sort.length ? sort : undefined, f: Object.keys(filter).length ? filter : undefined });
    setParams(
      (prev) => {
        if ((prev.get(key) ?? null) === value) return prev;
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }, [key, setParams]);

  const defaultSort = props.defaultSort;
  const onGridReady = useCallback(
    (e: GridReadyEvent<T>) => {
      apiRef.current = e.api;
      if (!key) {
        if (defaultSort) e.api.applyColumnState({ state: [{ colId: defaultSort[0], sort: defaultSort[1], sortIndex: 0 }] });
        return;
      }
      const state = readState(params.get(key));
      const sort = state.s?.length ? state.s : defaultSort ? [defaultSort] : [];
      if (sort.length) e.api.applyColumnState({ state: sort.map(([colId, dir], i) => ({ colId, sort: dir, sortIndex: i })) });
      if (state.f) e.api.setFilterModel(state.f);
    },
    // The initial URL state is applied once, when the grid is created.
    [key, defaultSort],
  );

  const getRowIdFn = useCallback((p: { data: T }) => props.getRowId(p.data), [props]);
  const localeText = useMemo(() => AG_GRID_LOCALE_RU, []);
  const pageSize = props.pageSize ?? PAGE_SIZES[0];
  const rowTestId = props.rowTestId;
  const processRowPostCreate = useCallback(
    (p: { eRow: HTMLElement; node: { data?: T } }) => {
      if (rowTestId && p.node.data) p.eRow.setAttribute('data-testid', rowTestId(p.node.data));
    },
    [rowTestId],
  );

  return (
    <div
      data-testid="data-grid"
      style={props.autoHeight ? undefined : { height: props.height ?? 'calc(100vh - 16rem)', minHeight: 360 }}
    >
      <AgGridReact<T>
        theme={GRID_THEME}
        rowData={props.rowData as T[]}
        columnDefs={props.columnDefs}
        defaultColDef={DEFAULT_COL_DEF}
        getRowId={getRowIdFn}
        localeText={localeText}
        pagination={props.pagination !== false}
        paginationPageSize={pageSize}
        paginationPageSizeSelector={props.pagination === false ? false : PAGE_SIZES}
        rowHeight={36}
        loading={props.loading}
        domLayout={props.autoHeight ? 'autoHeight' : 'normal'}
        processRowPostCreate={processRowPostCreate}
        onGridReady={onGridReady}
        onSortChanged={save}
        onFilterChanged={save}
        onRowClicked={(e) => {
          if (e.data && props.onRowClicked) props.onRowClicked(e.data);
        }}
        suppressCellFocus={false}
        // Every column is in the DOM even when the grid scrolls sideways (a few columns per grid; the hooks of the
        // right-hand cells must exist on a narrow screen).
        suppressColumnVirtualisation
      />
    </div>
  );
}
