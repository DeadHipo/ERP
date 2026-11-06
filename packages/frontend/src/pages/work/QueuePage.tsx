import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import { C_REASONS, type CReason, type QueueGroup } from '@erp/shared/api-responses';
import { reportQueries } from '../../api/queries/reports';
import { ActionButton, OperatorNotice } from '../../components/ActionButton';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { PageState, QueryView } from '../../components/PageState';
import { StatusChip } from '../../components/StatusChip';
import { DataGrid } from '../../components/grid/DataGrid';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { compareDecimal } from '../../lib/money';
import { fmt, ru } from '../../i18n/ru';
import { useLabel } from '../../lib/label';
import { useOwnerNames } from '../reference/shared';
import { usePeriod } from './OverviewPage';
import {
  ApproveDocumentDialog,
  AssignOwnerDialog,
  ConfirmSplitDialog,
  CreateContractDialog,
  LabelAliasDialog,
  MapWriterDialog,
  MergeOwnerDialog,
  PublishingTermsDialog,
  RegisterTrackDialog,
  ReplaceDocumentDialog,
  SublabelRuleDialog,
} from './actions/dialogs';
import { REASON_ACTIONS } from './actions/action-table';
import { ACTION_OPS, type RowAction } from './actions/action-ops';

const t = ru.queue;
const a = ru.actions;

/** `/queue` (the summary from the overview, the one money call shared with P1) and `/queue/:reason` (the groups). */
export function QueuePage() {
  const { reason } = useParams();
  if (reason === undefined) return <QueueSummary />;
  const known = C_REASONS.find((r) => r === reason);
  return known ? <QueueReason reason={known} /> : <PageState variant="empty" message={`${reason}: ${ru.common.notFound}`} />;
}

