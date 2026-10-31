import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Sqlite = Database.Database;

export interface ModuleDb<TSchema extends Record<string, unknown>> {
  sqlite: Sqlite;
  orm: BetterSQLite3Database<TSchema>;
  close(): void;
}

/**
 * Opens the SQLite file of one module (or ':memory:' in tests) and applies its DDL.
 * The DDL uses only portable SQL (TEXT/INTEGER columns, plain indexes) so it can move to PostgreSQL.
 */
export function openModuleDb<TSchema extends Record<string, unknown>>(
  file: string,
  ddl: string,
  schema: TSchema,
): ModuleDb<TSchema> {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  if (file !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(ddl);
  const orm = drizzle(sqlite, { schema });
  return { sqlite, orm, close: () => sqlite.close() };
}
