/**
 * D-174: the opening balances of 15.10.2026 from the owner's files. Builds the import csv (`START_IMPORT_COLUMNS`) from
 * the cabinet snapshot (`cabinet_snapshot_2026-10-15.json`: one row per nick, the whole amount in the master area
 * (D-175: the cabinet position is one number and the November payroll of the master area carries it whole; the
 * publishing part of the `terms` goes into the comment), the `missing` nicks as rows without an amount) and the approved start adjustments of `transition.json`
 * (`start_adjustments` with `status: approved`; a `pub_advance` adjustment reopens the advance named by
 * `reopen_advances`, found among the organization's advances by pseudonym, date and amount), writes it next to the
 * issue report under `<out>` and runs the facade import under the own label `0to8`: a preview by default, `--apply`
 * writes (one transaction, all or nothing, through `importStart` like the API, without an audit row: a migration
 * script, like D-131's).
 *
 *   npx tsx packages/backend/scripts/start/load-cabinet.ts <snapshot.json> <transition.json> [--out data/mvp-load/start] [--create-owners] [--skip-errors] [--apply] [--org <id>] [dataDir]
 *
 * Prints the totals of the preview, the rows per issue code with their pseudonyms, and the sums; the issue report
 * (`start_issues.csv`) lists every row that is not `create` / `unchanged`. `--create-owners` first gives every
 * pseudonym of the snapshot that has no owner a person owner named after it (`origin: 'start'`), and creates the
 * pseudonyms the registry does not know at all (owner + pseudonym), then classifies again: a nick of the cabinet is a
 * participant whose position is owed whether or not a split names it yet. Ambiguous names (two live pseudonyms) stay
 * errors for the operator (P11 duplicates); `--skip-errors` writes the rows without an error to `start_<cutoff>_clean.csv`
 * and applies that file (the skipped rows stay in the issue report, to be imported after the operator resolves them).
 * Needs the stack of `.env`.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { START_IMPORT_COLUMNS } from '@erp/shared/start-import';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { Decimal, ZERO } from '../../src/shared/money';
import { normalizeName } from '../../src/shared/identifiers';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const createOwners = args.includes('--create-owners');
const skipErrors = args.includes('--skip-errors');
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 ? (args[outIdx + 1] as string) : 'data/mvp-load/start');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const [snapshotPath, transitionPath, dataDirArg] = positional;
if (!snapshotPath || !transitionPath) {
  console.error('usage: load-cabinet.ts <snapshot.json> <transition.json> [--out <dir>] [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));

interface Term {
  key: string;
  amount: number;
}
interface Item {
  name: string;
  amount?: number;
  terms?: Term[];
}
interface Snapshot {
  synced_at: string;
  items: Item[];
  missing: Item[];
  counts?: Record<string, number>;
}
interface Adjustment {
  party: string;
  kind: string;
  amount: number;
  status: string;
  why?: string;
  source?: string;
  approved_by?: string;
}
interface Reopen {
  party: string;
  date: string;
  amount: number;
  recoup_from?: string;
  why?: string;
}
interface Transition {
  approved?: boolean;
  cutoff: string;
  snapshot?: { synced_at?: string; file?: string };
  start_adjustments?: Adjustment[];
  reopen_advances?: Reopen[];
  approval?: { what?: string };
}

const money = (v: number | string | undefined) => new Decimal(typeof v === 'number' ? v.toString() : (v ?? '0'));
const text = (d: Decimal) => d.toFixed(2);
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot;
const transition = JSON.parse(readFileSync(transitionPath, 'utf8')) as Transition;
const cutoff = transition.cutoff;
const syncedAt = transition.snapshot?.synced_at ?? snapshot.synced_at;
if (!/^\d{4}-\d{2}$/.test(cutoff) || !syncedAt) {
  console.error('transition.json has no cutoff / synced_at');
  process.exit(1);
}
const snapshotSha = sha256(snapshotPath);
const basis = `cabinet snapshot ${basename(snapshotPath)} sha256 ${snapshotSha}, synced ${syncedAt}`;

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const { labels, owners, settlements } = f.modules;
  const zero = (await labels.index()).ownLabels().find((l) => l.name === '0to8');
  if (!zero) throw new Error('no own label named 0to8');

  // the rows of the csv
  type Row = Record<(typeof START_IMPORT_COLUMNS)[number]['name'], string>;
  const empty = (): Row => ({ pseudonym: '', kind: '', master: '', publishing: '', missing: '', basis: '', document: '', operation_ref: '', comment: '' });
  const rows: Row[] = [];
  let sumAmount = ZERO;
  let sumPub = ZERO;
  for (const it of snapshot.items) {
    const amount = money(it.amount);
    const pub = (it.terms ?? []).filter((t) => t.key === 'income.publishing' || t.key === 'expense.publishing').reduce((s, t) => s.add(money(t.amount)), ZERO);
    const termsSum = (it.terms ?? []).reduce((s, t) => s.add(money(t.amount)), ZERO);
    if (!termsSum.eq(amount)) console.warn(`terms of ${it.name} sum to ${text(termsSum)}, amount ${text(amount)}: the master part takes the difference`);
    sumAmount = sumAmount.add(amount);
    sumPub = sumPub.add(pub);
    rows.push({ ...empty(), pseudonym: it.name, kind: 'start', master: text(amount), publishing: '0', comment: `cabinet 15.10 (of it publishing by the terms ${text(pub)})` });
  }
  for (const it of snapshot.missing) rows.push({ ...empty(), pseudonym: it.name, kind: 'start', missing: '1', comment: 'the cabinet answered an error: the start is not confirmed, not a zero' });

  // the approved adjustments; a publishing advance reopened = the advance found by pseudonym, date and amount
  const index = await owners.artistIndex();
  const byNorm = new Map<string, { id: string; ownerId: string | null }[]>();
  for (const [id, a] of index) if (id === a.id) byNorm.set(normalizeName(a.pseudonym), [...(byNorm.get(normalizeName(a.pseudonym)) ?? []), { id: a.id, ownerId: a.ownerId }]);
  const advances = (await settlements.listOperations({ kind: 'advance', active: true })).filter((o) => o.labelId === zero.id);
  const reopen = transition.reopen_advances ?? [];
  let adjustments = 0;
  for (const a of transition.start_adjustments ?? []) {
    if (a.status !== 'approved') {
      console.log(`skipped (not approved): ${a.party} ${a.kind} ${a.amount} [${a.status}]`);
      continue;
    }
    let operationRef = '';
    if (a.kind === 'pub_advance') {
      const r = reopen.find((x) => x.party === a.party);
      const candidates = byNorm.get(normalizeName(a.party)) ?? [];
      const found = r
        ? advances.filter((o) => candidates.some((c) => c.id === (index.get(o.artistId ?? '')?.id ?? o.artistId)) && o.date === r.date && String(o.amountCents) === money(r.amount).mul(100).toFixed(0))
        : [];
      if (found.length === 1) operationRef = (found[0] as { id: string }).id;
      else console.warn(`reopened advance of ${a.party} (${r?.date ?? '?'}, ${r?.amount ?? '?'}): ${found.length} candidates, operation_ref left empty`);
    }
    const why = `${a.kind}: ${a.why ?? ''} (${a.source ?? ''}; ${a.approved_by ?? ''})`.slice(0, 2000);
    rows.push({ ...empty(), pseudonym: a.party, kind: 'adjustment', master: text(money(a.amount)), publishing: '0', basis: why, operation_ref: operationRef, comment: 'transition.json start_adjustments' });
    adjustments++;
  }

  mkdirSync(out, { recursive: true });
  const names = START_IMPORT_COLUMNS.map((c) => c.name);
  const csvPath = join(out, `start_${cutoff}.csv`);
  writeFileSync(csvPath, '﻿' + [names.join(';'), ...rows.map((r) => names.map((n) => quote(r[n])).join(';'))].join('\r\n') + '\r\n');
  console.log(`csv: ${csvPath}: ${snapshot.items.length} starts, ${snapshot.missing.length} missing, ${adjustments} adjustments; Σ amount ${text(sumAmount)}, of it publishing ${text(sumPub)}`);

  let result = await f.importStart({ path: csvPath, fileName: basename(csvPath), labelId: zero.id, cutoff, syncedAt, dryRun: true, basis });
  if (createOwners) {
    let createdOwners = 0;
    let createdArtists = 0;
    const done = new Set<string>();
    for (const r of result.rows) {
      const key = normalizeName(r.pseudonym);
      if (done.has(key)) continue;
      if (r.issues.some((i) => i.code === 'artist_without_owner') && r.artistId) {
        const owner = await owners.createOwner({ name: r.pseudonym, kind: 'person', origin: 'start' });
        await owners.assignArtistOwner(r.artistId, owner.id);
        createdOwners++;
        done.add(key);
      } else if (r.issues.some((i) => i.code === 'pseudonym_not_found')) {
        const owner = await owners.createOwner({ name: r.pseudonym, kind: 'person', origin: 'start' });
        await owners.createArtist({ pseudonym: r.pseudonym, ownerId: owner.id, origin: 'start' });
        createdOwners++;
        createdArtists++;
        done.add(key);
      }
    }
    console.log(`created owners ${createdOwners} (of them with a new pseudonym ${createdArtists})`);
    result = await f.importStart({ path: csvPath, fileName: basename(csvPath), labelId: zero.id, cutoff, syncedAt, dryRun: true, basis });
  }
  let applied = csvPath;
  if (skipErrors && result.totals.errors > 0) {
    const bad = new Set(result.rows.filter((r) => r.action === 'error').map((r) => r.line));
    const kept = rows.filter((_, i) => !bad.has(i + 2)); // line 1 is the header
    applied = join(out, `start_${cutoff}_clean.csv`);
    writeFileSync(applied, '\ufeff' + [names.join(';'), ...kept.map((r) => names.map((n) => quote(r[n])).join(';'))].join('\r\n') + '\r\n');
    console.log(`skipped ${bad.size} error rows; the clean file ${applied} has ${kept.length} rows`);
    result = await f.importStart({ path: applied, fileName: basename(applied), labelId: zero.id, cutoff, syncedAt, dryRun: true, basis });
  }
  if (apply) result = await f.importStart({ path: applied, fileName: basename(applied), labelId: zero.id, cutoff, syncedAt, dryRun: false, basis });
  const t = result.totals;
  console.log(`${apply ? 'APPLIED' : 'preview'}: rows ${t.rows}, create ${t.create} (starts ${t.starts}, adjustments ${t.adjustments}, missing ${t.missing}), unchanged ${t.unchanged}, errors ${t.errors}, warnings ${t.warnings}; Σ master ${t.master}, Σ publishing ${t.publishing}`);
  const byCode = new Map<string, string[]>();
  for (const r of result.rows) for (const i of r.issues) byCode.set(i.code, [...(byCode.get(i.code) ?? []), r.pseudonym]);
  for (const [code, list] of [...byCode.entries()].sort((a, b) => b[1].length - a[1].length))
    console.log(`  ${code}: ${list.length}${list.length <= 40 ? ` — ${list.join(', ')}` : ''}`);
  const issues = result.rows.filter((r) => r.action === 'error' || r.issues.some((i) => i.severity === 'warning'));
  const reportPath = join(out, 'start_issues.csv');
  writeFileSync(
    reportPath,
    '﻿' + ['line;pseudonym;kind;master;publishing;action;issues', ...issues.map((r) => [r.line, quote(r.pseudonym), r.kind, r.master ?? '', r.publishing ?? '', r.action, quote(r.issues.map((i) => i.code).join(' '))].join(';'))].join('\r\n') + '\r\n',
  );
  console.log(`issue report: ${reportPath} (${issues.length} rows)`);
  if (apply && result.result) console.log(`created ${result.result.ids.length} rows`);
} finally {
  await stack.close();
}
