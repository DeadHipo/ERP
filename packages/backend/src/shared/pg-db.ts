import { AsyncLocalStorage } from 'node:async_hooks';
import type pg from 'pg';
import { customType } from 'drizzle-orm/pg-core';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * The PostgreSQL database of the modules owners, splits, settlements and publishing (one schema per module, D-121).
 *
 * Every repository asks `orm()` for its executor at the moment of the query: inside `transaction()` or `snapshot()`
 * that is the connection of the transaction (AsyncLocalStorage), otherwise the pool. So the same repository code runs
 * alone, inside a module transaction, or inside one facade transaction that spans several modules.
 *
 *  - `transaction(fn)`: a write transaction. All write transactions of the application are serialized by one advisory
 *    lock, as the synchronous SQLite code never interleaved two writes (check-then-insert rules stay safe). A nested
 *    call joins the outer transaction.
 *  - `snapshot(fn)`: a read-only REPEATABLE READ transaction, one consistent version of every module (D-012). Inside a
 *    write transaction it joins it (the lock keeps other writers out).
 */
export interface Db {
  orm(): NodePgDatabase;
  /** Raw SQL on the current executor (for exact text casts drizzle does not express well). */
  query<R extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  snapshot<T>(fn: () => Promise<T>): Promise<T>;
  /** True inside transaction() or snapshot(). */
  inTransaction(): boolean;
}

/** Key of pg_advisory_xact_lock that serializes all writes of the modules ('erp-writes'). */
const WRITE_LOCK = 72_011_301;

interface Scope {
  client: pg.PoolClient;
  orm: NodePgDatabase;
  mode: 'write' | 'read';
}

/**
 * The connection of a transaction runs one query at a time: reads started together (Promise.all inside a snapshot)
 * wait for each other here instead of in pg's own queue, which pg deprecates.
 */
function queued(client: pg.PoolClient): pg.PoolClient {
  let tail: Promise<unknown> = Promise.resolve();
  const query = (...args: unknown[]) => {
    const run = tail.then(() => (client.query as (...a: unknown[]) => Promise<unknown>)(...args));
    tail = run.catch(() => undefined);
    return run;
  };
  return new Proxy(client, {
    get: (target, prop) => (prop === 'query' ? query : Reflect.get(target, prop, target)),
  });
}

export function createDb(pool: pg.Pool): Db {
  const als = new AsyncLocalStorage<Scope>();
  const poolOrm = drizzle({ client: pool });

  async function run<T>(mode: Scope['mode'], fn: () => Promise<T>): Promise<T> {
    const outer = als.getStore();
    if (outer) {
      if (outer.mode === 'read' && mode === 'write')
        throw new Error('A write transaction cannot start inside a read-only snapshot');
      return fn();
    }
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query(mode === 'write' ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (mode === 'write') await client.query('SELECT pg_advisory_xact_lock($1)', [WRITE_LOCK]);
      const queuedClient = queued(client);
      const result = await als.run(
        { client: queuedClient, orm: drizzle({ client: queuedClient }), mode },
        fn,
      );
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      throw e;
    } finally {
      client.release(broken);
    }
  }

  return {
    orm: () => als.getStore()?.orm ?? poolOrm,
    query: (text, values) => (als.getStore()?.client ?? pool).query(text, values),
    transaction: (fn) => run('write', fn),
    snapshot: (fn) => run('read', fn),
    inTransaction: () => als.getStore() !== undefined,
  };
}

/** timestamptz read as ISO 8601 UTC text ('2026-10-31T14:43:20.319Z'), the format of every timestamp in the app. */
export const isoTimestamp = customType<{ data: string; driverData: string }>({
  dataType: () => 'timestamp with time zone',
  fromDriver: (v) => new Date(v).toISOString(),
  toDriver: (v) => v,
});
