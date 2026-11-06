/**
 * D-175: the buyouts of the owner's registry (the pack of 2026-11-06, folder 7). Per contract (a nick, a contract id)
 * one approved document of kind `buyout` under the own label `0to8` (idempotent by title; the file reference points to
 * the pack: the PandaDoc / CAA / CAPA documents stay there), then `facade.buyout` on the ISRCs of the contract from the
 * signing date (R5, the owner's answer of 2026-11-06: the whole seller share from the signing month, M52) or from the
 * month of `buyout_overrides.json`. The registry's `seller_pct` is checked against the seller's row (a difference is
 * reported, never applied). `buyouts_extra.json` names works by title: the tracks of the seller whose base title equals
 * one of them (the version suffix stripped) are bought out, the rest reported. The prices of the Main workbook become
 * `buyout` operations through the operation import (`external_id` = `main:<row>`; «DJ Zynx» stays out as the owner
 * said). Dry run by default; `--apply` writes. Reports: `<out>/buyouts_report.csv` (every ISRC of every contract with
 * what happened) and the operation import answer.
 *
 *   npx tsx packages/backend/scripts/stage2/load-buyouts.ts <folder 7> [--out data/mvp-load/stage2] [--apply] [--org <id>] [dataDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { OPERATION_IMPORT_COLUMNS } from '@erp/shared/operation-import';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { parseCsv } from '../../src/shared/csv';
import { normalizeName } from '../../src/shared/identifiers';
import { Decimal } from '../../src/shared/money';
import { AppError } from '../../src/shared/errors';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 ? (args[outIdx + 1] as string) : 'data/mvp-load/stage2');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const [folder, dataDirArg] = positional;
if (!folder) {
  console.error('usage: load-buyouts.ts <folder 7> [--out <dir>] [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const PACK = 'pack://для_разработчика_2026-11-06/7 выкупы';

async function readCsv(path: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  let header: string[] | undefined;
  for await (const rec of parseCsv(createReadStream(path), ';')) {
    if (!header) {
      header = rec.map((h) => h.replace(/^\uFEFF/, '').trim());
      continue;
    }
    if (rec.every((v) => v.trim() === '')) continue;
    rows.push(Object.fromEntries(header.map((h, i) => [h, (rec[i] ?? '').trim()])));
  }
  return rows;
}

const MONTHS: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
/** «24 August, 2026», «December 16, 2025» or an ISO date → YYYY-MM-DD. */
function parseDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${MONTHS[(m[2] as string).toLowerCase()] ?? '??'}-${(m[1] as string).padStart(2, '0')}`;
  m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${MONTHS[(m[1] as string).toLowerCase()] ?? '??'}-${(m[2] as string).padStart(2, '0')}`;
  throw new Error(`cannot parse the date «${raw}»`);
}
const money = (raw: string) => new Decimal(raw.replace(/[$,\s]/g, '') || '0');
/** The base title of a work: lower case, the version suffix in brackets or after « - » dropped, punctuation collapsed. */
const baseTitle = (t: string) =>
  normalizeName(t.replace(/\s*[([][^)\]]*[)\]]\s*$/g, '').replace(/\s+-\s+(slowed|sped up|super slowed|ultra slowed|speed up|nightcore|remix)[^-]*$/i, ''));
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

interface Contract {
  key: string;
  nick: string;
  contract: string;
  effective: string;
  price: string;
  isrcs: Map<string, string>; // isrc → seller_pct
  titles: string[];
  source: string;
}

const registry = await readCsv(join(folder, 'buyouts_pandadoc_2026-10-16.csv'));
const extra = JSON.parse(readFileSync(join(folder, 'buyouts_extra.json'), 'utf8')) as { items: { nick: string; contract: string; effective: string; titles: string[]; source?: string }[] };
const overrides = JSON.parse(readFileSync(join(folder, 'buyout_overrides.json'), 'utf8')) as { items: { contract: string; from_month: string; why: string }[] };
const prices = await readCsv(join(folder, 'цены_выкупа_в_Main_как_расход_артиста.csv'));

