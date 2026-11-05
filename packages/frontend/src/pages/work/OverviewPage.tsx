import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { CReason, overviewSchema } from '@erp/shared/api-responses';
import { reportQueries } from '../../api/queries/reports';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { Money } from '../../components/Money';
import { ActionButton } from '../../components/ActionButton';
import { DateField } from '../../components/fields/DateField';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { formatDateTime } from '../../lib/datetime';
import { fmt, plural, ru } from '../../i18n/ru';
import { OverviewKpis } from './OverviewKpis';

type Overview = z.output<typeof overviewSchema>;
type Row = Overview['reconciliation'][number];
type Period = { from?: string; to?: string; basis?: 'report' | 'sales' };

const t = ru.overview;

/** The period of the money pages, kept in the URL (`from`, `to` as YYYY-MM, `basis`). */
export function usePeriod(): [Period, (p: Period) => void] {
  const [params, setParams] = useSearchParams();
  const basis = params.get('basis');
  const period: Period = {
    ...(params.get('from') ? { from: params.get('from') ?? undefined } : {}),
    ...(params.get('to') ? { to: params.get('to') ?? undefined } : {}),
    ...(basis === 'report' || basis === 'sales' ? { basis } : {}),
  };
  const set = (p: Period) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const k of ['from', 'to', 'basis'] as const) {
        const v = p[k];
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    });
  return [period, set];
}

function PeriodFilter(props: { period: Period; onApply: (p: Period) => void }) {
  const [from, setFrom] = useState(props.period.from ?? '');
  const [to, setTo] = useState(props.period.to ?? '');
  const [basis, setBasis] = useState<string>(props.period.basis ?? 'report');
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="period-filter">
      <div className="w-40">
        <DateField name="period-from" label={t.period.from} value={from} onChange={setFrom} month />
      </div>
      <div className="w-40">
        <DateField name="period-to" label={t.period.to} value={to} onChange={setTo} month />
      </div>
      <div className="w-36">
        <SelectField
          name="period-basis"
          label={t.period.basis}
          value={basis}
          onChange={setBasis}
          options={[
            { id: 'report', label: t.period.report },
            { id: 'sales', label: t.period.sales },
          ]}
        />
      </div>
      <ActionButton
        name="period-apply"
        write={false}
        onPress={() =>
          props.onApply({
            from: from || undefined,
            to: to || undefined,
            basis: basis === 'sales' ? 'sales' : undefined,
          })
        }
      >
        {t.period.apply}
      </ActionButton>
    </div>
  );
}

/** Links of a reconciliation row (17 §4): C reason → queue, B / ours → tracks, account+month → source lines. */
const rowQuery = (r: Row) => (r.source === 'believe' ? `account=${encodeURIComponent(r.account)}&month=${r.month}` : `month=${r.month}`);

export function OverviewPage() {
  const [period, setPeriod] = usePeriod();
  const [params, setParams] = useSearchParams();
  const account = params.get('account') ?? '';
  const query = useQuery(reportQueries.overview(period));
  return (
    <div data-testid="overview-page">
      <PageHeader title={t.title} subtitle={t.subtitle} toolbar={<PeriodFilter period={period} onApply={setPeriod} />} />
      {query.isError && query.data === undefined ? null : (
        <div className="mb-4">
          <OverviewKpis data={query.data} loading={query.data === undefined} account={account} />
        </div>
      )}
      <QueryView
        query={query}
        money
        isEmpty={(d) => d.files.believe === 0 && d.files.b17 === 0}
        emptyMessage={t.noFiles}
        emptyAction={
          <Link to="/sources" className="text-accent hover:underline">
            {t.toSources}
          </Link>
        }
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-muted" data-testid="overview-meta">
              <span title={data.calculatedAt}>{t.calculatedAt}: {formatDateTime(data.calculatedAt)}</span> · {fmt(t.files, { believe: data.files.believe, b17: data.files.b17 })}
            </div>
            <QueueStrip queue={data.queue} />
            <SignalStrip signals={data.signals} />
            <div className="w-56">
              <TextField
                name="overview-account"
                label={t.accountFilter}
                value={account}
                placeholder={t.accountPlaceholder}
                type="search"
                onChange={(v) =>
                  setParams((prev) => {
                    const next = new URLSearchParams(prev);
                    if (v) next.set('account', v);
                    else next.delete('account');
                    return next;
                  }, { replace: true })
                }
              />
            </div>
            <ReconTable rows={data.reconciliation.filter((r) => account === '' || r.account.includes(account))} />
            <p className="text-xs text-muted">{t.noTotals}</p>
            <LabelBooksTable books={data.totals.byLabel} />
          </div>
        )}
      </QueryView>
    </div>
  );
}

