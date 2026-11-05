import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { adsQuery } from '@erp/shared/api-schemas';
import type { AdSummary, AdView } from '@erp/shared/api-responses';
import { adQueries } from '../../api/queries/ads';
import { artistQueries } from '../../api/queries/artists';
import { ActionButton, OperatorNotice } from '../../components/ActionButton';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { EntityPicker } from '../../components/fields/EntityPicker';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { DataGrid } from '../../components/grid/DataGrid';
import { compareDecimal, formatMoney } from '../../lib/money';
import { fmt, ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';
import { Section, SimpleTable, Td } from '../owners/components/Fact';
import { BatchAdDialog, CreateAdDialog, DeactivateAdDialog, EditAdDialog } from './AdDialogs';

const t = ru.ads;
const STATUSES = ['allocated', 'pre_allocated', 'no_split', 'no_artist'] as const;
const KEYS = ['isrc', 'artistId', 'status', 'from', 'to'] as const;
/** The API cap of one `GET /ads`; the grid pages on the client. */
const LIST_LIMIT = 5000;
type Key = (typeof KEYS)[number];
type Filter = z.input<typeof adsQuery>;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The filters of P22 from the URL (`isrc`, `artistId`, `status`, `from`, `to`), sent as they are; the summary takes the months. */
function useAdsFilter(): [Filter, (f: Record<Key, string>) => void] {
  const [params, setParams] = useSearchParams();
  const month = (v: string | null) => (v && MONTH.test(v) ? v : undefined);
  const filter: Filter = {
    isrc: params.get('isrc') ?? undefined,
    artistId: params.get('artistId') ?? undefined,
    status: STATUSES.find((s) => s === params.get('status')),
    from: month(params.get('from')),
    to: month(params.get('to')),
  };
  const apply = (next: Record<Key, string>) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const k of KEYS) {
        if (next[k]) p.set(k, next[k]);
        else p.delete(k);
      }
      return p;
    });
  return [filter, apply];
}

/** P22 Реклама `/ads`: what advertising was spent, on which ISRC, who returns it, and what sublabels and we bear? */
export function AdsPage() {
  const [filter, apply] = useAdsFilter();
  const [creating, setCreating] = useState<'one' | 'batch' | null>(null);
  const summary = useQuery(adQueries.summary({ from: filter.from, to: filter.to }));
  const list = useQuery(adQueries.list({ ...filter, limit: LIST_LIMIT }));
  return (
    <div data-testid="ads-page" className="flex flex-col gap-4">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton name="create-ad" onPress={() => setCreating('one')}>
              {t.create.open}
            </ActionButton>
            <ActionButton name="create-ads-batch" variant="secondary" onPress={() => setCreating('batch')}>
              {t.batch.open}
            </ActionButton>
          </div>
        }
      />
      <Filters key={JSON.stringify(filter)} filter={filter} onApply={apply} />
      <Section title={t.summary.title} testId="ads-summary">
        <QueryView query={summary} money isEmpty={(d) => d.rows.length === 0} emptyMessage={t.summary.empty}>
          {(d) => <SummaryTable data={d} />}
        </QueryView>
      </Section>
      <Section title={t.list.title} testId="ads-list">
        <QueryView query={list} money isEmpty={(d) => d.count === 0} emptyMessage={t.list.empty}>
          {(d) => (
            <>
              <div className="text-sm text-muted" data-testid="ads-count">
                {fmt(t.list.total, { n: d.count })}
                {d.items.length < d.count ? ` · ${fmt(t.list.shown, { shown: d.items.length, n: d.count })}` : null}
              </div>
              <AdsGrid rows={d.items} />
            </>
          )}
        </QueryView>
      </Section>
      {creating === 'one' ? <CreateAdDialog onClose={() => setCreating(null)} /> : null}
      {creating === 'batch' ? <BatchAdDialog onClose={() => setCreating(null)} /> : null}
    </div>
  );
}

