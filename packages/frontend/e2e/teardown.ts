import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Drops the private e2e stores after the run unless E2E_KEEP=1 (keep them to look at the data or rerun a spec).
export default function globalTeardown(): void {
  if (process.env.E2E_KEEP === '1') {
    console.log('e2e: E2E_KEEP=1, the stores erp_e2e and believe_e2e are kept');
    return;
  }
  const root = join(import.meta.dirname, '..', '..', '..');
  const result = spawnSync('npx', ['tsx', 'packages/backend/scripts/e2e/drop.ts', 'e2e'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) console.error('e2e: dropping the private stores failed; drop erp_e2e and believe_e2e by hand');
}
