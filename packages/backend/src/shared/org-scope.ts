import { and, eq, getTableColumns, type SQL, type Table } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import type { Db } from './pg-db';

/**
 * The organization a module is opened under (stage 2, D-170). A module knows `org_id` only through this helper: it
 * does not know what an organization is (that is `src/orgs`, above the facade). Every repository is created with one
 * scope and filters every statement by it, so a module opened under organization A never reads or writes a row of B.
 */
export interface OrgScope {
  readonly id: string;
}

export function orgScope(id: string): OrgScope {
  if (typeof id !== 'string' || id.trim() === '') throw new Error('An organization id is required');
  return Object.freeze({ id });
}

/** `org_id = <org> AND ...conds` for a table with the `orgId` column (undefined conditions are dropped, as in `and`). */
export function orgWhere(org: OrgScope, table: { orgId: PgColumn }, ...conds: (SQL | undefined)[]): SQL {
  return and(eq(table.orgId, org.id), ...conds) as SQL;
}

/** The insert row stamped with the organization (the caller never names `orgId`). */
export function orgRow<R extends object>(org: OrgScope, row: R): R & { orgId: string } {
  return { ...row, orgId: org.id };
}

export function orgRows<R extends object>(org: OrgScope, rows: R[]): (R & { orgId: string })[] {
  return rows.map((r) => orgRow(org, r));
}

/**
 * The columns of a table without `orgId`, for `select(orgFree(T))`: a row read under an organization never carries
 * the organization (the answers of the API stay as they were; the module does not hand the id around).
 */
export function orgFree<T extends Table>(table: T): Omit<T['_']['columns'], 'orgId'> {
  const rest: Record<string, unknown> = { ...getTableColumns(table) };
  delete rest.orgId;
  return rest as Omit<T['_']['columns'], 'orgId'>;
}

/** A row type of a module table as the module sees it: without `orgId`. */
export type OrgFree<T> = Omit<T, 'orgId'>;

/** Raw SQL executor of one organization: `$1` is always the organization id, the caller's values follow as `$2…`. */
export type OrgQuery = <R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<pg.QueryResult<R>>;

/**
 * `q(text, values)` = `db.query(text, [org.id, ...values])`. Refuses a statement that does not name `org_id` and `$1`
 * (a forgotten filter fails at once, not silently across organizations).
 */
export function orgQuery(db: Pick<Db, 'query'>, org: OrgScope): OrgQuery {
  return (text, values = []) => {
    if (!/\borg_id\b/.test(text) || !/\$1(?!\d)/.test(text))
      throw new Error('An organization query must filter by org_id = $1');
    return db.query(text, [org.id, ...values]);
  };
}
