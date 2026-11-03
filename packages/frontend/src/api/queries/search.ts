import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const searchKeys = {
  query: (q: string, kinds?: readonly string[]) => ['search', 'query', q, kinds?.join(',') ?? null] as const,
};

export const searchQueries = {
  query: (q: string, kinds?: readonly ('owners' | 'artists' | 'tracks' | 'documents' | 'labels')[]) =>
    queryOptions({
      queryKey: searchKeys.query(q, kinds),
      queryFn: () => api.search.query(q, kinds),
      staleTime: 10_000,
    }),
};
