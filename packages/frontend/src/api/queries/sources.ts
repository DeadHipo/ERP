import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { sourceLinesQuery } from '@erp/shared/api-schemas';
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
  lines: (query: z.input<typeof sourceLinesQuery>) =>
    queryOptions({ queryKey: sourceKeys.lines(query), queryFn: () => api.sources.lines(query), placeholderData: (prev) => prev }),
};
