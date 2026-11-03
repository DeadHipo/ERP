import { describe, expect, it } from 'vitest';
import { read } from './helpers';

// R3: a route never carries a name; the only parameters are keys (ISRC, UPC, id) and enum values (reason, signal name).
const ALLOWED = new Set(['isrc', 'upc', 'id', 'reason', 'name']);

describe('route parameters', () => {
  const files = ['src/routes/paths.ts'];

  it('finds the route files', () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('are only isrc, upc, id, reason, name', () => {
    const found: string[] = [];
    for (const file of files) {
      for (const m of read(file).matchAll(/'([^']*)'/g)) {
        for (const p of (m[1] ?? '').matchAll(/:(\w+)/g)) found.push(`${file}: ${p[1]}`);
      }
    }
    const bad = found.filter((f) => !ALLOWED.has(f.split(': ')[1] ?? ''));
    expect(bad).toEqual([]);
    expect(found.length).toBeGreaterThan(5);
  });
});
