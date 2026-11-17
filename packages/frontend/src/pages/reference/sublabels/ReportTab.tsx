import { Fragment, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { ArtistRef, sublabelReportSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import type { ApiError } from '../../../api/client';
import { sublabelQueries } from '../../../api/queries/sublabels';
import { ActionButton } from '../../../components/ActionButton';
import { Money } from '../../../components/Money';
import { QueryView } from '../../../components/PageState';
import { TextField } from '../../../components/fields/TextField';
import { notifyError, notifySuccess } from '../../../components/toast';
import { fmt, ru } from '../../../i18n/ru';
import { saveBlob } from '../../../lib/download';
import { formatCount } from '../../../lib/money';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';

const t = ru.sublabels;
type Report = z.output<typeof sublabelReportSchema>;
type Sums = Report['total'];
type View = 'months' | 'tracks' | 'artists';
const VIEWS: readonly View[] = ['months', 'tracks', 'artists'];
const SUM_KEYS = ['labelShare', 'amount', 'confirmed', 'waiting', 'currentAmount'] as const;
const SUM_HEADERS = [t.cols.labelShare, t.cols.amount, t.confirmed, t.waiting, t.cols.current];

function SumCells(props: { sums: Sums }) {
  return (
    <>
      {SUM_KEYS.map((k) => (
        <Td key={k} col={k}>
          <Money value={props.sums[k]} />
        </Td>
      ))}
    </>
  );
}

const artistNames = (artists: readonly ArtistRef[]) =>
  artists.length === 0 ? (
    <span className="text-muted">{t.noArtist}</span>
  ) : (
    artists.map((a, i) => (
      <Fragment key={a.id}>
        {i > 0 ? ', ' : ''}
        <Link className="text-accent hover:underline" to={`/artists/${a.id}`}>
          {a.pseudonym}
        </Link>
      </Fragment>
    ))
  );

/** One row that opens its details below it (the rows of the month, the months of a track, the tracks of an artist). */
function Expandable(props: { testId: string; cells: ReactNode; colSpan: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <>
      <tr data-testid={props.testId} data-open={props.open ? '1' : '0'}>
        <Td>
          <ActionButton name="report-expand" write={false} variant="tertiary" compact onPress={props.onToggle}>
            {props.open ? '▾' : '▸'}
          </ActionButton>
        </Td>
        {props.cells}
      </tr>
      {props.open ? (
        <tr data-testid={`${props.testId}-details`}>
          <Td colSpan={props.colSpan} className="bg-default/30">
            {props.children}
          </Td>
        </tr>
      ) : null}
    </>
  );
}

/** The track × month rows of one month or one track: the detail level. */
function RowsTable(props: { rows: Report['rows']; without: 'month' | 'track' }) {
  const head = [
    ...(props.without === 'month' ? [] : [t.cols.month]),
    ...(props.without === 'track' ? [] : [t.cols.isrc, t.cols.title, t.cols.artists]),
    t.cols.labelShare,
    t.cols.percent,
    t.cols.amount,
    t.cols.status,
    t.cols.current,
  ];
  return (
    <SimpleTable headers={head}>
      {props.rows.map((x) => (
        <tr key={`${x.month}-${x.isrc}`} data-testid={`report-row-${x.month}-${x.isrc}`} data-status={x.status} data-reason={x.reason ?? ''}>
          {props.without === 'month' ? null : <Td>{x.month}</Td>}
          {props.without === 'track' ? null : (
            <>
              <Td>{x.isrc}</Td>
              <Td>{x.title ?? ''}</Td>
              <Td>{artistNames(x.artists)}</Td>
            </>
          )}
          <Td col="labelShare"><Money value={x.labelShare} /></Td>
          <Td>{x.percent}%</Td>
          <Td col="amount"><Money value={x.amount} /></Td>
          <Td col="status">{x.reason ? `${t.waiting}: ${t.reason[x.reason]}` : t.confirmed}</Td>
          <Td col="currentAmount"><Money value={x.currentAmount} /></Td>
        </tr>
      ))}
    </SimpleTable>
  );
}

function useOpen() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  return {
    has: (k: string) => open.has(k),
    toggle: (k: string) =>
      setOpen((s) => {
        const next = new Set(s);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      }),
  };
}

function MonthsView(props: { r: Report }) {
  const open = useOpen();
  return (
    <SimpleTable testId="sublabel-report-months" headers={['', t.cols.month, t.cols.tracks, ...SUM_HEADERS]}>
      {props.r.months.map((m) => {
        const rows = props.r.rows.filter((x) => x.month === m.month);
        return (
          <Expandable
            key={m.month}
            testId={`report-month-${m.month}`}
            colSpan={8}
            open={open.has(m.month)}
            onToggle={() => open.toggle(m.month)}
            cells={
              <>
                <Td>{m.month}</Td>
                <Td col="tracks">{formatCount(rows.length)}</Td>
                <SumCells sums={m} />
              </>
            }
          >
            <RowsTable rows={rows} without="month" />
          </Expandable>
        );
      })}
    </SimpleTable>
  );
}

function TracksView(props: { r: Report; isrcs?: readonly string[]; testId?: string }) {
  const open = useOpen();
  const list = props.isrcs ? props.r.tracks.filter((x) => props.isrcs?.includes(x.isrc)) : props.r.tracks;
  return (
    <SimpleTable testId={props.testId ?? 'sublabel-report-tracks'} headers={['', t.cols.isrc, t.cols.title, t.cols.artists, t.cols.months, ...SUM_HEADERS]}>
      {list.map((x) => (
        <Expandable
          key={x.isrc}
          testId={`report-track-${x.isrc}`}
          colSpan={10}
          open={open.has(x.isrc)}
          onToggle={() => open.toggle(x.isrc)}
          cells={
            <>
              <Td>
                <Link className="text-accent hover:underline" to={`/tracks/${x.isrc}`}>
                  {x.isrc}
                </Link>
              </Td>
              <Td>{x.title ?? ''}</Td>
              <Td>{artistNames(x.artists)}</Td>
              <Td col="months">{formatCount(x.months)}</Td>
              <SumCells sums={x} />
            </>
          }
        >
          <RowsTable rows={props.r.rows.filter((y) => y.isrc === x.isrc)} without="track" />
        </Expandable>
      ))}
    </SimpleTable>
  );
}

function ArtistsView(props: { r: Report }) {
  const open = useOpen();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">{t.artistsNote}</p>
      <SimpleTable testId="sublabel-report-artists" headers={['', t.cols.artists, t.cols.tracks, ...SUM_HEADERS]}>
        {props.r.artists.map((g) => (
          <Expandable
            key={g.key}
            testId={`report-artist-${g.key || 'none'}`}
            colSpan={8}
            open={open.has(g.key)}
            onToggle={() => open.toggle(g.key)}
            cells={
              <>
                <Td>{artistNames(g.artists)}</Td>
                <Td col="tracks">{formatCount(g.tracks)}</Td>
                <SumCells sums={g} />
              </>
            }
          >
            <TracksView r={props.r} isrcs={g.isrcs} testId={`report-artist-tracks-${g.key || 'none'}`} />
          </Expandable>
        ))}
      </SimpleTable>
    </div>
  );
}

