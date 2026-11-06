import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { TrackMoney } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { trackQueries } from '../../../api/queries/tracks';
import { ActionButton } from '../../../components/ActionButton';
import { ArtistLinks } from '../../../components/ArtistLinks';
import { useBreadcrumbLabel } from '../../../components/breadcrumb-label';
import { EntityCard } from '../../../components/EntityCard';
import { EntityLink } from '../../../components/EntityLink';
import { Money } from '../../../components/Money';
import { QueryView } from '../../../components/PageState';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { CReasonList } from '../components/CReasonList';
import { MoneyTab } from './MoneyTab';
import { RulesTab } from './RulesTab';
import { DocumentsTab } from './DocumentsTab';
import { HistoryTab } from './HistoryTab';
import { AdsOfEntity } from '../../ads/AdsOfEntity';
import { TrackLabelsDialog, currentInterval } from './TrackLabelsDialog';

const t = ru.catalog.track;
const m = ru.catalog.money;

/**
 * P6 «Трек»: whose is every dollar of this ISRC. One money call (`GET /tracks/:isrc/money`): the header with the
 * totals and the note, the months with their allocations and layers, the rules, the documents, the history.
 */
export function TrackPage() {
  const isrc = useParams().isrc ?? '';
  const query = useQuery(trackQueries.money(isrc));
  const title = query.data?.title;
  useBreadcrumbLabel(title && title !== isrc ? `${title} (${isrc})` : isrc);
  return (
    <div data-testid="track-page">
      <QueryView query={query} money>
        {(data) => <TrackCard isrc={isrc} data={data} />}
      </QueryView>
    </div>
  );
}

function TrackCard({ isrc, data }: { isrc: string; data: TrackMoney }) {
  const upcs = [...new Set([...data.tracks.flatMap((x) => (x.upc ? [x.upc] : [])), ...data.months.map((x) => x.upc)])];
  return (
    <EntityCard
      title={<span data-testid="track-title">{data.title || isrc}</span>}
      subtitle={
        <div className="flex flex-col gap-1">
          <span>
            ISRC <b data-testid="track-isrc">{isrc}</b> · {t.artist}:{' '}
            <span data-testid="track-artists">
              <ArtistLinks artists={data.artists} reportName={data.artistName} />
            </span>
            {data.artists.length > 0 && data.artistName.trim() !== '' ? (
              <span className="text-muted" data-testid="track-report-artist">
                {' '}
                ({t.reportArtist}: {data.artistName})
              </span>
            ) : null}{' '}
            · {t.upcs}:{' '}
            {upcs.length === 0
              ? '—'
              : upcs.map((u, i) => (
                  <span key={u}>
                    {i > 0 ? ', ' : ''}
                    <EntityLink kind="upc" id={u} />
                  </span>
                ))}
          </span>
          <TrackCatalogLabel isrc={isrc} />
          <NoteEditor data={data} />
        </div>
      }
      headline={<Totals totals={data.totals} />}
      defaultTab="money"
      tabs={[
        { id: 'money', label: t.tabs.money, content: <MoneyTab isrc={isrc} data={data} /> },
        { id: 'rules', label: t.tabs.rules, content: <RulesTab isrc={isrc} data={data} /> },
        { id: 'ads', label: t.tabs.ads, content: <AdsOfEntity isrc={isrc} /> },
        { id: 'documents', label: t.tabs.documents, content: <DocumentsTab data={data} /> },
        { id: 'history', label: t.tabs.history, content: <HistoryTab isrc={isrc} /> },
        {
          id: 'lines',
          label: t.tabs.lines,
          content: (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-muted">{t.linesNote}</p>
              <Link to={`/sources/lines?isrc=${encodeURIComponent(isrc)}`} className="text-accent hover:underline" data-testid="track-lines-link">
                {t.lines}
              </Link>
            </div>
          ),
        },
      ]}
    />
  );
}

/**
 * The catalog label of the ISRC (D-172): the open interval of its label history (`GET /tracks/:isrc/labels`, no money)
 * and «История лейбла» (`TrackLabelsDialog`). Not the book: the money of a month row sits in the label of its file.
 */
function TrackCatalogLabel({ isrc }: { isrc: string }) {
  const c = ru.catalog.catalogLabel;
  const query = useQuery(trackQueries.labels(isrc));
  const [open, setOpen] = useState(false);
  const now = query.data ? currentInterval(query.data) : null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {c.header}:{' '}
      <span data-testid="track-catalog-label" data-label-id={now?.labelId ?? ''} title={c.hint}>
        {now ? `${now.labelName} (${fmt(c.since, { from: now.validFrom })})` : c.none}
      </span>
      <ActionButton name="track-labels" write={false} op="GET /tracks/:isrc/labels" variant="tertiary" onPress={() => setOpen(true)}>
        {c.history}
      </ActionButton>
      {open ? <TrackLabelsDialog isrc={isrc} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function Totals({ totals }: { totals: TrackMoney['totals'] }) {
  const cell = (col: 'net' | 'B' | 'C' | 'ours', label: string) => (
    <div className="flex flex-col items-end" data-col={col}>
      <span className="text-xs text-muted">{label}</span>
      <span className="text-lg font-semibold">
        <Money value={totals[col]} />
      </span>
      {col === 'C' ? <CReasonList byReason={totals.cByReason} /> : null}
    </div>
  );
  return (
    <div className="flex gap-6" data-testid="track-totals">
      {cell('net', m.net)}
      {cell('B', m.B)}
      {cell('C', m.C)}
      {cell('ours', m.ours)}
    </div>
  );
}

/** The free note of the track (M29) with an inline edit: `PATCH /tracks/:id` (the first registered track of the ISRC). */
function NoteEditor({ data }: { data: TrackMoney }) {
  const track = data.tracks[0];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const run = useAction((value: string) => api.tracks.update(track?.id ?? '', { note: value.trim() === '' ? null : value.trim() }), {
    invalidate: 'all',
    success: (tr) => (tr.note ? t.noteSaved : t.noteCleared),
  });
  if (!track) return <span className="text-xs text-muted">{t.noTrackRecord}</span>;
  if (!editing)
    return (
      <span className="flex flex-wrap items-center gap-2">
        {t.note}:{' '}
        <span data-testid="track-note" className={track.note ? '' : 'text-muted'}>
          {track.note ?? t.noNote}
        </span>
        <ActionButton
          name="edit-note"
          variant="tertiary"
          write={false}
          onPress={() => {
            setText(track.note ?? '');
            setEditing(true);
          }}
        >
          {t.editNote}
        </ActionButton>
      </span>
    );
  return (
    <span className="flex flex-wrap items-end gap-2">
      <span className="w-80">
        <TextField name="track-note" label={`${t.note} (${t.noteHint})`} value={text} onChange={setText} />
      </span>
      <ActionButton name="note-save" op="PATCH /tracks/:id" isPending={run.isPending} onPress={() => run.mutate(text, { onSuccess: () => setEditing(false) })}>
        {t.saveNote}
      </ActionButton>
      <ActionButton name="note-cancel" variant="secondary" write={false} onPress={() => setEditing(false)}>
        {t.cancelNote}
      </ActionButton>
    </span>
  );
}
