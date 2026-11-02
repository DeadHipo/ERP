/**
 * Stage 5: net label share per ISRC and report month, ERP vs Annex "Monthly NLS by ISRC" (docs/agents/11_plan.md).
 * Read-only: one calculate() and nothing else. Stage names, ISRC and amounts only in the report.
 *
 * Usage: npx tsx packages/backend/scripts/mvp/compare-annex.ts [--out data/mvp-load/verify/annex.md] [--refresh]
 *   --refresh  re-read the Annex workbook into data/mvp-load/verify/annex_cache.json (python3 annex_nls.py)
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  addTo, arg, bootstrap, calculateAll, D, flag, MAIN_ACCOUNT, Md, money, monthKey, MVP, readJson, ROOT,
  VERIFY, ZERO, type Decimal,
} from './compare-common';

const TOL = D('0.01');
const out = resolve(ROOT, arg('out') ?? 'data/mvp-load/verify/annex.md');
const t0 = Date.now();

// ---------- Annex cache ----------
const cachePath = join(VERIFY, 'annex_cache.json');
if (flag('refresh') || !existsSync(cachePath)) {
  const ctx = join(ROOT, 'context_data');
  const wb = readdirSync(ctx).find((n) => n.startsWith('Annex 14_beta (') && n.endsWith('.xlsx'));
  if (!wb) throw new Error('Annex 14_beta (...).xlsx not found in context_data');
  const r = spawnSync(
    'python3',
    ['-I', join(import.meta.dirname, 'annex_nls.py'), join(ctx, wb), cachePath],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`annex_nls.py failed: ${r.stderr}`);
  console.log(r.stdout.trim());
}
interface AnnexCache {
  months: string[];
  nls: Record<string, Record<string, number | string>>;
  receipts: Record<string, Record<string, number | string>>;
}
const annex = readJson<AnnexCache>(cachePath);
const annexMonths = new Set(annex.months);
const num = (v: number | string | undefined): number | null => (typeof v === 'number' ? v : null);

// ---------- reference data ----------
const excl = readJson(join(MVP, 'annex', 'exclusions.json'));
const echo8 = new Set<string>([
  ...excl.echo8Repertoire.isrc.map((x: { isrc: string }) => x.isrc),
  ...(excl.echo8Repertoire.believeEchoFamilyIsrc?.isrc ?? []).map((x: { isrc: string }) => x.isrc),
]);
const part = readJson(join(MVP, 'annex', 'participations.json'));
const floorIsrc = new Set<string>(part.splitRewrites.map((r: { isrc: string }) => r.isrc));
const remixerIsrc = new Set(['FRX282644590', 'FRX282644591']);
const sd = readJson(join(MVP, 'annex', 'splits_diff.json'));
const m52 = new Map<string, Set<string>>(); // isrc -> months where a split of a different period starts
const splitDiffers = new Set<string>();
for (const r of sd.records) {
  if (r.classification === 'different_period') {
    const ms = new Set<string>();
    for (const d of [r.firstDifferentMonth, r.erpTargetSplit?.validFrom, r.annex?.period?.from, r.annex?.instrumentMonth])
      if (d) ms.add(String(d).slice(0, 7));
    for (const s of r.erp ?? []) if (s.validFrom && s.validFrom > '2001') ms.add(String(s.validFrom).slice(0, 7));
    m52.set(r.isrc, ms);
  } else if (['different_rows', 'missing_in_erp', 'erp_only'].includes(r.classification)) splitDiffers.add(r.isrc);
}
for (const r of sd.erpOnly ?? []) splitDiffers.add(r.isrc);

// ---------- ERP ----------
const b = await bootstrap();
const { calc } = await calculateAll(b);
interface Cell {
  net: Decimal;
  labelShare: Decimal;
  units: number;
  labels: Set<string>;
  statuses: Set<string>;
  categories: Set<string>;
  ahh: boolean;
  noSplit: boolean;
  unmapped: boolean;
  sublabelAssumption: boolean;
  alloc: Map<string, Decimal>; // pseudonym|layer -> percent sum (of units)
  ourLabel: Set<string>;
}
const erp = new Map<string, Cell>();
let excluded = ZERO;
let outOfRange = ZERO;
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\W_]+/g, ' ').trim();
for (const u of calc.units) {
  if (u.account !== MAIN_ACCOUNT) continue;
  if (echo8.has(u.isrc) || (u.ourLabelName ?? '').toLowerCase() === 'echo8') {
    excluded = excluded.add(u.net);
    continue;
  }
  const m = monthKey(u.reportingMonth);
  if (!annexMonths.has(m)) {
    outOfRange = outOfRange.add(u.net);
    continue;
  }
  const k = `${u.isrc}|${m}`;
  let c = erp.get(k);
  if (!c) {
    c = {
      net: ZERO, labelShare: ZERO, units: 0, labels: new Set(), statuses: new Set(), categories: new Set(),
      ahh: false, noSplit: false, unmapped: false, sublabelAssumption: false, alloc: new Map(), ourLabel: new Set(),
    };
    erp.set(k, c);
  }
  c.net = c.net.add(u.net);
  c.labelShare = c.labelShare.add(u.labelShare);
  c.units++;
  c.labels.add(u.labelName);
  c.statuses.add(u.status);
  c.categories.add(u.labelShareCategory);
  if (u.ourLabelName) c.ourLabel.add(u.ourLabelName);
  if (norm(u.labelName).includes('ahh music')) c.ahh = true;
  if (u.status === 'no_split') c.noSplit = true;
  if (u.labelShareCategory === 'label_unmapped') c.unmapped = true;
  for (const a of u.allocations) {
    if (a.layer === 'sublabel' && (a.assumption !== null || a.category === 'C')) c.sublabelAssumption = true;
    const who = calc.artistIndex.get(a.artistId)?.pseudonym ?? a.artistId.slice(0, 8);
    addTo(c.alloc, `${who} ${a.layer}/${a.kind}${a.category === 'C' ? ' C' : ''}`, a.amount);
  }
}

// ---------- compare ----------
const keys = new Set<string>(erp.keys());
for (const isrc of Object.keys(annex.nls)) for (const m of Object.keys(annex.nls[isrc] as object)) keys.add(`${isrc}|${m}`);
for (const isrc of Object.keys(annex.receipts)) for (const m of Object.keys(annex.receipts[isrc] as object)) keys.add(`${isrc}|${m}`);

const CAUSES = [
  'annex_no_share', 'ahh_music', 'remixer', 'floor_titles', 'sublabel_assumption', 'm52_month', 'no_split_erp',
  'label_unmapped', 'split_differs', 'not_in_annex', 'no_erp_units', 'other',
] as const;
type Cause = (typeof CAUSES)[number];
interface Diff { isrc: string; month: string; erpShare: Decimal; annexShare: number | null; diff: Decimal; net: Decimal; cause: Cause; cell?: Cell }
const byCause = new Map<Cause, { count: number; net: Decimal; signed: Decimal; abs: Decimal; erp: Decimal; annex: Decimal }>();
const diffs: Diff[] = [];
const recDiffs: { isrc: string; month: string; erp: Decimal; annex: number; diff: Decimal; kind: string }[] = [];
let sumErpShare = ZERO, sumAnnexNls = ZERO, sumNet = ZERO, sumNetMatch = ZERO, sumNetNoShare = ZERO, sumNetMatchExNoShare = ZERO;
let cells = 0, matchCells = 0, noShareCells = 0;
let recAbs = ZERO, recSigned = ZERO;
const recKinds = new Map<string, { n: number; abs: Decimal }>();
const annexIsrc = new Set([...Object.keys(annex.nls), ...Object.keys(annex.receipts)]);

for (const k of keys) {
  const [isrc, month] = k.split('|') as [string, string];
  const c = erp.get(k);
  const aNlsRaw = annex.nls[isrc]?.[month];
  const aRec = num(annex.receipts[isrc]?.[month]) ?? 0;
  const aNls = num(aNlsRaw);
  const erpNet = c?.net ?? ZERO;
  const erpShare = c?.labelShare ?? ZERO;

  // receipts first
  const rd = erpNet.sub(aRec);
  if (rd.abs().gt(TOL)) {
    const kind = !annexIsrc.has(isrc) ? 'isrc_not_in_annex' : !c ? 'no_erp_units' : 'amount';
    recDiffs.push({ isrc, month, erp: erpNet, annex: aRec, diff: rd, kind });
    recAbs = recAbs.add(rd.abs());
    recSigned = recSigned.add(rd);
    const e = recKinds.get(kind) ?? { n: 0, abs: ZERO };
    e.n++;
    e.abs = e.abs.add(rd.abs());
    recKinds.set(kind, e);
  }

  // label share
  const isNoShare = aNlsRaw === 'no share';
  sumErpShare = sumErpShare.add(erpShare);
  sumAnnexNls = sumAnnexNls.add(aNls ?? 0);
  sumNet = sumNet.add(erpNet);
  cells++;
  if (isNoShare) {
    noShareCells++;
    sumNetNoShare = sumNetNoShare.add(erpNet);
  }
  const diff = erpShare.sub(aNls ?? 0);
  if (diff.abs().lte(TOL)) {
    matchCells++;
    sumNetMatch = sumNetMatch.add(erpNet);
    if (!isNoShare) sumNetMatchExNoShare = sumNetMatchExNoShare.add(erpNet);
    continue;
  }
  let cause: Cause;
  if (isNoShare) cause = 'annex_no_share';
  else if (c?.ahh) cause = 'ahh_music';
  else if (remixerIsrc.has(isrc)) cause = 'remixer';
  else if (floorIsrc.has(isrc)) cause = 'floor_titles';
  else if (c?.sublabelAssumption) cause = 'sublabel_assumption';
  else if (m52.get(isrc)?.has(month)) cause = 'm52_month';
  else if (c?.noSplit) cause = 'no_split_erp';
  else if (c?.unmapped) cause = 'label_unmapped';
  else if (splitDiffers.has(isrc) || m52.has(isrc)) cause = 'split_differs';
  else if (!annexIsrc.has(isrc)) cause = 'not_in_annex';
  else if (!c) cause = 'no_erp_units';
  else cause = 'other';
  diffs.push({ isrc, month, erpShare, annexShare: aNls, diff, net: erpNet, cause, cell: c });
  const e = byCause.get(cause) ?? { count: 0, net: ZERO, signed: ZERO, abs: ZERO, erp: ZERO, annex: ZERO };
  e.count++;
  e.net = e.net.add(erpNet);
  e.signed = e.signed.add(diff);
  e.abs = e.abs.add(diff.abs());
  e.erp = e.erp.add(erpShare);
  e.annex = e.annex.add(aNls ?? 0);
  byCause.set(cause, e);
}

// ---------- report ----------
const pct = (a: Decimal, b2: Decimal) => (b2.isZero() ? 'n/a' : `${a.div(b2).mul(100).toFixed(2)} %`);
const md = new Md();
md.h(1, 'Net label share vs Annex 14 (stage 5)');
md.p(
  `Generated by compare-annex.ts. Perimeter: Believe account ${MAIN_ACCOUNT}, Echo8 repertoire (${echo8.size} ISRC) and units of label of record Echo8 excluded; ` +
    `months ${annex.months[0]}..${annex.months[annex.months.length - 1]}; tolerance ${TOL.toFixed(2)} per cell. ERP label share = Σ unit \`labelShare\` (before categorisation).`,
);
md.table(
  ['Item', 'Value'],
  [
    ['ISRC-month cells compared', cells],
    ['ERP units (perimeter)', [...erp.values()].reduce((s, c) => s + c.units, 0)],
    ['ERP net excluded (Echo8)', money(excluded)],
    ['ERP net outside the Annex months', money(outOfRange)],
    ['Σ ERP net (cells)', money(sumNet)],
    ['Σ ERP label share', money(sumErpShare)],
    ['Σ Annex NLS', money(sumAnnexNls)],
    ['Σ ERP label share − Σ Annex NLS', money(sumErpShare.sub(sumAnnexNls))],
    ['Cells with the label share within tolerance', `${matchCells} of ${cells}`],
    ['Share of receipts whose label share matches', pct(sumNetMatch, sumNet)],
    ['  excluding Annex "no share" cells (Annex does the same)', pct(sumNetMatchExNoShare, sumNet.sub(sumNetNoShare))],
    ['Annex "no share" cells (ERP net)', `${noShareCells} (${money(sumNetNoShare)})`],
    ['Receipts differences (cells, Σ|diff|)', `${recDiffs.length}, ${money(recAbs)}`],
  ],
);

md.h(2, '1. Receipts (perimeter and units)');
md.p('A receipts difference means a perimeter or unit difference; it is reported before the label share.');
md.table(
  ['Kind', 'Cells', 'Σ|diff|'],
  [...recKinds.entries()].map(([kd, e]) => [kd, e.n, money(e.abs)]),
);
md.p(`Σ(ERP − Annex) = ${money(recSigned)}. Top 20 by |diff|:`);
md.table(
  ['ISRC', 'Month', 'ERP net', 'Annex receipts', 'Diff', 'Kind'],
  recDiffs
    .sort((x, y) => y.diff.abs().cmp(x.diff.abs()))
    .slice(0, 20)
    .map((r) => [r.isrc, r.month, money(r.erp), money(r.annex), money(r.diff), r.kind]),
);

md.h(2, '2. Label share differences by cause');
md.p('Each ISRC-month goes to the first cause that applies, in this order. `not_in_annex` and `no_erp_units` are added before `other` (ISRC absent from the Annex / no ERP unit).');
md.table(
  ['Cause', 'Cells', 'Σ ERP net', 'Σ ERP label share', 'Σ Annex NLS', 'Σ diff (ERP − Annex)', 'Σ|diff|'],
  CAUSES.map((cz) => {
    const e = byCause.get(cz);
    return [cz, e?.count ?? 0, money(e?.net ?? 0), money(e?.erp ?? 0), money(e?.annex ?? 0), money(e?.signed ?? 0), money(e?.abs ?? 0)];
  }),
);
const totAbs = [...byCause.values()].reduce((s, e) => s.add(e.abs), ZERO);
const totSigned = [...byCause.values()].reduce((s, e) => s.add(e.signed), ZERO);
md.p(`Total: ${diffs.length} cells, Σ diff ${money(totSigned)}, Σ|diff| ${money(totAbs)}.`);

md.h(2, '3. Top 30 `other` by |diff|');
const alloc = (c?: Cell) =>
  c
    ? [...c.alloc.entries()]
        .sort((x, y) => y[1].abs().cmp(x[1].abs()))
        .slice(0, 5)
        .map(([w, v]) => `${w} ${money(v)}`)
        .join('; ')
    : '';
md.table(
  ['ISRC', 'Month', 'ERP net', 'ERP label share', 'Annex NLS', 'Diff', 'ERP label strings / status / category', 'ERP allocations (top 5)'],
  diffs
    .filter((d) => d.cause === 'other')
    .sort((x, y) => y.diff.abs().cmp(x.diff.abs()))
    .slice(0, 30)
    .map((d) => [
      d.isrc, d.month, money(d.net), money(d.erpShare), d.annexShare === null ? '-' : money(d.annexShare), money(d.diff),
      d.cell ? `${[...d.cell.labels].join(', ')} / ${[...d.cell.statuses].join(',')} / ${[...d.cell.categories].join(',')}` : '',
      alloc(d.cell),
    ]),
);
md.write(out);
console.log(
  `cells ${cells}; matched ${matchCells}; receipts diffs ${recDiffs.length} (Σ|diff| ${money(recAbs)}); ΣERP share ${money(sumErpShare)}; ΣAnnex NLS ${money(sumAnnexNls)}; ` +
    `matched receipts ${pct(sumNetMatch, sumNet)}`,
);
for (const cz of CAUSES) {
  const e = byCause.get(cz);
  if (e) console.log(`  ${cz}: ${e.count} cells, Σdiff ${money(e.signed)}, Σ|diff| ${money(e.abs)}`);
}
console.log(`report: ${out} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
await b.close();
