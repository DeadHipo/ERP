import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const sourceKeys = {
  files: () => ['sources', 'files'] as const,
  facets: (fileId: string | undefined) => ['sources', 'facets', fileId ?? null] as const,
  lines: (query: object) => ['sources', 'lines', query] as const,
};

export const sourceQueries = {
  files: () => queryOptions({ queryKey: sourceKeys.files(), queryFn: () => api.sources.files() }),
  facets: (fileId?: string) =>
    queryOptions({ queryKey: sourceKeys.facets(fileId), queryFn: () => api.sources.facets({ fileId }) }),
};
