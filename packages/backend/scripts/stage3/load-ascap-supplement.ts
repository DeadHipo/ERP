/**
 * D-181 (A20): the ASCAP money that did not enter the start (the owner's list `ASCAP_доплата_артистам_2026-11-06.csv`,
 * folder 4 of the update of the pack of 2026-11-06; the owner's decision of 2026-11-06, evening: «начислить всем
 * сейчас»). Group «А — не вошёл в старт» with the action «начислить» becomes one `credit` per pseudonym through the
 * operation import (the basis document «ASCAP вне старта», the sources of the row in the comment, `external_id`
 * `ascap-2026-11-06:<line>` so that a repeat answers `unchanged`). The rows of group «Б» (the owner checks them against
 * the start first), the rows «кроме выкупленных работ после даты подписания» (the amount of the bought works is not in
 * the file) and the excluded ones are listed, never loaded. Dry run by default; `--apply` writes.
 *
 *   npx tsx packages/backend/scripts/stage3/load-ascap-supplement.ts <csv> [--out data/mvp-load/stage3] [--apply] [--org <id>] [dataDir]
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OPERATION_IMPORT_COLUMNS } from '@erp/shared/operation-import';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { parseCsv } from '../../src/shared/csv';
import { Decimal } from '../../src/shared/money';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 ? (args[outIdx + 1] as string) : 'data/mvp-load/stage3');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const [file, dataDirArg] = positional;
if (!file) {
  console.error('usage: load-ascap-supplement.ts <csv> [--out <dir>] [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const DATE = '2026-11-06';
const PACK = 'pack://для_разработчика_2026-11-06_update/4 ASCAP/ASCAP_доплата_артистам_2026-11-06.csv';
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function readCsv(path: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  let header: string[] | undefined;
  for await (const rec of parseCsv(createReadStream(path), ';')) {
    if (!header) {
      header = rec.map((h) => h.replace(/^/, '').trim());
      continue;
    }
    if (rec.every((v) => v.trim() === '')) continue;
    rows.push(Object.fromEntries(header.map((h, i) => [h, (rec[i] ?? '').trim()])));
  }
  return rows;
}
const money = (raw: string) => new Decimal(raw.replace(/\s/g, '').replace(',', '.') || '0');

const rows = await readCsv(file);
const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const { labels, owners } = f.modules;
  const zero = (await labels.index()).ownLabels().find((l) => l.name === '0to8');
  if (!zero) throw new Error('no own label named 0to8');
  mkdirSync(out, { recursive: true });

  // the basis document (idempotent by title), approved: the owner's list is the decision
  const title = 'ASCAP вне старта — список владельца 2026-11-06';
  const existing = (await owners.listDocuments()).find((d) => d.title === title);
  let docId = existing?.id;
  if (!docId) {
    const d = await owners.createDocument({ kind: 'adjustment_basis', title, fileRef: PACK, ownerId: null, requiresApproval: true, labelId: zero.id });
    await owners.approveDocument(d.id, 'D-181 loader: the owner\'s decision of 2026-11-06 (ASCAP outside the start)');
    docId = d.id;
  } else if (!existing?.approvedAt) await owners.approveDocument(docId, 'D-181 loader: the owner\'s decision of 2026-11-06 (ASCAP outside the start)');

  const names = OPERATION_IMPORT_COLUMNS.map((c) => c.name);
  const opRows: Record<string, string>[] = [];
  const left: { line: number; nick: string; amount: string; group: string; action: string }[] = [];
  let sum = new Decimal(0);
  rows.forEach((r, i) => {
    const line = i + 2;
    const nick = r['артист'] ?? '';
    const group = r['группа'] ?? '';
    const action = r['что делать'] ?? '';
    const amount = money(r['сумма к добавлению $'] ?? '0');
    if (!group.startsWith('А') || action !== 'начислить') {
      left.push({ line, nick, amount: amount.toFixed(2), group, action });
      return;
    }
    sum = sum.add(amount);
    opRows.push({
      owner: '',
      pseudonym: nick,
      date: DATE,
      // a credit is entered with the sign «−» (KIND_SIGN, D-173): money in favour of the pseudonym
      amount: amount.neg().toFixed(2),
      kind: 'credit',
      channel: '',
      confirmation: '',
      document: docId as string,
      external_id: `ascap-2026-11-06:${line}`,
      scope: '',
      comment: `ASCAP вне старта (${group}); источники: ${r['источники (выписки ASCAP)'] ?? ''}`.slice(0, 1500),
    });
  });
  const csvPath = join(out, 'ascap_credits.csv');
  writeFileSync(csvPath, '\ufeff' + [names.join(';'), ...opRows.map((r) => names.map((n) => quote(r[n] ?? '')).join(';'))].join('\r\n') + '\r\n');
  const leftPath = join(out, 'ascap_left.csv');
  writeFileSync(leftPath, '\ufeff' + ['line;nick;amount;group;action', ...left.map((l) => [String(l.line), l.nick, l.amount, l.group, l.action].map(quote).join(';'))].join('\r\n') + '\r\n');
  console.log(`credits: ${opRows.length} rows, Σ ${sum.toFixed(2)} → ${csvPath}; left for the owner: ${left.length} rows → ${leftPath}`);
  for (const l of left) console.log(`  left line ${l.line} ${l.nick} ${l.amount}: ${l.group} / ${l.action}`);

  const preview = await f.importOperations({ path: csvPath, fileName: 'ascap_credits.csv', labelId: zero.id, dryRun: true });
  console.log(`preview: rows ${preview.totals.rows}, create ${preview.totals.create}, unchanged ${preview.totals.unchanged}, errors ${preview.totals.errors}`);
  for (const r of preview.rows.filter((x) => x.action === 'error')) console.log(`  line ${r.line} ${r.pseudonym}: ${r.issues.map((i) => i.code).join(' ')}`);
  if (apply) {
    if (preview.totals.errors > 0) throw new Error('the preview has errors: nothing applied');
    const res = await f.importOperations({ path: csvPath, fileName: 'ascap_credits.csv', labelId: zero.id, dryRun: false });
    console.log(`applied: ${res.totals.create} created, ${res.totals.unchanged} unchanged`);
  }
} finally {
  await stack.close();
}
