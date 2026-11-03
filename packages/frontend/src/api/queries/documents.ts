import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { documentsQuery } from '@erp/shared/api-schemas';
import * as api from '../client';
import { reference } from '../reference';
import { MONEY_QUERY } from './core';

export const documentKeys = {
  list: (ownerId?: string) => ['documents', 'list', ownerId ?? null] as const,
  uses: (documentId: string) => ['documents', 'uses', documentId] as const,
  filtered: (query: object) => ['documents', 'filtered', query] as const,
};

export const documentQueries = {
  list: (ownerId?: string) =>
    queryOptions({ queryKey: documentKeys.list(ownerId), queryFn: () => api.documents.list({ ownerId }) }),
  filtered: (query: z.input<typeof documentsQuery>) =>
    queryOptions({ queryKey: documentKeys.filtered(query), queryFn: () => reference.documents(query) }),
  /** A money call (one calculation): the approve dialog shows `waiting.amount` (19 §1, N13). */
  uses: (documentId: string) =>
    queryOptions({ queryKey: documentKeys.uses(documentId), queryFn: () => api.documents.uses(documentId), ...MONEY_QUERY }),
};
