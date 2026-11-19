import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { MasterRow, TrackCatalogItem, TrackSummaryItem } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { useMasterRows } from '../../api/queries/money';
import { trackQueries, useCachedTrack, useTracks } from '../../api/queries/tracks';
import { ActionButton } from '../../components/ActionButton';
import { ArtistLinks, artistsText } from '../../components/ArtistLinks';
import { TrackName } from '../../components/TrackName';
import { EntityLink } from '../../components/EntityLink';
import { FormDialog } from '../../components/FormDialog';
import { PageHeader } from '../../components/PageHeader';
import { PageState, QueryView, StaleBadge } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { MoneyValue } from '../../components/money-blocks/MoneyCells';
import { rowsByIsrc } from '../../components/money-blocks/rows';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { isrcKey } from '../../lib/isrc';
import { compareDecimal } from '../../lib/money';
import { useLabel } from '../../lib/label';
import { fmt, ru } from '../../i18n/ru';
import { useUrlParam } from './components/url';
import { FlagChip } from './components/FlagChip';

const t = ru.catalog.tracks;
const m = ru.catalog.money;

/** The money of a row: the sums and the report months of a row of the master money (`MasterRow`). */
type RowMoney = Pick<MasterRow, 'sums' | 'months'>;

/**
 * A row of P5: the track without money (the catalog) and its money. `money` is `undefined` until the answer that
 * covers the row arrives and `null` when that answer has no row for it (no units: the cells read «—», D-255).
 * `moneyNotAsked` marks a row the paged request cannot name (its ISRC is not in the ISRC format): its money is not
 * known by pages (it may well have units), so its cells read «?» with a hint, never «—» and never «…». The old paged
 * read could not name it either: `GET /tracks/summary?isrcs=` refused the whole list with 400 and the page stayed on «…».
 */
type TrackRow = Omit<TrackCatalogItem, 'registered'> & { money?: RowMoney | null; moneyNotAsked?: true };

/** The most ISRCs one `POST /money/master/query` takes (`masterQueryBody`); a grid page is far smaller. */
const MAX_ASKED = 5000;

type CatalogFields = Pick<TrackCatalogItem, 'catalogLabelId' | 'catalogLabelName' | 'catalogFrom'>;
const NO_CATALOG: CatalogFields = { catalogLabelId: null, catalogLabelName: null, catalogFrom: null };

/**
 * A summary item as a row (the account / month mode); its catalog label (D-172) comes from the catalog read of the
 * same label view. Its money is the item's own sums and months, in the shape of a master row.
 */
const rowOfSummary = (i: TrackSummaryItem, catalogOf: Map<string, CatalogFields>): TrackRow => ({
  isrc: i.isrc,
  upcs: i.upcs,
  title: i.title,
  artistName: i.artistName,
  artists: i.artists,
  hasSplit: i.hasSplit,
  hasParticipations: i.hasParticipations,
  meta: i.meta,
  ...(catalogOf.get(i.isrc) ?? NO_CATALOG),
  money: { sums: i, ...(i.months.from !== null && i.months.to !== null ? { months: { from: i.months.from, to: i.months.to, count: i.months.count } } : {}) },
});

/**
 * P5 «Треки» (D-162, D-255). The rows come from `GET /tracks/catalog` (no money). Their money is one block of the
 * master money (`useMasterRows`, grain `isrc`, one request):
 *
 * - by pages (the default): the ISRCs of the rows on the screen (`{ kind: 'isrcs', isrcs }`); a page seen before keeps
 *   its numbers; the money columns do not sort;
 * - «Посчитать все» (`all=1`): every ISRC (`{ kind: 'isrcs' }` without a list); the money columns sort.
 *
 * A row the answer does not name has no units and reads «—». With an account or month (the P1 drill-down) the page is
 * one `GET /tracks/summary` of every row, as before: the master rows have no such filters. Every row is filtered on
 * the client.
 */
