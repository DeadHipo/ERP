import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { catalog } from '../catalog';
import { labelQuery } from '../../lib/label';
import { MONEY_QUERY } from './core';

// The release reads take the label view (D-168): `labelId` '' = «Все».
export const releaseKeys = {
  list: (q?: string, labelId = '') => ['releases', 'list', q ?? null, labelId || null] as const,
  detail: (upc: string, labelId = '') => ['releases', 'detail', upc, labelId || null] as const,
  /** Not a money key: the registry has no money (D-172). */
  registry: (q?: string, labelId = '') => ['releases', 'registry', q ?? null, labelId || null] as const,
};

export const releaseQueries = {
  /** P7: net per UPC of the loaded files (N8); `q` filters on the server; under a label its tracks and units. */
  list: (q?: string, labelId = '') =>
    queryOptions({ queryKey: releaseKeys.list(q, labelId), queryFn: () => catalog.releases({ q: q || undefined, ...labelQuery(labelId) }), ...MONEY_QUERY }),
  /** P8: one calculation filtered by UPC (N9). */
  detail: (upc: string, labelId = '') =>
    queryOptions({ queryKey: releaseKeys.detail(upc, labelId), queryFn: () => catalog.release(upc, labelQuery(labelId)), ...MONEY_QUERY }),
  /** P7 «Реестр» (D-172): the release registry of the label (every label under «Все»), no money. */
  registry: (q?: string, labelId = '') =>
    queryOptions({ queryKey: releaseKeys.registry(q, labelId), queryFn: () => api.releases.registry({ q: q || undefined, ...labelQuery(labelId) }) }),
};
