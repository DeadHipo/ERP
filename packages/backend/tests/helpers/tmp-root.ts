import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

// One private scratch folder per test file under data/test-tmp (git-ignored). Removed after the file by tests/setup.ts.
export const TMP = join(import.meta.dirname, '..', '..', '..', '..', 'data', 'test-tmp', `run-${randomBytes(5).toString('hex')}`);

export function removeTmp(): void {
  rmSync(TMP, { recursive: true, force: true });
}
