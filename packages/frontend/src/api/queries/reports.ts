import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { periodQuery, queueQuery } from '@erp/shared/api-schemas';
import type { CReason } from '@erp/shared/api-responses';
import * as api from '../client';
import { MONEY_QUERY } from './core';

type QueryPeriod = z.input<typeof periodQuery>;
type QueryQueue = z.input<typeof queueQuery>;

/** Every key here is a money key (`MONEY_KEYS`): the answer is one recalculation. */
export const reportKeys = {
  reconciliation: (period: QueryPeriod = {}) => ['reports', 'reconciliation', period] as const,
  signals: (limit?: number) => ['reports', 'signals', limit ?? null] as const,
  overview: (period: QueryPeriod = {}) => ['reports', 'overview', period] as const,
  queue: (reason: CReason, params: QueryQueue = {}) => ['reports', 'queue', reason, params] as const,
};

export const reportQueries = {
  reconciliation: (period: QueryPeriod = {}) =>
    queryOptions({
      queryKey: reportKeys.reconciliation(period),
      queryFn: () => api.reports.reconciliation(period),
      ...MONEY_QUERY,
    }),
  signals: (limit?: number) =>
    queryOptions({ queryKey: reportKeys.signals(limit), queryFn: () => api.reports.signals({ limit }), ...MONEY_QUERY }),
  /** P1 and the summary of P2 share this one call (R2). */
  overview: (period: QueryPeriod = {}) =>
    queryOptions({ queryKey: reportKeys.overview(period), queryFn: () => api.reports.overview(period), ...MONEY_QUERY }),
  queue: (reason: CReason, params: QueryQueue = {}) =>
    queryOptions({
      queryKey: reportKeys.queue(reason, params),
      queryFn: () => api.reports.queue(reason, params),
      ...MONEY_QUERY,
    }),
};
