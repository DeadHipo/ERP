import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { reference } from '../reference';

export const artistKeys = {
  list: () => ['artists', 'list'] as const,
  detail: (artistId: string) => ['artists', 'detail', artistId] as const,
  duplicates: () => ['artists', 'duplicates'] as const,
};

export const artistQueries = {
  list: () => queryOptions({ queryKey: artistKeys.list(), queryFn: () => api.artists.list() }),
  detail: (artistId: string) =>
    queryOptions({ queryKey: artistKeys.detail(artistId), queryFn: () => api.artists.get(artistId) }),
  duplicates: () => queryOptions({ queryKey: artistKeys.duplicates(), queryFn: () => reference.artistDuplicates() }),
};
