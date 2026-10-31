/**
 * ClickHouse migration runner.
 *
 * Applies migrations/clickhouse/NNNN_name.sql in order and records each one in <database>.schema_migrations
 * (version, name, sha256 of the file, time). Already applied files are skipped; an applied file that was edited
 * afterwards is an error (add a new migration instead). ClickHouse DDL is not transactional, so a migration
 * that fails half way is not recorded and is applied again on the next run: write every statement idempotent
 * (IF NOT EXISTS, CREATE OR REPLACE VIEW).
 *
 * No dependencies: plain fetch against the HTTP interface. Needs Node 22.18+ (runs .ts directly).
 * Not safe to run in two processes at once: it is meant to be the one-shot `clickhouse-migrate` compose service.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-clickhouse.ts            apply pending migrations
 *   node --env-file=.env scripts/migrate-clickhouse.ts --status   show applied and pending, change nothing
 * Env: CLICKHOUSE_HOST (localhost), CLICKHOUSE_HTTP_PORT (8123), CLICKHOUSE_DATABASE, CLICKHOUSE_USERNAME,
 *      CLICKHOUSE_PASSWORD, MIGRATIONS_DIR (../migrations/clickhouse), CLICKHOUSE_WAIT_SECONDS (90).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface Migration {
  version: number;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
}

/**
 * Splits a SQL file into statements on `;`. `--` line comments and 'single quoted' strings (with backslash
 * and doubled-quote escapes) are respected, so a `;` inside them does not split. Comments are dropped.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] as string;
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += '\n';
    } else if (c === "'") {
      cur += c;
      for (i++; i < sql.length; i++) {
        const s = sql[i] as string;
        cur += s;
        if (s === '\\') {
          i++;
          cur += sql[i] ?? '';
        } else if (s === "'") {
          if (sql[i + 1] === "'") {
            i++;
            cur += "'";
          } else break;
        }
      }
    } else if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Reads NNNN_name.sql files sorted by version. Any other .sql file or a repeated version is an error. */
export function listMigrations(dir: string): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;
    const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!m)
      throw new Error(
        `Migration file "${file}" does not match NNNN_name.sql (lowercase, digits, underscore)`,
      );
    const version = Number(m[1]);
    const prev = migrations[migrations.length - 1];
    if (prev && prev.version === version)
      throw new Error(`Two migrations have version ${version}: ${prev.file}, ${file}`);
    const sql = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    migrations.push({
      version,
      name: m[2] as string,
      file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return migrations;
}

/** Applied files must be unchanged, and nothing new may sit before an applied version. */
export function planMigrations(local: Migration[], applied: AppliedRow[]): Migration[] {
  const byVersion = new Map(applied.map((a) => [a.version, a]));
  for (const m of local) {
    const a = byVersion.get(m.version);
    if (a && a.checksum !== m.checksum) {
      throw new Error(
        `${m.file} was changed after it was applied (checksum differs). Add a new migration instead.`,
      );
    }
  }
  const pending = local.filter((m) => !byVersion.has(m.version));
  const maxApplied = applied.reduce((n, a) => Math.max(n, a.version), 0);
  const stale = pending.find((m) => m.version < maxApplied);
  if (stale) throw new Error(`${stale.file} has a lower version than the applied ${maxApplied}: renumber it`);
  return pending;
}

class ClickHouse {
  // plain fields, not constructor parameter properties: Node runs this file with type stripping only
  private readonly url: string;
  private readonly user: string;
  private readonly password: string;

  constructor(url: string, user: string, password: string) {
    this.url = url;
    this.user = user;
    this.password = password;
  }

  async exec(query: string, body?: string): Promise<string> {
    const res = await fetch(
      body === undefined ? this.url : `${this.url}/?query=${encodeURIComponent(query)}`,
      {
        method: 'POST',
        headers: { 'X-ClickHouse-User': this.user, 'X-ClickHouse-Key': this.password },
        body: body ?? query,
      },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.trim().slice(0, 500)}`);
    return text;
  }

  /** Waits until the server answers. On a first start the image restarts the server once after creating the user. */
  async waitReady(seconds: number): Promise<void> {
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      try {
        await this.exec('SELECT 1');
        return;
      } catch (e) {
        if (Date.now() > deadline) {
          throw new Error(`ClickHouse is not ready after ${seconds}s: ${(e as Error).message}`, { cause: e });
        }
      }
      await sleep(2000);
    }
  }
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Environment variable ${name} is required`);
  return v;
}

export async function main(argv: string[]): Promise<void> {
  const statusOnly = argv.includes('--status');
  const database = env('CLICKHOUSE_DATABASE');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database))
    throw new Error(`Invalid CLICKHOUSE_DATABASE "${database}"`);
  const dir = resolve(
    process.env.MIGRATIONS_DIR ?? join(import.meta.dirname, '..', 'migrations', 'clickhouse'),
  );
  const local = listMigrations(dir);

  const ch = new ClickHouse(
    `http://${env('CLICKHOUSE_HOST', 'localhost')}:${env('CLICKHOUSE_HTTP_PORT', '8123')}`,
    env('CLICKHOUSE_USERNAME'),
    env('CLICKHOUSE_PASSWORD'),
  );
  await ch.waitReady(Number(process.env.CLICKHOUSE_WAIT_SECONDS ?? 90));

  const table = `${database}.schema_migrations`;
  await ch.exec(`CREATE DATABASE IF NOT EXISTS ${database}`);
  await ch.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (
       version UInt32, name String, checksum String, applied_at DateTime64(3, 'UTC') DEFAULT now64(3)
     ) ENGINE = MergeTree ORDER BY version`,
  );
  const applied = (
    await ch.exec(`SELECT version, name, checksum FROM ${table} ORDER BY version FORMAT JSONEachRow`)
  )
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AppliedRow);

  const missing = applied.filter((a) => !local.some((m) => m.version === a.version));
  for (const a of missing)
    console.warn(`warning: applied migration ${a.version}_${a.name} has no file in ${dir}`);
  const pending = planMigrations(local, applied);

  if (statusOnly) {
    for (const m of local) console.log(`${pending.includes(m) ? 'pending' : 'applied'}  ${m.file}`);
    return;
  }
  if (!pending.length) {
    console.log(`clickhouse: up to date (${applied.length} applied)`);
    return;
  }
  for (const m of pending) {
    const statements = splitStatements(m.sql);
    console.log(`clickhouse: applying ${m.file} (${statements.length} statements)`);
    for (const [i, st] of statements.entries()) {
      try {
        await ch.exec(st);
      } catch (e) {
        throw new Error(
          `${m.file}, statement ${i + 1} (${st.split('\n')[0]?.slice(0, 70)}): ${(e as Error).message}`,
          {
            cause: e,
          },
        );
      }
    }
    await ch.exec(
      `INSERT INTO ${table} (version, name, checksum) FORMAT JSONEachRow`,
      JSON.stringify({ version: m.version, name: m.name, checksum: m.checksum }),
    );
  }
  console.log(`clickhouse: applied ${pending.length}, total ${applied.length + pending.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main(process.argv.slice(2)).catch((e: Error) => {
    console.error(`clickhouse migrate failed: ${e.message}`);
    process.exit(1);
  });
}
