import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openFacade } from '../src/facade';
import { tmpPath } from './helpers/fixtures';
import { testSources } from './helpers/test-sources';

const SRC = join(process.cwd(), 'src');
const MODULES = ['owners', 'splits', 'sources', 'settlements', 'publishing'];

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

  it('the four SQLite modules each have their own file; the sources are not SQLite', () => {
    const dir = tmpPath('db');
    const f = openFacade({ dataDir: dir, payoutThresholdCents: 0, sources: testSources() });
    f.close();
    const dbs = readdirSync(dir)
      .filter((n) => n.endsWith('.sqlite'))
      .sort();
    expect(dbs).toEqual(
      MODULES.filter((m) => m !== 'sources')
        .map((m) => `${m}.sqlite`)
        .sort(),
    );
  });
});
