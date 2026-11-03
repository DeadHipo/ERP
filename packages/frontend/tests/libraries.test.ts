import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Every library of the frontend has a D-entry with its exact version (the goal: "каждая библиотека — D-запись"; D-154).
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const log = readFileSync(join(__dirname, '..', '..', '..', 'docs', '97_принятые_решения.md'), 'utf8');

describe('library ledger (D-154)', () => {
  const all = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([name]) => name !== '@erp/shared');

  it('scans the dependencies', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it.each(all)('%s is pinned exactly and named in the decision log with its version', (name, version) => {
    expect(version, `${name} must be an exact version`).toMatch(/^\d+\.\d+\.\d+$/);
    expect(log.includes(`\`${name}\``), `${name} is not named in docs/97`).toBe(true);
    expect(log.includes(version), `${name}@${version}: the version is not in docs/97`).toBe(true);
  });
});
