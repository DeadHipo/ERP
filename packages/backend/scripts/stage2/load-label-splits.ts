/**
 * D-175: the «100 % label» split versions of the owner's `split_changes.json` (the pack of 2026-11-06, folder 2: 112
 * ISRCs whose work was assigned to the company, valid from 2026-09). Every record names its basis group («Р-сентябрь
 * A1» … «A6») and the documents of the DD pack in `basis`; the script creates one approved document per group under
 * the own label `0to8` (kind `buyout` for an assignment to the company, `label_decision` for A6 = the owner's decision
 * in the chat of 23.10.2026; idempotent by title), writes the split import csv (`SPLIT_IMPORT_COLUMNS`: the ISRC, an
 * empty pseudonym, percent 100, from <valid_from>-01, the document id, the basis as the note) and runs the facade
 * import (`importSplits`: a preview by default, `--apply` writes all or nothing).
 *
 *   npx tsx packages/backend/scripts/stage2/load-label-splits.ts <split_changes.json> [--out data/mvp-load/stage2] [--apply] [--org <id>] [dataDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { SPLIT_IMPORT_COLUMNS } from '@erp/shared/split-import';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 ? (args[outIdx + 1] as string) : 'data/mvp-load/stage2');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const [jsonPath, dataDirArg] = positional;
if (!jsonPath) {
  console.error('usage: load-label-splits.ts <split_changes.json> [--out <dir>] [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));

interface Item {
  isrc: string;
  valid_from: string;
  split: { name: string; rate: number }[];
  basis: string;
}
const items = (JSON.parse(readFileSync(jsonPath, 'utf8')) as { items: Item[] }).items;
const groupOf = (it: Item) => /^Р-сентябрь (A\d)/.exec(it.basis)?.[1] ?? '?';
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const { labels, owners } = f.modules;
  const zero = (await labels.index()).ownLabels().find((l) => l.name === '0to8');
  if (!zero) throw new Error('no own label named 0to8');
  for (const it of items) {
    if (it.split.length !== 1 || it.split[0]?.name !== '0to8' || it.split[0]?.rate !== 100)
      throw new Error(`${it.isrc}: not a «100 % label» record (${JSON.stringify(it.split)})`);
  }
  // one approved document per basis group (idempotent by title)
  const groups = [...new Set(items.map(groupOf))].sort();
  const existing = await owners.listDocuments();
  const docOf = new Map<string, string>();
  for (const g of groups) {
    const sample = items.find((it) => groupOf(it) === g) as Item;
    const kind = g === 'A6' ? 'label_decision' : 'buyout';
    const title = `Уступка на компанию, сентябрь 2026: группа ${g} (${sample.basis.split(':')[1]?.split('—')[0]?.trim() ?? g})`;
    // the file of the document is the owner's record itself (the DD-pack documents named in `basis` stay in the pack)
    const fileRef = `pack://для_разработчика_2026-11-06/2 сплиты и альбомы с 2026-09/${basename(jsonPath)}#${g}`;
    const found = existing.find((d) => d.title === title);
    let id = found?.id;
    if (!id) {
      const d = await owners.createDocument({ kind, title, fileRef, ownerId: null, requiresApproval: true, labelId: zero.id });
      id = d.id;
      console.log(`document ${g}: ${kind} «${title}» ${d.id}`);
    } else if (!found?.fileRef) await owners.attachFile(id, fileRef);
    if (!(found?.approvedAt ?? null)) await owners.approveDocument(id, "D-175 loader: the owner's basis of 2026-10-23 (split_changes.json)");
    docOf.set(g, id);
  }
  mkdirSync(out, { recursive: true });
  const names = SPLIT_IMPORT_COLUMNS.map((c) => c.name);
  const rows = items.map((it) => ({
    isrc: it.isrc,
    pseudonym: '',
    percent: '100',
    from: `${it.valid_from}-01`,
    to: '',
    owner: '',
    document: docOf.get(groupOf(it)) as string,
    artist_id: '',
    note: it.basis.slice(0, 500),
  }));
  const csvPath = join(out, `label_splits_${basename(jsonPath, '.json')}.csv`);
  writeFileSync(csvPath, '﻿' + [names.join(';'), ...rows.map((r) => names.map((n) => quote(r[n as keyof typeof r])).join(';'))].join('\r\n') + '\r\n');
  console.log(`csv: ${csvPath}: ${rows.length} rows, groups ${groups.join(', ')}`);
  const result = await f.importSplits({ path: csvPath, fileName: basename(csvPath), labelId: zero.id, dryRun: !apply });
  const t = result.totals;
  console.log(`${apply ? 'APPLIED' : 'preview'}: rows ${t.rows}, groups ${t.groups}, create ${t.create}, change ${t.change}, unchanged ${t.unchanged}, errors ${t.errors}, warnings ${t.warnings}`);
  const byCode = new Map<string, number>();
  for (const r of result.rows) for (const i of r.issues) byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);
  for (const [code, n] of byCode) console.log(`  ${code}: ${n}`);
  const blocked = result.rows.filter((r) => r.issues.some((i) => i.severity === 'error'));
  for (const r of blocked.slice(0, 30)) console.log(`  blocked line ${r.line} ${r.group}: ${r.issues.map((i) => i.code).join(' ')}`);
} finally {
  await stack.close();
}
