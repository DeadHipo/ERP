import type { Response } from 'express';
import { principalOf } from './authorize';

// The paging of the long lists (D-177), at the edge of the API: the facade answers the whole list, as it does for the
// screens, and the route cuts the page. A session without `limit` and `offset` gets the whole list as before; the read
// token is always paged, so that one call of a tool cannot return megabytes. Money is not touched.

const DEFAULT_PAGE = 50;

export interface PageParams {
  limit?: number | undefined;
  offset?: number | undefined;
}

/** The page size a request gets without `limit`: 50 for the read token, none for a session. */
export const defaultLimit = (res: Response): number | undefined =>
  principalOf(res)?.kind === 'reader' ? DEFAULT_PAGE : undefined;

function windowOf(res: Response, q: PageParams): { limit: number; offset: number } | null {
  const limit = q.limit ?? defaultLimit(res);
  if (limit === undefined && q.offset === undefined) return null;
  return { limit: limit ?? DEFAULT_PAGE, offset: q.offset ?? 0 };
}

/** A list answered as a bare array: the array, or `{ total, limit, offset, items }` when paged. */
export function pagedList<T>(res: Response, items: readonly T[], q: PageParams) {
  const w = windowOf(res, q);
  if (!w) return items;
  return { total: items.length, ...w, items: items.slice(w.offset, w.offset + w.limit) };
}

/** An answer with a list in `key`: the list cut to the page, with `total`, `limit`, `offset` beside it when paged. */
export function pagedField<A extends object, K extends keyof A>(res: Response, answer: A, key: K, q: PageParams) {
  const w = windowOf(res, q);
  const list = answer[key];
  if (!w || !Array.isArray(list)) return answer;
  return { ...answer, [key]: list.slice(w.offset, w.offset + w.limit), total: list.length, ...w };
}