function SummaryTable(props: { data: AdSummary }) {
  const s = t.summary;
  const total = props.data.totals;
  return (
    <SimpleTable head={[s.month, s.label, s.count, s.amount, s.recovered, s.sublabels, s.ours, s.noSplit]} testId="ads-summary-table">
      {props.data.rows.map((r) => (
        <tr key={`${r.month}|${r.label}`} data-testid={`ads-summary-${r.month}-${r.label}`}>
          <Td>
            <Link className="text-accent hover:underline" to={`/ads?from=${r.month}&to=${r.month}`}>
              {r.month}
            </Link>
          </Td>
          <Td>{r.label === '?' ? s.unmapped : r.label}</Td>
          <Td col="count">{r.count}</Td>
          <Td col="amount">
            <Money value={r.amount} />
          </Td>
          <Td col="recovered">
            <Money value={r.recoveredFromArtists} />
          </Td>
          <Td col="sublabels">
            <Money value={r.borneBySublabels} />
          </Td>
          <Td col="ours">
            <Money value={r.borneByUs} />
          </Td>
          <Td col="noSplit">
            <Money value={r.noSplit} />
          </Td>
        </tr>
      ))}
      <tr data-testid="ads-summary-total" className="border-t border-border font-medium">
        <Td>{s.total}</Td>
        <Td> </Td>
        <Td col="count">{total.count}</Td>
        <Td col="amount">
          <Money value={total.amount} />
        </Td>
        <Td col="recovered">
          <Money value={total.recoveredFromArtists} />
        </Td>
        <Td col="sublabels">
          <Money value={total.borneBySublabels} />
        </Td>
        <Td col="ours">
          <Money value={total.borneByUs} />
        </Td>
        <Td col="noSplit">
          <Money value={total.noSplit} />
        </Td>
      </tr>
    </SimpleTable>
  );
}

function Filters(props: { filter: Filter; onApply: (f: Record<Key, string>) => void }) {
  const f = t.filters;
  const [isrc, setIsrc] = useState(props.filter.isrc ?? '');
  const [artistId, setArtistId] = useState(props.filter.artistId ?? '');
  const chosen = useQuery({ ...artistQueries.detail(props.filter.artistId ?? ''), enabled: !!props.filter.artistId });
  const [status, setStatus] = useState<string>(props.filter.status ?? 'all');
  const [from, setFrom] = useState(props.filter.from ?? '');
  const [to, setTo] = useState(props.filter.to ?? '');
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="ads-filters">
      <div className="w-48">
        <TextField name="filter-isrc" label={f.isrc} value={isrc} onChange={setIsrc} />
      </div>
      <div className="w-56">
        <EntityPicker
          name="filter-artist"
          label={f.artist}
          kind="artists"
          value={artistId || null}
          onChange={(id) => setArtistId(id ?? '')}
        />
      </div>
      <div className="w-44">
        <SelectField
          name="filter-status"
          label={f.status}
          value={status}
          onChange={setStatus}
          options={[{ id: 'all', label: f.all }, ...STATUSES.map((s) => ({ id: s, label: t.status[s] }))]}
        />
      </div>
      <div className="w-40">
        <TextField name="filter-from" label={f.from} value={from} onChange={setFrom} placeholder="2026-01" />
      </div>
      <div className="w-40">
        <TextField name="filter-to" label={f.to} value={to} onChange={setTo} placeholder="2026-12" />
      </div>
      <ActionButton
        name="ads-apply"
        write={false}
        onPress={() =>
          props.onApply({ isrc: isrc.trim().toUpperCase(), artistId, status: status === 'all' ? '' : status, from: from.trim(), to: to.trim() })
        }
      >
        {f.apply}
      </ActionButton>
      <ActionButton
        name="ads-reset"
        write={false}
        variant="secondary"
        onPress={() => {
          setIsrc('');
          setArtistId('');
          setStatus('all');
          setFrom('');
          setTo('');
          props.onApply({ isrc: '', artistId: '', status: '', from: '', to: '' });
        }}
      >
        {f.reset}
      </ActionButton>
      {props.filter.artistId ? (
        <span className="w-full text-sm" data-testid="ads-filter-artist">
          {f.artistChosen}
          <EntityLink kind="artist" id={props.filter.artistId} label={chosen.data?.artist.pseudonym ?? props.filter.artistId} />
        </span>
      ) : null}
    </div>
  );
}

type Dialog = { kind: 'edit' | 'deactivate'; ad: AdView };
type P = { data?: AdView };

