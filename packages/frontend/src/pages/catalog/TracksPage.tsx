import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { TrackSummaryItem } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { trackQueries } from '../../api/queries/tracks';
import { ActionButton } from '../../components/ActionButton';
import { EntityLink } from '../../components/EntityLink';
import { FormDialog } from '../../components/FormDialog';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { compareDecimal } from '../../lib/money';
import { fmt, ru } from '../../i18n/ru';
import { useUrlParam } from './components/url';
import { FlagChip } from './components/FlagChip';

const t = ru.catalog.tracks;
const m = ru.catalog.money;

/** P5 «Треки»: one `GET /tracks/summary` (account and month from the URL), every row filtered on the client. */
export function TracksPage() {
  const [account, setAccount] = useUrlParam('account');
  const [month, setMonth] = useUrlParam('month');
  const [hasSplit, setHasSplit] = useUrlParam('hasSplit');
  const [q, setQ] = useUrlParam('q');
  const [creating, setCreating] = useState(false);
  const query = useQuery(trackQueries.summary(account || undefined, month || undefined));
  const columns = useMemo(() => trackColumns(), []);
  // The P1 drill-down (B or ours of an account and month) opens the list sorted by that column, largest first; the
  // column travels in the router state, so the link itself stays `/tracks?account&month`.
  const location = useLocation();
  const sortBy = (location.state as { sortBy?: unknown } | null)?.sortBy;
  const defaultSort = sortBy === 'B' || sortBy === 'ours' ? ([sortBy, 'desc'] as const) : undefined;
  const filter = (items: readonly TrackSummaryItem[]) => {
    const needle = q.trim().toLocaleLowerCase('ru');
    // With an account or month scope the API still lists every track (zeros outside the scope): show those with units in it.
    const scoped = account !== '' || month !== '';
    return items.filter(
      (i) =>
        (!scoped || i.months.count > 0) &&
        (hasSplit === '' || (hasSplit === 'yes') === i.hasSplit) &&
        (needle === '' ||
          [i.isrc, i.title, i.artistName, ...i.upcs].some((s) => s.toLocaleLowerCase('ru').includes(needle))),
    );
  };
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
      <QueryView
        query={query}
        money
        isEmpty={(d) => d.items.length === 0}
        emptyMessage={t.empty}
        emptyAction={
          <Link to="/sources" className="text-accent hover:underline">
            {t.toSources}
          </Link>
        }
      >
        {(data) => {
          const rows = filter(data.items);
          return (
            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted" data-testid="tracks-count">
                {fmt(t.count, { n: rows.length })}
              </div>
              <DataGrid
                rowData={rows}
                columnDefs={columns}
                getRowId={(r) => r.isrc}
                rowTestId={(r) => `track-${r.isrc}`}
                defaultSort={defaultSort}
                gridStateKey="grid"
              />
            </div>
          );
        }}
      </QueryView>
      {creating ? <CreateTrackDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

type P = { data?: TrackSummaryItem };
const money = (col: 'net' | 'B' | 'C' | 'ours') => (p: P) =>
  p.data ? (
    <span data-col={col}>
      <Money value={p.data[col]} />
    </span>
  ) : null;

function trackColumns(): ColDef<TrackSummaryItem>[] {
  const c = t.cols;
  return [
    {
      colId: 'isrc',
      headerName: c.isrc,
      minWidth: 150,
      valueGetter: (p) => p.data?.isrc,
      cellRenderer: (p: P) => (p.data ? <EntityLink kind="isrc" id={p.data.isrc} /> : null),
    },
    { colId: 'title', headerName: c.title, minWidth: 160, valueGetter: (p) => p.data?.title },
    { colId: 'artist', headerName: c.artist, minWidth: 140, valueGetter: (p) => p.data?.artistName },
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
    { colId: 'net', headerName: m.net, minWidth: 130, valueGetter: (p) => p.data?.net, cellRenderer: money('net'), comparator: compareDecimal, filter: false },
    { colId: 'B', headerName: m.B, minWidth: 130, valueGetter: (p) => p.data?.B, cellRenderer: money('B'), comparator: compareDecimal, filter: false },
    { colId: 'C', headerName: m.C, minWidth: 130, valueGetter: (p) => p.data?.C, cellRenderer: money('C'), comparator: compareDecimal, filter: false },
    { colId: 'ours', headerName: m.ours, minWidth: 130, valueGetter: (p) => p.data?.ours, cellRenderer: money('ours'), comparator: compareDecimal, filter: false },
    {
      colId: 'months',
      headerName: c.months,
      minWidth: 150,
      valueGetter: (p) =>
        p.data ? `${p.data.months.count}: ${p.data.months.from ?? '—'} – ${p.data.months.to ?? '—'}` : '',
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