export function QueueStrip({ queue }: { queue: Overview['queue'] }) {
  if (queue.length === 0) return null;
  return (
    <section data-testid="overview-queue">
      <h2 className="mb-2 text-sm font-medium">{t.queueStrip}</h2>
      <div className="flex flex-wrap gap-2">
        {queue.map((q) => (
          <Link
            key={q.reason}
            to={`/queue/${q.reason}`}
            data-testid={`queue-chip-${q.reason}`}
            className="flex flex-col rounded-lg border border-border px-3 py-2 text-sm hover:bg-default"
          >
            <span>{ru.reasons[q.reason]}</span>
            <span className="flex gap-2">
              <Money value={q.amount} />
              <span className="text-muted">
                · {q.groups} {plural(q.groups, t.groups)}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const signalLabel = (name: string) => (name in ru.signals ? ru.signals[name as keyof typeof ru.signals] : name);

function SignalStrip({ signals }: { signals: Overview['signals'] }) {
  if (signals.length === 0) return null;
  return (
    <section data-testid="overview-signals">
      <h2 className="mb-2 text-sm font-medium">{t.signalStrip}</h2>
      <div className="flex flex-wrap gap-2">
        {signals.map((s) => (
          <Link
            key={s.name}
            to={`/signals/${s.name}`}
            data-testid={`signal-chip-${s.name}`}
            className="rounded-full border border-border px-3 py-1 text-xs hover:bg-default"
          >
            {signalLabel(s.name)}: <b>{s.count}</b>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** The six sums of the period per label of record (D-168, the backend's `totals.byLabel`; '?' = without a label). */
function LabelBooksTable({ books }: { books: z.output<typeof overviewSchema>['totals']['byLabel'] }) {
  const entries = Object.entries(books);
  if (entries.length === 0) return null;
  const c = t.cols;
  return (
    <section data-testid="overview-by-label">
      <h2 className="mb-2 text-sm font-medium">{t.byLabelTitle}</h2>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-default/50 text-left text-xs text-muted">
            <tr>
              {[c.byLabel, c.A, c.B, c.C, c.ours, c.noSplit, c.discrepancy].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(([label, v]) => (
              <tr key={label} data-testid={`overview-label-${label}`} className="border-t border-border">
                <td className="px-3 py-2">{label === '?' ? t.byLabelNone : label}</td>
                {(['received', 'notOurs', 'waiting', 'ourShare', 'ourShareNoSplit', 'discrepancy'] as const).map((k) => (
                  <td key={k} className="px-3 py-2" data-col={k}>
                    <Money value={v[k]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReconTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{t.noRows}</p>;
  const c = t.cols;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm" data-testid="overview-table">
        <thead className="bg-default/50 text-left text-xs text-muted">
          <tr>
            {[c.source, c.account, c.month, c.A, c.B, c.C, c.ours, c.noSplit, c.discrepancy, c.fileDiscrepancy].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <ReconRow key={`${r.source}|${r.account}|${r.month}`} r={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReconRow({ r }: { r: Row }) {
  const q = rowQuery(r);
  const believe = r.source === 'believe';
  const reasons = Object.entries(r.C_breakdown) as [CReason, string][];
  const labels = Object.entries(r.ourShareByLabel);
  const link = (to: string, value: string, col: string) => (
    <Link to={to} state={col === 'B' || col === 'ours' ? { sortBy: col } : undefined} className="hover:underline" data-col-link={col}>
      <Money value={value} />
    </Link>
  );
  return (
    <tr data-testid={`overview-row-${r.source}-${r.account}-${r.month}`} className="border-t border-border align-top">
      <td className="px-3 py-2">{t.sources[r.source]}</td>
      <td className="px-3 py-2">
        {believe ? (
          <Link to={`/sources/lines?${q}`} className="text-accent hover:underline" title={t.linesNote}>
            {r.account}
          </Link>
        ) : (
          r.account
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{r.month}</td>
      <td className="px-3 py-2" data-col="A">
        <Money value={r.A_received} />
      </td>
      <td className="px-3 py-2" data-col="B">
        {believe ? link(`/tracks?${q}`, r.B_notOurs, 'B') : <Money value={r.B_notOurs} />}
      </td>
      <td className="px-3 py-2" data-col="C">
        {reasons.length === 1 && reasons[0] ? (
          link(`/queue/${reasons[0][0]}?${q}`, r.C_waiting, 'C')
        ) : (
          <Money value={r.C_waiting} />
        )}
        {reasons.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-xs" aria-label={t.cBreakdown}>
            {reasons.map(([reason, amount]) => (
              <li key={reason} data-testid={`c-reason-${reason}`}>
                <Link to={`/queue/${reason}?${q}`} className="text-accent hover:underline">
                  {ru.reasons[reason]}: <Money value={amount} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </td>
      <td className="px-3 py-2" data-col="ours">
        {believe ? link(`/tracks?${q}`, r.ourShare, 'ours') : <Money value={r.ourShare} />}
        {labels.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted" aria-label={t.cols.byLabel}>
            {labels.map(([name, amount]) => (
              <li key={name} data-testid={`by-label-${name}`}>
                {name}: <Money value={amount} />
              </li>
            ))}
          </ul>
        ) : null}
      </td>
      <td className="px-3 py-2" data-col="noSplit">
        <Money value={r.ourShareNoSplit} />
      </td>
      <td className={r.discrepancy === '0' ? 'px-3 py-2' : 'bg-danger/10 px-3 py-2'} data-col="discrepancy">
        <Money value={r.discrepancy} />
      </td>
      <td className={r.fileDiscrepancy === null || r.fileDiscrepancy === '0' ? 'px-3 py-2' : 'bg-danger/10 px-3 py-2'} data-col="fileDiscrepancy">
        <Money value={r.fileDiscrepancy} />
      </td>
    </tr>
  );
}
