import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { Signals } from '@erp/shared/api-responses';
import { documentQueries } from '../../api/queries/documents';
import { reportQueries } from '../../api/queries/reports';
import { ActionButton, OperatorNotice } from '../../components/ActionButton';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { PageState, QueryView } from '../../components/PageState';
import { StatusChip } from '../../components/StatusChip';
import { DataGrid } from '../../components/grid/DataGrid';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { compareDecimal } from '../../lib/money';
import { useLabel } from '../../lib/label';
import { fmt, ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';
import { useOwnerNames } from '../reference/shared';
import {
  AssignOwnerDialog,
  CloseRuleDialog,
  CreateSplitDialog,
  LabelAliasDialog,
  MapWriterDialog,
  NoteDialog,
  RecreateParticipationDialog,
  RegisterTrackDialog,
  SetOperationLabelDialog,
  SetRuleDialog,
  SublabelRuleDialog,
} from './actions/dialogs';
import { SIGNAL_ACTIONS } from './actions/action-table';

const t = ru.signalsPage;
const c = t.cols;
const a = ru.actions;

/** Every list of `GET /signals` in the order of the page (16 §2.7). */
export const SIGNAL_NAMES = Object.keys(ru.signals) as (keyof typeof ru.signals)[];
type SignalName = (typeof SIGNAL_NAMES)[number];

/**
 * One call for every list, cut to the API's cap per list (5000; `counts` has the full lengths): every row is reachable
 * and the grid pages them on the client (stage 4 walk F2).
 */
const LIMIT = 5000;

export function SignalsPage() {
  const { name } = useParams();
  const { labelId } = useLabel(); // the label view (D-168): the units of the label; the lists without a label stay whole
  const query = useQuery(reportQueries.signals(LIMIT, labelId));
  const known = SIGNAL_NAMES.find((n) => n === name);
  useBreadcrumbLabel(known ? ru.signals[known] : name);
  if (name !== undefined && !known) return <PageState variant="empty" message={t.unknown} />;
  return (
    <div data-testid="signals-page">
      <PageHeader title={known ? `${t.title}: ${ru.signals[known]}` : t.title} subtitle={t.subtitle} />
      <QueryView query={query} money>
        {(data) => (known ? <SignalList name={known} data={data} /> : <SignalIndex data={data} />)}
      </QueryView>
    </div>
  );
}

function SignalIndex({ data }: { data: Signals }) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border" data-testid="signals-index">
      {SIGNAL_NAMES.map((n) => (
        <li key={n} className="flex items-center justify-between px-4 py-2" data-testid={`signal-list-${n}`}>
          <Link to={`/signals/${n}`} className="text-accent hover:underline">
            {ru.signals[n]}
          </Link>
          <span className="text-sm" data-testid="signal-count">
            {data.counts[n] ?? 0}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Open = (dialog: ReactNode) => void;

function Grid<T>(props: {
  name: SignalName;
  rows: readonly T[];
  columns: ColDef<T>[];
  /** The key of the test hook `signal-row-<name>-<key>` (D-145). */
  rowKey: (r: T) => string;
  /** The grid's row id when the key is not unique (unfunded: one row per sales month). */
  rowId?: (r: T) => string;
  count: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm" data-testid="signal-total">
        {t.count}: {props.count}
        {props.rows.length < props.count ? ` · ${fmt(t.shown, { limit: props.rows.length, count: props.count })}` : ''}
      </div>
      {props.rows.length === 0 ? (
        <PageState variant="empty" message={t.empty} />
      ) : (
        <DataGrid
          rowData={props.rows}
          columnDefs={props.columns}
          getRowId={props.rowId ?? props.rowKey}
          rowTestId={(r) => `signal-row-${props.name}-${props.rowKey(r)}`}
          autoHeight
          pageSize={100}
          gridStateKey="grid"
        />
      )}
    </div>
  );
}

const isrcCol = <T,>(get: (r: T) => string | null): ColDef<T> => ({
  colId: 'isrc',
  headerName: c.isrc,
  valueGetter: (p) => (p.data ? get(p.data) : null),
  cellRenderer: (p: { data?: T }) => {
    const v = p.data ? get(p.data) : null;
    return v ? <EntityLink kind="isrc" id={v} /> : <span className="text-muted">—</span>;
  },
});
const moneyCol = <T,>(colId: string, headerName: string, get: (r: T) => string): ColDef<T> => ({
  colId,
  headerName,
  minWidth: 120,
  comparator: compareDecimal,
  valueGetter: (p) => (p.data ? get(p.data) : null),
  cellRenderer: (p: { data?: T }) => (p.data ? <span data-col={colId}><Money value={get(p.data)} /></span> : null),
});
const textCol = <T,>(colId: string, headerName: string, get: (r: T) => string): ColDef<T> => ({
  colId,
  headerName,
  valueGetter: (p) => (p.data ? get(p.data) : ''),
});
const actionCol = <T,>(render: (r: T) => ReactNode): ColDef<T> => ({
  colId: 'action',
  headerName: c.action,
  minWidth: 300,
  autoHeight: true,
  wrapText: true,
  sortable: false,
  filter: false,
  cellRenderer: (p: { data?: T }) => (p.data ? <div className="flex flex-wrap items-center gap-1 py-1">{render(p.data)}</div> : null),
});
const btn = (name: string, label: string, onPress: () => void) => (
  <ActionButton key={name} name={name} variant="secondary" compact onPress={onPress}>
    {label}
  </ActionButton>
);
const info = (text: string) => <span className="text-xs text-muted">{text}</span>;

function SignalList({ name, data }: { name: SignalName; data: Signals }) {
  const [dialog, setDialog] = useState<ReactNode>(null);
  const close = () => setDialog(null);
  const open: Open = (d) => setDialog(d);
  const count = data.counts[name] ?? 0;
  // Names for rows that carry only ids (reference lists, no money): owners of twoRowsOneOwner, document titles of assumptions.
  const owners = useOwnerNames(name === 'twoRowsOneOwner');
  const docs = useQuery({ ...documentQueries.list(), enabled: name === 'assumptions' });
  const titles = new Map((docs.data ?? []).map((d) => [d.id, d.title]));
  return (
    <>
      <OperatorNotice />
      {renderList(name, data, count, open, close, { owners, titles })}
      {dialog}
    </>
  );
}

type Names = { owners: Map<string, string>; titles: Map<string, string> };

const fundedText = (v: string | null) => (v === null ? '—' : v in t.funded ? t.funded[v as keyof typeof t.funded] : v);
const pseudonymCol = <T extends { artistId: string; pseudonym: string }>(): ColDef<T> => ({
  colId: 'pseudonym',
  headerName: c.pseudonym,
  valueGetter: (p) => p.data?.pseudonym,
  cellRenderer: (p: { data?: T }) => (p.data ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym} /> : null),
});

function renderList(name: SignalName, data: Signals, count: number, open: Open, close: () => void, names: Names): ReactNode {
  switch (name) {
    case 'unallocated': {
      type R = Signals['unallocated']['pairs'][number];
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.unallocated.pairs}
          rowKey={(r) => `${r.isrc}|${r.upc}`}
          columns={[
            isrcCol((r) => r.isrc || null),
            textCol('upc', c.upc, (r) => r.upc),
            moneyCol('net', c.net, (r) => r.net),
            textCol('months', c.months, (r) => r.months.join(', ')),
            textCol('title', c.title, (r) => r.reportTitle),
            actionCol((r) =>
              r.isrc
                ? btn('register-track', a.registerTrack, () =>
                    open(<RegisterTrackDialog isrc={r.isrc} upc={r.upc} title={r.reportTitle} onClose={close} />),
                  )
                : <span data-testid="read-only" className="text-xs text-muted">{ru.queue.noIsrc} · {ru.queue.noIsrcText}</span>,
            ),
          ]}
        />
      );
    }
    case 'isrcsWithoutSplit': {
      type R = Signals['isrcsWithoutSplit']['items'][number];
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.isrcsWithoutSplit.items}
          rowKey={(r) => r.isrc}
          columns={[
            isrcCol((r) => r.isrc),
            moneyCol('net', c.net, (r) => r.net),
            actionCol((r) => btn('create-split', a.createSplit, () => open(<CreateSplitDialog isrc={r.isrc} onClose={close} />))),
          ]}
        />
      );
    }
    case 'ambiguousWriters': {
      type R = Signals['ambiguousWriters'][number];
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.ambiguousWriters}
          rowKey={(r) => r.writerNorm}
          columns={[
            textCol('writer', c.writer, (r) => r.displayName),
            textCol('norm', c.norm, (r) => r.writerNorm),
            actionCol((r) => btn('map-writer', a.mapWriter, () => open(<MapWriterDialog writer={r.writerNorm} onClose={close} />))),
          ]}
        />
      );
    }
    case 'unfunded': {
      // `isrc|month|ruleId|salesMonth` can still repeat on real data (a row per UPC), so the grid id adds the position.
      type R = Signals['unfunded'][number] & { at: number };
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.unfunded.map((r, at) => ({ ...r, at }))}
          rowKey={(r) => `${r.isrc}|${r.month}|${r.ruleId}|${r.salesMonth}`}
          rowId={(r) => `${r.isrc}|${r.month}|${r.ruleId}|${r.salesMonth}|${r.at}`}
          columns={[
            isrcCol((r) => r.isrc),
            textCol('upc', c.upc, (r) => r.upc),
            textCol('month', c.month, (r) => r.month),
            textCol('salesMonth', c.salesMonth, (r) => r.salesMonth),
            pseudonymCol<R>(),
            textCol('fundedFrom', c.fundedFrom, (r) => fundedText(r.fundedFrom)),
            moneyCol('missing', c.missing, (r) => r.missing),
            textCol('why', c.why, (r) => t.why[r.why]),
            actionCol((r) =>
              btn('recreate-participation', a.recreateParticipation, () =>
                open(<RecreateParticipationDialog isrc={r.isrc} participationId={r.ruleId} month={r.month} onClose={close} />),
              ),
            ),
          ]}
        />
      );
    }
    case 'labelUnmapped': {
      type R = Signals['labelUnmapped'][number];
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.labelUnmapped}
          rowKey={(r) => r.labelName}
          columns={[
            textCol('label', c.label, (r) => r.labelName),
            moneyCol('net', c.net, (r) => r.net),
            actionCol((r) => [
              btn('label-alias', a.labelAlias, () => open(<LabelAliasDialog alias={r.labelName} onClose={close} />)),
              btn('sublabel-rule', a.sublabelRule, () => open(<SublabelRuleDialog labelString={r.labelName} onClose={close} />)),
            ]),
          ]}
        />
      );
    }
    case 'sublabelWithoutRule': {
      type R = Signals['sublabelWithoutRule'][number];
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.sublabelWithoutRule}
          rowKey={(r) => `${r.label}|${r.month}`}
          columns={[
            textCol('label', c.label, (r) => r.label),
            textCol('month', c.month, (r) => r.month),
            moneyCol('net', c.net, (r) => r.net),
            actionCol((r) => [
              btn('set-rule', a.setRule, () => open(<SetRuleDialog labelString={r.label} month={r.month} onClose={close} />)),
              <Link key="labels" to="/labels" className="text-xs text-accent hover:underline">
                {t.toLabels}
              </Link>,
            ]),
          ]}
        />
      );
    }
    case 'ruleRecipientIsRow': {
      type R = Signals['ruleRecipientIsRow'][number];
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.ruleRecipientIsRow}
          rowKey={(r) => `${r.isrc}|${r.month}`}
          columns={[
            isrcCol((r) => r.isrc),
            pseudonymCol<R>(),
            textCol('month', c.month, (r) => r.month),
            actionCol((r) => [
              <Link key="rules" to={`/tracks/${encodeURIComponent(r.isrc)}?tab=rules`} className="text-xs text-accent hover:underline">
                {t.toRules}
              </Link>,
              btn('close-rule', a.closeRule, () =>
                open(<CloseRuleDialog artistId={r.artistId} month={r.month} onClose={close} />),
              ),
            ]),
          ]}
        />
      );
    }
    case 'twoRowsOneOwner': {
      type R = Signals['twoRowsOneOwner'][number];
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.twoRowsOneOwner}
          rowKey={(r) => `${r.isrc}|${r.month}`}
          columns={[
            isrcCol((r) => r.isrc),
            textCol('month', c.month, (r) => r.month),
            textCol('pseudonyms', c.pseudonyms, (r) => r.pseudonyms.join(', ')),
            {
              colId: 'owner',
              headerName: c.owner,
              minWidth: 180,
              valueGetter: (p) => (p.data ? (names.owners.get(p.data.ownerId) ?? '') : ''),
              cellRenderer: (p: { data?: R }) =>
                p.data ? <EntityLink kind="owner" id={p.data.ownerId} label={names.owners.get(p.data.ownerId) ?? p.data.ownerId} /> : null,
            },
            actionCol(() => (SIGNAL_ACTIONS.twoRowsOneOwner.information ? info(t.info) : null)),
          ]}
        />
      );
    }
    case 'tracksWithNote': {
      type R = Signals['tracksWithNote'][number];
      return (
        <div className="flex flex-col gap-2">
          <div>{btn('add-note', a.addNote, () => open(<NoteDialog onClose={close} />))}</div>
          <Grid<R>
            name={name}
            count={count}
            rows={data.tracksWithNote}
            rowKey={(r) => r.isrc ?? r.trackId}
            columns={[
              isrcCol((r) => r.isrc),
              textCol('title', c.trackTitle, (r) => r.title),
              textCol('note', c.note, (r) => r.note),
              actionCol((r) => [
                btn('edit-note', a.editNote, () =>
                  open(<NoteDialog trackId={r.trackId} isrc={r.isrc} note={r.note} onClose={close} />),
                ),
                btn('clear-note', a.clearNote, () => open(<NoteDialog trackId={r.trackId} isrc={r.isrc} note="" onClose={close} />)),
              ]),
            ]}
          />
        </div>
      );
    }
    case 'participantsWithoutOwner': {
      type R = Signals['participantsWithoutOwner'][number];
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.participantsWithoutOwner}
          rowKey={(r) => r.participationId}
          columns={[
            isrcCol((r) => r.isrc),
            pseudonymCol<R>(),
            textCol('fundedFrom', c.fundedFrom, (r) => fundedText(r.fundedFrom)),
            moneyCol('amount', c.amount, (r) => r.amount),
            actionCol((r) =>
              btn('assign-owner', a.assignOwner, () => open(<AssignOwnerDialog artistId={r.artistId} pseudonym={r.pseudonym} onClose={close} />)),
            ),
          ]}
        />
      );
    }
    case 'operationsWithoutLabel': {
      type R = Signals['operationsWithoutLabel'][number];
      return (
        <Grid<R>
          name={name}
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
            actionCol((r) => btn('set-label', a.setLabel, () => open(<SetOperationLabelDialog operationId={r.operationId} onClose={close} />))),
          ]}
        />
      );
    }
    case 'labelOutsideAccount': {
      type R = Signals['labelOutsideAccount'][number];
      return (
        <Grid<R>
          name={name}
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
            actionCol(() => (SIGNAL_ACTIONS.labelOutsideAccount.information ? info(t.info) : null)),
          ]}
        />
      );
    }
    case 'assumptions': {
      type R = Signals['assumptions'][number];
      return (
        <Grid<R>
          name={name}
          count={count}
          rows={data.assumptions}
          rowKey={(r) => `${r.documentId ?? ''}|${r.basis}`}
          columns={[
            {
              colId: 'document',
              headerName: c.document,
              minWidth: 200,
              valueGetter: (p) => (p.data?.documentId ? (names.titles.get(p.data.documentId) ?? '') : ''),
              cellRenderer: (p: { data?: R }) =>
                p.data?.documentId ? (
                  <EntityLink kind="document" id={p.data.documentId} label={names.titles.get(p.data.documentId) ?? a.openDocument} />
                ) : (
                  <span>—</span>
                ),
            },
            textCol('basis', c.basis, (r) => t.basis[r.basis]),
            moneyCol('amount', c.amount, (r) => r.amount),
            textCol('isrcs', c.isrcs, (r) => r.isrcs.join(', ')),
            actionCol((r) =>
              r.basis === 'document' ? (
                <Link to="/queue/assumption" className="text-xs text-accent hover:underline" data-testid="action-replace-assumption">
                  {a.replaceAssumption}
                </Link>
              ) : (
                <span data-testid="read-only" className="text-xs text-muted">
                  {t.basis[r.basis]} · {ru.queue.basisText}
                </span>
              ),
            ),
          ]}
        />
      );
    }
  }
}
