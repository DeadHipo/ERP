// Client functions of the reference pages. Uses `call` of client.ts.
import type { z } from 'zod';
import type * as S from '@erp/shared/api-schemas';
import * as R from '@erp/shared/api-responses';
import { call } from './client';

export const reference = {
  /** N11: groups of artists with one normalised pseudonym (no calculation). */
  artistDuplicates: () => call('GET', '/artists/duplicates', { schema: R.duplicatesSchema }),
  /** N12: documents filtered by status, kind, title substring and owner. */
  documents: (query: z.input<typeof S.documentsQuery> = {}) =>
    call('GET', '/documents', { query, schema: R.documentSchema.array() }),
};
