/**
 * Stage 5 / 7: decomposition of each owner's difference "ERP payable − Main balance" into named components
 * (docs/agents/14_verification.md §9.3, §10; recipe 9). Read-only: one calculate(), the owner balances and SELECTs.
 *
 * Input: `data/mvp-load/verify/main_owners.csv` (written by compare-main.ts: the owners and their diff), the Main rows
 * `data/mvp-load/main/{nicknames,cash_rows}.json` and the database. Run compare-main.ts first; an owner whose diff
 * here differs from the CSV by more than 0.01 is reported (the CSV is stale).
 *
 * Components per owner (each in ERP − Main terms; their sum equals the diff to rounding):
 *   - C master <reason>: money waiting in C (Main paid it);
 *   - C publishing; B17 holder separate (ERP publishing B + C − Main publishing income);
 *   - Echo8 account 1055956 B (Main keeps it on the Echo8 sheet);
 *   - Main expense rows not loaded as an operation (ads, document-only buy-out prices, carve rows replaced by a
 *     participation, review rows);
 *   - open positions (advances and deductions not recouped yet);
 *   - carve participation taken from the rows (origin `mvp:carve`, account 1052428: pro rata of the split rows);
 *   - master earned (B + C) vs Main royalties, and ops vs Main expense mismatch: the two **not explained** parts.
 * An owner with |diff| > 1.00 is explained when |not explained| ≤ the tolerance: 1.00, or max(1.00, 2 % of
 * max(|Main income|, |diff|)).
 *
 * Usage: npx tsx packages/backend/scripts/mvp/decompose-main.ts [--csv data/mvp-load/verify/main_owners.csv] [--top N]
 * Prints owner id prefixes, the stage name of the main nickname and amounts only.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ownerBalance } from '../../src/facade/balance';
import type { Calculation, PublishingResult, UnitResult } from '../../src/facade/calculation';
import { addTo, arg, bootstrap, calculateAll, D, MAIN_ACCOUNT, money, MVP, readJson, ROOT, sum, ZERO, type Decimal } from './compare-common';

const ECHO8_ACCOUNT = '1055956';
const csvPath = resolve(ROOT, arg('csv') ?? 'data/mvp-load/verify/main_owners.csv');
const top = Number(arg('top') ?? '0');
const t0 = Date.now();

interface Nick {
  nickname: string;
  status: string;
  artistId?: string;
  ownerId?: string;
}
interface Row {
  rowNo: number;
  nickname: string;
  category: string;
  amount: string;
  side: 'income' | 'expense';
  load: string;
  noRecap?: boolean;
}

// ---------- the CSV of compare-main ----------
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (q) {
      if (ch === '\\' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const csvLines = readFileSync(csvPath, 'utf8').trim().split('\n');
const head = parseCsvLine(csvLines[0] as string);
const col = (name: string) => head.indexOf(name);
const csvDiff = new Map<string, Decimal>();
for (const l of csvLines.slice(1)) {
  const c = parseCsvLine(l);
  csvDiff.set(c[col('owner')] as string, D(c[col('diff')]));
}

// ---------- Main rows ----------
const nicks = readJson<Record<string, Nick>>(join(MVP, 'main', 'nicknames.json'));
const rows = readJson<Row[]>(join(MVP, 'main', 'cash_rows.json'));

const b = await bootstrap();
const { calc, ops } = await calculateAll(b);
const ownerOfArtist = (id?: string) => (id ? (calc.artistIndex.get(id)?.ownerId ?? null) : null);
const nicksOfOwner = new Map<string, string[]>();
for (const n of Object.values(nicks)) {
  if (n.status !== 'matched') continue;
  const o = ownerOfArtist(n.artistId) ?? n.ownerId ?? null;
  if (o) nicksOfOwner.set(o, [...(nicksOfOwner.get(o) ?? []), n.nickname]);
}
const rowsOfNick = new Map<string, Row[]>();
for (const r of rows) rowsOfNick.set(r.nickname, [...(rowsOfNick.get(r.nickname) ?? []), r]);
const loadedRows = new Set<number>();
for (const o of ops) {
  const m = /mvp:main(?::review)?:(\d+)/.exec(o.comment ?? '');
  if (m && o.active) loadedRows.add(Number(m[1]));
}

// ---------- ERP side ----------
const unitsOfOwner = new Map<string, UnitResult[]>();
const accCat = new Map<string, Map<string, Decimal>>(); // owner -> "account|B" or "account|C:reason"
const carveIds = new Set(
  (await b.modules.splits.listParticipations()).filter((p) => p.origin === 'mvp:carve').map((p) => p.id),
);
const carveTake = new Map<string, Decimal>();
for (const u of calc.units) {
  const seen = new Set<string>();
  for (const a of u.allocations) {
    if (!a.ownerId) continue;
    if (!seen.has(a.ownerId)) {
      seen.add(a.ownerId);
      unitsOfOwner.set(a.ownerId, [...(unitsOfOwner.get(a.ownerId) ?? []), u]);
    }
    let m = accCat.get(a.ownerId);
    if (!m) accCat.set(a.ownerId, (m = new Map()));
    addTo(m, `${u.account}|${a.category}${a.category === 'C' ? `:${a.reason ?? '?'}` : ''}`, a.amount);
  }
  if (u.account !== MAIN_ACCOUNT) continue;
  const carved = sum(u.allocations.filter((a) => a.layer === 'carve' && a.ruleId && carveIds.has(a.ruleId)).map((a) => a.amount));
  if (carved.isZero()) continue;
  const rs = u.allocations.filter((a) => a.layer === 'split');
  const tot = sum(rs.map((a) => a.amount));
  if (tot.isZero()) continue;
  for (const a of rs) if (a.ownerId) addTo(carveTake, a.ownerId, carved.mul(a.amount).div(tot));
}
const pubOfOwner = new Map<string, PublishingResult[]>();
for (const p of calc.publishing) if (p.ownerId) pubOfOwner.set(p.ownerId, [...(pubOfOwner.get(p.ownerId) ?? []), p]);
const opsOfOwner = new Map<string, typeof ops>();
for (const o of ops) if (o.ownerId) opsOfOwner.set(o.ownerId, [...(opsOfOwner.get(o.ownerId) ?? []), o]);

const NOT_LOADED: Record<string, string> = {
  Advertising_not_loaded: 'Main expense not loaded: ads',
  Other_document_only: 'Main expense not loaded: buy-out price / fee (document only)',
  Sample_carve_pair: 'Main expense not loaded: carve row covered or replaced by a participation',
};
const POSITION: Record<string, string> = {
  'recoupable_payout:any': 'advance unrecouped (scope any)',
  'recoupable_payout:publishing': 'advance unrecouped (scope publishing)',
  'deduction:any': 'deduction (carve row) unrecouped',
};
const RESID = 'not explained: master earned (B + C) vs Main royalties';
const OPS = 'not explained: ops vs Main expense mismatch';

interface Line {
  ownerId: string;
  nick: string;
  mainIncome: Decimal;
  diff: Decimal;
  comp: Map<string, Decimal>;
  check: Decimal;
  unexplained: Decimal;
}
const lines: Line[] = [];
const stale: string[] = [];
for (const ownerId of csvDiff.keys()) {
  const ns = nicksOfOwner.get(ownerId) ?? [];
  const sub: Calculation = { ...calc, units: unitsOfOwner.get(ownerId) ?? [], publishing: pubOfOwner.get(ownerId) ?? [] };
  const myOps = opsOfOwner.get(ownerId) ?? [];
  const bal = ownerBalance(sub, ownerId, myOps, {});
  // Main side by kind
  let inc = ZERO, exp = ZERO, incRoy = ZERO, incPub = ZERO, incOther = ZERO, incCarve = ZERO;
  const notLoaded = new Map<string, Decimal>();
  for (const nk of ns)
    for (const r of rowsOfNick.get(nk) ?? []) {
      const v = D(D(r.amount).toFixed(2));
      if (r.side === 'income') {
        inc = inc.add(v);
        if (r.load === 'carve_pair' && (r.category === 'Sample' || r.category === 'Other')) incCarve = incCarve.add(v);
        else if (r.category === 'Royalties') incRoy = incRoy.add(v);
        else if (r.category === 'Publishing') incPub = incPub.add(v);
        else incOther = incOther.add(v); // Other and rows without a category
      } else {
        exp = exp.add(v);
        if (!loadedRows.has(r.rowNo))
          addTo(notLoaded, NOT_LOADED[`${r.category}_${r.load}`] ?? `Main expense not loaded: ${r.category} ${r.load}`, v);
      }
    }
  const diff = bal.total.payable.sub(inc.sub(exp));
  const prev = csvDiff.get(ownerId) as Decimal;
  if (diff.sub(prev).abs().gt('0.01')) stale.push(`${ownerId.slice(0, 8)} csv ${money(prev)} now ${money(diff)}`);
  const ac = accCat.get(ownerId) ?? new Map<string, Decimal>();
  const pick = (pred: (k: string) => boolean) => sum([...ac].filter(([k]) => pred(k)).map(([, v]) => v));
  const masterB = pick((k) => k === `${MAIN_ACCOUNT}|B`);
  const masterC = pick((k) => k.startsWith(`${MAIN_ACCOUNT}|C`));
  const echo8B = pick((k) => k === `${ECHO8_ACCOUNT}|B`);
  const bmAll = sum(Object.values(bal.byLabel).map((v) => v.earned));
  const cmAll = sum(Object.values(bal.byLabel).map((v) => v.waiting));
  const bPub = bal.total.earned.sub(bmAll);
  const cPub = bal.total.waiting.sub(cmAll);
  const comp = new Map<string, Decimal>();
  for (const [k, v] of ac) if (k.startsWith(`${MAIN_ACCOUNT}|C:`)) addTo(comp, `C master ${k.split(':')[1]}`, v.neg());
  addTo(comp, 'C publishing', cPub.neg());
  addTo(comp, 'B17 holder separate (ERP publishing B + C − Main publishing income)', bPub.add(cPub).sub(incPub));
  addTo(comp, 'Echo8 account 1055956 B (Main keeps it on the Echo8 sheet)', echo8B);
  for (const [k, v] of notLoaded) addTo(comp, k, v);
  let remaining = ZERO;
  for (const p of bal.positions) {
    const o = myOps.find((x) => x.id === p.operationId);
    const k = `${o?.meaning}:${(p.scope as { kind?: string } | null)?.kind ?? 'any'}`;
    addTo(comp, POSITION[k] ?? `position ${k}`, p.remaining);
    remaining = remaining.add(p.remaining);
  }
  const nl = sum(notLoaded.values());
  const opsMismatch = exp.sub(nl).sub(bal.total.paid).sub(bal.total.recouped.add(remaining)).add(bal.total.returns).add(bal.total.credits);
  const take = carveTake.get(ownerId) ?? ZERO;
  if (!take.isZero()) addTo(comp, 'carve participation taken from the rows (Main: a deduction row)', take.neg());
  const resid = masterB.add(masterC).sub(incRoy.add(incOther).add(incCarve)).add(take);
  addTo(comp, RESID, resid);
  addTo(comp, OPS, opsMismatch);
  const check = diff.sub(sum(comp.values()));
  lines.push({ ownerId, nick: ns[0] ?? '-', mainIncome: inc, diff, comp, check, unexplained: resid.add(opsMismatch) });
}

const T = D('1.00');
const bad = lines.filter((l) => l.diff.abs().gt(T));
const tol1 = () => T;
const tol2 = (l: Line) => {
  const base = l.mainIncome.abs().gt(l.diff.abs()) ? l.mainIncome.abs() : l.diff.abs();
  const t = base.mul('0.02');
  return t.gt(T) ? t : T;
};
const count = (tol: (l: Line) => Decimal) => {
  const no = bad.filter((l) => l.unexplained.abs().gt(tol(l)));
  return { explained: bad.length - no.length, not: no.length, abs: sum(no.map((l) => l.unexplained.abs())), no };
};

console.log(`owners ${lines.length}; |diff| > 1.00: ${bad.length}; Σ|diff| ${money(sum(bad.map((l) => l.diff.abs())))}; max |check| ${money(lines.reduce((m, l) => (l.check.abs().gt(m) ? l.check.abs() : m), ZERO))}`);
console.log(`Σ ERP payable − Σ Main balance = Σ diff ${money(sum(lines.map((l) => l.diff)))}`);
if (stale.length) console.log(`WARNING: ${stale.length} owners differ from the CSV (run compare-main.ts first): ${stale.slice(0, 5).join('; ')}`);
for (const [name, tol] of [
  ['max(1.00, 2 %)', tol2],
  ['1.00', tol1],
] as const) {
  const r = count(tol);
  console.log(`tolerance ${name}: explained ${r.explained}, not explained ${r.not} (Σ|not explained| ${money(r.abs)})`);
  const by = (lo: number, hi: number) => r.no.filter((l) => l.unexplained.abs().gte(lo) && l.unexplained.abs().lt(hi)).length;
  console.log(
    `  not explained by size: ≥ 10,000: ${by(10000, Infinity)}; 1,000–10,000: ${by(1000, 10000)}; 100–1,000: ${by(100, 1000)}; < 100: ${by(0, 100)}; ` +
      `ERP higher on ${r.no.filter((l) => l.unexplained.gt(0)).length}, lower on ${r.no.filter((l) => l.unexplained.lt(0)).length}`,
  );
}
const tot = new Map<string, Decimal>();
for (const l of bad) for (const [k, v] of l.comp) addTo(tot, k, v);
console.log('\nPer cause, owners with |diff| > 1.00 (Σ, ERP − Main):');
console.log('| Cause | Owners | Σ |');
console.log('|---|---:|---:|');
for (const [k, v] of [...tot].sort((x, y) => y[1].abs().cmp(x[1].abs()))) {
  const n = bad.filter((l) => (l.comp.get(k) ?? ZERO).abs().gt('0.005')).length;
  if (n === 0) continue;
  console.log(`| ${k} | ${n} | ${money(v)} |`);
}
if (top > 0) {
  console.log(`\nThe ${top} largest not-explained owners at max(1.00, 2 %):`);
  for (const l of count(tol2).no.sort((x, y) => y.unexplained.abs().cmp(x.unexplained.abs())).slice(0, top))
    console.log(
      `${l.ownerId.slice(0, 8)} ${l.nick}: diff ${money(l.diff)}, not explained ${money(l.unexplained)} | ` +
        [...l.comp].filter(([, v]) => v.abs().gt('0.005')).sort((x, y) => y[1].abs().cmp(x[1].abs())).slice(0, 5).map(([k, v]) => `${k} ${money(v)}`).join('; '),
    );
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
await b.close();
