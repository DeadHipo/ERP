/**
 * D-175: the owner's `writeoffs.json` (the pack of 2026-11-06, folder 6): publishing deductions of the Main workbook that
 * the cabinet took off the position although the B17 registration gave the MC nothing; the owner's decision of
 * 2026-10-18 «списать как историю, не удерживать» adds the amount back. They are corrections of the start, so they
 * become `adjustment` rows of the opening balances (in the master area like the start itself, D-175; the basis = the
 * reason and the Main rows) through the start import. Dry run by default; `--apply` writes.
 *
 *   npx tsx packages/backend/scripts/stage2/load-writeoffs.ts <writeoffs.json> --cutoff 2026-08 --synced-at 2026-10-15T15:09:49.505Z [--out data/mvp-load/stage2] [--apply] [--org <id>] [dataDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { START_IMPORT_COLUMNS } from '@erp/shared/start-import';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { Decimal } from '../../src/shared/money';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] as string) : fallback;
};
const out = resolve(opt('--out', 'data/mvp-load/stage2'));
const cutoff = opt('--cutoff', '2026-08');
const syncedAt = opt('--synced-at', '2026-10-15T15:09:49.505Z');
const positional = args.filter((a, i) => !a.startsWith('--') && !['--out', '--cutoff', '--synced-at'].includes(args[i - 1] as string));
const [jsonPath, dataDirArg] = positional;
if (!jsonPath) {
  console.error('usage: load-writeoffs.ts <writeoffs.json> [--cutoff YYYY-MM] [--synced-at ISO] [--out <dir>] [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const items = (JSON.parse(readFileSync(jsonPath, 'utf8')) as { items: { nick: string; amount: number; month: string; main_rows: number[]; reason: string; decision: string }[] }).items;
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const zero = (await f.modules.labels.index()).ownLabels().find((l) => l.name === '0to8');
  if (!zero) throw new Error('no own label named 0to8');
  mkdirSync(out, { recursive: true });
  const names = START_IMPORT_COLUMNS.map((c) => c.name);
  const rows = items.map((it) => ({
    pseudonym: it.nick,
    kind: 'adjustment',
    master: new Decimal(it.amount.toString()).toFixed(2),
    publishing: '0',
    missing: '',
    basis: `writeoffs.json ${it.month}: ${it.reason}; ${it.decision}; Main #${it.main_rows.join(', ')}`.slice(0, 2000),
    document: '',
    operation_ref: '',
    comment: 'the owner\'s writeoffs.json (publishing deducted by Main, nothing accrued by B17)',
  }));
  const csvPath = join(out, `writeoffs_${basename(jsonPath, '.json')}.csv`);
  writeFileSync(csvPath, '﻿' + [names.join(';'), ...rows.map((r) => names.map((n) => quote(r[n as keyof typeof r])).join(';'))].join('\r\n') + '\r\n');
  const res = await f.importStart({ path: csvPath, fileName: basename(csvPath), labelId: zero.id, cutoff, syncedAt, dryRun: !apply, basis: 'writeoffs.json' });
  const t = res.totals;
  console.log(`${apply ? 'APPLIED' : 'preview'}: rows ${t.rows}, create ${t.create} (adjustments ${t.adjustments}), unchanged ${t.unchanged}, errors ${t.errors}; Σ publishing ${t.publishing}`);
  for (const r of res.rows.filter((x) => x.action !== 'create')) console.log(`  line ${r.line} ${r.pseudonym}: ${r.action} ${r.issues.map((i) => i.code).join(' ')}`);
} finally {
  await stack.close();
}
