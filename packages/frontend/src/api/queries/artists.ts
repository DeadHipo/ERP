import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { periodQuery } from '@erp/shared/api-schemas';
import * as api from '../client';
import { reference } from '../reference';
import { labelQuery } from '../../lib/label';
import { MONEY_QUERY } from './core';

type QueryPeriod = z.input<typeof periodQuery>;

// Every money read takes the label view (D-168): `labelId` '' = «Все»; the key carries it, so a switch refetches.
export const artistKeys = {
  list: (labelId = '') => ['artists', 'list', labelId || null] as const,
  detail: (artistId: string) => ['artists', 'detail', artistId] as const,
  /** A money key (`MONEY_KEYS`): the calculation of the pseudonym's reach (D-165). */
  balance: (artistId: string, period: QueryPeriod = {}, labelId = '') => ['artists', 'balance', artistId, period, labelId || null] as const,
  duplicates: () => ['artists', 'duplicates'] as const,
  /** A money key: one calculation for every pseudonym (P11 «Посчитать все», D-167). */
  balances: (labelId = '') => ['artists', 'balances', labelId || null] as const,
  /** The balances of a list of pseudonyms (the visible rows of P11, D-167); the key is the sorted list. */
  balancesOf: (ids: readonly string[], labelId = '') => ['artists', 'balances', 'ids', ids.join(','), labelId || null] as const,
};

export const artistQueries = {
  list: (labelId = '') => queryOptions({ queryKey: artistKeys.list(labelId), queryFn: () => api.artists.list(labelQuery(labelId)) }),
  detail: (artistId: string) =>
    queryOptions({ queryKey: artistKeys.detail(artistId), queryFn: () => api.artists.get(artistId) }),
  balance: (artistId: string, period: QueryPeriod = {}, labelId = '') =>
    queryOptions({
      queryKey: artistKeys.balance(artistId, period, labelId),
      queryFn: () => api.artists.balance(artistId, { ...period, ...labelQuery(labelId) }),
      ...MONEY_QUERY,
    }),
  duplicates: () => queryOptions({ queryKey: artistKeys.duplicates(), queryFn: () => reference.artistDuplicates() }),
  balances: (labelId = '') =>
    queryOptions({ queryKey: artistKeys.balances(labelId), queryFn: () => api.artists.balances(labelQuery(labelId)), ...MONEY_QUERY }),
  /** P11 (D-167): the money of the visible rows only; one calculation of the units of their union reach. */
  balancesOf: (ids: readonly string[], labelId = '') =>
    queryOptions({
      queryKey: artistKeys.balancesOf(ids, labelId),
      queryFn: () => api.artists.balances({ ...labelQuery(labelId), ids: ids.join(',') }),
      enabled: ids.length > 0,
      ...MONEY_QUERY,
    }),
};
