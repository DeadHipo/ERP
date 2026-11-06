/**
 * Publishing v2 (D-182): loads the B17 reports of a directory, oldest quarter first, the `Updated` run last with its
 * quarter replaced. Dry run by default: the summaries are read and printed; `--apply` writes. Idempotent: a file
 * already loaded is skipped. Touches only the schema `pubv2`.
 *
 *   npx tsx packages/backend/scripts/pubv2/load.ts <dir> --label 0to8 [--apply] [--org <id>] [dataDir]
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { readB17Summary } from '../../src/modules/pubv2';
import { picoToString } from '../../src/shared/money';

const args = process.argv.slice(2);
const ORG = takeOrgArgument(args);
const apply = args.includes('--apply');
const labelAt = args.indexOf('--label');
const labelName = labelAt >= 0 ? args[labelAt + 1] : undefined;
const free = args.filter((a, i) => !a.startsWith('--') && i !== labelAt + 1);
const dir = free[0];
if (!dir || !labelName) {
  console.error('usage: load.ts <dir> --label <name> [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const dataDir = resolve(free[1] ?? join(import.meta.dirname, '..', '..', '..', '..', 'data', 'real'));

const quarterKey = (name: string) => {
  const m = /Q([1-4])(\d{4})/.exec(name);
  return m ? `${m[2]}-${m[1]}` : name;
};
const names = readdirSync(dir)
  .filter((n) => n.endsWith('.xlsx') && !n.startsWith('~'))
  .sort((a, b) => Number(/Updated/i.test(a)) - Number(/Updated/i.test(b)) || quarterKey(a).localeCompare(quarterKey(b)));

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
const label = (await f.modules.labels.listLabels()).find((l) => l.name === labelName);
if (!label) {
  console.error(`No label ${labelName}`);
  process.exit(1);
}
for (const name of names) {
  const path = join(dir, name);
  if (!apply) {
    const s = await readB17Summary(path, name);
    const payable = s.rows.reduce((a, r) => a + r.payablePico, 0n);
    console.log(name, s.format, s.periods.join('+'), s.rows.length, picoToString(payable));
    continue;
  }
  try {
    const file = await f.modules.pubv2.ingest({ path, fileName: name, labelId: label.id, replace: /Updated/i.test(name) });
    console.log(name, file.format, file.periods.join('+'), file.rowCount, file.payable, 'difference', file.difference ?? '-');
  } catch (e) {
    if ((e as { code?: string }).code !== 'duplicate_file') throw e;
    console.log(name, 'already loaded');
  }
}
await stack.close();
