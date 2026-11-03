import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { operationsQuery } from '@erp/shared/api-schemas';
import { money } from '../money';

type QueryOperations = z.input<typeof operationsQuery>;

/** Operations are not a money key (no calculation); the actions on them invalidate `all`. */
export const settlementKeys = {
  operations: (filter: QueryOperations = {}) => ['settlements', 'operations', filter] as const,
  snapshot: (operationId: string) => ['settlements', 'snapshot', operationId] as const,
};

export const settlementQueries = {
  operations: (filter: QueryOperations = {}) =>
    queryOptions({ queryKey: settlementKeys.operations(filter), queryFn: () => money.operations(filter), staleTime: 0 }),
  snapshot: (operationId: string) =>
    queryOptions({ queryKey: settlementKeys.snapshot(operationId), queryFn: () => money.snapshot(operationId) }),
};
