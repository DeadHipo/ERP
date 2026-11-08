import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { admissionQuery, operationsQuery, startListQuery } from '@erp/shared/api-schemas';
import { money } from '../money';
import { settlements } from '../client';
import { MONEY_QUERY } from './core';

type QueryOperations = z.input<typeof operationsQuery>;
type QueryStart = z.input<typeof startListQuery>;
type QueryAdmission = z.input<typeof admissionQuery>;

/** Operations are not a money key (no calculation); the actions on them invalidate `all`. */
export const settlementKeys = {
  operations: (filter: QueryOperations = {}) => ['settlements', 'operations', filter] as const,
  snapshot: (operationId: string) => ['settlements', 'snapshot', operationId] as const,
  /** The opening balances (D-174): a list, no calculation; the writes of P30 invalidate `all`. */
  start: (filter: QueryStart = {}) => ['settlements', 'start', filter] as const,
  /** The admission (D-176): no calculation; the writes invalidate `all` (the gate of the balance changes). */
  admission: (filter: QueryAdmission = {}) => ['settlements', 'admission', filter] as const,
  /** The cuts (D-198): the list is no calculation; the state of a cut is a money key. */
  cuts: (labelId = '') => ['settlements', 'cuts', labelId || null] as const,
  cutState: (cutId: string, all: boolean) => ['settlements', 'cutState', cutId, all] as const,
};

export const settlementQueries = {
  operations: (filter: QueryOperations = {}) =>
    queryOptions({ queryKey: settlementKeys.operations(filter), queryFn: () => money.operations(filter), staleTime: 0 }),
  snapshot: (operationId: string) =>
    queryOptions({ queryKey: settlementKeys.snapshot(operationId), queryFn: () => money.snapshot(operationId) }),
  start: (filter: QueryStart = {}) => queryOptions({ queryKey: settlementKeys.start(filter), queryFn: () => settlements.startList(filter), staleTime: 0 }),
  admission: (filter: QueryAdmission = {}) => queryOptions({ queryKey: settlementKeys.admission(filter), queryFn: () => settlements.admission(filter), staleTime: 0 }),
  cuts: (labelId = '') =>
    queryOptions({ queryKey: settlementKeys.cuts(labelId), queryFn: () => settlements.cuts(labelId ? { label: labelId } : {}), staleTime: 0 }),
  cutState: (cutId: string, all: boolean) =>
    queryOptions({ queryKey: settlementKeys.cutState(cutId, all), queryFn: () => settlements.cutState(cutId, all ? { all: 'true' } : {}), ...MONEY_QUERY }),
};
