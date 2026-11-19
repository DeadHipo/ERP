import { TrackName } from '../../../components/TrackName';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { SplitListItem } from '@erp/shared/api-responses';
import { splitQueries } from '../../../api/queries/splits';
import { useTracks } from '../../../api/queries/tracks';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { compareDecimal } from '../../../lib/money';
import { trackText } from '../../../lib/track-title';
import { fmt, ru } from '../../../i18n/ru';
import { useUrlParam } from '../../catalog/components/url';
import { ConfirmSplitDialog } from '../../work/actions/dialogs';
import { DocumentCell, period, toInt } from '../shared';
import { CreateForIsrc, IsrcActionDialog, type IsrcAction } from './IsrcDialogs';
import { AssumeDialog } from './AssumeDialog';

const t = ru.reference.splits;
const SIZES = ['50', '100', '500'];

type Dialog = { kind: 'create' } | { kind: 'confirm'; split: SplitListItem } | { kind: 'assume'; split: SplitListItem } | { kind: 'isrc'; action: IsrcAction } | null;

/** Server paging of a list page: `limit`/`offset` in the URL, the previous/next buttons and the range text. */
export function usePaging() {
  const [limit, setLimit] = useUrlParam('limit');
  const [offset, setOffset] = useUrlParam('offset');
  const size = SIZES.includes(limit) ? limit : '50';
  return { size, offset: offset === '' ? '0' : offset, setSize: (v: string) => { setLimit(v === '50' ? '' : v); setOffset(''); }, setOffset: (v: string) => setOffset(v === '0' ? '' : v) };
}

export function Pager(props: { total: number; shown: number; size: string; offset: string; setOffset: (v: string) => void; setSize: (v: string) => void; testId: string }) {
  const size = toInt(props.size);
  const offset = toInt(props.offset);
  const from = props.shown === 0 ? 0 : offset + 1;
  const to = offset + props.shown;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid={props.testId}>
      <ActionButton name="page-prev" write={false} variant="secondary" isDisabled={offset === 0} onPress={() => props.setOffset(String(offset > size ? offset - size : 0))}>
        {t.prev}
      </ActionButton>
      <span data-testid="page-range">{fmt(t.range, { from, to })}</span>
      <ActionButton name="page-next" write={false} variant="secondary" isDisabled={to >= props.total} onPress={() => props.setOffset(String(offset + size))}>
        {t.next}
      </ActionButton>
      <div className="w-32">
        <SelectField name="page-size" label={t.perPage} value={props.size} onChange={props.setSize} options={SIZES.map((s) => ({ id: s, label: s }))} />
      </div>
    </div>
  );
}

