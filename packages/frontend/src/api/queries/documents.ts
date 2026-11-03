import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const documentKeys = {
  list: (ownerId?: string) => ['documents', 'list', ownerId ?? null] as const,
};

export const documentQueries = {
  list: (ownerId?: string) =>
    queryOptions({ queryKey: documentKeys.list(ownerId), queryFn: () => api.documents.list({ ownerId }) }),
};