function AdsGrid(props: { rows: AdView[] }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const columns = useMemo(() => adColumns(setDialog), []);
  return (
    <>
      <OperatorNotice />
      <DataGrid
        rowData={props.rows}
        columnDefs={columns}
        getRowId={(a) => a.id}
        rowTestId={(a) => `ad-${a.id}`}
        autoHeight
        pageSize={100}
        gridStateKey="grid"
      />
      {dialog?.kind === 'edit' ? <EditAdDialog ad={dialog.ad} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'deactivate' ? <DeactivateAdDialog ad={dialog.ad} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

const borneText = (ad: AdView) => {
  const a = ad.allocation;
  if (!a) return '';
  return a.borneBy.kind === 'sublabel'
    ? fmt(t.borne.sublabel, {
        pseudonym: a.sublabelName ?? a.borneBy.artistId,
        amount: formatMoney(a.borneBy.amount),
      })
    : fmt(t.borne.ours, { amount: formatMoney(a.borneBy.amount) });
};

function adColumns(open: (d: Dialog) => void): ColDef<AdView>[] {
  const c = t.cols;
  return [
    {
      colId: 'month',
      headerName: c.month,
      minWidth: 90,
      maxWidth: 110,
      valueGetter: (p) => p.data?.month,
      cellRenderer: (p: P) => (p.data ? <EntityLink kind="ad" id={p.data.id} label={p.data.month} /> : null),
    },
    {
      colId: 'isrc',
      headerName: c.isrc,
      minWidth: 140,
      valueGetter: (p) => p.data?.isrc,
      cellRenderer: (p: P) => (p.data?.isrc ? <EntityLink kind="isrc" id={p.data.isrc} label={p.data.isrc} /> : '—'),
    },
    {
      colId: 'amount',
      headerName: c.amount,
      minWidth: 110,
      filter: false,
      comparator: compareDecimal,
      valueGetter: (p) => (p.data ? centsToText(p.data.amountCents) : ''),
      cellRenderer: (p: P) => (p.data ? <span data-col="amount"><Money value={centsToText(p.data.amountCents)} /></span> : null),
    },
    {
      colId: 'percent',
      headerName: c.percent,
      minWidth: 90,
      maxWidth: 110,
      valueGetter: (p) => p.data?.recoveryPercent,
      cellRenderer: (p: P) => (p.data ? <span data-col="percent">{p.data.recoveryPercent}</span> : null),
    },
    { colId: 'scope', headerName: c.scope, minWidth: 120, valueGetter: (p) => (p.data ? t.scopes[p.data.scope] : '') },
    {
      colId: 'status',
      headerName: c.status,
      minWidth: 120,
      valueGetter: (p) =>
        p.data ? (p.data.active ? (p.data.allocation ? t.status[p.data.allocation.status] : '') : t.inactive) : '',
      cellRenderer: (p: P) =>
        p.data ? (
          <span data-col="status" data-value={p.data.allocation?.status ?? 'inactive'} className={p.data.active ? '' : 'text-danger'}>
            {p.data.active ? (p.data.allocation ? t.status[p.data.allocation.status] : '') : t.inactive}
            {p.data.migration ? <span className="ml-1 text-xs text-muted">{t.migration}</span> : null}
          </span>
        ) : null,
    },
    {
      colId: 'label',
      headerName: c.label,
      minWidth: 120,
      valueGetter: (p) => {
        const a = p.data?.allocation;
        return a ? [a.ourLabelName, a.sublabelName].filter((x) => x).join(' / ') : '';
      },
    },
    {
      colId: 'artists',
      headerName: c.artists,
      minWidth: 220,
      flex: 2,
      wrapText: true,
      autoHeight: true,
      sortable: false,
      valueGetter: (p) => p.data?.allocation?.parts.map((x) => x.pseudonym).join(', ') ?? '',
      cellRenderer: (p: P) => (
        <span className="flex flex-col py-1 text-xs leading-tight" data-col="artists">
          {(p.data?.allocation?.parts ?? []).map((x) => (
            <span key={x.artistId} data-testid={`ad-part-${x.artistId}`}>
              <EntityLink kind="artist" id={x.artistId} label={x.pseudonym} /> · <Money value={x.recovered} />
            </span>
          ))}
        </span>
      ),
    },
    {
      colId: 'borne',
      headerName: c.borne,
      minWidth: 160,
      wrapText: true,
      autoHeight: true,
      valueGetter: (p) => (p.data ? borneText(p.data) : ''),
      cellRenderer: (p: P) => (p.data ? <span data-col="borne" className="text-xs">{borneText(p.data)}</span> : null),
    },
    {
      colId: 'actions',
      headerName: c.actions,
      minWidth: 220,
      autoHeight: true,
      sortable: false,
      filter: false,
      cellRenderer: (p: P) =>
        p.data?.active ? (
          <div className="flex flex-wrap items-center gap-1 py-1">
            <ActionButton name="ad-edit" variant="secondary" compact onPress={() => p.data && open({ kind: 'edit', ad: p.data })}>
              {t.edit.open}
            </ActionButton>
            <ActionButton name="ad-deactivate" variant="danger" compact onPress={() => p.data && open({ kind: 'deactivate', ad: p.data })}>
              {t.deactivate.open}
            </ActionButton>
          </div>
        ) : null,
    },
    { colId: 'comment', headerName: c.comment, minWidth: 140, tooltipValueGetter: (p) => p.data?.comment, valueGetter: (p) => p.data?.comment },
  ];
}
