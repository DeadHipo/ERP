import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const settlementKeys = {
  operations: (ownerId?: string) => ['settlements', 'operations', ownerId ?? null] as const,
};

export const settlementQueries = {
  operations: (ownerId?: string) =>
    queryOptions({
      queryKey: settlementKeys.operations(ownerId),
      queryFn: () => api.settlements.operations({ ownerId }),
    }),
};
