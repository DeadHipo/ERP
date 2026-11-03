import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { MONEY_QUERY } from './core';

export const ownerKeys = {
  all: ['owners'] as const,
  list: () => ['owners', 'list'] as const,
  detail: (ownerId: string) => ['owners', 'detail', ownerId] as const,
  balance: (ownerId: string, period: { from?: string; to?: string; basis?: 'report' | 'sales' } = {}) =>
    ['owners', 'balance', ownerId, period] as const,
};

export const ownerQueries = {
  list: () => queryOptions({ queryKey: ownerKeys.list(), queryFn: () => api.owners.list() }),
  detail: (ownerId: string) =>
    queryOptions({ queryKey: ownerKeys.detail(ownerId), queryFn: () => api.owners.get(ownerId) }),
  balance: (ownerId: string, period: { from?: string; to?: string; basis?: 'report' | 'sales' } = {}) =>
    queryOptions({
      queryKey: ownerKeys.balance(ownerId, period),
      queryFn: () => api.owners.balance(ownerId, period),
      ...MONEY_QUERY,
    }),
};
