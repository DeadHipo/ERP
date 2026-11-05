import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { ArtistBalanceItem, ArtistListItem } from '@erp/shared/api-responses';
import { artistQueries } from '../../../api/queries/artists';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView, StaleBadge } from '../../../components/PageState';
import { StatusChip, statusLabel } from '../../../components/StatusChip';
import { DataGrid } from '../../../components/grid/DataGrid';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { compareDecimal } from '../../../lib/money';
import { fmt, ru } from '../../../i18n/ru';
import { useUrlParam } from '../../catalog/components/url';
import { CreateArtistDialog } from './CreateArtistDialog';

const t = ru.reference.artists;
const STATUSES = ['no_owner', 'unconfirmed', 'confirmed'] as const;
/** The most artist ids one `GET /artists/balances?ids=` takes (the API's cap, as for the owners). */
const IDS_PER_REQUEST = 200;

/** A row of P11: the pseudonym without money (the list) and, once asked, its balances item. */
type Row = ArtistListItem & { money?: ArtistBalanceItem };
type MoneyCol = 'earned' | 'waiting' | 'recouped' | 'adsCharged' | 'paid' | 'remaining';

/**
 * P11 «Псевдонимы» `/artists?q&status&all`: which pseudonyms exist, whose are they, on which tracks and rules, and
 * how much has each earned? Two phases (D-167, as P9): the rows from `GET /artists` (no money) and the money of the
 * rows on the screen from `GET /artists/balances?ids=` (one calculation of the units of their union reach; a page
 * seen before keeps its numbers); «Посчитать все» is one `GET /artists/balances` of every pseudonym, so the money
 * columns sort. The quick search and the status filter work on the loaded list; the payout stays the owner's.
 */
