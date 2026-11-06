/**
 * Loads Believe reports (.csv or .csv.zip) into ClickHouse and the PostgreSQL registry, one after another.
 * Needs the compose stack (docker compose up -d) and .env in the repo root. Files are only read; a copy is kept in the storage dir.
 *
 * Usage: npx tsx scripts/load-believe.ts [--data <dir>] [--org <id>] [--label <own label name>] <file> [<file> ...]
 *        (default data: data; the copies go to <data>/orgs/<org>/files/sources, D-170)
 * A file for an account and month that is already loaded is reported and skipped.
 * With `--label` (D-169) every file goes through the facade, as the upload route: the account of the file name must be
 * registered under that own label (422 account_unregistered / account_of_other_label otherwise), and the file keeps the
 * label. Without it the files are loaded without a label, as before, and a warning is printed.
 */
import { basename, resolve } from 'node:path';
import { connectOrg, takeOrgArgument } from '../src/connect-sources';
import { openFacade } from '../src/facade';

// the organization (D-170): --org <id> anywhere on the line, else ERP_ORG / ERP_DEFAULT_ORG
const ORG = takeOrgArgument();

const args = process.argv.slice(2);
let dataDir = resolve(import.meta.dirname, '..', '..', '..', 'data');
let labelName: string | undefined;
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--data') dataDir = resolve(args[++i] ?? '');
  else if (args[i] === '--label') labelName = args[++i];
  else files.push(resolve(args[i] as string));
}
if (files.length === 0 || (labelName !== undefined && !labelName)) {
  console.error('Usage: npx tsx scripts/load-believe.ts [--data <dir>] [--org <id>] [--label <own label name>] <file> [<file> ...]');
  process.exit(2);
}

const stack = await connectOrg({ dataDir, org: ORG });
const facade = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 0, sources: stack.sources });
let labelId: string | undefined;
if (labelName === undefined) {
  console.warn('WARNING: no --label: the files are loaded without a label (D-169) and are not in the book of any label');
} else {
  const own = (await facade.modules.labels.listLabels()).find((l) => l.kind === 'own' && l.name === labelName);
  if (!own) {
    console.error(`No own label named "${labelName}"`);
    await stack.close();
    process.exit(2);
  }
  labelId = own.id;
}

let failed = 0;
for (const path of files) {
  const started = Date.now();
  try {
    const input = { path, fileName: basename(path), uploadedBy: 'load-believe' };
    const f = labelId === undefined ? await stack.sources.ingestBelieve(input) : await facade.ingestBelieve(input, labelId);
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
