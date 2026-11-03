import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { testStack } from './helpers/test-sources';

const SRC = join(process.cwd(), 'src');
const MODULES = ['owners', 'splits', 'labels', 'sources', 'settlements', 'publishing', 'audit'];

function filesOf(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesOf(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('module boundaries (README 4)', () => {
  it('a module imports neither another module, nor the facade, nor the API', () => {
    for (const m of MODULES) {
      for (const file of filesOf(join(SRC, 'modules', m))) {
        const imports = [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map(
          (x) => x[1] as string,
        );
        for (const imp of imports) {
          expect(imp, `${file} imports ${imp}`).not.toMatch(/facade|\/api\//);
          const other = MODULES.filter((o) => o !== m).find(
            (o) => imp.includes(`/${o}`) || imp === `../${o}`,
          );
          expect(other, `${file} imports module ${other}`).toBeUndefined();
        }
      }
    }
  });

  it('only the facade composes modules; the API never opens a module database', () => {
    for (const file of filesOf(join(SRC, 'api'))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/open\w+Module|better-sqlite3/);
    }
  });

  it('the PostgreSQL modules each have their own schema; no foreign key crosses modules (D-121)', async () => {
    const own = MODULES.filter((m) => m !== 'sources');
    for (const m of own) {
      const schema = readFileSync(join(SRC, 'modules', m, 'schema.ts'), 'utf8');
      const declared = [...schema.matchAll(/pgSchema\('([^']+)'\)/g)].map((x) => x[1]);
      expect(declared, `${m}/schema.ts`).toEqual([m]);
      expect(schema).not.toMatch(/sqlite/);
    }
    const { pg } = await testStack();
    const tables = await pg.pool.query<{ schemaname: string; n: string }>(
      `SELECT schemaname, count(*)::text AS n FROM pg_tables WHERE schemaname = ANY($1) GROUP BY schemaname`,
      [own],
    );
    expect(tables.rows.map((r) => r.schemaname).sort()).toEqual([...own].sort());
    const crossing = await pg.pool.query(
      `SELECT c.conname FROM pg_constraint c
       JOIN pg_class a ON a.oid = c.conrelid JOIN pg_namespace an ON an.oid = a.relnamespace
       JOIN pg_class b ON b.oid = c.confrelid JOIN pg_namespace bn ON bn.oid = b.relnamespace
       WHERE c.contype = 'f' AND an.nspname <> bn.nspname`,
    );
    expect(crossing.rows).toEqual([]);
  });
});