export function ArtistsPage() {
  const [q, setQ] = useUrlParam('q');
  const [status, setStatus] = useUrlParam('status');
  const [all, setAll] = useUrlParam('all');
  const [creating, setCreating] = useState(false);
  const full = all === '1';
  const list = useQuery(artistQueries.list());
  const allMoney = useQuery({ ...artistQueries.balances(), enabled: full });
  const [visible, setVisible] = useState<readonly string[]>([]);
  const [asked, setAsked] = useState<readonly string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(visible), 150);
    return () => clearTimeout(timer);
  }, [visible]);
  // Artist ids are UUIDs: a page of 500 would not fit one request line, so a page asks in chunks of 200 (the API's cap).
  const chunks = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < asked.length; i += IDS_PER_REQUEST) out.push(asked.slice(i, i + IDS_PER_REQUEST));
    return out;
  }, [asked]);
  const pageMoney = useQueries({
    queries: chunks.map((ids) => ({ ...artistQueries.balancesOf(ids), enabled: !full })),
    combine: (results) => ({
      items: results.flatMap((r) => r.data?.items ?? []),
      updatedAt: results.map((r) => r.dataUpdatedAt).join(','),
      isFetching: results.some((r) => r.isFetching),
    }),
  });
  // The money seen so far, by artist id: a row keeps its numbers while the next page is asked.
  const moneyRef = useRef(new Map<string, ArtistBalanceItem>());
  const [moneyVersion, setMoneyVersion] = useState(0);
  useEffect(() => {
    if (pageMoney.items.length === 0) return;
    for (const i of pageMoney.items) moneyRef.current.set(i.artistId, i);
    setMoneyVersion((v) => v + 1);
    // updatedAt: the chunks answered (the items array is rebuilt on every render)
  }, [pageMoney.updatedAt]);
  const onVisibleRowsChanged = useCallback((rows: Row[]) => {
    const next = rows.map((r) => r.id).sort();
    setVisible((prev) => (prev.join(',') === next.join(',') ? prev : next));
  }, []);
  const columns = useMemo(() => artistColumns(full), [full]);
  const needle = q.trim().toLocaleLowerCase('ru');
  const rows = useMemo(() => {
    const fullMoney = new Map((allMoney.data?.items ?? []).map((i) => [i.artistId, i]));
    return (list.data ?? [])
      .filter(
        (a) =>
          (status === '' || a.status === status) &&
          (needle === '' || [a.pseudonym, a.owner?.name ?? ''].some((s) => s.toLocaleLowerCase('ru').includes(needle))),
      )
      .map((a): Row => ({ ...a, money: full ? fullMoney.get(a.id) : moneyRef.current.get(a.id) }));
    // moneyVersion: the money of a page arrived (the map is a ref)
  }, [list.data, allMoney.data, full, status, needle, moneyVersion]);
  return (
    <div data-testid="artists-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <>
            <Link to="/artists/duplicates" className="text-sm text-accent hover:underline" data-testid="link-duplicates">
              {t.duplicatesLink}
            </Link>
            <ActionButton name="create-artist" onPress={() => setCreating(true)}>
              {t.create}
            </ActionButton>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-72">
          <TextField name="artists-q" label={t.q} value={q} onChange={setQ} type="search" />
        </div>
        <div className="w-52">
          <SelectField
            name="artists-status"
            label={t.status}
            value={status || 'all'}
            onChange={(v) => setStatus(v === 'all' ? '' : v)}
            options={[{ id: 'all', label: ru.reference.common.all }, ...STATUSES.map((s) => ({ id: s, label: statusLabel('artistStatus', s) }))]}
          />
        </div>
      </div>
      <QueryView query={list} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
        {() => (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span data-testid="artists-count">{fmt(ru.reference.common.count, { n: rows.length })}</span>
              {full ? (
                <>
                  <span data-testid="artists-all-money">{t.allMoney}</span>
                  <button type="button" className="text-accent hover:underline" data-testid="action-visible-only" onClick={() => setAll('')}>
                    {t.visibleOnly}
                  </button>
                  <StaleBadge show={allMoney.isFetching} />
                </>
              ) : (
                <>
                  <span data-testid="artists-visible-money">{t.visibleMoney}</span>
                  <button type="button" className="text-accent hover:underline" data-testid="action-compute-all" onClick={() => setAll('1')}>
                    {t.computeAll}
                  </button>
                  <StaleBadge show={pageMoney.isFetching} />
                </>
              )}
            </div>
            <div data-testid="artists-grid">
              <DataGrid
                key={full ? 'artists-all' : 'artists'}
                rowData={rows}
                columnDefs={columns}
                getRowId={(r) => r.id}
                rowTestId={(r) => `artist-${r.id}`}
                gridStateKey="grid"
                onVisibleRowsChanged={full ? undefined : onVisibleRowsChanged}
              />
            </div>
          </div>
        )}
      </QueryView>
      {creating ? <CreateArtistDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

type P = { data?: Row };
const pending = (col: string) => (
  <span data-col={col} data-testid="money-pending" className="text-muted">
    {t.moneyPending}
  </span>
);
const money = (colId: MoneyCol, headerName: string, sortable: boolean, headerTooltip = headerName): ColDef<Row> => ({
  colId,
  headerName,
  filter: false,
  sortable,
  // Wide enough for the largest amounts: money is never cut with an ellipsis.
  minWidth: 140,
  headerTooltip,
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
const count = (colId: 'tracks' | 'contracts' | 'undocumented', headerName: string, headerTooltip?: string): ColDef<Row> => ({
  colId,
  headerName,
  headerTooltip: headerTooltip ?? headerName,
  minWidth: 100,
  maxWidth: 140,
  filter: 'agNumberColumnFilter',
  valueGetter: (p) => p.data?.[colId],
  cellRenderer: (p: P) =>
    p.data ? (
      <span data-col={colId} className={colId === 'undocumented' && p.data.undocumented > 0 ? 'text-warning' : undefined}>
        {p.data[colId]}
      </span>
    ) : null,
});

/** The money columns sort only when every row has its money (`full`); by pages they are not sortable. */
function artistColumns(full: boolean): ColDef<Row>[] {
  const c = t.cols;
  return [
    {
      colId: 'pseudonym',
      headerName: c.pseudonym,
      minWidth: 180,
      valueGetter: (p) => p.data?.pseudonym,
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-testid={`artist-pseudonym-${p.data.id}`}>
            <EntityLink kind="artist" id={p.data.id} label={p.data.pseudonym} />
            {p.data.previousIds > 0 ? (
              <span className="ml-2 text-xs text-muted" title={t.mergedHint} data-testid={`artist-merged-${p.data.id}`}>
                {fmt(t.merged, { n: p.data.previousIds })}
              </span>
            ) : null}
          </span>
        ) : null,
    },
    {
      colId: 'owner',
      headerName: c.owner,
      minWidth: 170,
      valueGetter: (p) => p.data?.owner?.name ?? '',
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-testid={`artist-owner-${p.data.id}`} data-owner={p.data.owner?.id ?? ''}>
            {p.data.owner ? <EntityLink kind="owner" id={p.data.owner.id} label={p.data.owner.name} /> : <span className="text-muted">{ru.reference.common.none}</span>}
          </span>
        ) : null,
    },
    {
      colId: 'status',
      headerName: c.status,
      minWidth: 140,
      maxWidth: 170,
      valueGetter: (p) => (p.data ? statusLabel('artistStatus', p.data.status) : ''),
      cellRenderer: (p: P) => (p.data ? <StatusChip kind="artistStatus" value={p.data.status} /> : null),
    },
    count('tracks', c.tracks),
    {
      colId: 'rules',
      headerName: c.rules,
      headerTooltip: t.rulesHint,
      minWidth: 130,
      maxWidth: 160,
      filter: false,
      valueGetter: (p) => (p.data ? `${p.data.splitRows} / ${p.data.participations}` : ''),
      comparator: (_a, _b, na, nb) =>
        (na.data?.splitRows ?? 0) - (nb.data?.splitRows ?? 0) || (na.data?.participations ?? 0) - (nb.data?.participations ?? 0),
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-col="rules">
            <span data-col="splitRows">{p.data.splitRows}</span> / <span data-col="participations">{p.data.participations}</span>
          </span>
        ) : null,
    },
    count('contracts', c.contracts),
    count('undocumented', c.undocumented, t.undocumentedHint),
    money('earned', c.earned, full),
    money('waiting', c.waiting, full),
    money('recouped', c.recouped, full),
    money('adsCharged', c.adsCharged, full),
    money('paid', c.paid, full),
    money('remaining', c.remaining, full, t.remainingHint),
  ];
}
