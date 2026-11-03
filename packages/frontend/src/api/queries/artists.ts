import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const artistKeys = {
  list: () => ['artists', 'list'] as const,
  detail: (artistId: string) => ['artists', 'detail', artistId] as const,
};

export const artistQueries = {
  list: () => queryOptions({ queryKey: artistKeys.list(), queryFn: () => api.artists.list() }),
  detail: (artistId: string) =>
    queryOptions({ queryKey: artistKeys.detail(artistId), queryFn: () => api.artists.get(artistId) }),
};
