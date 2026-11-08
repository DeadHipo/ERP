import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { balanceQuery } from '@erp/shared/api-schemas';
import * as api from '../client';
import { money } from '../money';
import { labelQuery } from '../../lib/label';
import { MONEY_QUERY } from './core';

/** The period of a money read with the cut `asOf` and the area of the gate (D-173); the label goes separately. */
type QueryPeriod = Omit<z.input<typeof balanceQuery>, 'label'>;

// Every money read takes the label view (D-168): `labelId` '' = «Все»; the key carries it, so a switch refetches.
export const ownerKeys = {
  all: ['owners'] as const,
  list: (labelId = '') => ['owners', 'list', labelId || null] as const,
  detail: (ownerId: string) => ['owners', 'detail', ownerId] as const,
  balance: (ownerId: string, period: QueryPeriod = {}, labelId = '') => ['owners', 'balance', ownerId, period, labelId || null] as const,
  /** A money key (`MONEY_KEYS`): one calculation for every owner (N4). */
  payables: (period: QueryPeriod = {}, labelId = '') => ['owners', 'payables', period, labelId || null] as const,
  /** The payables of a list of owners (the visible rows of P9, D-163); the key is the sorted list. */
  payablesOf: (ids: readonly string[], period: QueryPeriod = {}, labelId = '') =>
    ['owners', 'payables', 'ids', ids.join(','), period, labelId || null] as const,
  audit: (entityId: string) => ['audit', 'entity', entityId] as const,
  /** The cuts of the owner (D-200): a money key. */
  cuts: (ownerId: string, labelId = '') => ['owners', 'cuts', ownerId, labelId || null] as const,
};

export const ownerQueries = {
  list: (labelId = '') => queryOptions({ queryKey: ownerKeys.list(labelId), queryFn: () => api.owners.list(labelQuery(labelId)) }),
  detail: (ownerId: string) =>
    queryOptions({ queryKey: ownerKeys.detail(ownerId), queryFn: () => api.owners.get(ownerId) }),
  cuts: (ownerId: string, labelId = '') =>
    queryOptions({ queryKey: ownerKeys.cuts(ownerId, labelId), queryFn: () => api.owners.cuts(ownerId, labelQuery(labelId)), ...MONEY_QUERY }),
  balance: (ownerId: string, period: QueryPeriod = {}, labelId = '') =>
    queryOptions({
      queryKey: ownerKeys.balance(ownerId, period, labelId),
      queryFn: () => api.owners.balance(ownerId, { ...period, ...labelQuery(labelId) }),
      ...MONEY_QUERY,
    }),
  payables: (period: QueryPeriod = {}, labelId = '') =>
    queryOptions({
      queryKey: ownerKeys.payables(period, labelId),
      queryFn: () => money.payables({ ...period, ...labelQuery(labelId) }),
      ...MONEY_QUERY,
    }),
  /** P9 (D-163): the payables of the visible rows only; one calculation of the units of their reach. */
  payablesOf: (ids: readonly string[], period: QueryPeriod = {}, labelId = '') =>
    queryOptions({
      queryKey: ownerKeys.payablesOf(ids, period, labelId),
      queryFn: () => money.payables({ ...period, ...labelQuery(labelId), ids: ids.join(',') }),
      enabled: ids.length > 0,
      ...MONEY_QUERY,
    }),
  /** The audit trail of an entity (not money; every write invalidates it with `all`). */
  audit: (entityId: string) =>
    queryOptions({ queryKey: ownerKeys.audit(entityId), queryFn: () => money.audit({ entityId, limit: 200 }), staleTime: 0 }),
};
