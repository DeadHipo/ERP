import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { ParticipationListItem } from '@erp/shared/api-responses';
import { splitQueries } from '../../../api/queries/splits';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { useUrlParam } from '../../catalog/components/url';
import { CloseParticipationDialog } from '../../catalog/track/ParticipationDialogs';
import { DocumentCell, period, toInt } from '../shared';
import { CreateForIsrc } from './IsrcDialogs';
import { Pager, usePaging } from './SplitsPage';

const t = ru.reference.participations;
const r = ru.catalog.rules;

/** P16 «Участия» `/participations?isrc&artistId&limit&offset`: `GET /participations` with server paging. */
export function ParticipationsPage() {
  const [isrc, setIsrc] = useUrlParam('isrc');
  const [artistId, setArtistId] = useUrlParam('artistId');
  const paging = usePaging();
  const [dialog, setDialog] = useState<{ kind: 'create' } | { kind: 'close'; part: ParticipationListItem } | null>(null);
  const query = useQuery(
    splitQueries.participationsPage({
      isrc: isrc.trim() || undefined,
      artistId: artistId || undefined,
      limit: toInt(paging.size),
      offset: toInt(paging.offset),
    }),
  );
  const columns = useMemo<ColDef<ParticipationListItem>[]>(
    () => [
      { colId: 'isrc', headerName: t.cols.isrc, minWidth: 150, valueGetter: (p) => p.data?.isrc, cellRenderer: (p: { data?: ParticipationListItem }) => (p.data ? <EntityLink kind="isrc" id={p.data.isrc} /> : null) },
      { colId: 'pseudonym', headerName: t.cols.pseudonym, valueGetter: (p) => p.data?.pseudonym, cellRenderer: (p: { data?: ParticipationListItem }) => (p.data ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym} /> : null) },
      { colId: 'percent', headerName: t.cols.percent, maxWidth: 110, valueGetter: (p) => p.data?.percent },
      { colId: 'base', headerName: t.cols.base, valueGetter: (p) => (p.data ? r.bases[p.data.base] : '') },
      { colId: 'fundedFrom', headerName: t.cols.fundedFrom, valueGetter: (p) => (p.data ? ru.signalsPage.funded[p.data.fundedFrom] : '') },
      { colId: 'fromPseudonym', headerName: t.cols.fromPseudonym, valueGetter: (p) => p.data?.fromPseudonym ?? '' },
      { colId: 'period', headerName: t.cols.period, minWidth: 200, valueGetter: (p) => (p.data ? period(p.data.validFrom, p.data.validTo) : '') },
      { colId: 'document', headerName: t.cols.document, valueGetter: (p) => p.data?.documentStatus, cellRenderer: (p: { data?: ParticipationListItem }) => (p.data ? <DocumentCell id={p.data.documentId} status={p.data.documentStatus} /> : null) },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: ParticipationListItem }) =>
          p.data ? (
            <ActionButton name="close-participation" op="POST /participations/:id/close" variant="secondary" onPress={() => p.data && setDialog({ kind: 'close', part: p.data })}>
              {t.close}
            </ActionButton>
          ) : null,
      },
    ],
    [],
  );
  return (
    <div data-testid="participations-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="create-participation" op="POST /participations" onPress={() => setDialog({ kind: 'create' })}>
            {t.create}
          </ActionButton>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <TextField name="participations-isrc" label={ru.reference.splits.isrc} value={isrc} onChange={(v) => { setIsrc(v); paging.setOffset('0'); }} />
        </div>
        <div className="w-64">
          <EntityPicker name="participations-artist" label={ru.reference.splits.artist} kind="artists" value={artistId || null} onChange={(id) => { setArtistId(id ?? ''); paging.setOffset('0'); }} />
        </div>
        {artistId ? (
          <button type="button" className="text-sm text-accent hover:underline" data-testid="action-clear-artist" onClick={() => setArtistId('')}>
            {ru.reference.splits.clearArtist}
          </button>
        ) : null}
      </div>
      <QueryView query={query} isEmpty={(d) => d.total === 0} emptyMessage={t.empty}>
        {(data) => (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted" data-testid="participations-total">
              {fmt(t.total, { total: data.total })}
            </div>
            <Pager total={data.total} shown={data.items.length} size={paging.size} offset={paging.offset} setOffset={paging.setOffset} setSize={paging.setSize} testId="participations-pager" />
            <DataGrid rowData={data.items} columnDefs={columns} getRowId={(x) => x.id} rowTestId={(x) => `participation-${x.id}`} pageSize={toInt(paging.size)} />
          </div>
        )}
      </QueryView>
      {dialog?.kind === 'create' ? <CreateForIsrc what="participation" onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'close' ? <CloseParticipationDialog part={dialog.part} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
