import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const splitKeys = {
  list: (isrc?: string, artistId?: string) => ['splits', 'list', isrc ?? null, artistId ?? null] as const,
  participations: (isrc?: string, artistId?: string) =>
    ['splits', 'participations', isrc ?? null, artistId ?? null] as const,
};

export const splitQueries = {
  list: (isrc?: string, artistId?: string) =>
    queryOptions({ queryKey: splitKeys.list(isrc, artistId), queryFn: () => api.splits.list({ isrc, artistId }) }),
  participations: (isrc?: string, artistId?: string) =>
    queryOptions({
      queryKey: splitKeys.participations(isrc, artistId),
      queryFn: () => api.participations.list({ isrc, artistId }),
    }),
};
