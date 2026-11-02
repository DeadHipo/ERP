/**
 * Loads one B17 statement through the facade (the same call the upload route makes, D-134) and prints counts only
 * (holder and writer names are legal names: never printed). Usage:
 *   npx tsx packages/backend/scripts/mvp/load-b17.ts <path.xlsx> [generatedAt]
 *   npx tsx packages/backend/scripts/mvp/load-b17.ts --reconcile      (read-only: the b17 rows of the reconciliation)
 */
import { basename, resolve } from 'node:path';
import { bootstrap } from './compare-common';
// eslint-disable-next-line no-restricted-imports -- read-only name check; the parser is not exported by the module index
import { quartersFromFileName } from '../../src/modules/publishing/b17-format';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const b = await bootstrap();
try {
  if (process.argv.includes('--reconcile')) {
    const rows = await b.f.reconciliation({});
    for (const r of rows.filter((x) => x.source === 'b17')) console.log(JSON.stringify(r));
  } else {
    const path = resolve(args[0] ?? '');
    const fileName = basename(path);
    console.log('quarters from the file name:', quartersFromFileName(fileName).join(', '));
    const out = await b.f.ingestB17({ path, fileName, generatedAt: args[1] ?? null });
    const s = out.statement;
    console.log(JSON.stringify({ periods: s.periods, lineCount: s.lineCount, totalPayable: s.totalPayable, warnings: s.warnings, status: s.status }));
    console.log('writers:', JSON.stringify(out.writers));
  }
} finally {
  await b.close();
}