/** P15 «Сплиты» `/splits?isrc&artistId&status&limit&offset`: `GET /splits` with server paging. */
export function SplitsPage() {
  const [isrc, setIsrc] = useUrlParam('isrc');
  const [artistId, setArtistId] = useUrlParam('artistId');
  const [status, setStatus] = useUrlParam('status');
  const paging = usePaging();
  const [dialog, setDialog] = useState<Dialog>(null);
  const navigate = useNavigate();
  const query = useQuery(
    splitQueries.page({
      isrc: isrc.trim() || undefined,
      artistId: artistId || undefined,
      status: status === 'unconfirmed' ? 'unconfirmed' : undefined,
      limit: toInt(paging.size),
      offset: toInt(paging.offset),
    }),
  );
  // The names of the rows (title, version, cover) come from the track directory, not from the list (D-254). The
  // list is paged by the server (at most 500 rows) and the grid shows the whole answer on one page, so the ISRCs of
  // the answer are the rows on the screen: one `POST /tracks/query`, and the sort and filter by title see every row.
  const isrcs = useMemo(() => (query.data?.items ?? []).map((row) => row.isrc), [query.data]);
  const tracks = useTracks(isrcs);
  const columns = useMemo<ColDef<SplitListItem>[]>(
    () => [
      {
        colId: 'isrc',
        headerName: t.cols.isrc,
        minWidth: 220,
        autoHeight: true,
        // D-242: the cover, the title and «version · ISRC» of the track; the sort and filter text holds all three.
        // The track is the directory's (D-254), so the text is «title · version · ISRC» once it arrived.
        valueGetter: (p) => (p.data ? trackText(p.data.isrc, tracks.track(p.data.isrc)) : ''),
        cellRenderer: (p: { data?: SplitListItem }) => (p.data ? <TrackName isrc={p.data.isrc} track={tracks.track(p.data.isrc)} /> : null),
      },
      { colId: 'period', headerName: t.cols.period, minWidth: 200, valueGetter: (p) => (p.data ? period(p.data.validFrom, p.data.validTo) : '') },
      { colId: 'document', headerName: t.cols.document, valueGetter: (p) => p.data?.documentStatus, cellRenderer: (p: { data?: SplitListItem }) => (p.data ? <DocumentCell id={p.data.documentId} status={p.data.documentStatus} /> : null) },
      {
        colId: 'shares',
        headerName: t.cols.shares,
        minWidth: 260,
        valueGetter: (p) => p.data?.shares.map((s) => `${s.pseudonym} ${s.percent} %${s.isMc ? ` ${t.mc}` : ''}`).join(', '),
        cellRenderer: (p: { data?: SplitListItem }) =>
          p.data
            ? p.data.shares.map((s, i) => (
                <span key={s.artistId}>
                  {i > 0 ? ', ' : ''}
                  <EntityLink kind="artist" id={s.artistId} label={s.pseudonym} /> {s.percent} %
                  {s.isMc ? <span data-testid={`split-mc-${s.artistId}`}> {t.mc}</span> : null}
                </span>
              ))
            : null,
      },
      { colId: 'ourShare', headerName: t.cols.ourShare, comparator: compareDecimal, valueGetter: (p) => p.data?.ourShare, cellRenderer: (p: { data?: SplitListItem }) => (p.data ? <span data-col="ourShare"><Money value={p.data.ourShare} /></span> : null) },
      { colId: 'origin', headerName: t.cols.origin, valueGetter: (p) => p.data?.origin },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        sortable: false,
        filter: false,
        minWidth: 520,
        cellRenderer: (p: { data?: SplitListItem }) =>
          p.data ? (
            <span className="flex items-center gap-2">
              <ActionButton name="change-split" op="POST /splits/change" variant="secondary" onPress={() => p.data && setDialog({ kind: 'isrc', action: { kind: 'change', isrc: p.data.isrc } })}>
                {t.change}
              </ActionButton>
              <ActionButton name="buyout" op="POST /splits/buyout" variant="secondary" onPress={() => p.data && setDialog({ kind: 'isrc', action: { kind: 'buyout', isrc: p.data.isrc } })}>
                {t.buyout}
              </ActionButton>
              <ActionButton name="confirm-split" op="POST /splits/:id/confirm" variant="secondary" isDisabled={p.data.documentId !== null} reason={t.hasDocument} onPress={() => p.data && setDialog({ kind: 'confirm', split: p.data })}>
                {t.confirm}
              </ActionButton>
              <ActionButton name={`assume-${p.data.id}`} op="POST /splits/assume" variant="secondary" isDisabled={p.data.documentId !== null} reason={t.hasDocument} onPress={() => p.data && setDialog({ kind: 'assume', split: p.data })}>
                {t.assume}
              </ActionButton>
            </span>
          ) : null,
      },
    ],
    // the columns read the tracks of the cache: built again when a track arrives or changes
    [tracks],
  );
  return (
    <div data-testid="splits-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <>
            <ActionButton name="create-split" op="POST /splits" onPress={() => setDialog({ kind: 'create' })}>
              {t.create}
            </ActionButton>
            {/* P28 (D-172): the import page is entered from here only (no sidebar item, О11) */}
            <ActionButton name="split-import" op="POST /splits/import" write={false} variant="secondary" onPress={() => void navigate('/splits/import')}>
              {t.import}
            </ActionButton>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <TextField name="splits-isrc" label={t.isrc} value={isrc} onChange={(v) => { setIsrc(v); paging.setOffset('0'); }} />
        </div>
        <div className="w-64">
          <EntityPicker name="splits-artist" label={t.artist} kind="artists" value={artistId || null} onChange={(id) => { setArtistId(id ?? ''); paging.setOffset('0'); }} />
        </div>
        {artistId ? (
          <button type="button" className="text-sm text-accent hover:underline" data-testid="action-clear-artist" onClick={() => setArtistId('')}>
            {t.clearArtist}
          </button>
        ) : null}
        <div className="w-60">
          <SelectField name="splits-status" label={t.status} value={status || 'all'} onChange={(v) => { setStatus(v === 'all' ? '' : v); paging.setOffset('0'); }} options={[{ id: 'all', label: ru.reference.common.all }, { id: 'unconfirmed', label: t.unconfirmed }]} />
        </div>
      </div>
      <QueryView query={query} isEmpty={(d) => d.total === 0} emptyMessage={t.empty}>
        {(data) => (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted" data-testid="splits-total">
              {fmt(t.total, { total: data.total })}
            </div>
            <Pager total={data.total} shown={data.items.length} size={paging.size} offset={paging.offset} setOffset={paging.setOffset} setSize={paging.setSize} testId="splits-pager" />
            <DataGrid rowData={data.items} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `split-${r.id}`} pageSize={toInt(paging.size)} />
          </div>
        )}
      </QueryView>
      {dialog?.kind === 'create' ? <CreateForIsrc what="split" onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'confirm' ? <ConfirmSplitDialog splitId={dialog.split.id} isrc={dialog.split.isrc} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'assume' ? (
        <AssumeDialog group={{ splitIds: [dialog.split.id] }} candidates={1} title={`ISRC ${dialog.split.isrc}`} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'isrc' ? <IsrcActionDialog action={dialog.action} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