export function TracksPage() {
  const [account, setAccount] = useUrlParam('account');
  const [month, setMonth] = useUrlParam('month');
  const [all, setAll] = useUrlParam('all');
  const [hasSplit, setHasSplit] = useUrlParam('hasSplit');
  const [q, setQ] = useUrlParam('q');
  // D-172: `catalog=current` = only the ISRCs whose open label-history interval is the label (any, under «Все»)
  const [catalogParam, setCatalogParam] = useUrlParam('catalog');
  const current = catalogParam === 'current';
  const [creating, setCreating] = useState(false);
  const scoped = account !== '' || month !== '';
  const allMode = !scoped && all === '1';
  // every row has its money (or will, by one answer): the money columns sort
  const full = scoped || allMode;
  // the label view (D-168): the ISRCs of the label's units and their money alone
  const { labelId } = useLabel();
  const summary = useQuery({ ...trackQueries.summary(account || undefined, month || undefined, labelId), enabled: scoped });
  // the catalog read (no money) also gives the catalog label of the rows of a full summary
  const catalog = useQuery(trackQueries.catalog(labelId, current));
  const catalogOf = useMemo(
    () => new Map((catalog.data?.items ?? []).map((i): [string, CatalogFields] => [i.isrc, { catalogLabelId: i.catalogLabelId, catalogLabelName: i.catalogLabelName, catalogFrom: i.catalogFrom }])),
    [catalog.data],
  );
  // The ISRCs on the screen (page, sort, filter), settled for a moment before they are asked.
  const [visible, setVisible] = useState<readonly string[]>([]);
  const [asked, setAsked] = useState<readonly string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(visible), 150);
    return () => clearTimeout(timer);
  }, [visible]);
  // The list of the money request: only strings in the ISRC format (the server refuses the whole list otherwise),
  // each once, sorted, so the same rows are the same cache entry. The cut at `MAX_ASKED` is never reached: the list is
  // the rows of one grid page (50, 100 or 500, `DataGrid`); it only keeps the request inside the limit of the schema.
  const askedIsrcs = useMemo(() => [...new Set(asked.flatMap((i) => isrcKey(i) ?? []))].sort().slice(0, MAX_ASKED), [asked]);
  const pageMoney = useMasterRows({ kind: 'isrcs', isrcs: askedIsrcs }, 'isrc', { enabled: !full && askedIsrcs.length > 0 });
  const allMoney = useMasterRows({ kind: 'isrcs' }, 'isrc', { enabled: allMode });
  const money = allMode ? allMoney : pageMoney;
  // The tracks of the rows on the screen (D-250), in both modes: asked here, like the money, and read from the
  // cache by the title cell of each row (`TitleCell`); the rows and their texts stay those of the catalog.
  useTracks(asked);
  // The money seen so far, by ISRC: a row keeps its numbers while the next page is asked. `null` = asked, no units.
  const moneyRef = useRef(new Map<string, RowMoney | null>());
  const [moneyVersion, setMoneyVersion] = useState(0);
  useEffect(() => {
    if (!pageMoney.data) return;
    // the answer is the one of `askedIsrcs` (the key of the query): an ISRC asked and not answered has no units
    const rowOf = rowsByIsrc(pageMoney.data.rows);
    for (const i of askedIsrcs) moneyRef.current.set(i, rowOf.get(i) ?? null);
    setMoneyVersion((v) => v + 1);
  }, [pageMoney.data, askedIsrcs]);
  // a new label changes every row's money: forget what was seen under the old one
  useEffect(() => {
    moneyRef.current.clear();
    setMoneyVersion((v) => v + 1);
  }, [labelId]);
  const onVisibleRowsChanged = useCallback((rows: TrackRow[]) => {
    const next = rows.map((r) => r.isrc).sort();
    setVisible((prev) => (prev.join(',') === next.join(',') ? prev : next));
  }, []);
  const columns = useMemo(() => trackColumns(full), [full]);
  // The P1 drill-down (B or ours of an account and month) opens the list sorted by that column, largest first; the
  // column travels in the router state, so the link itself stays `/tracks?account&month`.
  const location = useLocation();
  const sortBy = (location.state as { sortBy?: unknown } | null)?.sortBy;
  const defaultSort = full && (sortBy === 'B' || sortBy === 'ours') ? ([sortBy, 'desc'] as const) : undefined;
  const needle = q.trim().toLocaleLowerCase('ru');
  const keep = useCallback(
    (i: TrackRow) =>
      // With an account or month scope the API still lists every track (zeros outside the scope): show those with units in it.
      (!scoped || (i.money?.months?.count ?? 0) > 0) &&
      (hasSplit === '' || (hasSplit === 'yes') === i.hasSplit) &&
      (needle === '' ||
        [i.isrc, i.title, i.meta?.title ?? '', i.meta?.version ?? '', i.artistName, ...i.artists.map((a) => a.pseudonym), ...i.upcs].some((s) =>
          s.toLocaleLowerCase('ru').includes(needle),
        )),
    [scoped, hasSplit, needle],
  );
  const fullRows = useMemo(
    () =>
      summary.data
        ? summary.data.items
            .filter((i) => !current || catalogOf.has(i.isrc))
            .map((i) => rowOfSummary(i, catalogOf))
            .filter(keep)
        : [],
    [summary.data, keep, current, catalogOf],
  );
  const pagedRows = useMemo(
    () =>
      catalog.data
        ? catalog.data.items
            .map(({ registered: _registered, ...i }): TrackRow => {
              const key = isrcKey(i.isrc);
              return key === null ? { ...i, moneyNotAsked: true } : { ...i, money: moneyRef.current.get(key) };
            })
            .filter(keep)
        : [],
    // moneyVersion: the money of a page arrived (the map is a ref)
    [catalog.data, keep, moneyVersion],
  );
  // «Посчитать все»: the same rows of the catalog; the money of each is its row of the one answer over every ISRC
  const allRowOf = useMemo(() => (allMoney.data ? rowsByIsrc(allMoney.data.rows) : undefined), [allMoney.data]);
  const allRows = useMemo(
    () =>
      catalog.data
        ? catalog.data.items
            .map(({ registered: _registered, ...i }): TrackRow => ({ ...i, money: allRowOf ? (allRowOf.get(isrcKey(i.isrc) ?? i.isrc) ?? null) : undefined }))
            .filter(keep)
        : [],
    [catalog.data, keep, allRowOf],
  );
  const grid = (rows: TrackRow[]) => (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span data-testid="tracks-count">{fmt(t.count, { n: rows.length })}</span>
        {!scoped ? (
          full ? (
            <>
              <span data-testid="tracks-all-money">{t.allMoney}</span>
              <button type="button" className="text-accent hover:underline" data-testid="action-visible-only" onClick={() => setAll('')}>
                {t.visibleOnly}
              </button>
            </>
          ) : (
            <>
              <span data-testid="tracks-visible-money">{t.visibleMoney}</span>
              <button type="button" className="text-accent hover:underline" data-testid="action-compute-all" onClick={() => setAll('1')}>
                {t.computeAll}
              </button>
            </>
          )
        ) : null}
        {/* by pages every request is shown as a refresh (D-162); «Посчитать все» has the long panel until its answer */}
        {!scoped ? <StaleBadge show={money.isFetching && (!allMode || money.data !== undefined)} /> : null}
      </div>
      {/* the states of the money block: the rows of the catalog stay under them */}
      {!scoped && money.isError && money.data === undefined ? (
        <div data-testid="tracks-money-error">
          <PageState variant="error" error={money.error} onRetry={() => void money.refetch()} />
        </div>
      ) : allMode && money.data === undefined ? (
        <PageState variant="long" />
      ) : null}
      <DataGrid
        rowData={rows}
        columnDefs={columns}
        getRowId={(r) => r.isrc}
        rowTestId={(r) => `track-${r.isrc}`}
        defaultSort={defaultSort}
        gridStateKey="grid"
        onVisibleRowsChanged={onVisibleRowsChanged}
      />
    </div>
  );
  const emptyAction = (
    <Link to="/sources" className="text-accent hover:underline">
      {t.toSources}
    </Link>
  );
  return (
    <div data-testid="tracks-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="create-track" op="POST /tracks" onPress={() => setCreating(true)}>
            {t.create}
          </ActionButton>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        {account || month ? (
          <div className="flex items-center gap-2 text-sm" data-testid="tracks-scope">
            {fmt(t.scope, { account: account || '—', month: month || '—' })}
            <button
              type="button"
              className="text-accent hover:underline"
              data-testid="action-clear-scope"
              onClick={() => {
                setAccount('');
                setMonth('');
              }}
            >
              {t.clearScope}
            </button>
          </div>
        ) : null}
        <div className="w-72">
          <TextField name="tracks-q" label={t.q} value={q} onChange={setQ} type="search" />
        </div>
        <ActionButton
          name="catalog-current"
          write={false}
          variant={current ? 'primary' : 'secondary'}
          onPress={() => setCatalogParam(current ? '' : 'current')}
        >
          <span data-active={current ? 'true' : 'false'} title={t.catalogCurrentHint}>
            {current ? t.catalogAll : t.catalogCurrent}
          </span>
        </ActionButton>
        <div className="w-72">
          <SelectField
            name="tracks-has-split"
            label={t.hasSplit}
            value={hasSplit || 'all'}
            onChange={(v) => setHasSplit(v === 'all' ? '' : v)}
            options={[
              { id: 'all', label: t.all },
              { id: 'yes', label: t.withSplit },
              { id: 'no', label: t.withoutSplit },
            ]}
          />
        </div>
      </div>
      {scoped ? (
        <QueryView query={summary} money isEmpty={(d) => d.items.length === 0} emptyMessage={t.empty} emptyAction={emptyAction}>
          {() => grid(fullRows)}
        </QueryView>
      ) : (
        <QueryView query={catalog} isEmpty={(d) => d.items.length === 0} emptyMessage={t.empty} emptyAction={emptyAction}>
          {() => grid(allMode ? allRows : pagedRows)}
        </QueryView>
      )}
      {creating ? <CreateTrackDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

type P = { data?: TrackRow };
type MoneyCol = 'net' | 'B' | 'C' | 'ours';
/** The value of a money column: the server's string; `null` = no units («—»), `undefined` = not answered yet. */
const moneyValue = (col: MoneyCol) => (p: P) => (p.data?.money === null ? null : p.data?.money?.sums[col]);
/**
 * A money cell: «?» for a row that is not asked by pages (its money is unknown, not absent), «…» until the answer,
 * then the rule of the money blocks (`MoneyValue`: the string, «—» without sums = no units).
 */
const money = (col: MoneyCol) => (p: P) =>
  p.data ? (
    p.data.moneyNotAsked ? (
      <span data-col={col} data-money-not-asked="true" data-testid="money-not-asked" className="text-muted" title={t.moneyNotAsked}>
        {t.moneyNotAskedMark}
      </span>
    ) : p.data.money !== undefined ? (
      <span data-col={col} data-no-units={p.data.money === null ? 'true' : undefined}>
        <MoneyValue sums={p.data.money?.sums} col={col} />
      </span>
    ) : (
      <span data-col={col} data-testid="money-pending" className="text-muted">
        {t.moneyPending}
      </span>
    )
  ) : null;

/**
 * The name of a row (D-250): the track of the directory once the page's `useTracks` brought it, the catalog title
 * until then. The cell reads the cache itself: the grid redraws a cell only when its value changes, and the value of
 * this column stays the catalog text.
 */
function TitleCell({ isrc, title }: { isrc: string; title: string }) {
  return <TrackName isrc={isrc} track={useCachedTrack(isrc)} fallbackTitle={title} />;
}

/** The money columns sort only when every row has its money (`full`); by pages they are not sortable. A row without units («—») sorts before every amount. */
function trackColumns(full: boolean): ColDef<TrackRow>[] {
  const c = t.cols;
  const sums = { comparator: compareDecimal, filter: false, sortable: full, minWidth: 130 };
  return [
    {
      colId: 'isrc',
      headerName: c.isrc,
      minWidth: 150,
      valueGetter: (p) => p.data?.isrc,
      cellRenderer: (p: P) => (p.data ? <EntityLink kind="isrc" id={p.data.isrc} /> : null),
    },
    // D-242: the cover, the title and «version · ISRC» of the track; the cell shows the track of the directory once it
    // arrived (D-250) and the catalog title until then; the filter, sort and export text stays the catalog row's
    {
      colId: 'title',
      headerName: c.title,
      minWidth: 220,
      autoHeight: true,
      valueGetter: (p) => (p.data ? [p.data.meta?.title ?? p.data.title, p.data.meta?.version, p.data.isrc].filter(Boolean).join(' · ') : ''),
      cellRenderer: (p: P) => (p.data ? <TitleCell isrc={p.data.isrc} title={p.data.title} /> : null),
    },
    // The pseudonyms of the registry as links to P12 (D-166); the report string, muted, when the registry names none.
    {
      colId: 'artist',
      headerName: c.artist,
      minWidth: 160,
      wrapText: true,
      autoHeight: true,
      valueGetter: (p) => (p.data ? artistsText(p.data.artists, p.data.artistName) : ''),
      cellRenderer: (p: P) => (p.data ? <ArtistLinks artists={p.data.artists} reportName={p.data.artistName} /> : null),
    },
    // D-172: the label of the open label-history interval; not the book (the money of a row is by the files' label)
    {
      colId: 'catalogLabel',
      headerName: ru.catalog.catalogLabel.col,
      headerTooltip: ru.catalog.catalogLabel.hint,
      minWidth: 140,
      valueGetter: (p) => p.data?.catalogLabelName ?? '',
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-col="catalogLabel" data-label-id={p.data.catalogLabelId ?? ''} title={p.data.catalogFrom ? fmt(ru.catalog.catalogLabel.since, { from: p.data.catalogFrom }) : undefined}>
            {p.data.catalogLabelName ?? ru.catalog.catalogLabel.none}
          </span>
        ) : null,
    },
    {
      colId: 'upcs',
      headerName: c.upcs,
      minWidth: 150,
      valueGetter: (p) => p.data?.upcs.join(', '),
      cellRenderer: (p: P) =>
        p.data ? (
          <span className="flex flex-wrap gap-1">
            {p.data.upcs.map((u) => (
              <EntityLink key={u} kind="upc" id={u} />
            ))}
          </span>
        ) : null,
    },
    // Money columns sort by `compareDecimal` (sign, integer length, digits; no number is made); the API order (by ISRC) is the default.
    { colId: 'net', headerName: m.net, valueGetter: moneyValue('net'), cellRenderer: money('net'), ...sums },
    { colId: 'B', headerName: m.B, valueGetter: moneyValue('B'), cellRenderer: money('B'), ...sums },
    { colId: 'C', headerName: m.C, valueGetter: moneyValue('C'), cellRenderer: money('C'), ...sums },
    { colId: 'ours', headerName: m.ours, valueGetter: moneyValue('ours'), cellRenderer: money('ours'), ...sums },
    {
      colId: 'months',
      headerName: c.months,
      minWidth: 150,
      sortable: full,
      // the report months of the row's units (`MasterRow.months`); nothing for a row without units
      valueGetter: (p) => (p.data?.money?.months ? `${p.data.money.months.count}: ${p.data.money.months.from} – ${p.data.money.months.to}` : ''),
    },
    {
      colId: 'hasSplit',
      headerName: c.hasSplit,
      maxWidth: 130,
      valueGetter: (p) => (p.data?.hasSplit ? t.yes : t.no),
      cellRenderer: (p: P) =>
        p.data ? (
          <FlagChip name="has-split" value={p.data.hasSplit} yes={t.yes} no={t.no} warnOnNo />
        ) : null,
    },
    {
      colId: 'hasParticipations',
      headerName: c.hasParticipations,
      maxWidth: 120,
      valueGetter: (p) => (p.data?.hasParticipations ? t.yes : t.no),
      cellRenderer: (p: P) =>
        p.data ? <FlagChip name="has-participations" value={p.data.hasParticipations} yes={t.yes} no={t.no} /> : null,
    },
  ];
}

function CreateTrackDialog({ onClose }: { onClose: () => void }) {
  const f = ru.actions.fields;
  const [title, setTitle] = useState('');
  const [isrc, setIsrc] = useState('');
  const [upc, setUpc] = useState('');
  const run = useAction(
    () => api.tracks.create({ title: title.trim(), isrc: isrc.trim() || null, upc: upc.trim() || null }),
    { invalidate: 'all', success: (tr) => fmt(t.created, { isrc: tr.isrc ?? tr.title }) },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : onClose())}
      title={t.create}
      subtitle={t.createSubtitle}
      footer={
        <ActionButton
          name="create-track-submit" op="POST /tracks"
          isPending={run.isPending}
          isDisabled={title.trim() === ''}
          reason={title.trim() === '' ? ru.actions.hints.fillFields : undefined}
          onPress={() => run.mutate(undefined, { onSuccess: onClose })}
        >
          {ru.common.create}
        </ActionButton>
      }
    >
      <TextField name="track-title" label={f.trackTitle} value={title} onChange={setTitle} isRequired />
      <TextField name="track-isrc" label={f.isrc} value={isrc} onChange={setIsrc} />
      <TextField name="track-upc" label={f.upc} value={upc} onChange={setUpc} />
    </FormDialog>
  );
}
