import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ColDef } from 'ag-grid-community';
import type { Signals } from '@erp/shared/api-responses';
import { useOwnLabels } from '../../../components/LabelSwitch';
import { EntityLink } from '../../../components/EntityLink';
import { StatusChip } from '../../../components/StatusChip';
import { fmt, ru } from '../../../i18n/ru';
import { centsToText } from '../../owners/components/cents';
import { EditAdByIdDialog, SetOperationLabelDialog, TrackLabelsDialog } from '../actions/dialogs';
import { SIGNAL_ACTIONS } from '../actions/action-table';
import { actionCol, btn, c, Grid, info, isrcCol, moneyCol, t, textCol, type ListProps } from './signal-grid';

/**
 * The label lists of P21 (D-168, D-169): one renderer per list name. `SignalsPage.tsx` asks this table first, so a new
 * label list is one entry here plus its string in
 * `i18n/ru/signals.ts` and its row in `actions/action-table.ts`.
 */
export const LABEL_SIGNALS = {
  operationsWithoutLabel: ({ data, count, open, close }: ListProps): ReactNode => {
    type R = Signals['operationsWithoutLabel'][number];
    return (
      <Grid<R>
        name="operationsWithoutLabel"
        count={count}
        rows={data.operationsWithoutLabel}
        rowKey={(r) => r.operationId}
        columns={[
          textCol('date', c.date, (r) => r.date),
          {
            colId: 'owner',
            headerName: c.owner,
            minWidth: 160,
            valueGetter: (p) => p.data?.ownerName ?? '',
            cellRenderer: (p: { data?: R }) =>
              p.data?.ownerId ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.ownerName ?? p.data.ownerId} /> : <span>—</span>,
          },
          {
            colId: 'pseudonym',
            headerName: c.pseudonym,
            valueGetter: (p) => p.data?.pseudonym ?? '',
            cellRenderer: (p: { data?: R }) =>
              p.data?.artistId ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym ?? p.data.artistId} /> : <span>—</span>,
          },
          {
            colId: 'meaning',
            headerName: c.meaning,
            valueGetter: (p) => p.data?.meaning,
            cellRenderer: (p: { data?: R }) => (p.data ? <StatusChip kind="operationMeaning" value={p.data.meaning} /> : null),
          },
          moneyCol('amount', c.amount, (r) => centsToText(r.amountCents)),
          actionCol((r) =>
            btn('set-label', ru.actions.setLabel, () => open(<SetOperationLabelDialog operationId={r.operationId} onClose={close} />)),
          ),
        ]}
      />
    );
  },
  labelOutsideAccount: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['labelOutsideAccount'][number];
    return (
      <Grid<R>
        name="labelOutsideAccount"
        count={count}
        rows={data.labelOutsideAccount}
        rowKey={(r) => `${r.account}|${r.month}|${r.labelName}`}
        columns={[
          textCol('account', c.account, (r) => r.account),
          textCol('month', c.month, (r) => r.month),
          textCol('label', c.label, (r) => r.labelName),
          textCol('ourLabel', c.ourLabel, (r) => r.ourLabelName),
          textCol('accountLabel', c.accountLabel, (r) => r.accountLabelName),
          moneyCol('net', c.net, (r) => r.net),
          textCol('units', c.units, (r) => String(r.units)),
          informationCol<R>('labelOutsideAccount'),
        ]}
      />
    );
  },
  filesWithoutLabel: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['filesWithoutLabel'][number];
    return (
      <Grid<R>
        name="filesWithoutLabel"
        count={count}
        rows={data.filesWithoutLabel}
        rowKey={(r) => r.fileId}
        columns={[
          textCol('account', c.account, (r) => r.account),
          textCol('month', c.month, (r) => r.reportingMonth),
          textCol('fileName', c.fileName, (r) => r.fileName),
          informationCol<R>('filesWithoutLabel'),
        ]}
      />
    );
  },
  statementsWithoutLabel: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['statementsWithoutLabel'][number];
    return (
      <Grid<R>
        name="statementsWithoutLabel"
        count={count}
        rows={data.statementsWithoutLabel}
        rowKey={(r) => r.statementId}
        columns={[
          textCol('periods', c.periods, (r) => r.periods.join(', ')),
          {
            ...textCol<R>('fileName', c.fileName, (r) => r.fileName),
            // P19 lists the statement under its file name (`/sources?q=`): the row `statement-<id>` with its «Лейбл»
            cellRenderer: (p: { data?: R }) =>
              p.data ? (
                <Link to={`/sources?q=${encodeURIComponent(p.data.fileName)}`} className="text-accent hover:underline" data-col-link="statement">
                  {p.data.fileName}
                </Link>
              ) : null,
          },
          informationCol<R>('statementsWithoutLabel'),
        ]}
      />
    );
  },
  adsWithoutLabel: ({ data, count, open, close }: ListProps): ReactNode => {
    type R = Signals['adsWithoutLabel'][number];
    return (
      <Grid<R>
        name="adsWithoutLabel"
        count={count}
        rows={data.adsWithoutLabel}
        rowKey={(r) => r.adId}
        columns={[
          adMonthCol<R>(),
          isrcCol<R>((r) => r.isrc),
          moneyCol('amount', c.amount, (r) => r.amount),
          actionCol((r) => btn('set-payer', ru.actions.setPayer, () => open(<EditAdByIdDialog adId={r.adId} onClose={close} />))),
        ]}
      />
    );
  },
  adOutsideBook: ({ data, count, open, close }: ListProps): ReactNode => {
    type R = Signals['adOutsideBook'][number];
    return (
      <Grid<R>
        name="adOutsideBook"
        count={count}
        rows={data.adOutsideBook}
        rowKey={(r) => r.adId}
        columns={[
          adMonthCol<R>(),
          isrcCol<R>((r) => r.isrc),
          moneyCol('amount', c.amount, (r) => r.amount),
          { ...textCol<R>('payer', c.payer, (r) => r.payerLabelName), cellRenderer: (p: { data?: R }) => <span data-col="payer">{p.data?.payerLabelName}</span> },
          { ...textCol<R>('book', c.incomeBook, (r) => r.bookLabelName), cellRenderer: (p: { data?: R }) => <span data-col="book">{p.data?.bookLabelName}</span> },
          actionCol((r) => btn('set-payer', ru.actions.setPayer, () => open(<EditAdByIdDialog adId={r.adId} onClose={close} />))),
        ]}
      />
    );
  },
  // ---- D-172: the label history and the release registry (information, except tracksWithoutLabel) ----
  catalogOutsideAccount: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['catalogOutsideAccount'][number];
    return (
      <Grid<R>
        name="catalogOutsideAccount"
        count={count}
        rows={data.catalogOutsideAccount}
        rowKey={(r) => `${r.isrc}|${r.account}`}
        rowId={(r) => `${r.isrc}|${r.account}|${r.bookLabelId}|${r.firstMonth}`}
        columns={[
          isrcCol<R>((r) => r.isrc),
          textCol('account', c.account, (r) => r.account),
          labelCol<R>('book', c.book, (r) => r.bookLabelId),
          labelCol<R>('catalogLabel', c.catalogLabel, (r) => r.catalogLabelId),
          textCol('months', c.months, (r) => `${r.firstMonth} – ${r.lastMonth}`),
          textCol('units', c.units, (r) => String(r.units)),
          moneyCol('net', c.net, (r) => r.net),
          informationCol<R>('catalogOutsideAccount'),
        ]}
      />
    );
  },
  tracksWithoutLabel: ({ data, count, open, close }: ListProps): ReactNode => {
    type R = Signals['tracksWithoutLabel'][number];
    return (
      <Grid<R>
        name="tracksWithoutLabel"
        count={count}
        rows={data.tracksWithoutLabel}
        rowKey={(r) => r.isrc}
        columns={[
          isrcCol<R>((r) => r.isrc),
          textCol('lastMonth', c.lastMonth, (r) => r.lastMonth),
          labelCol<R>('book', c.book, (r) => r.bookLabelId),
          moneyCol('net', c.net, (r) => r.net),
          actionCol((r) => btn('track-labels', ru.catalog.catalogLabel.history, () => open(<TrackLabelsDialog isrc={r.isrc} onClose={close} />))),
        ]}
      />
    );
  },
  releasesIncomplete: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['releasesIncomplete'][number];
    return (
      <Grid<R>
        name="releasesIncomplete"
        count={count}
        rows={data.releasesIncomplete}
        rowKey={(r) => r.upc}
        rowId={(r) => `${r.upc}|${r.labelId}`}
        columns={[
          upcCol<R>((r) => r.upc),
          textCol('title', c.releaseTitle, (r) => r.title),
          labelCol<R>('label', c.registryLabel, (r) => r.labelId),
          textCol('trackCount', c.trackCount, (r) => String(r.trackCount)),
          textCol('isrcsInUnits', c.isrcsInUnits, (r) => String(r.isrcsInUnits)),
          informationCol<R>('releasesIncomplete'),
        ]}
      />
    );
  },
  // D-196: no money: what is missing and until when it was in the reports
  releasesUnknown: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['releasesUnknown'][number];
    return (
      <Grid<R>
        name="releasesUnknown"
        count={count}
        rows={data.releasesUnknown}
        rowKey={(r) => r.upc}
        rowId={(r) => `${r.upc}|${r.bookLabelId}`}
        columns={[
          upcCol<R>((r) => r.upc),
          textCol('title', c.title, (r) => r.releaseTitle),
          textCol('artist', c.reportArtist, (r) => r.artistName),
          textCol('isrcs', c.isrcs, (r) => r.isrcs.join(', ')),
          textCol('lastMonth', c.lastMonth, (r) => r.lastMonth),
          labelCol<R>('book', c.book, (r) => r.bookLabelId),
          informationCol<R>('releasesUnknown'),
        ]}
      />
    );
  },
  releasesWithoutDate: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['releasesWithoutDate'][number];
    return (
      <Grid<R>
        name="releasesWithoutDate"
        count={count}
        rows={data.releasesWithoutDate}
        rowKey={(r) => r.upc}
        rowId={(r) => `${r.upc}|${r.labelId}`}
        columns={[
          upcCol<R>((r) => r.upc),
          textCol('title', c.releaseTitle, (r) => r.releaseTitle),
          labelCol<R>('label', c.registryLabel, (r) => r.labelId),
          informationCol<R>('releasesWithoutDate'),
        ]}
      />
    );
  },
  // D-173: the history put under 0to8 by default (label source `default`, D-168): the operator relabels with a reason
  operationsDefaultLabel: ({ data, count, open, close }: ListProps): ReactNode => {
    type R = Signals['operationsDefaultLabel'][number];
    return (
      <Grid<R>
        name="operationsDefaultLabel"
        count={count}
        rows={data.operationsDefaultLabel}
        rowKey={(r) => r.operationId}
        columns={[
          textCol('date', c.date, (r) => r.date),
          ownerCol<R>(),
          pseudonymOfCol<R>(),
          {
            colId: 'kind',
            headerName: ru.operations.kind.field,
            valueGetter: (p) => p.data?.kind,
            cellRenderer: (p: { data?: R }) => (p.data ? <StatusChip kind="operationKind" value={p.data.kind} /> : null),
          },
          moneyCol('amount', c.amount, (r) => centsToText(r.amountCents)),
          labelCol<R>('label', c.label, (r) => r.labelId),
          actionCol((r) =>
            btn('set-label', ru.actions.setLabel, () =>
              open(<SetOperationLabelDialog operationId={r.operationId} onClose={close} />),
            ),
          ),
        ]}
      />
    );
  },
  // D-173: an advance whose recorded forgiveness is above the effective one (the income before the date came later)
  forgivenessReduced: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['forgivenessReduced'][number];
    return (
      <Grid<R>
        name="forgivenessReduced"
        count={count}
        rows={data.forgivenessReduced}
        rowKey={(r) => r.operationId}
        columns={[
          ownerCol<R>(),
          pseudonymOfCol<R>(),
          labelCol<R>('label', c.label, (r) => r.labelId),
          moneyCol('recorded', ru.operations.signals.recorded, (r) => r.recorded),
          moneyCol('effective', ru.operations.signals.effective, (r) => r.effective),
          {
            colId: 'operations',
            headerName: ru.operations.signals.advance,
            valueGetter: (p) => p.data?.operationId ?? '',
            cellRenderer: (p: { data?: R }) =>
              p.data ? (
                <Link to={`/operations?ownerId=${encodeURIComponent(p.data.ownerId)}&kind=advance`} className="text-xs text-accent hover:underline" data-testid="link-advance">
                  {ru.operations.signals.toAdvance}
                </Link>
              ) : null,
          },
          informationCol<R>('forgivenessReduced'),
        ]}
      />
    );
  },
  // D-173: a counter, not a list (the operations relabelled by the operator; the trail is in the audit)
  operationsRelabelled: ({ data }: ListProps): ReactNode => (
    <p className="text-sm" data-testid="signal-operationsRelabelled" data-value={data.operationsRelabelled}>
      {fmt(ru.operations.signals.relabelled, { n: data.operationsRelabelled })}
    </p>
  ),
} satisfies Partial<Record<keyof typeof SIGNAL_ACTIONS, (props: ListProps) => ReactNode>>;