/** «Отчёт» of P37 (D-219, D-223): the total, then by month, by track or by artist; a row opens its details. */
export function ReportTab(props: { sublabelId: string }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('view');
  const view: View = VIEWS.includes(requested as View) ? (requested as View) : 'months';
  const setView = (v: View) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('view', v);
        return next;
      },
      { replace: true },
    );
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = useQuery(sublabelQueries.report(props.sublabelId, from, to));
  const csv = useMutation({
    mutationFn: () => api.sublabels.reportCsv(props.sublabelId, { ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    onSuccess: (r) => {
      saveBlob(r.fileName, r.blob);
      notifySuccess(fmt(t.downloaded, { name: r.fileName }));
    },
    onError: (e) => notifyError(e as ApiError),
  });
  return (
    <div className="flex flex-col gap-4" data-testid="sublabel-report" data-view={view}>
      <div className="flex flex-wrap items-end gap-3">
        <TextField name="report-from" label={t.reportFrom} type="month" value={from} onChange={setFrom} />
        <TextField name="report-to" label={t.reportTo} type="month" value={to} onChange={setTo} />
        <ActionButton name="sublabel-report-csv" write={false} op="GET /sublabels/:id/report" variant="secondary" isPending={csv.isPending} onPress={() => csv.mutate()}>
          {t.download}
        </ActionButton>
      </div>
      <p className="text-xs text-muted">{t.reportNote}</p>
      <QueryView query={query} isEmpty={(d) => d.rows.length === 0} emptyMessage={t.reportEmpty}>
        {(r) => (
          <>
            <section data-testid="sublabel-report-total" className="flex flex-wrap gap-6 text-sm">
              {SUM_KEYS.map((k, i) => (
                <div key={k} data-col={k} data-value={r.total[k]}>
                  <div className="text-xs text-muted">{SUM_HEADERS[i]}</div>
                  <Money value={r.total[k]} />
                </div>
              ))}
              <div data-col="counts">
                <div className="text-xs text-muted">{t.cols.tracks}</div>
                {formatCount(r.tracks.length)} · {fmt(t.monthsCount, { n: r.months.length })}
              </div>
            </section>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t.reportView}>
              <ActionButton name="report-view-months" write={false} variant={view === 'months' ? 'primary' : 'secondary'} onPress={() => setView('months')}>
                {t.views.months}
              </ActionButton>
              <ActionButton name="report-view-tracks" write={false} variant={view === 'tracks' ? 'primary' : 'secondary'} onPress={() => setView('tracks')}>
                {t.views.tracks}
              </ActionButton>
              <ActionButton name="report-view-artists" write={false} variant={view === 'artists' ? 'primary' : 'secondary'} onPress={() => setView('artists')}>
                {t.views.artists}
              </ActionButton>
            </div>
            {view === 'months' ? <MonthsView r={r} /> : view === 'tracks' ? <TracksView r={r} /> : <ArtistsView r={r} />}
          </>
        )}
      </QueryView>
    </div>
  );
}
