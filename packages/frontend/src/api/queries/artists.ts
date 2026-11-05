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
};
