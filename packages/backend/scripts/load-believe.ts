/**
 * Loads Believe reports (.csv or .csv.zip) into ClickHouse and the PostgreSQL registry, one after another.
 * Needs the compose stack (docker compose up -d) and .env in the repo root. Files are only read; a copy is kept in the storage dir.
 *
 * Usage: npx tsx scripts/load-believe.ts [--storage <dir>] <file> [<file> ...]
 *        (default storage: data/files/sources)
 * A file for an account and month that is already loaded is reported and skipped.
 */
import { basename, resolve } from 'node:path';
import { connectSources } from '../src/connect-sources';

const args = process.argv.slice(2);
let storage = resolve(import.meta.dirname, '..', '..', '..', 'data', 'files', 'sources');
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--storage') storage = resolve(args[++i] ?? '');
  else files.push(resolve(args[i] as string));
}
if (files.length === 0) {
  console.error('Usage: npx tsx scripts/load-believe.ts [--storage <dir>] <file> [<file> ...]');
  process.exit(2);
}

const stack = connectSources(storage);

let failed = 0;
for (const path of files) {
  const started = Date.now();
  try {
    const f = await stack.sources.ingestBelieve({
      path,
      fileName: basename(path),
      uploadedBy: 'load-believe',
    });
    const s = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `loaded   ${basename(path)}  ${f.lineCount} lines  net ${f.netTotal}  ${s}s  rss ${Math.round(process.memoryUsage().rss / 1048576)} MB`,
    );
  } catch (e) {
    const err = e as Error & { code?: string };
    const skipped = err.code === 'duplicate_period' || err.code === 'duplicate_file';
    if (!skipped) failed++;
    console.log(`${skipped ? 'skipped ' : 'FAILED  '} ${basename(path)}  ${err.message}`);
  }
}
await stack.close();
process.exit(failed ? 1 : 0);
