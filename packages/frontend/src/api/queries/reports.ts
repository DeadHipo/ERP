import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { periodQuery, queueQuery } from '@erp/shared/api-schemas';
import type { CReason } from '@erp/shared/api-responses';
import * as api from '../client';
import { labelQuery } from '../../lib/label';
import { MONEY_QUERY } from './core';

type QueryPeriod = z.input<typeof periodQuery>;
type QueryQueue = z.input<typeof queueQuery>;

/** Every key here is a money key (`MONEY_KEYS`): the answer is one recalculation. */
export const reportKeys = {
  reconciliation: (period: QueryPeriod = {}) => ['reports', 'reconciliation', period] as const,
  signals: (limit?: number, labelId = '') => ['reports', 'signals', limit ?? null, labelId || null] as const,
  overview: (period: QueryPeriod = {}) => ['reports', 'overview', period] as const,
  queue: (reason: CReason, params: QueryQueue = {}, labelId = '') => ['reports', 'queue', reason, params, labelId || null] as const,
};

export const reportQueries = {
  reconciliation: (period: QueryPeriod = {}) =>
    queryOptions({
      queryKey: reportKeys.reconciliation(period),
      queryFn: () => api.reports.reconciliation(period),
      ...MONEY_QUERY,
    }),
  /** The signals; under a label (D-168) the units of that label. */
  signals: (limit?: number, labelId = '') =>
    queryOptions({ queryKey: reportKeys.signals(limit, labelId), queryFn: () => api.reports.signals({ limit, ...labelQuery(labelId) }), ...MONEY_QUERY }),
  /** P1 and the summary of P2 share this one call (R2). */
  overview: (period: QueryPeriod = {}) =>
    queryOptions({ queryKey: reportKeys.overview(period), queryFn: () => api.reports.overview(period), ...MONEY_QUERY }),
  queue: (reason: CReason, params: QueryQueue = {}, labelId = '') =>
    queryOptions({
      queryKey: reportKeys.queue(reason, params, labelId),
      queryFn: () => api.reports.queue(reason, { ...params, ...labelQuery(labelId) }),
      ...MONEY_QUERY,
    }),
};
