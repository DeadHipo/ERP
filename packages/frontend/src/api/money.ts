import { z } from 'zod';
import type * as S from '@erp/shared/api-schemas';
import * as R from '@erp/shared/api-responses';
import { call } from './client';

// Client functions of the money pages: payables, operations with filters, the payout snapshot, the audit
// trail. One function per operation of packages/backend/src/api/operations.ts; every response parsed by its schema.

const id = encodeURIComponent;

export const money = {
  /** Every owner with the balance fields and the payout gate, from one calculation (N4). */
  payables: (query: z.input<typeof S.payablesAsOfQuery> = {}) =>
    call('GET', '/owners/payables', { query, schema: R.payablesSchema }),
  /** Operations with the owner name and the pseudonym, filtered (N14). */
  operations: (query: z.input<typeof S.operationsQuery> = {}) =>
    call('GET', '/settlements/operations', { query, schema: z.array(R.operationSchema) }),
  /** The snapshot stored with a button payout (N15). */
  snapshot: (operationId: string) =>
    call('GET', `/settlements/operations/${id(operationId)}/snapshot`, { schema: R.payoutSnapshotSchema }),
  /** The trail of writes that touched an entity, newest first (N16). */
  audit: (query: z.input<typeof S.auditQuery> = {}) => call('GET', '/audit', { query, schema: R.auditListSchema }),
};