export type LabelSignalName = keyof typeof LABEL_SIGNALS;

/** The action column of an information list (`SIGNAL_ACTIONS[name].information`): the note, no button. */
function informationCol<T>(name: LabelSignalName): ColDef<T> {
  return actionCol<T>(() => (SIGNAL_ACTIONS[name].information ? info(t.info) : null));
}

/** The owner of a row as a link to P10 («—» without one). */
function ownerCol<T extends { ownerId: string | null; ownerName: string | null }>(): ColDef<T> {
  return {
    colId: 'owner',
    headerName: c.owner,
    minWidth: 160,
    valueGetter: (p) => p.data?.ownerName ?? '',
    cellRenderer: (p: { data?: T }) =>
      p.data?.ownerId ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.ownerName ?? p.data.ownerId} /> : <span>—</span>,
  };
}

/** The pseudonym of a row as a link to P12 («—» without one). */
function pseudonymOfCol<T extends { artistId: string | null; pseudonym: string | null }>(): ColDef<T> {
  return {
    colId: 'pseudonym',
    headerName: c.pseudonym,
    valueGetter: (p) => p.data?.pseudonym ?? '',
    cellRenderer: (p: { data?: T }) =>
      p.data?.artistId ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym ?? p.data.artistId} /> : <span>—</span>,
  };
}

