import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { documentsQuery } from '@erp/shared/api-schemas';
import * as api from '../client';
import { reference } from '../reference';
import { labelQuery } from '../../lib/label';
import { MONEY_QUERY } from './core';

export const documentKeys = {
  list: (ownerId?: string, labelId = '') => ['documents', 'list', ownerId ?? null, labelId || null] as const,
  uses: (documentId: string) => ['documents', 'uses', documentId] as const,
  filtered: (query: object) => ['documents', 'filtered', query] as const,
};

export const documentQueries = {
  /** `labelId` (D-169): the documents of that label and those without one; '' = every document. */
  list: (ownerId?: string, labelId = '') =>
    queryOptions({
      queryKey: documentKeys.list(ownerId, labelId),
      queryFn: () => api.documents.list({ ownerId, ...labelQuery(labelId) }),
    }),
  /** The query carries `label` (the switch, D-169), so the key does too. */
  filtered: (query: z.input<typeof documentsQuery>) =>
    queryOptions({ queryKey: documentKeys.filtered(query), queryFn: () => reference.documents(query) }),
  /** A money call (one calculation): the approve dialog shows `waiting.amount` (19 §1, N13). */
  uses: (documentId: string) =>
    queryOptions({ queryKey: documentKeys.uses(documentId), queryFn: () => api.documents.uses(documentId), ...MONEY_QUERY }),
};
