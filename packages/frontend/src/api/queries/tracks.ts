import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { catalog } from '../catalog';
import { MONEY_QUERY } from './core';

export const trackKeys = {
  list: () => ['tracks', 'list'] as const,
  explain: (isrc: string) => ['tracks', 'explain', isrc] as const,
  summary: (account?: string, month?: string) => ['tracks', 'summary', account ?? null, month ?? null] as const,
  /** The money of a list of ISRCs (the visible rows of P5, D-162); the key is the sorted list, so a page seen before is cached. */
  summaryOf: (isrcs: readonly string[]) => ['tracks', 'summary', 'isrcs', isrcs.join(',')] as const,
  catalog: () => ['tracks', 'catalog'] as const,
  money: (isrc: string) => ['tracks', 'money', isrc] as const,
  breakdown: (isrc: string, month: string) => ['tracks', 'breakdown', isrc, month] as const,
  audit: (entityId: string) => ['audit', 'list', entityId] as const,
};

export const trackQueries = {
  list: () => queryOptions({ queryKey: trackKeys.list(), queryFn: () => api.tracks.list() }),
  explain: (isrc: string) =>
    queryOptions({ queryKey: trackKeys.explain(isrc), queryFn: () => api.tracks.explain(isrc), ...MONEY_QUERY }),
  /** P5: one calculation, all rows; the grid filters client-side (N5). */
  summary: (account?: string, month?: string) =>
    queryOptions({
      queryKey: trackKeys.summary(account, month),
      queryFn: () => catalog.trackSummary({ account, month }),
      ...MONEY_QUERY,
    }),
  /** P5 (D-162): the money of the visible rows only; one calculation of their units. */
  summaryOf: (isrcs: readonly string[]) =>
    queryOptions({
      queryKey: trackKeys.summaryOf(isrcs),
      queryFn: () => catalog.trackSummary({ isrcs: isrcs.join(',') }),
      enabled: isrcs.length > 0,
      ...MONEY_QUERY,
    }),
  /** P5 (D-162): the rows without money (a reference list, no calculation). */
  catalog: () => queryOptions({ queryKey: trackKeys.catalog(), queryFn: () => catalog.trackCatalog() }),
  /** P6: the one money call of the track card (N6). */
  money: (isrc: string) =>
    queryOptions({ queryKey: trackKeys.money(isrc), queryFn: () => catalog.trackMoney(isrc), ...MONEY_QUERY }),
  /** The breakdown of one month: ClickHouse rows only, no calculation (N7). */
  breakdown: (isrc: string, month: string) =>
    queryOptions({ queryKey: trackKeys.breakdown(isrc, month), queryFn: () => catalog.trackBreakdown(isrc, month) }),
  /** The audit trail of the ISRC (History tab). */
  audit: (entityId: string) =>
    queryOptions({ queryKey: trackKeys.audit(entityId), queryFn: () => catalog.audit({ entityId, limit: 200 }), staleTime: 0 }),
};
