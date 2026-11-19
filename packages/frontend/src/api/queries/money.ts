import { queryOptions, useQuery } from '@tanstack/react-query';
import type { MasterQueryBody } from '@erp/shared/api-schemas';
import { catalog } from '../catalog';
import { useLabel } from '../../lib/label';
import { MONEY_QUERY } from './core';

// The master money as rows (D-251, R2′): one money request per block. The key starts with `['money', 'master']`
// (a money key of `MONEY_KEYS`: never fresh, invalidated by every write that changes money) and carries the label
// view (D-168, '' = «Все»), the scope, the grain and the period, so each block of a page has its own cache entry.
export const masterKeys = {
  rows: (labelId: string, scope: MasterQueryBody['scope'], grain: MasterQueryBody['grain'], period?: MasterQueryBody['period']) =>
    ['money', 'master', labelId || null, scope, grain, { from: period?.from ?? null, to: period?.to ?? null }] as const,
};

export const masterQueries = {
  /** The rows of one block: one calculation of the units of the scope, grouped by the grain. */
  rows: (labelId: string, scope: MasterQueryBody['scope'], grain: MasterQueryBody['grain'], period?: MasterQueryBody['period']) =>
    queryOptions({
      queryKey: masterKeys.rows(labelId, scope, grain, period),
      queryFn: () => catalog.masterRows({ scope, grain, ...(period?.from || period?.to ? { period } : {}) }, labelId),
      ...MONEY_QUERY,
    }),
};

/**
 * The master money of a block (D-251): the rows of `scope` at `grain` under the label view of the header
 * (`useLabel()`), optionally for the report months of `period`. The key is by value, so a new object of the same scope
 * is the same query. `enabled: false` holds the request back (e.g. until the ISRC list of the block is known).
 */
export function useMasterRows(
  scope: MasterQueryBody['scope'],
  grain: MasterQueryBody['grain'],
  options: { period?: MasterQueryBody['period']; enabled?: boolean } = {},
) {
  const { labelId } = useLabel();
  return useQuery({ ...masterQueries.rows(labelId, scope, grain, options.period), enabled: options.enabled ?? true });
}
