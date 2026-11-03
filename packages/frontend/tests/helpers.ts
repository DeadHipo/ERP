import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every file under `dir` (relative to the frontend package) whose name matches `pattern`. */
export function filesUnder(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name === 'dist' || name === 'test-results' || name === 'playwright-report') continue;
      const full = join(abs, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (pattern.test(name)) out.push(relative(FRONTEND_ROOT, full));
    }
  };
  try {
    walk(join(FRONTEND_ROOT, dir));
  } catch {
    /* the folder may not exist */
  }
  return out;
}

export function read(relativePath: string): string {
  return readFileSync(join(FRONTEND_ROOT, relativePath), 'utf8');
}
