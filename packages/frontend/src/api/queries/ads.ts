import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { adsQuery, adsSummaryQuery } from '@erp/shared/api-schemas';
import { catalog } from '../catalog';
import { ads } from '../client';
import { MONEY_QUERY } from './core';

type QueryList = z.input<typeof adsQuery>;
type QuerySummary = z.input<typeof adsSummaryQuery>;

/** Both answers come from one recalculation: money keys (`MONEY_KEYS`), never fresh. */
export const adKeys = {
  list: (filter: QueryList = {}) => ['ads', 'list', filter] as const,
  detail: (id: string) => ['ads', 'detail', id] as const,
  summary: (filter: QuerySummary = {}) => ['ads', 'summary', filter] as const,
};

export const adQueries = {
  list: (filter: QueryList = {}) => queryOptions({ queryKey: adKeys.list(filter), queryFn: () => ads.list(filter), ...MONEY_QUERY }),
  detail: (id: string) => queryOptions({ queryKey: adKeys.detail(id), queryFn: () => ads.get(id), ...MONEY_QUERY }),
  audit: (id: string) => queryOptions({ queryKey: ['audit', 'list', id] as const, queryFn: () => catalog.audit({ entityId: id, limit: 200 }), staleTime: 0 }),
  summary: (filter: QuerySummary = {}) =>
    queryOptions({ queryKey: adKeys.summary(filter), queryFn: () => ads.summary(filter), ...MONEY_QUERY }),
};
