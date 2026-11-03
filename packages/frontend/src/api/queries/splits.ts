import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { listQuery } from '@erp/shared/api-schemas';
import * as api from '../client';

export const splitKeys = {
  list: (isrc?: string, artistId?: string) => ['splits', 'list', isrc ?? null, artistId ?? null] as const,
  participations: (isrc?: string, artistId?: string) =>
    ['splits', 'participations', isrc ?? null, artistId ?? null] as const,
};

type QueryPage = z.input<typeof listQuery>;

export const splitQueries = {
  page: (query: QueryPage) =>
    queryOptions({ queryKey: ['splits', 'page', query] as const, queryFn: () => api.splits.list(query) }),
  participationsPage: (query: QueryPage) =>
    queryOptions({ queryKey: ['splits', 'participationsPage', query] as const, queryFn: () => api.participations.list(query) }),
  list: (isrc?: string, artistId?: string) =>
    queryOptions({ queryKey: splitKeys.list(isrc, artistId), queryFn: () => api.splits.list({ isrc, artistId }) }),
  participations: (isrc?: string, artistId?: string) =>
    queryOptions({
      queryKey: splitKeys.participations(isrc, artistId),
      queryFn: () => api.participations.list({ isrc, artistId }),
    }),
};
