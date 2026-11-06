/**
 * D-181 (A18): the buyouts by the owner's registry of 2026-11-03 («Выкупленные записи — сплиты после выкупа.xlsx», folder
 * 11 of the update of the pack of 2026-11-06; 1 032 ISRC, fuller than the PandaDoc csv of stage 2) and the first month
 * of the label per contract (`transition_buyouts.csv`, «первый месяц лейбла» = the first reporting month not paid to
 * the seller on the day of signing: the owner's rule R5 of 2026-11-06, the buyout acts from the signing day). For every
 * seller of an ISRC («Что выкуплено и у кого»: `nick NN% (contract)`) the split in force at that month is read: the
 * seller's row at 0 already → `already_zero`; a row ≥ the bought percent → the whole row to the label (`facade.buyout`);
 * a row above it → the bought part only (`changeSplit`, the remainder to the label; the owner: «обнулять нужно эту часть
 * доли»); no row / no split → reported. The document is the stage-2 one of the contract (by title) or a new approved
 * `buyout` document of the seller from the registry. Dry run by default; `--apply` writes. Report:
 * `<out>/buyout_workbook_report.csv`.
 *
 *   npx tsx packages/backend/scripts/stage3/apply-buyout-workbook.ts <xlsx> <transition_buyouts.csv> [--out data/mvp-load/stage3] [--apply] [--org <id>] [dataDir]
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { parseCsv } from '../../src/shared/csv';
import { normalizeName } from '../../src/shared/identifiers';
import { Decimal } from '../../src/shared/money';
import { AppError } from '../../src/shared/errors';
import { cellText, readRows } from '../../src/shared/xlsx-rows';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 ? (args[outIdx + 1] as string) : 'data/mvp-load/stage3');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const [xlsx, transitionCsv, dataDirArg] = positional;
if (!xlsx || !transitionCsv) {
  console.error('usage: apply-buyout-workbook.ts <xlsx> <transition_buyouts.csv> [--out <dir>] [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const PACK = 'pack://для_разработчика_2026-11-06_update/11 дополнения к разбору 06.11/выкупы и каталог/Выкупленные записи — сплиты после выкупа.xlsx';
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

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

// the first month of the label per seller (and contract)
const transition = await readCsv(transitionCsv);
const firstMonth = new Map<string, { month: string; contract: string; signed: string }>();
for (const r of transition) {
  const month = r['первый месяц лейбла'] ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) continue;
  firstMonth.set(normalizeName(r['продавец'] ?? ''), { month, contract: r['договор'] ?? '', signed: r['дата выкупа'] ?? '' });
}

// the registry: ISRC × seller × bought percent
interface Sale { isrc: string; nick: string; pct: Decimal; contract: string; sheet: number }
const sales: Sale[] = [];
let header: Map<string, number> | undefined;
let sheetSeen = 0;
for await (const row of readRows(xlsx)) {
  if (row.sheet !== sheetSeen) {
    sheetSeen = row.sheet;
    header = undefined;
  }
  if (row.sheet > 2) break;
  const cells = Array.from(row.values, (v) => cellText(v));
  if (!header) {
    if (cells.some((c) => c === 'ISRC')) header = new Map(cells.map((c, i) => [c, i]));
    continue;
  }
  const isrc = (cells[header.get('ISRC') ?? -1] ?? '').trim().toUpperCase();
  if (!ISRC.test(isrc)) continue;
  const bought = cells[header.get('Что выкуплено и у кого') ?? -1] ?? '';
  for (const m of bought.matchAll(/([^;()]+?)\s+(\d+(?:[.,]\d+)?)%\s*\(([^)]*)\)/g))
    sales.push({ isrc, nick: (m[1] as string).trim(), pct: new Decimal((m[2] as string).replace(',', '.')), contract: (m[3] as string).trim(), sheet: row.sheet });
}
console.log(`registry: ${sales.length} seller × ISRC pairs on ${new Set(sales.map((s) => s.isrc)).size} ISRCs; first months known for ${firstMonth.size} sellers`);

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const { labels, owners, splits } = f.modules;
  const zero = (await labels.index()).ownLabels().find((l) => l.name === '0to8');
  if (!zero) throw new Error('no own label named 0to8');
  const zeroId = zero.id;
  const index = await owners.artistIndex();
  const byNorm = new Map<string, { id: string; pseudonym: string }[]>();
  for (const [id, a] of index) if (id === a.id) byNorm.set(normalizeName(a.pseudonym), [...(byNorm.get(normalizeName(a.pseudonym)) ?? []), a]);
  const canon = (id: string) => index.get(id)?.id ?? id;
  const docs = await owners.listDocuments();
  async function documentOf(nick: string, contract: string): Promise<string> {
    const found = docs.find((d) => d.kind === 'buyout' && (d.title.startsWith(`Выкуп ${contract}`) || d.title.includes(`(${nick})`)));
    if (found) return found.id;
    const d = await owners.createDocument({ kind: 'buyout', title: `Выкуп по реестру 03.11 (${nick}, ${contract || 'без номера'})`, fileRef: PACK, ownerId: null, requiresApproval: true, labelId: zeroId });
    await owners.approveDocument(d.id, 'D-181 loader: the owner\'s buyout registry of 2026-11-03');
    docs.push(d);
    return d.id;
  }

  mkdirSync(out, { recursive: true });
  const report: string[][] = [];
  const counts = new Map<string, number>();
  const count = (s: string) => counts.set(s, (counts.get(s) ?? 0) + 1);
  const whole = new Map<string, { sellerId: string; from: string; docId: string; isrcs: string[] }>();
  const partial: { isrc: string; from: string; docId: string; shares: { artistId: string; percent: string; documentId: string | null }[]; note: string }[] = [];
  const list = await splits.listSplits({ isrcs: [...new Set(sales.map((s) => s.isrc))] });
  for (const s of sales) {
    const sellers = byNorm.get(normalizeName(s.nick)) ?? [];
    const fm = firstMonth.get(normalizeName(s.nick));
    let status: string;
    if (sellers.length !== 1) status = sellers.length === 0 ? 'pseudonym_not_found' : 'pseudonym_ambiguous';
    else if (!fm) status = 'no_first_month';
    else {
      const seller = sellers[0] as { id: string; pseudonym: string };
      const from = `${fm.month}-01`;
      const sellerIds = new Set([...index].filter(([, v]) => v.id === seller.id).map(([k]) => k));
      const current = list.find((x) => x.isrc === s.isrc && x.validFrom <= from && (x.validTo === null || x.validTo > from));
      const row = current?.shares.find((sh) => sellerIds.has(sh.artistId) || sellerIds.has(canon(sh.artistId)));
      if (!current) status = 'no_split_at_date';
      else if (!row) status = 'seller_not_in_split';
      else if (new Decimal(row.percent).isZero()) status = 'already_zero';
      else if (s.pct.gte(new Decimal(row.percent))) {
        status = `buyout(row ${row.percent})`;
        const docId = await documentOf(s.nick, s.contract || fm.contract);
        const key = `${seller.id}|${from}|${docId}`;
        const g = whole.get(key) ?? { sellerId: seller.id, from, docId, isrcs: [] };
        g.isrcs.push(s.isrc);
        whole.set(key, g);
      } else {
        status = `partial(row ${row.percent} − ${s.pct.toFixed()})`;
        const docId = await documentOf(s.nick, s.contract || fm.contract);
        const left = new Decimal(row.percent).sub(s.pct);
        partial.push({
          isrc: s.isrc,
          from,
          docId,
          shares: current.shares.map((sh) => ({ artistId: sh.artistId, percent: sellerIds.has(sh.artistId) || sellerIds.has(canon(sh.artistId)) ? left.toFixed() : sh.percent, documentId: sh.documentId })),
          note: `Частичный выкуп ${s.pct.toFixed()} % трека у ${s.nick} (${s.contract}), с ${fm.month}: реестр 03.11`,
        });
      }
    }
    count(status.split('(')[0] as string);
    report.push([s.isrc, String(s.sheet), s.nick, s.contract, s.pct.toFixed(), fm?.month ?? '', status]);
  }
  writeFileSync(join(out, 'buyout_workbook_report.csv'), '\ufeff' + ['isrc;sheet;nick;contract;pct;first_month;status', ...report.map((r) => r.map(quote).join(';'))].join('\r\n') + '\r\n');
  console.log([...counts].map(([k, v]) => `${k} ${v}`).join(', '));
  for (const g of whole.values()) console.log(`${apply ? '+' : '·'} buyout ${index.get(g.sellerId)?.pseudonym ?? g.sellerId} from ${g.from}: ${g.isrcs.length} ISRCs`);
  for (const p of partial) console.log(`${apply ? '+' : '·'} partial ${p.isrc} from ${p.from}: ${p.note}`);
  if (apply) {
    for (const g of whole.values()) {
      try {
        const changed = await f.buyout({ isrcs: g.isrcs, sellerArtistId: g.sellerId, effectiveFrom: g.from, documentId: g.docId });
        console.log(`  applied ${index.get(g.sellerId)?.pseudonym ?? g.sellerId} from ${g.from}: ${changed.length} splits changed`);
      } catch (e) {
        console.log(`  FAILED ${g.sellerId} from ${g.from}: ${e instanceof AppError ? `${e.code} ${e.message}` : String(e)}`);
      }
    }
    for (const p of partial) {
      try {
        await f.changeSplit({ isrc: p.isrc, from: p.from, shares: p.shares, documentId: p.docId, note: p.note });
        console.log(`  applied partial ${p.isrc}`);
      } catch (e) {
        console.log(`  FAILED partial ${p.isrc}: ${e instanceof AppError ? `${e.code} ${e.message}` : String(e)}`);
      }
    }
  }
  console.log(`report: ${join(out, 'buyout_workbook_report.csv')} (${report.length} rows)`);
} finally {
  await stack.close();
}
