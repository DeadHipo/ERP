import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { testStack } from './helpers/test-sources';

const SRC = join(process.cwd(), 'src');
const MODULES = ['owners', 'splits', 'labels', 'sources', 'settlements', 'publishing', 'pubv2', 'audit', 'ads'];

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

  it('modules and the facade import neither src/orgs nor src/auth; the organization reaches them only as the shared OrgScope (D-170)', () => {
    const files = [...MODULES.flatMap((m) => filesOf(join(SRC, 'modules', m))), ...filesOf(join(SRC, 'facade'))];
    for (const file of files) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((x) => x[1] as string);
      for (const imp of imports) expect(imp, `${file} imports ${imp}`).not.toMatch(/(^|\/)(orgs|auth)(\/|$)/);
    }
    // the modules know the organization only through the helper in shared/, which knows no module
    const helper = readFileSync(join(SRC, 'shared', 'org-scope.ts'), 'utf8');
    expect(helper).not.toMatch(/from '\.\.\/(modules|facade|orgs|auth|api)/);
  });

  it('the facade never imports the API; it knows the viewer only as its own Viewer type (D-171)', () => {
    for (const file of filesOf(join(SRC, 'facade'))) {
      const body = readFileSync(file, 'utf8');
      const imports = [...body.matchAll(/from '([^']+)'/g)].map((x) => x[1] as string);
      for (const imp of imports) expect(imp, `${file} imports ${imp}`).not.toMatch(/(^|\/)(api|auth|orgs)(\/|$)/);
      expect(body, file).not.toMatch(/\bPrincipal\b|label_manager|org_admin/);
    }
  });

  it('only src/orgs/middleware.ts reads X-Org and res.locals.org: no route or facade names the organization (D-170)', () => {
    const reader = join(SRC, 'orgs', 'middleware.ts');
    const readers = filesOf(SRC).filter((f) => /header\(\s*'x-org'|headers\[\s*'x-org'|locals\.org\b/i.test(readFileSync(f, 'utf8')));
    expect(readers).toEqual([reader]);
    // no path names an organization: no /o/:id/ or /orgs/:id/ outside the system routes
    for (const file of filesOf(join(SRC, 'api', 'routes')).filter((f) => !f.endsWith('orgs.ts')))
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\br\.\w+\(\s*'\/(o|orgs)\//);
  });

  it('the layers import only the shared helpers, each other and the fixed shapes of four modules (D-169: the book is no layer input)', () => {
    const allowed = new Set([
      '../../modules/labels',
      '../../modules/publishing',
      '../../modules/settlements',
      '../../modules/splits',
      '../../shared/dates',
      '../../shared/identifiers',
      '../../shared/money',
      '@erp/shared/api-responses',
    ]);
    for (const file of filesOf(join(SRC, 'facade', 'layers'))) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((x) => x[1] as string);
      for (const imp of imports) expect(imp.startsWith('./') || allowed.has(imp), `${file} imports ${imp}`).toBe(true);
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/bookLabel|labelIds|source_files/);
    }
  });

  it('the calculation never reads the label history of an ISRC or the release registry (D-172: navigation, not money)', () => {
    const calc = [
      ...filesOf(join(SRC, 'facade', 'layers')),
      ...['calculation.ts', 'balance.ts', 'scope.ts', 'owner-scope.ts', 'label-scope.ts'].map((f) => join(SRC, 'facade', f)),
    ];
    for (const file of calc)
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/trackLabels|track_labels|releaseRegistry|release-registry|isrcsOfUpcs|owners\.releases|\breleases\./);
  });

  it('the onboarding checklist never calculates (D-172): no import of the calculation, no calculate(), no units read', () => {
    const body = readFileSync(join(SRC, 'facade', 'onboarding.ts'), 'utf8');
    expect(body).not.toMatch(/from '\.\/(calculation|scope|balance|reports|aggregates)'/);
    expect(body).not.toMatch(/\bcalculate\(|sources\.(snapshot|units)\(|withScope|scoped\(/);
  });

  it('only the facade composes modules; the API never opens a module database', () => {
    for (const file of filesOf(join(SRC, 'api'))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/open\w+Module|better-sqlite3/);
      // a route reaches a module only through the facade: no import of src/modules (D-172 review)
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from '[^']*\/modules\//);
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
