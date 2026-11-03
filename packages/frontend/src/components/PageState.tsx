import type { ReactNode } from 'react';
import { Button, Spinner } from '@heroui/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ru } from '../i18n/ru';

/** "Устарело, пересчёт": old numbers stay visible while a refetch is in flight (17 §8). */
export function StaleBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      data-testid="stale-badge"
      className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning"
    >
      <Spinner size="sm" />
      {ru.pageState.stale}
    </span>
  );
}

/** The three non-data states of a page (17 §8). */
export function PageState(props:
  | { variant: 'empty'; message: string; action?: ReactNode }
  | { variant: 'long' }
  | { variant: 'error'; error: Error; onRetry?: () => void }) {
  if (props.variant === 'empty') {
    return (
      <div data-testid="page-state-empty" className="flex flex-col items-start gap-3 rounded-xl border border-border p-6">
        <p className="text-sm text-muted">{props.message}</p>
        {props.action}
      </div>
    );
  }
  if (props.variant === 'long') {
    return (
      <div data-testid="page-state-long" className="flex items-center gap-3 rounded-xl border border-border p-6">
        <Spinner />
        <div>
          <div className="font-medium">{ru.pageState.longTitle}</div>
          <div className="text-sm text-muted">{ru.pageState.long}</div>
        </div>
      </div>
    );
  }
  const code = props.error instanceof ApiError ? props.error.code : 'error';
  return (
    <div data-testid="page-state-error" className="flex flex-col items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 p-6">
      <div className="font-medium text-danger">
        {ru.pageState.errorTitle}: <span data-testid="error-code">{code}</span>
      </div>
      <p className="text-sm" data-testid="error-message">
        {code === 'contract_mismatch' ? ru.pageState.contractMismatch : props.error.message}
      </p>
      {props.onRetry ? (
        <Button size="sm" variant="secondary" data-testid="action-retry" onPress={props.onRetry}>
          {ru.pageState.retry}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Wraps a TanStack query with the states of 17 §8: the long panel while a money query has no data yet, the error
 * with a retry, the empty sentence, and the stale badge when a refetch runs over old data.
 */
export function QueryView<T>(props: {
  query: UseQueryResult<T, Error>;
  /** A money query shows the "идёт пересчёт" panel; others a plain spinner. */
  money?: boolean;
  isEmpty?: (data: T) => boolean;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { query } = props;
  if (query.isError && query.data === undefined)
    return <PageState variant="error" error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined)
    return props.money ? <PageState variant="long" /> : <Spinner aria-label={ru.common.loading} />;
  if (props.isEmpty?.(query.data))
    return <PageState variant="empty" message={props.emptyMessage ?? ru.common.noData} action={props.emptyAction} />;
  return (
    <div>
      <StaleBadge show={query.isFetching} />
      {props.children(query.data)}
    </div>
  );
}
