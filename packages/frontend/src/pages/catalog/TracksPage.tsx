import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { TrackCatalogItem, TrackSummaryItem } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { trackQueries } from '../../api/queries/tracks';
import { ActionButton } from '../../components/ActionButton';
import { ArtistLinks, artistsText } from '../../components/ArtistLinks';
import { EntityLink } from '../../components/EntityLink';
import { FormDialog } from '../../components/FormDialog';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { QueryView, StaleBadge } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { compareDecimal } from '../../lib/money';
import { useLabel } from '../../lib/label';
import { fmt, ru } from '../../i18n/ru';
import { useUrlParam } from './components/url';
import { FlagChip } from './components/FlagChip';

const t = ru.catalog.tracks;
const m = ru.catalog.money;

/** A row of P5: the track without money (the catalog) and, once asked, its money (a summary item). */
type TrackRow = Omit<TrackCatalogItem, 'registered'> & { money?: TrackSummaryItem };

const rowOfSummary = (i: TrackSummaryItem): TrackRow => ({
  isrc: i.isrc,
  upcs: i.upcs,
  title: i.title,
  artistName: i.artistName,
  artists: i.artists,
  hasSplit: i.hasSplit,
  hasParticipations: i.hasParticipations,
  money: i,
});

/**
 * P5 «Треки» (D-162). Without an account or month: the rows come from `GET /tracks/catalog` (no money) and the money
 * of the rows on the screen from `GET /tracks/summary?isrcs=` (one calculation of their units); a page seen before
 * is cached. With an account or month (the P1 drill-down) or «Посчитать все»: one `GET /tracks/summary` of every row,
 * as before, so the money columns sort. Every row is filtered on the client.
 */
export function TracksPage() {
  const [account, setAccount] = useUrlParam('account');
  const [month, setMonth] = useUrlParam('month');
  const [all, setAll] = useUrlParam('all');
  const [hasSplit, setHasSplit] = useUrlParam('hasSplit');
  const [q, setQ] = useUrlParam('q');
  const [creating, setCreating] = useState(false);
  const full = account !== '' || month !== '' || all === '1';
  // the label view (D-168): the ISRCs of the label's units and their money alone
  const { labelId } = useLabel();
  const summary = useQuery({ ...trackQueries.summary(account || undefined, month || undefined, labelId), enabled: full });
  const catalog = useQuery({ ...trackQueries.catalog(labelId), enabled: !full });
  // The ISRCs on the screen (page, sort, filter), settled for a moment before they are asked.
  const [visible, setVisible] = useState<readonly string[]>([]);
  const [asked, setAsked] = useState<readonly string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(visible), 150);
    return () => clearTimeout(timer);
  }, [visible]);
  const pageMoney = useQuery({ ...trackQueries.summaryOf(asked, labelId), enabled: !full && asked.length > 0 });
  // The money seen so far, by ISRC: a row keeps its numbers while the next page is asked.
  const moneyRef = useRef(new Map<string, TrackSummaryItem>());
  const [moneyVersion, setMoneyVersion] = useState(0);
  useEffect(() => {
    if (!pageMoney.data) return;
    for (const i of pageMoney.data.items) moneyRef.current.set(i.isrc, i);
    setMoneyVersion((v) => v + 1);
  }, [pageMoney.data]);
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
  const scoped = account !== '' || month !== '';
  const keep = useCallback(
    (i: TrackRow) =>
      // With an account or month scope the API still lists every track (zeros outside the scope): show those with units in it.
      (!scoped || (i.money?.months.count ?? 0) > 0) &&
      (hasSplit === '' || (hasSplit === 'yes') === i.hasSplit) &&
      (needle === '' ||
        [i.isrc, i.title, i.artistName, ...i.artists.map((a) => a.pseudonym), ...i.upcs].some((s) => s.toLocaleLowerCase('ru').includes(needle))),
    [scoped, hasSplit, needle],
  );
  const fullRows = useMemo(() => (summary.data ? summary.data.items.map(rowOfSummary).filter(keep) : []), [summary.data, keep]);
  const pagedRows = useMemo(
    () =>
      catalog.data
        ? catalog.data.items
            .map(({ registered: _registered, ...i }): TrackRow => ({ ...i, money: moneyRef.current.get(i.isrc) }))
            .filter(keep)
        : [],
    // moneyVersion: the money of a page arrived (the map is a ref)
    [catalog.data, keep, moneyVersion],
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
              <StaleBadge show={pageMoney.isFetching} />
            </>
          )
        ) : null}
      </div>
      <DataGrid
        rowData={rows}
        columnDefs={columns}
        getRowId={(r) => r.isrc}
        rowTestId={(r) => `track-${r.isrc}`}
        defaultSort={defaultSort}
        gridStateKey="grid"
        onVisibleRowsChanged={full ? undefined : onVisibleRowsChanged}
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
          <ActionButton name="create-track" onPress={() => setCreating(true)}>
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
      {full ? (
        <QueryView query={summary} money isEmpty={(d) => d.items.length === 0} emptyMessage={t.empty} emptyAction={emptyAction}>
          {() => grid(fullRows)}
        </QueryView>
      ) : (
        <QueryView query={catalog} isEmpty={(d) => d.items.length === 0} emptyMessage={t.empty} emptyAction={emptyAction}>
          {() => grid(pagedRows)}
        </QueryView>
      )}
      {creating ? <CreateTrackDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

type P = { data?: TrackRow };
const money = (col: 'net' | 'B' | 'C' | 'ours') => (p: P) =>
  p.data ? (
    p.data.money ? (
      <span data-col={col}>
        <Money value={p.data.money[col]} />
      </span>
    ) : (
      <span data-col={col} data-testid="money-pending" className="text-muted">
        {t.moneyPending}
      </span>
    )
  ) : null;

/** The money columns sort only when every row has its money (`full`); by pages they are not sortable. */
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
    { colId: 'title', headerName: c.title, minWidth: 160, valueGetter: (p) => p.data?.title },
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
    { colId: 'net', headerName: m.net, valueGetter: (p) => p.data?.money?.net, cellRenderer: money('net'), ...sums },
    { colId: 'B', headerName: m.B, valueGetter: (p) => p.data?.money?.B, cellRenderer: money('B'), ...sums },
    { colId: 'C', headerName: m.C, valueGetter: (p) => p.data?.money?.C, cellRenderer: money('C'), ...sums },
    { colId: 'ours', headerName: m.ours, valueGetter: (p) => p.data?.money?.ours, cellRenderer: money('ours'), ...sums },
    {
      colId: 'months',
      headerName: c.months,
      minWidth: 150,
      sortable: full,
      valueGetter: (p) =>
        p.data?.money ? `${p.data.money.months.count}: ${p.data.money.months.from ?? '—'} – ${p.data.money.months.to ?? '—'}` : '',
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
          name="create-track-submit"
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
