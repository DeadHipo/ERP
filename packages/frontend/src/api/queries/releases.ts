import { queryOptions } from '@tanstack/react-query';
import { catalog } from '../catalog';
import { labelQuery } from '../../lib/label';
import { MONEY_QUERY } from './core';

// The release reads take the label view (D-168): `labelId` '' = «Все».
export const releaseKeys = {
  list: (q?: string, labelId = '') => ['releases', 'list', q ?? null, labelId || null] as const,
  detail: (upc: string, labelId = '') => ['releases', 'detail', upc, labelId || null] as const,
};

export const releaseQueries = {
  /** P7: net per UPC of the loaded files (N8); `q` filters on the server; under a label its tracks and units. */
  list: (q?: string, labelId = '') =>
    queryOptions({ queryKey: releaseKeys.list(q, labelId), queryFn: () => catalog.releases({ q: q || undefined, ...labelQuery(labelId) }), ...MONEY_QUERY }),
  /** P8: one calculation filtered by UPC (N9). */
  detail: (upc: string, labelId = '') =>
    queryOptions({ queryKey: releaseKeys.detail(upc, labelId), queryFn: () => catalog.release(upc, labelQuery(labelId)), ...MONEY_QUERY }),
};
