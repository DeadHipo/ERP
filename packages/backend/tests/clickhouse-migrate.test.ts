import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TMP } from './helpers/tmp-root';
import { listMigrations, planMigrations, splitStatements } from '../scripts/migrate-clickhouse';

const dir = join(TMP, 'clickhouse-migrate');
mkdirSync(dir, { recursive: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
