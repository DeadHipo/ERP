import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { pubV2SongSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { publishingV2Queries } from '../../../api/queries/publishing';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { Money } from '../../../components/Money';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { useLabel } from '../../../lib/label';
import { compareDecimal, formatCount } from '../../../lib/money';

const t = ru.reference.publishingV2;
type Song = z.output<typeof pubV2SongSchema>;

function IsrcDialog(props: { song: Song; onClose: () => void }) {
  const query = useQuery(publishingV2Queries.songCandidates(props.song.songId));
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [manual, setManual] = useState('');
  const data = query.data;
  useEffect(() => {
    if (!data || chosen !== null) return;
    const confirmed = data.isrcs.map((x) => x.isrc);
    setChosen(new Set(confirmed.length > 0 ? confirmed : data.candidates.filter((c) => c.reason === 'owner' || c.coAuthors.length > 0).map((c) => c.isrc)));
  }, [data, chosen]);
  const run = useAction((isrcs: string[]) => api.publishingV2.setSongIsrcs(props.song.songId, isrcs), {
    invalidate: 'all',
    success: (r) => fmt(t.isrcsSaved, { name: props.song.title, count: formatCount(r.isrcs.length) }),
  });
  const toggle = (isrc: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(isrc)) next.delete(isrc);
      else next.add(isrc);
      return next;
    });
  const extra = (data?.isrcs ?? []).filter((x) => !data?.candidates.some((c) => c.isrc === x.isrc));
  const typed = manual.trim();
  const list = [...(chosen ?? []), ...(typed ? [typed] : [])];
  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => (open ? null : props.onClose())}
      title={fmt(t.isrcTitle, { name: props.song.title })}
      footer={
        <ActionButton name="isrcs-submit" op="POST /publishing-v2/songs/:id/isrcs" isPending={run.isPending} onPress={() => run.mutate(list, { onSuccess: props.onClose })}>
          {t.save}
        </ActionButton>
      }
    >
      <div className="text-sm text-muted">
        {t.cols.name}: {props.song.songwriter}
        {props.song.ownerName ? ` · ${t.cols.owner}: ${props.song.ownerName}` : ''}
      </div>
      <QueryView query={query}>
        {(d) => (
          <div className="flex max-h-96 flex-col gap-1 overflow-y-auto" data-testid="isrc-candidates">
            {d.candidates.length === 0 && extra.length === 0 ? <p className="text-sm text-muted">{t.noCandidates}</p> : null}
            {d.candidates.map((c) => (
              <label key={c.isrc} className="flex items-start gap-2 rounded-lg px-2 py-1 text-sm hover:bg-default/50">
                <input type="checkbox" className="mt-1" data-testid={`isrc-${c.isrc}`} checked={chosen?.has(c.isrc) ?? false} onChange={() => toggle(c.isrc)} />
                <span>
                  <span className="tabular-nums">{c.isrc}</span> · {c.title}
                  <span className="block text-xs text-muted">
                    {t.candidateReason[c.reason]}
                    {c.artists.length > 0 ? ` · ${c.artists.join(', ')}` : ` · ${t.noSplit}`}
                  </span>
                  {c.coAuthors.length > 0 ? (
                    <span className="block text-xs text-muted" data-testid={`isrc-co-authors-${c.isrc}`}>
                      {fmt(t.coAuthors, { names: c.coAuthors.join(', ') })}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
            {extra.map((x) => (
              <label key={x.isrc} className="flex items-start gap-2 rounded-lg px-2 py-1 text-sm hover:bg-default/50">
                <input type="checkbox" className="mt-1" data-testid={`isrc-${x.isrc}`} checked={chosen?.has(x.isrc) ?? false} onChange={() => toggle(x.isrc)} />
                <span>
                  <span className="tabular-nums">{x.isrc}</span> · {x.title}
                </span>
              </label>
            ))}
          </div>
        )}
      </QueryView>
      <TextField name="isrc-manual" label={t.isrcManual} value={manual} onChange={setManual} placeholder="FR96X2569666" />
    </FormDialog>
  );
}

/** The tab «Треки» (D-184): a candidate is a hint; the ISRCs of a song are set only by the operator. */
export function TracksTab() {
  const { labelId } = useLabel();
  const query = useQuery(publishingV2Queries.songs(labelId));
  const [editing, setEditing] = useState<Song | null>(null);
  const columns = useMemo<ColDef<Song>[]>(
    () => [
      { colId: 'title', headerName: t.cols.title, minWidth: 260, valueGetter: (p) => p.data?.title },
      {
        colId: 'songwriter',
        headerName: t.cols.name,
        minWidth: 220,
        valueGetter: (p) => p.data?.songwriter,
        cellRenderer: (p: { data?: Song }) =>
          p.data ? (
            <Link className="text-accent hover:underline" to={`/publishing-v2/${p.data.songwriterId}`}>
              {p.data.songwriter}
            </Link>
          ) : null,
      },
      { colId: 'owner', headerName: t.cols.owner, minWidth: 180, valueGetter: (p) => p.data?.ownerName ?? '' },
      {
        colId: 'payable',
        headerName: t.cols.payable,
        valueGetter: (p) => p.data?.payable,
        comparator: compareDecimal,
        cellRenderer: (p: { data?: Song }) => (p.data ? <Money value={p.data.payable} /> : null),
      },
      { colId: 'isrcs', headerName: t.cols.isrcs, minWidth: 200, valueGetter: (p) => p.data?.isrcs.join(', ') ?? '' },
      {
        colId: 'candidates',
        headerName: t.cols.candidates,
        valueGetter: (p) => (p.data ? fmt(t.candidatesCount, { own: formatCount(p.data.ownerCandidates), all: formatCount(p.data.candidates) }) : ''),
      },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: Song }) =>
          p.data ? (
            <ActionButton name="set-isrcs" op="POST /publishing-v2/songs/:id/isrcs" variant="secondary" onPress={() => p.data && setEditing(p.data)}>
              {t.chooseIsrc}
            </ActionButton>
          ) : null,
      },
    ],
    [],
  );
  return (
    <div data-testid="tracks-tab" className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t.tracksHint}</p>
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.noSongwriters}>
        {(rows) => <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.songId} rowTestId={(r) => `song-${r.songId}`} />}
      </QueryView>
      {editing ? <IsrcDialog song={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