const contracts = new Map<string, Contract>();
for (const r of registry) {
  const nick = r.nick ?? '';
  const contract = r.contract ?? '';
  const key = `${nick}|${contract || 'no-contract'}`;
  let c = contracts.get(key);
  if (!c) contracts.set(key, (c = { key, nick, contract: contract || `без номера (${nick})`, effective: parseDate(r.effective ?? ''), price: r.price ?? '', isrcs: new Map(), titles: [], source: r.src ?? '' }));
  c.isrcs.set((r.isrc ?? '').trim().toUpperCase(), r.seller_pct ?? '');
}
for (const e of extra.items) {
  const key = `${e.nick}|${e.contract}`;
  contracts.set(key, { key, nick: e.nick, contract: e.contract, effective: parseDate(e.effective), price: '', isrcs: new Map(), titles: e.titles, source: e.source ?? 'buyouts_extra.json' });
}

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const { labels, owners, splits } = f.modules;
  const zeroLabel = (await labels.index()).ownLabels().find((l) => l.name === '0to8');
  if (!zeroLabel) throw new Error('no own label named 0to8');
  const zero = zeroLabel;
  const index = await owners.artistIndex();
  const byNorm = new Map<string, { id: string; pseudonym: string; ownerId: string | null }[]>();
  for (const [id, a] of index) if (id === a.id) byNorm.set(normalizeName(a.pseudonym), [...(byNorm.get(normalizeName(a.pseudonym)) ?? []), a]);
  const canon = (id: string) => index.get(id)?.id ?? id;
  const existingDocs = await owners.listDocuments();
  const report: string[][] = [];
  mkdirSync(out, { recursive: true });

  // the document of a contract (idempotent by title; created in the preview too: the registry is its basis, and the
  // operation preview needs it)
  async function documentOf(title: string, fileRef: string): Promise<string> {
    const found = existingDocs.find((d) => d.title === title);
    if (found) {
      if (!found.fileRef) await owners.attachFile(found.id, fileRef);
      if (!found.approvedAt) await owners.approveDocument(found.id, 'D-175 loader: the owner\'s buyout registry of 2026-10-16');
      return found.id;
    }
    const d = await owners.createDocument({ kind: 'buyout', title, fileRef, ownerId: null, requiresApproval: true, labelId: zero.id });
    await owners.approveDocument(d.id, 'D-175 loader: the owner\'s buyout registry of 2026-10-16');
    existingDocs.push(d);
    return d.id;
  }

  const docOfNick = new Map<string, string>();
  const tracks = await owners.listTracks();
  for (const c of [...contracts.values()].sort((a, b) => a.nick.localeCompare(b.nick))) {
    const sellers = byNorm.get(normalizeName(c.nick)) ?? [];
    if (sellers.length !== 1) {
      console.log(`${c.nick} (${c.contract}): ${sellers.length === 0 ? 'pseudonym not found' : 'pseudonym ambiguous'} — skipped`);
      for (const isrc of c.isrcs.keys()) report.push([c.nick, c.contract, isrc, '', sellers.length === 0 ? 'pseudonym_not_found' : 'pseudonym_ambiguous', '']);
      continue;
    }
    const seller = sellers[0] as { id: string; pseudonym: string; ownerId: string | null };
    const override = overrides.items.find((o) => c.contract.startsWith(o.contract));
    const from = override ? `${override.from_month}-01` : c.effective;
    const title = `Выкуп ${c.contract} (${c.nick}), с ${c.effective}`;
    const docId = await documentOf(title, `${PACK}/${c.source || 'buyouts_pandadoc_2026-10-16.csv'}`);
    docOfNick.set(normalizeName(c.nick), docId);
    // the ISRCs: the registry's, plus the tracks whose base title is one of the contract's titles
    const wanted = new Map(c.isrcs);
    if (c.titles.length > 0) {
      const bases = new Set(c.titles.map(baseTitle));
      for (const t of tracks) if (t.isrc && bases.has(baseTitle(t.title))) wanted.set(t.isrc, 'title');
      if (wanted.size === 0) console.log(`${c.nick} (${c.contract}): none of the titles ${c.titles.join(' / ')} matched a track`);
    }
    const sellerIds = new Set([...index].filter(([, v]) => v.id === seller.id).map(([k]) => k));
    const list = wanted.size ? await splits.listSplits({ isrcs: [...wanted.keys()] }) : [];
    const applicable: string[] = [];
    for (const [isrc, pct] of wanted) {
      const covering = list.filter((s) => s.isrc === isrc && s.validFrom <= from && (s.validTo === null || s.validTo > from));
      const current = covering[0];
      const row = current?.shares.find((sh) => sellerIds.has(sh.artistId) || sellerIds.has(canon(sh.artistId)));
      let status: string;
      if (!current) status = 'no_split_at_date';
      else if (!row) status = 'seller_not_in_split';
      else if (new Decimal(row.percent).isZero()) status = 'already_zero';
      else if (/^[\d.]+$/.test(pct) && !new Decimal(row.percent).eq(new Decimal(pct)))
        status = `pct_differs(row ${row.percent}, registry ${pct})`; // the owner decides: not applied
      else {
        status = 'buyout';
        applicable.push(isrc);
      }
      report.push([c.nick, c.contract, isrc, from, status, pct]);
    }
    const counts = new Map<string, number>();
    for (const r of report.filter((x) => x[0] === c.nick && x[1] === c.contract)) counts.set((r[4] as string).split('(')[0] as string, (counts.get((r[4] as string).split('(')[0] as string) ?? 0) + 1);
    console.log(`${c.nick} (${c.contract}) from ${from}: ${[...counts].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (apply && applicable.length > 0) {
      try {
        const changed = await f.buyout({ isrcs: applicable, sellerArtistId: seller.id, effectiveFrom: from, documentId: docId });
        console.log(`  applied: ${changed.length} splits changed`);
      } catch (e) {
        console.log(`  FAILED: ${e instanceof AppError ? `${e.code} ${e.message}` : String(e)}`);
      }
    }
  }
  writeFileSync(join(out, 'buyouts_report.csv'), '﻿' + ['nick;contract;isrc;from;status;seller_pct', ...report.map((r) => r.map(quote).join(';'))].join('\r\n') + '\r\n');
  console.log(`report: ${join(out, 'buyouts_report.csv')} (${report.length} rows)`);

  // the prices of Main → buyout operations
  const names = OPERATION_IMPORT_COLUMNS.map((c) => c.name);
  const opRows: Record<string, string>[] = [];
  for (const p of prices) {
    const nick = p['ник'] as string;
    const action = p['что делать'] as string;
    if (/не трогать/.test(action)) {
      console.log(`price of ${nick} (Main #${p['строка Main (income_expense)']}): skipped (${action})`);
      continue;
    }
    let doc = docOfNick.get(normalizeName(nick));
    if (!doc) {
      // a price without a contract in the registry: a document of its own from the Main row
      doc = await documentOf(`Выкуп по строке Main #${p['строка Main (income_expense)']} (${nick}): ${p['комментарий в Main']}`, `${PACK}/цены_выкупа_в_Main_как_расход_артиста.csv#${p['строка Main (income_expense)']}`);
      console.log(`price of ${nick}: no contract in the registry, a document from the Main row`);
    }
    opRows.push({
      owner: '',
      pseudonym: nick,
      date: p['дата'] as string,
      amount: money(p['сумма $'] as string).toFixed(2),
      kind: 'buyout',
      channel: 'Main',
      confirmation: '',
      document: doc,
      external_id: `main:${p['строка Main (income_expense)']}`,
      scope: '',
      comment: `${p['комментарий в Main']} (${action})`,
    });
  }
  const opsPath = join(out, 'buyout_operations.csv');
  writeFileSync(opsPath, '﻿' + [names.join(';'), ...opRows.map((r) => names.map((n) => quote(r[n] ?? '')).join(';'))].join('\r\n') + '\r\n');
  const preview = await f.importOperations({ path: opsPath, fileName: 'buyout_operations.csv', labelId: zero.id, dryRun: true });
  console.log(`operations preview: rows ${preview.totals.rows}, create ${preview.totals.create}, unchanged ${preview.totals.unchanged}, errors ${preview.totals.errors}`);
  const bad = new Set(preview.rows.filter((x) => x.action === 'error').map((x) => x.line));
  for (const r of preview.rows.filter((x) => x.action === 'error')) console.log(`  line ${r.line} ${r.pseudonym}: ${r.issues.map((i) => i.code).join(' ')} — left out`);
  if (apply) {
    const kept = opRows.filter((_, i) => !bad.has(i + 2));
    const cleanPath = join(out, 'buyout_operations_clean.csv');
    writeFileSync(cleanPath, '\ufeff' + [names.join(';'), ...kept.map((r) => names.map((n) => quote(r[n] ?? '')).join(';'))].join('\r\n') + '\r\n');
    const res = await f.importOperations({ path: cleanPath, fileName: 'buyout_operations_clean.csv', labelId: zero.id, dryRun: false });
    console.log(`operations: ${res.totals.create} created, ${res.totals.unchanged} unchanged`);
  }
} finally {
  await stack.close();
}
