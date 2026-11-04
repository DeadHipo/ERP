import type { MouseEvent, ReactNode } from 'react';
import { Skeleton, Tooltip } from '@heroui/react';
import { ChevronDownIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { Money } from './Money';
import { ru } from '../i18n/ru';

/** The tone of the icon well and the active ring: a HeroUI token, so both themes follow. */
export type KpiAccent = 'success' | 'accent' | 'warning' | 'danger' | 'muted';

const accentVar = (accent: KpiAccent) => `var(--${accent})`;

/**
 * One KPI card (D-160): an icon in a tinted square, a label with an info tooltip, a large amount with the currency in
 * small print, an optional line under it, and a chevron that expands a breakdown the page renders below the row.
 * The value is shown, never computed: `value` is a decimal string of the API (`null`: nothing to show, see `hint`).
 */
export function KpiCard(props: {
  testId: string;
  icon: ReactNode;
  accent: KpiAccent;
  label: string;
  tooltip: string;
  value: string | null;
  /** Shown under the amount in small print (e.g. the identity check); `null` hides the line. */
  check?: { label: string; value: string; ok: boolean; title?: string } | null;
  /** Shown in place of the check line when there is no value (e.g. "several accounts match"). */
  hint?: string;
  extra?: ReactNode;
  loading?: boolean;
  /** Empty period: the zeros are shown muted. */
  muted?: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  const t = ru.overview.kpi;
  const toggleLabel = props.expanded ? t.collapse : t.expand;
  return (
    <div
      data-testid={props.testId}
      data-active={props.expanded ? 'true' : 'false'}
      className={`relative flex min-h-28 cursor-pointer flex-col justify-between gap-3 rounded-xl border bg-surface p-3.5 text-left transition-colors hover:bg-default/40 ${
        props.expanded ? 'border-accent shadow-sm ring-1 ring-accent' : 'border-border'
      }`}
      onClick={props.onToggle}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4"
          style={{ background: `color-mix(in srgb, ${accentVar(props.accent)} 22%, transparent)`, color: accentVar(props.accent) }}
          aria-hidden
        >
          {props.icon}
        </span>
        <span className="min-w-0 text-sm font-medium leading-tight text-foreground/90">{props.label}</span>
        <Tooltip delay={0}>
          <Tooltip.Trigger
            className="inline-flex shrink-0 rounded-sm text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={t.infoAria}
            onClick={stop}
          >
            <InformationCircleIcon className="size-4" aria-hidden />
          </Tooltip.Trigger>
          <Tooltip.Content placement="top" className="max-w-72 text-xs">
            {props.tooltip}
          </Tooltip.Content>
        </Tooltip>
        <button
          type="button"
          className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-default hover:text-foreground"
          aria-label={toggleLabel}
          aria-expanded={props.expanded}
          data-testid={`${props.testId}-toggle`}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle();
          }}
        >
          <ChevronDownIcon className={`size-4 transition-transform ${props.expanded ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {props.loading ? (
          <Skeleton className="h-7 w-36 rounded-md" data-testid={`${props.testId}-skeleton`} />
        ) : props.value === null ? (
          <span className="text-2xl font-semibold leading-none text-muted" data-testid={`${props.testId}-none`}>
            —
          </span>
        ) : (
          <span className={`flex flex-wrap items-baseline gap-x-2 ${props.muted ? 'text-muted' : ''}`}>
            <span className="text-2xl font-semibold leading-none tracking-tight">
              <Money value={props.value} />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t.usd}</span>
          </span>
        )}
        {props.loading ? (
          <Skeleton className="h-3 w-40 rounded" />
        ) : props.check ? (
          <span
            className={`text-xs ${props.check.ok ? 'text-muted' : 'font-medium text-danger'}`}
            data-testid={`${props.testId}-check`}
            data-ok={props.check.ok ? 'true' : 'false'}
            title={props.check.title}
          >
            {props.check.label} <Money value={props.check.value} />
          </span>
        ) : props.hint ? (
          <span className="text-xs text-warning" data-testid={`${props.testId}-hint`}>
            {props.hint}
          </span>
        ) : null}
        {!props.loading && props.extra ? <span className="text-xs text-muted">{props.extra}</span> : null}
      </div>
    </div>
  );
}
