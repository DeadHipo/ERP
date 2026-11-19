import { TrackName } from '../../../components/TrackName';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import { sublabelQueries } from '../../../api/queries/sublabels';
import { useTracks } from '../../../api/queries/tracks';
import { ActionButton } from '../../../components/ActionButton';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { TextField } from '../../../components/fields/TextField';
import { ru } from '../../../i18n/ru';
import { trackText } from '../../../lib/track-title';
import { AddTermsDialog, AttachDialog, TrackTermsDialog, type Term } from './dialogs';

const t = ru.sublabels;

/** The terms of every sublabel (P36 «Треки») or of one (P37): filters, the history of a track, the document. */
export function TermsTab(props: { sublabelId?: string }) {
  const [noDocument, setNoDocument] = useState(false);
  const [month, setMonth] = useState('');
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<Term[] | null>(null);
  const terms = useQuery(sublabelQueries.terms({ sublabel: props.sublabelId, month, noDocument }));
  // The names of the rows (title, version, cover) come from the track directory, not from the list (D-256). The
  // grid pages the answer on the client and sorts and filters the column by the name, so the tracks of the whole
  // answer are asked (one `POST /tracks/query` per 1 000 ISRCs, each ISRC once).
  const isrcs = useMemo(() => (terms.data ?? []).map((x) => x.isrc), [terms.data]);
  const tracks = useTracks(isrcs);
  const columns = useMemo<ColDef<Term>[]>(
    () => [
      {
        colId: 'isrc',
        headerName: t.cols.title,
        minWidth: 240,
        autoHeight: true,
        // «title · version · ISRC» of the track of the directory; a track it does not know reads its ISRC (D-256)
        valueGetter: (p) => (p.data ? trackText(p.data.isrc, tracks.track(p.data.isrc)) : ''),
        cellRenderer: (p: { data?: Term }) => (p.data ? <TrackName isrc={p.data.isrc} track={tracks.track(p.data.isrc)} /> : null),
      },
      ...(props.sublabelId
        ? []
        : [
            {
              colId: 'sublabel',
              headerName: t.cols.sublabel,
              valueGetter: (p: { data?: Term }) => p.data?.sublabelName,
              cellRenderer: (p: { data?: Term }) =>
                p.data ? <Link className="text-accent hover:underline" to={`/sublabels/${p.data.sublabelId}`}>{p.data.sublabelName}</Link> : null,
            } satisfies ColDef<Term>,
          ]),
      { colId: 'percent', headerName: t.cols.percent, valueGetter: (p) => (p.data ? `${p.data.percent}%` : '') },
      { colId: 'from', headerName: t.cols.from, valueGetter: (p) => p.data?.validFrom },
      { colId: 'to', headerName: t.cols.to, valueGetter: (p) => (p.data ? (p.data.validTo ?? t.openEnded) : '') },
      {
        colId: 'document',
        headerName: t.cols.document,
        valueGetter: (p) => (p.data ? (p.data.documentStatus ? t.documentStatus[p.data.documentStatus] : t.noDocument) : ''),
        cellRenderer: (p: { data?: Term }) =>
          p.data?.documentId ? (
            <Link className="text-accent hover:underline" to={`/documents/${p.data.documentId}`}>
              {p.data.documentStatus ? t.documentStatus[p.data.documentStatus] : ''}
            </Link>
          ) : p.data ? (
            <span className="text-warning">{t.noDocument}</span>
          ) : null,
      },
      { colId: 'state', headerName: t.cols.state, valueGetter: (p) => (p.data ? t.state[p.data.state] : '') },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: Term }) =>
          p.data ? (
            <ActionButton name="sublabel-term-history" write={false} variant="secondary" compact onPress={() => p.data && setHistory(p.data.isrc)}>
              {t.history}
            </ActionButton>
          ) : null,
      },
    ],
    // the columns read the tracks of the cache: built again when a track arrives or changes
    [props.sublabelId, tracks],
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <ActionButton name="add-sublabel-terms" op="POST /sublabels/:id/terms" onPress={() => setAdding(true)}>
          {t.add}
        </ActionButton>
        <ActionButton
          name="attach-sublabel-terms"
          op="POST /sublabels/terms/document"
          variant="secondary"
          isDisabled={!terms.data?.some((x) => x.documentId === null)}
          reason={t.selectFirst}
          onPress={() => setAttaching((terms.data ?? []).filter((x) => x.documentId === null))}
        >
          {t.attach}
        </ActionButton>
        <TextField name="terms-filter-month" label={t.filters.month} type="month" value={month} onChange={setMonth} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="field-terms-no-document" checked={noDocument} onChange={(e) => setNoDocument(e.target.checked)} />
          {t.filters.noDocument}
        </label>
      </div>
      <QueryView query={terms} isEmpty={(d) => d.length === 0} emptyMessage={t.noTerms}>
        {(rows) => (
          <DataGrid
            rowData={rows}
            columnDefs={columns}
            getRowId={(x) => x.id}
            rowTestId={(x) => `sublabel-term-${x.id}`}
            rowAttributes={(x) => ({ 'data-isrc': x.isrc, 'data-state': x.state })}
          />
        )}
      </QueryView>
      {adding ? <AddTermsDialog sublabelId={props.sublabelId} onClose={() => setAdding(false)} /> : null}
      {history ? <TrackTermsDialog isrc={history} onClose={() => setHistory(null)} /> : null}
      {attaching ? <AttachDialog terms={attaching} onClose={() => setAttaching(null)} /> : null}
    </div>
  );
}
