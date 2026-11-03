import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { MONEY_QUERY } from './core';

export const reportKeys = {
  reconciliation: (period: { from?: string; to?: string; basis?: 'report' | 'sales' } = {}) =>
    ['reports', 'reconciliation', period] as const,
  signals: (limit?: number) => ['reports', 'signals', limit ?? null] as const,
};

export const reportQueries = {
  reconciliation: (period: { from?: string; to?: string; basis?: 'report' | 'sales' } = {}) =>
    queryOptions({
      queryKey: reportKeys.reconciliation(period),
      queryFn: () => api.reports.reconciliation(period),
      ...MONEY_QUERY,
    }),
  signals: (limit?: number) =>
    queryOptions({ queryKey: reportKeys.signals(limit), queryFn: () => api.reports.signals({ limit }), ...MONEY_QUERY }),
};
