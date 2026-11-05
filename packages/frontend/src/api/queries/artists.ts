import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { periodQuery } from '@erp/shared/api-schemas';
import * as api from '../client';
import { reference } from '../reference';
import { MONEY_QUERY } from './core';

type QueryPeriod = z.input<typeof periodQuery>;

export const artistKeys = {
  list: () => ['artists', 'list'] as const,
  detail: (artistId: string) => ['artists', 'detail', artistId] as const,
  /** A money key (`MONEY_KEYS`): the calculation of the pseudonym's reach (D-165). */
  balance: (artistId: string, period: QueryPeriod = {}) => ['artists', 'balance', artistId, period] as const,
  duplicates: () => ['artists', 'duplicates'] as const,
  /** A money key: one calculation for every pseudonym (P11 «Посчитать все», D-167). */
  balances: () => ['artists', 'balances'] as const,
  /** The balances of a list of pseudonyms (the visible rows of P11, D-167); the key is the sorted list. */
  balancesOf: (ids: readonly string[]) => ['artists', 'balances', 'ids', ids.join(',')] as const,
};

export const artistQueries = {
  list: () => queryOptions({ queryKey: artistKeys.list(), queryFn: () => api.artists.list() }),
  detail: (artistId: string) =>
    queryOptions({ queryKey: artistKeys.detail(artistId), queryFn: () => api.artists.get(artistId) }),
  balance: (artistId: string, period: QueryPeriod = {}) =>
    queryOptions({
      queryKey: artistKeys.balance(artistId, period),
      queryFn: () => api.artists.balance(artistId, period),
      ...MONEY_QUERY,
    }),
  duplicates: () => queryOptions({ queryKey: artistKeys.duplicates(), queryFn: () => reference.artistDuplicates() }),
  balances: () => queryOptions({ queryKey: artistKeys.balances(), queryFn: () => api.artists.balances(), ...MONEY_QUERY }),
  /** P11 (D-167): the money of the visible rows only; one calculation of the units of their union reach. */
  balancesOf: (ids: readonly string[]) =>
    queryOptions({
      queryKey: artistKeys.balancesOf(ids),
      queryFn: () => api.artists.balances({ ids: ids.join(',') }),
      enabled: ids.length > 0,
      ...MONEY_QUERY,
    }),
};
