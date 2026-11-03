import { queryOptions } from '@tanstack/react-query';
import { catalog } from '../catalog';
import { MONEY_QUERY } from './core';

export const releaseKeys = {
  list: (q?: string) => ['releases', 'list', q ?? null] as const,
  detail: (upc: string) => ['releases', 'detail', upc] as const,
};

export const releaseQueries = {
  /** P7: net per UPC of the loaded files (N8); `q` filters on the server. */
  list: (q?: string) =>
    queryOptions({ queryKey: releaseKeys.list(q), queryFn: () => catalog.releases({ q: q || undefined }), ...MONEY_QUERY }),
  /** P8: one calculation filtered by UPC (N9). */
  detail: (upc: string) =>
    queryOptions({ queryKey: releaseKeys.detail(upc), queryFn: () => catalog.release(upc), ...MONEY_QUERY }),
};
