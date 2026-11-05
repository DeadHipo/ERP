/**
 * Loads one B17 statement through the facade (the same call the upload route makes, D-134) and prints counts only
 * (holder and writer names are legal names: never printed). Usage:
 *   npx tsx packages/backend/scripts/mvp/load-b17.ts <path.xlsx> [generatedAt] [--label <own label name>]
 *     (D-169: the statement is loaded under the own label; without --label it is loaded without one and a warning is printed)
 *   npx tsx packages/backend/scripts/mvp/load-b17.ts --reconcile      (read-only: the b17 rows of the reconciliation)
 */
import { basename, resolve } from 'node:path';
import { bootstrap } from './compare-common';
// eslint-disable-next-line no-restricted-imports -- read-only name check; the parser is not exported by the module index
import { quartersFromFileName } from '../../src/modules/publishing/b17-format';

const argv = process.argv.slice(2);
const labelAt = argv.indexOf('--label');
const labelName = labelAt >= 0 ? argv[labelAt + 1] : undefined;
const args = argv.filter((a, i) => !a.startsWith('--') && !(labelAt >= 0 && i === labelAt + 1));
const b = await bootstrap();
try {
  if (process.argv.includes('--reconcile')) {
    const rows = await b.f.reconciliation({});
    for (const r of rows.filter((x) => x.source === 'b17')) console.log(JSON.stringify(r));
  } else {
    const path = resolve(args[0] ?? '');
    const fileName = basename(path);
    console.log('quarters from the file name:', quartersFromFileName(fileName).join(', '));
    const input = { path, fileName, generatedAt: args[1] ?? null };
    let out: Awaited<ReturnType<typeof b.f.ingestB17>>;
    if (labelName === undefined) {
      console.warn('WARNING: no --label: the statement is loaded without a label (D-169)');
      // the module directly, as before the labels; the writers are resolved as the facade does
      const statement = await b.f.modules.publishing.ingestB17(input);
      out = { statement, writers: await b.f.resolveWriters() };
    } else {
      const own = (await b.f.modules.labels.listLabels()).find((l) => l.kind === 'own' && l.name === labelName);
      if (!own) throw new Error(`No own label named "${labelName}"`);
      out = await b.f.ingestB17(input, own.id);
    }
    const s = out.statement;
    console.log(JSON.stringify({ periods: s.periods, lineCount: s.lineCount, totalPayable: s.totalPayable, warnings: s.warnings, status: s.status }));
    console.log('writers:', JSON.stringify(out.writers));
  }
} finally {
  await b.close();
}