/** The month of an advertising record as the link to its card (P22 `/ads/:id`). */
function adMonthCol<T extends { adId: string; month: string }>(): ColDef<T> {
  return {
    colId: 'month',
    headerName: c.month,
    valueGetter: (p) => p.data?.month ?? '',
    cellRenderer: (p: { data?: T }) => (p.data ? <EntityLink kind="ad" id={p.data.adId} label={p.data.month} /> : null),
  };
}

/** The name of an own label by id (the labels of the switch); «—» for none. */
function LabelName({ id, col }: { id: string | null; col: string }) {
  const own = useOwnLabels();
  return (
    <span data-col={col} data-label-id={id ?? ''}>
      {id === null ? '—' : (own.find((l) => l.id === id)?.name ?? id)}
    </span>
  );
}

function labelCol<T>(colId: string, headerName: string, get: (r: T) => string | null): ColDef<T> {
  return {
    colId,
    headerName,
    valueGetter: (p) => (p.data ? (get(p.data) ?? '') : ''),
    cellRenderer: (p: { data?: T }) => (p.data ? <LabelName id={get(p.data)} col={colId} /> : null),
  };
}

function upcCol<T>(get: (r: T) => string): ColDef<T> {
  return {
    colId: 'upc',
    headerName: c.upc,
    valueGetter: (p) => (p.data ? get(p.data) : ''),
    cellRenderer: (p: { data?: T }) => (p.data ? <EntityLink kind="upc" id={get(p.data)} /> : null),
  };
}
