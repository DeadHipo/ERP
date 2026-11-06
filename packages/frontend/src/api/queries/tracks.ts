import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { catalog } from '../catalog';
import { labelQuery } from '../../lib/label';
import { MONEY_QUERY } from './core';

// The track reads take the label view (D-168): `labelId` '' = «Все»; the key carries it, so a switch refetches.
export const trackKeys = {
  list: () => ['tracks', 'list'] as const,
  explain: (isrc: string) => ['tracks', 'explain', isrc] as const,
  summary: (account?: string, month?: string, labelId = '') => ['tracks', 'summary', account ?? null, month ?? null, labelId || null] as const,
  /** The money of a list of ISRCs (the visible rows of P5, D-162); the key is the sorted list, so a page seen before is cached. */
  summaryOf: (isrcs: readonly string[], labelId = '') => ['tracks', 'summary', 'isrcs', isrcs.join(','), labelId || null] as const,
  catalog: (labelId = '', current = false) => ['tracks', 'catalog', labelId || null, current ? 'current' : 'all'] as const,
  labels: (isrc: string) => ['tracks', 'labels', isrc] as const,
  money: (isrc: string) => ['tracks', 'money', isrc] as const,
  breakdown: (isrc: string, month: string) => ['tracks', 'breakdown', isrc, month] as const,
  audit: (entityId: string) => ['audit', 'list', entityId] as const,
};

export const trackQueries = {
  list: () => queryOptions({ queryKey: trackKeys.list(), queryFn: () => api.tracks.list() }),
  explain: (isrc: string) =>
    queryOptions({ queryKey: trackKeys.explain(isrc), queryFn: () => api.tracks.explain(isrc), ...MONEY_QUERY }),
  /** P5: one calculation, all rows; the grid filters client-side (N5). */
  summary: (account?: string, month?: string, labelId = '') =>
    queryOptions({
      queryKey: trackKeys.summary(account, month, labelId),
      queryFn: () => catalog.trackSummary({ account, month, ...labelQuery(labelId) }),
      ...MONEY_QUERY,
    }),
  /** P5 (D-162): the money of the visible rows only; one calculation of their units. */
  summaryOf: (isrcs: readonly string[], labelId = '') =>
    queryOptions({
      queryKey: trackKeys.summaryOf(isrcs, labelId),
      queryFn: () => catalog.trackSummary({ isrcs: isrcs.join(','), ...labelQuery(labelId) }),
      enabled: isrcs.length > 0,
      ...MONEY_QUERY,
    }),
  /** P5 (D-162): the rows without money (a reference list, no calculation); under a label the ISRCs of its units. */
  catalog: (labelId = '', current = false) =>
    queryOptions({
      queryKey: trackKeys.catalog(labelId, current),
      queryFn: () => catalog.trackCatalog({ ...labelQuery(labelId), ...(current ? { catalog: 'current' as const } : {}) }),
    }),
  /** The label history of the ISRC (D-172, P6): navigation, no money. */
  labels: (isrc: string) => queryOptions({ queryKey: trackKeys.labels(isrc), queryFn: () => api.tracks.labels(isrc), staleTime: 0 }),
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