function QueueSummary() {
  const [period] = usePeriod();
  const query = useQuery(reportQueries.overview(period));
  return (
    <div data-testid="queue-page">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <QueryView query={query} money isEmpty={(d) => d.queue.length === 0} emptyMessage={t.summaryEmpty}>
        {(data) => (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm" data-testid="queue-summary">
              <thead className="bg-default/50 text-left text-xs text-muted">
                <tr>
                  {[t.cols.reason, t.cols.amount, t.cols.groups, t.cols.isrcs, t.cols.action].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.queue.map((q) => (
                  <tr key={q.reason} data-testid={`queue-reason-${q.reason}`} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <Link to={`/queue/${q.reason}`} className="text-accent hover:underline">
                        {ru.reasons[q.reason]}
                      </Link>
                    </td>
                    <td className="px-3 py-2" data-col="amount">
                      <Money value={q.amount} />
                    </td>
                    <td className="px-3 py-2">{q.groups}</td>
                    <td className="px-3 py-2">{q.isrcs}</td>
                    <td className="px-3 py-2 text-muted">{ru.reasonActions[q.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </div>
  );
}

/** The action of a group, opened as a dialog by the page (16 §2.6, 17 §6). */
type Active = { action: string; group: QueueGroup };

const LIMITS = [50, 100, 500] as const;

function QueueReason({ reason }: { reason: CReason }) {
  useBreadcrumbLabel(ru.reasons[reason]);
  const [period] = usePeriod();
  const [params, setParams] = useSearchParams();
  const limitParam = params.get('limit');
  const limit = LIMITS.find((l) => String(l) === limitParam) ?? LIMITS[0];
  const offset = params.get('offset') ?? '0';
  const filter = {
    account: params.get('account') ?? undefined,
    month: params.get('month') ?? undefined,
    ownerId: params.get('ownerId') ?? undefined,
    q: params.get('q') ?? undefined,
  };
  const { labelId } = useLabel(); // the label view (D-168, D-169): the units of the label's files and the B17 lines of its statements
  const query = useQuery(reportQueries.queue(reason, { ...period, ...filter, limit, offset }, labelId));
  const [active, setActive] = useState<Active | null>(null);
  const ownerNames = useOwnerNames(filter.ownerId !== undefined);
  const setParam = (key: string, value: string | undefined) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'offset') next.delete('offset');
      return next;
    });

  const columns = useMemo(() => groupColumns(reason, setActive), [reason]);

  return (
    <div data-testid="queue-page">
      <PageHeader title={`${t.title}: ${ru.reasons[reason]}`} subtitle={ru.reasonActions[reason]} />
      <QueueFilters filter={filter} onApply={(f) => {
        setParams((prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(f)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          next.delete('offset');
          return next;
        });
      }} />
      {filter.ownerId ? (
        <div className="mb-2 text-sm">
          {t.filters.owner}: <EntityLink kind="owner" id={filter.ownerId} label={ownerNames.get(filter.ownerId) ?? filter.ownerId} />{' '}
          <button type="button" className="text-accent hover:underline" onClick={() => setParam('ownerId', undefined)}>
            ×
          </button>
        </div>
      ) : null}
      <OperatorNotice />
      <QueryView
        query={query}
        money
        isEmpty={(d) => d.items.length === 0}
        emptyMessage={filter.account || filter.month || filter.ownerId || filter.q ? t.groupsEmptyFiltered : t.groupsEmpty}
      >
        {(data) => (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="queue-total">
              <span>
                {fmt(t.total, { total: data.total })} <Money value={data.amount} />
              </span>
              <Pager total={data.total} limit={limit} offset={offset} onChange={(o) => setParam('offset', o === '0' ? undefined : o)} />
              <div className="w-28">
                <SelectField
                  name="queue-limit"
                  label=""
                  value={String(limit)}
                  onChange={(v) => setParam('limit', v === '50' ? undefined : v)}
                  options={LIMITS.map((l) => ({ id: String(l), label: String(l) }))}
                />
              </div>
            </div>
            <DataGrid
              rowData={data.items}
              columnDefs={columns}
              getRowId={(g) => `${g.key.kind}|${g.key.id}`}
              rowTestId={(g) => `queue-group-${g.key.kind}-${g.key.id}`}
              autoHeight
              pagination={false}
              pageSize={500}
              gridStateKey="grid"
            />
          </div>
        )}
      </QueryView>
      {active ? <ActionHost active={active} onClose={() => setActive(null)} /> : null}
    </div>
  );
}

function QueueFilters(props: {
  filter: { account?: string; month?: string; q?: string };
  onApply: (f: { account?: string; month?: string; q?: string }) => void;
}) {
  const [account, setAccount] = useState(props.filter.account ?? '');
  const [month, setMonth] = useState(props.filter.month ?? '');
  const [q, setQ] = useState(props.filter.q ?? '');
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2" data-testid="queue-filters">
      <div className="w-40">
        <TextField name="queue-account" label={t.filters.account} value={account} onChange={setAccount} placeholder={t.filters.accountPlaceholder} />
      </div>
      <div className="w-40">
        <TextField name="queue-month" label={t.filters.month} value={month} onChange={setMonth} placeholder="YYYY-MM" />
      </div>
      <div className="w-56">
        <TextField name="queue-q" label={t.filters.q} value={q} onChange={setQ} type="search" placeholder={t.filters.qPlaceholder} />
      </div>
      <ActionButton name="queue-apply" write={false} onPress={() => props.onApply({ account, month, q })}>
        {t.filters.apply}
      </ActionButton>
      <ActionButton
        name="queue-reset"
        write={false}
        variant="secondary"
        onPress={() => {
          setAccount('');
          setMonth('');
          setQ('');
          props.onApply({ account: '', month: '', q: '' });
        }}
      >
        {t.filters.reset}
      </ActionButton>
    </div>
  );
}

/** Server pages of the groups: the offsets are multiples of the page size up to the total the API reports. */
function Pager(props: { total: number; limit: number; offset: string; onChange: (offset: string) => void }) {
  if (props.total <= props.limit) return null;
  const options: { id: string; label: string }[] = [];
  for (let o = 0; o < props.total && options.length < 50; o += props.limit)
    options.push({ id: String(o), label: `${o + 1}…${o + props.limit < props.total ? o + props.limit : props.total}` });
  return (
    <div className="w-36">
      <SelectField name="queue-offset" label={t.page} value={props.offset} onChange={props.onChange} options={options} />
    </div>
  );
}

function EntityCell({ g }: { g: QueueGroup }) {
  const first = g.isrcs[0]?.isrc;
  switch (g.key.kind) {
    case 'owner':
    case 'ownerTerms':
      return <EntityLink kind="owner" id={g.key.id} label={g.key.label} />;
    case 'artist':
      return <EntityLink kind="artist" id={g.key.id} label={g.key.label} />;
    case 'split':
      return <EntityLink kind="isrc" id={g.key.label} label={g.key.label} />;
    case 'pair':
      return first ? <EntityLink kind="isrc" id={first} label={g.key.label} /> : <span>{g.key.label}</span>;
    case 'participation':
      return first ? <EntityLink kind="isrc" id={first} label={g.key.label} /> : <span>{g.key.label}</span>;
    case 'writer':
      return (
        <Link to="/publishing" className="text-accent hover:underline">
          {g.key.label}
        </Link>
      );
    default:
      return <span>{g.key.label}</span>;
  }
}

function groupColumns(reason: CReason, open: (a: Active) => void): ColDef<QueueGroup>[] {
  const c = t.cols;
  return [
    {
      colId: 'entity',
      headerName: c.entity,
      minWidth: 180,
      wrapText: true,
      autoHeight: true,
      valueGetter: (p) => p.data?.key.label,
      cellRenderer: (p: { data?: QueueGroup }) => (p.data ? <EntityCell g={p.data} /> : null),
    },
    {
      colId: 'owner',
      headerName: c.owner,
      minWidth: 160,
      wrapText: true,
      autoHeight: true,
      valueGetter: (p) => p.data?.ownerName,
      cellRenderer: (p: { data?: QueueGroup }) =>
        p.data?.ownerId ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.ownerName ?? p.data.ownerId} /> : null,
    },
    {
      colId: 'pseudonym',
      headerName: c.pseudonym,
      minWidth: 120,
      wrapText: true,
      autoHeight: true,
      valueGetter: (p) => p.data?.pseudonym,
      cellRenderer: (p: { data?: QueueGroup }) =>
        p.data?.artistId ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym ?? p.data.artistId} /> : null,
    },
    {
      colId: 'document',
      headerName: c.document,
      minWidth: 120,
      valueGetter: (p) => p.data?.documentStatus,
      cellRenderer: (p: { data?: QueueGroup }) =>
        p.data?.documentId || p.data?.documentStatus ? (
          <span className="flex items-center gap-1">
            {p.data.documentId ? <EntityLink kind="document" id={p.data.documentId} label="→" /> : null}
            {p.data.documentStatus ? <StatusChip kind="documentStatus" value={p.data.documentStatus} /> : null}
            {p.data.assumptionBasis && p.data.assumptionBasis !== 'document' ? (
              <span data-testid={`basis-${p.data.assumptionBasis}`} className="rounded-full bg-warning/15 px-2 text-xs text-warning">
                {t.basis[p.data.assumptionBasis]}
              </span>
            ) : null}
          </span>
        ) : null,
    },
    {
      colId: 'amount',
      headerName: c.amount,
      minWidth: 130,
      comparator: compareDecimal,
      valueGetter: (p) => p.data?.amount,
      cellRenderer: (p: { data?: QueueGroup }) => (p.data ? <span data-col="amount"><Money value={p.data.amount} /></span> : null),
    },
    { colId: 'isrcCount', headerName: c.isrcCount, maxWidth: 90, valueGetter: (p) => p.data?.isrcCount },
    { colId: 'months', headerName: c.months, minWidth: 150, valueGetter: (p) => (p.data ? `${p.data.months.from} – ${p.data.months.to}` : '') },
    {
      colId: 'actions',
      headerName: c.actions,
      minWidth: 220,
      autoHeight: true,
      wrapText: true,
      sortable: false,
      filter: false,
      cellRenderer: (p: { data?: QueueGroup }) => (p.data ? <GroupActions reason={reason} g={p.data} open={open} /> : null),
    },
  ];
}

/** The buttons of a group, by reason (16 §2.6); ⚠ items are read-only with their decision id. */
function GroupActions({ reason, g, open }: { reason: CReason; g: QueueGroup; open: (a: Active) => void }) {
  const btn = (action: RowAction, label: string) => (
    <ActionButton key={action} name={action} op={ACTION_OPS[action]} variant="secondary" compact onPress={() => open({ action, group: g })}>
      {label}
    </ActionButton>
  );
  const readOnly = (chip: string, text: string) => (
    <span key="read-only" className="flex items-center gap-2 text-xs text-muted" data-testid="read-only">
      <span className="rounded-full bg-warning/15 px-2 text-warning">{chip}</span> {text}
    </span>
  );
  const items = (() => {
    if (REASON_ACTIONS[reason].information) return [readOnly(t.noIsrc, t.noIsrcText)];
    switch (reason) {
      case 'owner_unconfirmed':
        return [btn('create-contract', a.createContract), btn('merge', a.mergeOwner)];
      case 'split_unconfirmed':
        return [btn('confirm-split', a.confirmSplit)];
      case 'assumption':
        if (g.assumptionBasis === 'q11' || g.assumptionBasis === 'r1') return [readOnly(t.basis[g.assumptionBasis], t.basisText)];
        return [btn('replace-assumption', a.replaceAssumption)];
      case 'artist_without_owner':
        return [btn('assign-owner', a.assignOwner)];
      case 'label_unmapped':
        return [btn('label-alias', a.labelAlias), btn('sublabel-rule', a.sublabelRule)];
      case 'rule_unconfirmed':
        return g.documentId && g.documentStatus === 'not_approved'
          ? [btn('approve', a.approveDocument)]
          : [btn('recreate-rule', a.recreateRule)];
      case 'unknown_pair':
        return [btn('register-track', a.registerTrack)];
      case 'no_isrc':
        return [readOnly(t.noIsrc, t.noIsrcText)];
      case 'writer_unmapped':
        return [btn('map-writer', a.mapWriter)];
      case 'publishing_terms_unconfirmed':
        return [btn('publishing-terms', a.publishingTerms)];
    }
  })();
  // Two actions stack (the row grows, autoHeight): a button never overlaps the next row (stage 4 walk F1).
  return <div className="flex flex-col items-start gap-1 py-1">{items}</div>;
}

function ActionHost({ active, onClose }: { active: Active; onClose: () => void }) {
  const g = active.group;
  const isrc = g.isrcs[0]?.isrc ?? null;
  const ruleKind = g.key.kind === 'split' || g.key.kind === 'participation' || g.key.kind === 'labelRule' ? g.key.kind : null;
  switch (active.action) {
    case 'create-contract':
      return (
        <CreateContractDialog
          ownerId={g.key.id}
          ownerLabel={g.key.label}
          waiting={g.amount}
          newDocumentOnly
          submitName="submit"
          onClose={onClose}
        />
      );
    case 'merge':
      return <MergeOwnerDialog ownerId={g.key.id} ownerLabel={g.key.label} onClose={onClose} />;
    case 'confirm-split':
      return <ConfirmSplitDialog splitId={g.key.id} isrc={g.key.label} onClose={onClose} />;
    case 'replace-assumption':
    case 'recreate-rule':
      return ruleKind ? (
        <ReplaceDocumentDialog
          kind={ruleKind}
          ruleId={g.ruleId ?? g.key.id}
          isrc={ruleKind === 'split' ? g.key.label : isrc}
          oldDocumentId={g.documentId}
          fromMonth={g.months.from}
          title={active.action === 'recreate-rule' ? a.recreateRule : a.replaceAssumption}
          onClose={onClose}
        />
      ) : null;
    case 'approve':
      return g.documentId ? <ApproveDocumentDialog documentId={g.documentId} onClose={onClose} /> : null;
    case 'assign-owner':
      return <AssignOwnerDialog artistId={g.key.id} pseudonym={g.key.label} onClose={onClose} />;
    case 'label-alias':
      return <LabelAliasDialog alias={g.key.id} onClose={onClose} />;
    case 'sublabel-rule':
      return <SublabelRuleDialog labelString={g.key.id} onClose={onClose} />;
    case 'register-track': {
      const [pairIsrc = '', pairUpc = ''] = g.key.id.split('|');
      return <RegisterTrackDialog isrc={pairIsrc} upc={pairUpc} onClose={onClose} />;
    }
    case 'map-writer':
      return <MapWriterDialog writer={g.key.id} onClose={onClose} />;
    case 'publishing-terms':
      return <PublishingTermsDialog ownerId={g.key.id} ownerLabel={g.key.label} onClose={onClose} />;
    default:
      return null;
  }
}
