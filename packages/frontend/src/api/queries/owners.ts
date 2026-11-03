import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { payablesQuery } from '@erp/shared/api-schemas';
import * as api from '../client';
import { money } from '../money';
import { MONEY_QUERY } from './core';

type QueryPeriod = z.input<typeof payablesQuery>;

export const ownerKeys = {
  all: ['owners'] as const,
  list: () => ['owners', 'list'] as const,
  detail: (ownerId: string) => ['owners', 'detail', ownerId] as const,
  balance: (ownerId: string, period: QueryPeriod = {}) => ['owners', 'balance', ownerId, period] as const,
  /** A money key (`MONEY_KEYS`): one calculation for every owner (N4). */
  payables: (period: QueryPeriod = {}) => ['owners', 'payables', period] as const,
  audit: (entityId: string) => ['audit', 'entity', entityId] as const,
};

export const ownerQueries = {
  list: () => queryOptions({ queryKey: ownerKeys.list(), queryFn: () => api.owners.list() }),
  detail: (ownerId: string) =>
    queryOptions({ queryKey: ownerKeys.detail(ownerId), queryFn: () => api.owners.get(ownerId) }),
  balance: (ownerId: string, period: QueryPeriod = {}) =>
    queryOptions({
      queryKey: ownerKeys.balance(ownerId, period),
      queryFn: () => api.owners.balance(ownerId, period),
      ...MONEY_QUERY,
    }),
  payables: (period: QueryPeriod = {}) =>
    queryOptions({ queryKey: ownerKeys.payables(period), queryFn: () => money.payables(period), ...MONEY_QUERY }),
  /** The audit trail of an entity (not money; every write invalidates it with `all`). */
  audit: (entityId: string) =>
    queryOptions({ queryKey: ownerKeys.audit(entityId), queryFn: () => money.audit({ entityId, limit: 200 }), staleTime: 0 }),
};
