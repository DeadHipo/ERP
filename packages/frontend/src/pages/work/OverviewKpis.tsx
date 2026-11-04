import { useState } from 'react';
import { ArrowTrendingUpIcon, ClockIcon, PlusCircleIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import type { Overview } from '@erp/shared/api-responses';
import { KpiCard, type KpiAccent } from '../../components/KpiCard';
import { Money } from '../../components/Money';
import { compareDecimal } from '../../lib/money';
import { fmt, ru } from '../../i18n/ru';
import { breakdownLines, pickTotals, type KpiMetric, type KpiPick } from './overview-kpi';

const t = ru.overview.kpi;

const CARDS: { metric: KpiMetric; testId: string; icon: typeof PlusCircleIcon; accent: KpiAccent; text: { label: string; tooltip: string } }[] = [
  { metric: 'received', testId: 'kpi-received', icon: PlusCircleIcon, accent: 'success', text: t.received },
  { metric: 'notOurs', testId: 'kpi-confirmed', icon: UserGroupIcon, accent: 'accent', text: t.confirmed },
  { metric: 'waiting', testId: 'kpi-waiting', icon: ClockIcon, accent: 'warning', text: t.waiting },
  { metric: 'ourShare', testId: 'kpi-ours', icon: ArrowTrendingUpIcon, accent: 'success', text: t.ours },
];

const hintOf = (pick: KpiPick): string | undefined =>
  pick.kind === 'ambiguous' ? t.ambiguous : pick.kind === 'none' ? t.noAccount : undefined;

/**
 * The four KPI cards of P1 (D-160): A received, B confirmed to others, C waiting, ours; every number is a field of
 * `totals` of the overview (R1: nothing is summed here). The account filter of the table selects the account of the
 * cards; the expanded card shows the same metric by source and by Believe account. Rendered above the QueryView so a
 * pending query shows skeletons; an empty period shows muted zeros.
 */
export function OverviewKpis(props: { data: Overview | undefined; loading: boolean; account: string }) {
  const [open, setOpen] = useState<KpiMetric | null>(null);
  const pick = props.data ? pickTotals(props.data.totals, props.account) : null;
  const sums = pick && (pick.kind === 'all' || pick.kind === 'account') ? pick.sums : null;
  const muted = props.data !== undefined && props.data.reconciliation.length === 0;
  const checkOk = sums ? sums.discrepancy === '0' : true;
  const check = sums ? { label: `${t.check}:`, value: sums.discrepancy, ok: checkOk, title: t.checkTitle } : null;
  const toggle = (metric: KpiMetric) => setOpen((cur) => (cur === metric ? null : metric));
  const opened = open ? CARDS.find((c) => c.metric === open) : undefined;
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="overview-kpis" aria-label={t.bySource}>
      {CARDS.map((c) => {
        const Icon = c.icon;
        const value = sums ? sums[c.metric] : null;
        const accent: KpiAccent = c.metric === 'ourShare' && value !== null && compareDecimal(value, '0') < 0 ? 'danger' : c.accent;
        return (
          <KpiCard
            key={c.metric}
            testId={c.testId}
            icon={<Icon />}
            accent={accent}
            label={c.text.label}
            tooltip={c.text.tooltip}
            value={props.loading ? null : value}
            check={check}
            hint={pick ? hintOf(pick) : undefined}
            loading={props.loading}
            muted={muted}
            expanded={open === c.metric}
            onToggle={() => toggle(c.metric)}
            extra={
              c.metric === 'ourShare' && sums ? (
                <span data-testid="kpi-ours-nosplit">
                  {t.noSplitOf}: <Money value={sums.ourShareNoSplit} />
                </span>
              ) : undefined
            }
          />
        );
      })}
      {opened && props.data && pick ? (
        <Breakdown data={props.data} metric={opened.metric} label={opened.text.label} account={props.account} pick={pick} />
      ) : null}
    </section>
  );
}

function Breakdown(props: { data: Overview; metric: KpiMetric; label: string; account: string; pick: KpiPick }) {
  const lines = breakdownLines(props.data.totals, props.metric, props.account);
  const hint = hintOf(props.pick);
  return (
    <div className="col-span-full rounded-xl border border-border bg-surface p-3.5" data-testid="kpi-breakdown" data-metric={props.metric}>
      <div className="mb-2 flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-medium">{t.bySource}</span>
        <span className="text-muted">· {props.label}</span>
        {props.account !== '' ? <span className="text-xs text-muted">({t.filtered}: {props.account})</span> : null}
      </div>
      {hint ? (
        <p className="mb-2 text-xs text-warning" data-testid="kpi-breakdown-hint">
          {hint}
        </p>
      ) : null}
      {lines.length === 0 ? (
        <p className="text-sm text-muted">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {lines.map((l) => (
            <li
              key={l.key}
              data-testid={`kpi-breakdown-${l.key}`}
              className={`flex items-baseline justify-between gap-4 ${l.level === 1 ? 'pl-6 text-muted' : 'font-medium'}`}
            >
              <span>
                {l.account !== undefined && l.source === 'believe'
                  ? l.level === 1
                    ? fmt(t.account, { account: l.account })
                    : `${t.believe} · ${fmt(t.account, { account: l.account })}`
                  : t[l.source]}
              </span>
              <Money value={l.value} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
