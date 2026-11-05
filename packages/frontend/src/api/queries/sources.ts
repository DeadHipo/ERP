import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { sourceLinesQuery } from '@erp/shared/api-schemas';
import { labelQuery } from '../../lib/label';
import * as api from '../client';

// Under a label (D-169) the files, the lines and the facets are those of the files loaded under it; the key carries the
// label (`labelId || null`) like the money reads of D-168.
export const sourceKeys = {
  files: (labelId: string) => ['sources', 'files', labelId || null] as const,
  facets: (fileId: string | undefined, labelId: string) => ['sources', 'facets', fileId ?? null, labelId || null] as const,
  lines: (query: object) => ['sources', 'lines', query] as const,
};

export const sourceQueries = {
  files: (labelId: string) =>
    queryOptions({ queryKey: sourceKeys.files(labelId), queryFn: () => api.sources.files(labelQuery(labelId)) }),
  facets: (fileId: string | undefined, labelId: string) =>
    queryOptions({
      queryKey: sourceKeys.facets(fileId, labelId),
      queryFn: () => api.sources.facets({ fileId, ...labelQuery(labelId) }),
    }),
  /** `query.label` is the label of the switch (spread `labelQuery(labelId)`); it is part of the key. */
  lines: (query: z.input<typeof sourceLinesQuery>) =>
    queryOptions({ queryKey: sourceKeys.lines(query), queryFn: () => api.sources.lines(query), placeholderData: (prev) => prev }),
};
