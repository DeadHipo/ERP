import { describe, expect, it } from 'vitest';
import { filesUnder, read } from './helpers';

// R6: `src/api/` declares no hand-written response type; types come from `@erp/shared` (zod schemas).
describe('src/api declares no body types', () => {
  const declaration = /^\s*(export )?(interface|type) (\w+)/gm;
  // `OperationKey` (coverage.ts, D-171) is the union of the operation keys, not a body type
  const allowed = (name: string) => name === 'ApiError' || name === 'OperationKey' || name.startsWith('Query');

  it('has only ApiError, OperationKey and Query* option types', () => {
    const offenders: string[] = [];
    for (const file of filesUnder('src/api', /\.tsx?$/)) {
      for (const match of read(file).matchAll(declaration)) {
        if (!allowed(match[3] ?? '')) offenders.push(`${file}: ${match[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has one fetch call site', () => {
    const sites = filesUnder('src/api', /\.tsx?$/).filter((f) => /\bfetch\(/.test(read(f)));
    expect(sites).toEqual(['src/api/client.ts']);
  });
});
