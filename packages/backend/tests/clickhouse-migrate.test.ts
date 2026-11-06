import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TMP } from './helpers/tmp-root';
import { listMigrations, planMigrations, renameBelieveDatabases, splitStatements } from '../scripts/migrate-clickhouse';

const dir = join(TMP, 'clickhouse-migrate');
mkdirSync(dir, { recursive: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('renameBelieveDatabases', () => {
  const real = listMigrations(join(import.meta.dirname, '..', 'migrations', 'clickhouse'));
  it('leaves the files byte-identical for the default database believe', () => {
    for (const m of real) expect(renameBelieveDatabases(m.sql, 'believe')).toBe(m.sql);
  });
  it('retargets believe and believe_stage to <name> and <name>_stage, whole words only', () => {
    const sql = 'CREATE TABLE believe.rows; INSERT INTO believe_stage.t SELECT * FROM believe.rows; SELECT believer, my_believe';
    expect(renameBelieveDatabases(sql, 'believe_x')).toBe(
      'CREATE TABLE believe_x.rows; INSERT INTO believe_x_stage.t SELECT * FROM believe_x.rows; SELECT believer, my_believe',
    );
  });
  it('leaves no reference to the default pair in the real migrations', () => {
    for (const m of real) {
      const renamed = renameBelieveDatabases(m.sql, 'other');
      expect(renamed).not.toMatch(/\bbelieve(_stage)?\b/);
      if (/\bbelieve_stage\b/.test(m.sql)) expect(renamed).toMatch(/\bother_stage\b/);
    }
  });
});

describe('splitStatements', () => {
  it('splits on semicolons and drops empty statements', () => {
    expect(splitStatements('CREATE A; ;CREATE B;\n')).toEqual(['CREATE A', 'CREATE B']);
  });
  it('keeps a final statement without a semicolon', () => {
    expect(splitStatements('SELECT 1')).toEqual(['SELECT 1']);
  });
  it('ignores -- comments, including a semicolon inside one', () => {
    expect(splitStatements('-- header; not a split\nCREATE A; -- tail; more\nCREATE B')).toEqual([
      'CREATE A',
      'CREATE B',
    ]);
  });
  it('does not split inside quoted strings, with backslash and doubled-quote escapes', () => {
    expect(splitStatements(`SELECT 'a;b', 'it''s;', 'x\\';y'; SELECT 2`)).toEqual([
      `SELECT 'a;b', 'it''s;', 'x\\';y'`,
      'SELECT 2',
    ]);
  });
});

describe('listMigrations and planMigrations', () => {
  it('reads files in version order and ignores non-sql files', () => {
    writeFileSync(join(dir, '0002_second.sql'), 'SELECT 2;');
    writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;\r\n');
    writeFileSync(join(dir, '.gitkeep'), '');
    expect(listMigrations(dir).map((m) => m.file)).toEqual(['0001_first.sql', '0002_second.sql']);
  });
  it('hashes the file with line endings normalised', () => {
    writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;\n');
    const lf = listMigrations(dir)[0]?.checksum;
    writeFileSync(join(dir, '0001_first.sql'), 'SELECT 1;\r\n');
    expect(listMigrations(dir)[0]?.checksum).toBe(lf);
  });
  it('rejects a badly named .sql file and a repeated version', () => {
    writeFileSync(join(dir, 'oops.sql'), 'SELECT 1');
    expect(() => listMigrations(dir)).toThrow(/does not match/);
    rmSync(join(dir, 'oops.sql'));
    writeFileSync(join(dir, '0002_other.sql'), 'SELECT 3');
    expect(() => listMigrations(dir)).toThrow(/Two migrations have version 2/);
    rmSync(join(dir, '0002_other.sql'));
  });
  it('plans only the pending files', () => {
    const local = listMigrations(dir);
    const first = local[0];
    expect(first).toBeDefined();
    const pending = planMigrations(local, [{ version: 1, name: 'first', checksum: first?.checksum ?? '' }]);
    expect(pending.map((m) => m.version)).toEqual([2]);
  });
  it('refuses an applied file that was changed', () => {
    const local = listMigrations(dir);
    expect(() => planMigrations(local, [{ version: 1, name: 'first', checksum: 'other' }])).toThrow(
      /was changed/,
    );
  });
  it('refuses a new file numbered before an applied one', () => {
    const local = listMigrations(dir);
    const second = local[1];
    expect(() =>
      planMigrations(local, [{ version: 2, name: 'second', checksum: second?.checksum ?? '' }]),
    ).toThrow(/lower version/);
  });
});

describe('the shipped ClickHouse migrations', () => {
  const real = listMigrations(join(__dirname, '..', 'migrations', 'clickhouse'));
  it('are numbered without gaps', () => {
    expect(real.map((m) => m.version)).toEqual(real.map((_, i) => i + 1));
  });
  it('0003 replaces the units projection by units_by_label and recreates the view with label_name', () => {
    const m = real.find((x) => x.version === 3);
    expect(m?.name).toBe('units_by_label');
    const statements = splitStatements(m?.sql ?? '').map((s) => s.replace(/\s+/g, ' '));
    expect(statements).toHaveLength(4);
    expect(statements[0]).toBe('ALTER TABLE believe.rows DROP PROJECTION IF EXISTS units');
    expect(statements[1]).toMatch(/^ALTER TABLE believe\.rows ADD PROJECTION IF NOT EXISTS units_by_label/);
    expect(statements[1]).toContain('GROUP BY file_id, isrc, upc, reporting_month, sales_month, label_name');
    expect(statements[2]).toBe(
      'ALTER TABLE believe.rows MATERIALIZE PROJECTION units_by_label SETTINGS mutations_sync = 1',
    );
    expect(statements[3]).toMatch(/^CREATE OR REPLACE VIEW believe\.units AS/);
    expect(statements[3]).toContain('GROUP BY file_id, isrc, upc, reporting_month, sales_month, label_name');
  });
});
