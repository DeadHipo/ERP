import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Connection settings of the PostgreSQL pool. Names follow the DB_* variables of .env. */
export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** Maximum connections of the pool (default 10). Keep it below the server's max_connections. */
  max?: number;
}

export function postgresConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PostgresConfig {
  const need = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`Environment variable ${name} is required`);
    return v;
  };
  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    database: need('DB_DATABASE'),
    user: need('DB_USERNAME'),
    password: need('DB_PASSWORD'),
    ...(env.DB_POOL_MAX ? { max: Number(env.DB_POOL_MAX) } : {}),
  };
}

const DATE = 1082;
const TIMESTAMPTZ = 1184;

/**
 * Value conversion of this application, set per pool (nothing global):
 *  - date -> 'YYYY-MM-DD' text (pg would build a Date in the local time zone and can shift the day);
 *  - timestamptz -> ISO 8601 UTC text, like every timestamp in the application;
 *  - numeric and bigint are left as pg gives them: exact decimal text, so money goes to decimal.js untouched.
 */
const types = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
    if (oid === DATE) return (v: string) => v;
    if (oid === TIMESTAMPTZ) return (v: string) => new Date(v).toISOString();
    return pg.types.getTypeParser(oid, format);
  }) as typeof pg.types.getTypeParser,
};

export interface Postgres {
  pool: pg.Pool;
  db: NodePgDatabase;
  close(): Promise<void>;
}

export function createPostgres(config: PostgresConfig): Postgres {
  const pool = new pg.Pool({ ...config, types });
  // An idle connection that the server drops must not crash the process.
  pool.on('error', (e) => console.error(`postgres: idle client error: ${e.message}`));
  return { pool, db: drizzle({ client: pool }), close: () => pool.end() };
}
