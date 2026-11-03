import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { MONEY_QUERY } from './core';

export const documentKeys = {
  list: (ownerId?: string) => ['documents', 'list', ownerId ?? null] as const,
  uses: (documentId: string) => ['documents', 'uses', documentId] as const,
};

export const documentQueries = {
  list: (ownerId?: string) =>
    queryOptions({ queryKey: documentKeys.list(ownerId), queryFn: () => api.documents.list({ ownerId }) }),
  /** A money call (one calculation): the approve dialog shows `waiting.amount` (19 §1, N13). */
  uses: (documentId: string) =>
    queryOptions({ queryKey: documentKeys.uses(documentId), queryFn: () => api.documents.uses(documentId), ...MONEY_QUERY }),
};
