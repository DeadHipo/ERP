import { describe, expect, it } from 'vitest';
import { filesUnder, read } from './helpers';

// R8: no personal data in the repo: no e-mail address and no home-directory path in sources, specs and tests.
describe('privacy patterns', () => {
  const files = [
    ...filesUnder('src', /\.(tsx?|css|html)$/),
    ...filesUnder('e2e', /\.(tsx?|json)$/),
    ...filesUnder('tests', /\.tsx?$/),
    ...filesUnder('scripts', /\.(sh|ts)$/),
  ].filter((f) => !f.endsWith('privacy.test.ts'));

  it('scans files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no e-mail address', () => {
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
    expect(files.filter((f) => email.test(read(f)))).toEqual([]);
  });

  it('has no /Users/ path', () => {
    expect(files.filter((f) => read(f).includes('/Users/'))).toEqual([]);
  });
});
