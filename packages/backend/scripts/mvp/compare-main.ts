/**
 * Stage 5: owner balances vs `0to8 Main.xlsx` (docs/agents/11_plan.md). Read-only: one calculate() and SELECTs.
 * Per owner (and per nickname): ERP earned B by report month vs Main Income rows, ERP paid vs Main Expense rows,
 * ERP payable (ownerBalance) vs Main balance (Income - Expense). Stage names and amounts only; owner legal names are
 * never printed (the owner is shown by id prefix and the pseudonym of its main nickname).
 *
 * Usage: npx tsx packages/backend/scripts/mvp/compare-main.ts [--out data/mvp-load/verify/main.md]
 * Also writes <out without .md>_owners.csv (one line per owner).
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ownerBalance, classifyOperation } from '../../src/facade/balance';
import type { Calculation, PublishingResult, UnitResult } from '../../src/facade/calculation';
import {
  addTo, arg, bootstrap, calculateAll, D, Md, money, monthKey, MVP, readJson, ROOT, sum, ZERO, type Decimal,
} from './compare-common';

const out = resolve(ROOT, arg('out') ?? 'data/mvp-load/verify/main.md');
const T = D('1.00');
const t0 = Date.now();

interface Nick {
  nickname: string; status: string; artistId?: string; ownerId?: string; pseudonym?: string;
}
interface Row {
  rowNo: number; comment: string; reportMonth: string | null; date: string; nickname: string; type: string;
  category: string; amount: string; side: 'income' | 'expense'; load: string; noRecap?: boolean;
  overpayment?: boolean; ignoreFlag?: boolean; nicknameStatus?: string; ownerId?: string; artistId?: string;
}
const nicks = readJson<Record<string, Nick>>(join(MVP, 'main', 'nicknames.json'));
const rows = readJson<Row[]>(join(MVP, 'main', 'cash_rows.json'));

const b = await bootstrap();
const { calc, ops } = await calculateAll(b);

// ---------- map nicknames to the current owners ----------
const canonArtist = (id: string | undefined) => (id ? (calc.artistIndex.get(id)?.id ?? id) : undefined);
const ownerOfArtist = (id: string | undefined) => (id ? (calc.artistIndex.get(id)?.ownerId ?? null) : null);
const nickOwner = new Map<string, string>(); // nickname -> owner id
const nickArtist = new Map<string, string>();
for (const n of Object.values(nicks)) {
  if (n.status !== 'matched') continue;
  const a = canonArtist(n.artistId);
  const o = ownerOfArtist(n.artistId) ?? n.ownerId ?? null;
  if (a) nickArtist.set(n.nickname, a);
  if (o) nickOwner.set(n.nickname, o);
}
const nicksOfOwner = new Map<string, string[]>();
for (const [nk, o] of nickOwner) nicksOfOwner.set(o, [...(nicksOfOwner.get(o) ?? []), nk]);

// ---------- Main side ----------
interface MainSide {
  royalties: Map<string, Decimal>; publishing: Map<string, Decimal>; incomeOther: Decimal; incomeAll: Decimal;
  expenseAll: Decimal; expensePaid: Decimal; ads: Decimal; noRecapRows: number; noRecapIncome: Decimal;
  overpayment: Decimal; rows: number;
}
const newMain = (): MainSide => ({
  royalties: new Map(), publishing: new Map(), incomeOther: ZERO, incomeAll: ZERO, expenseAll: ZERO,
  expensePaid: ZERO, ads: ZERO, noRecapRows: 0, noRecapIncome: ZERO, overpayment: ZERO, rows: 0,
});
const mainByNick = new Map<string, MainSide>();
const unmatchedExpense = new Map<string, { n: number; sum: Decimal; status: string }>();
for (const r of rows) {
  const amt = D(r.amount);
  const nm = mainByNick.get(r.nickname) ?? newMain();
  mainByNick.set(r.nickname, nm);
  nm.rows++;
  if (r.side === 'income') {
    nm.incomeAll = nm.incomeAll.add(amt);
    const m = r.reportMonth ?? 'none';
    if (r.category === 'Royalties') addTo(nm.royalties, m, amt);
    else if (r.category === 'Publishing') addTo(nm.publishing, m, amt);
    else nm.incomeOther = nm.incomeOther.add(amt);
    if (r.noRecap) {
      nm.noRecapRows++;
      nm.noRecapIncome = nm.noRecapIncome.add(amt);
    }
  } else {
    nm.expenseAll = nm.expenseAll.add(amt);
    if (r.category === 'Advertising') nm.ads = nm.ads.add(amt);
    else nm.expensePaid = nm.expensePaid.add(amt);
    if (r.noRecap) nm.noRecapRows++;
    if (r.overpayment) nm.overpayment = nm.overpayment.add(amt);
    if (!nickOwner.has(r.nickname) && r.category !== 'Advertising') {
      const e = unmatchedExpense.get(r.nickname) ?? { n: 0, sum: ZERO, status: nicks[r.nickname]?.status ?? r.nicknameStatus ?? 'unknown' };
      e.n++;
      e.sum = e.sum.add(amt);
      unmatchedExpense.set(r.nickname, e);
    }
  }
}

// ---------- ERP side: one pass over units and publishing ----------
const unitsOfOwner = new Map<string, UnitResult[]>();
const masterByOwnerMonth = new Map<string, Map<string, Decimal>>();
const masterByArtistMonth = new Map<string, Map<string, Decimal>>();
const monthMap = (m: Map<string, Map<string, Decimal>>, k: string) => {
  let x = m.get(k);
  if (!x) m.set(k, (x = new Map()));
  return x;
};
for (const u of calc.units) {
  const seen = new Set<string>();
  for (const a of u.allocations) {
    if (!a.ownerId) continue;
    if (!seen.has(a.ownerId)) {
      seen.add(a.ownerId);
      let l = unitsOfOwner.get(a.ownerId);
      if (!l) unitsOfOwner.set(a.ownerId, (l = []));
      l.push(u);
    }
    if (a.category === 'B') {
      addTo(monthMap(masterByOwnerMonth, a.ownerId), monthKey(u.reportingMonth), a.amount);
      addTo(monthMap(masterByArtistMonth, a.artistId), monthKey(u.reportingMonth), a.amount);
    }
  }
}
const pubOfOwner = new Map<string, PublishingResult[]>();
const pubBByOwnerMonth = new Map<string, Map<string, Decimal>>();
for (const p of calc.publishing) {
  if (!p.ownerId) continue;
  pubOfOwner.set(p.ownerId, [...(pubOfOwner.get(p.ownerId) ?? []), p]);
  if (p.category === 'B') addTo(monthMap(pubBByOwnerMonth, p.ownerId), monthKey(p.reportMonth), p.authorAmount);
}
const opsOfOwner = new Map<string, typeof ops>();
for (const o of ops) if (o.ownerId) opsOfOwner.set(o.ownerId, [...(opsOfOwner.get(o.ownerId) ?? []), o]);

const sumMap = (m?: Map<string, Decimal>) => (m ? sum(m.values()) : ZERO);
function monthDiffs(erp: Map<string, Decimal>, main: Map<string, Decimal>) {
  const months = new Set([...erp.keys(), ...main.keys()]);
  let abs = ZERO, n = 0, worst = '', worstAbs = ZERO;
  for (const m of months) {
    const d = (erp.get(m) ?? ZERO).sub(main.get(m) ?? ZERO);
    if (d.abs().gt(T)) {
      n++;
      abs = abs.add(d.abs());
      if (d.abs().gt(worstAbs)) {
        worstAbs = d.abs();
        worst = `${m} (${money(d)})`;
      }
    }
  }
  return { n, abs, worst };
}

// ---------- per owner ----------
interface OwnerLine {
  ownerId: string; nick: string; nicks: number; mainIncome: Decimal; mainRoy: Decimal; mainPub: Decimal; mainExpense: Decimal;
  mainAds: Decimal; mainBalance: Decimal; erpEarnedB: Decimal; erpWaiting: Decimal; erpPaid: Decimal; erpRecouped: Decimal;
  erpPayable: Decimal; diff: Decimal; monthsOff: number; monthsOffAbs: Decimal; worst: string; guess: string;
  waitingByReason: string; noRecap: number; overpayment: Decimal;
  mainAdsCharged: Decimal; erpAdsRecouped: Decimal; erpAdsRemaining: Decimal;
}
// Ads charged in Main (the "expense posted" column, D-156): they lower the Main balance like the ERP ad debts lower payable.
const adsCharged = new Map<string, Decimal>();
for (const r of readJson<{ records: { ownerId: string | null; charged: string }[] }>(join(MVP, 'ads', 'main_ads_mapping.json')).records)
  if (r.ownerId) adsCharged.set(r.ownerId, (adsCharged.get(r.ownerId) ?? ZERO).add(D(r.charged)));
const lines: OwnerLine[] = [];
const matchedOwners = [...nicksOfOwner.keys()];
for (const ownerId of matchedOwners) {
  const sub: Calculation = { ...calc, units: unitsOfOwner.get(ownerId) ?? [], publishing: pubOfOwner.get(ownerId) ?? [] };
  const myOps = opsOfOwner.get(ownerId) ?? [];
  const bal = ownerBalance(sub, ownerId, myOps, {});
  const ns = nicksOfOwner.get(ownerId) as string[];
  const main = newMain();
  for (const nk of ns) {
    const m = mainByNick.get(nk);
    if (!m) continue;
    for (const [k, v] of m.royalties) addTo(main.royalties, k, v);
    for (const [k, v] of m.publishing) addTo(main.publishing, k, v);
    main.incomeOther = main.incomeOther.add(m.incomeOther);
    main.incomeAll = main.incomeAll.add(m.incomeAll);
    main.expenseAll = main.expenseAll.add(m.expenseAll);
    main.expensePaid = main.expensePaid.add(m.expensePaid);
    main.ads = main.ads.add(m.ads);
    main.noRecapRows += m.noRecapRows;
    main.noRecapIncome = main.noRecapIncome.add(m.noRecapIncome);
    main.overpayment = main.overpayment.add(m.overpayment);
  }
  const erpM = masterByOwnerMonth.get(ownerId) ?? new Map();
  const erpP = pubBByOwnerMonth.get(ownerId) ?? new Map();
  const mdiff = monthDiffs(erpM, main.royalties);
  const pdiff = monthDiffs(erpP, main.publishing);
  const mainAdsCharged = adsCharged.get(ownerId) ?? ZERO;
  const mainBalance = main.incomeAll.sub(main.expenseAll).sub(mainAdsCharged);
  const countedOut = myOps.filter((o) => o.direction === 'out' && classifyOperation(o, calc.documentStatus).counted);
  const erpPaid = sum(countedOut.map((o) => D(o.amountCents).div(100)));
  const diff = bal.total.payable.sub(mainBalance);
  const wb = Object.entries(bal.period.waitingBreakdown).sort((x, y) => (y[1] as Decimal).abs().cmp((x[1] as Decimal).abs()));
  void wb;
  // all-time waiting by reason: recompute from the subset (the period breakdown of ownerBalance({}) is all time)
  const waitingByReason = wb.map(([r, v]) => `${r} ${money(v as Decimal)}`).join('; ');

  // first-cause guess
  const earnedB = bal.total.earned;
  const incomeDelta = earnedB.sub(main.incomeAll); // negative: ERP earned less than Main income
  const outDelta = bal.total.paid.add(bal.total.recouped).sub(bal.total.returns).sub(bal.total.credits).sub(main.expenseAll);
  const tags: string[] = [];
  if (main.incomeAll.gt(T) && earnedB.add(bal.total.waiting).abs().lte(T)) tags.push('no split in ERP (C): no master/publishing allocation at all');
  else if (bal.total.waiting.gt(T) && incomeDelta.lt(T.neg()) && bal.total.waiting.gte(incomeDelta.abs().mul('0.5')))
    tags.push(`waiting in C: ${(wb[0]?.[0] as string) ?? 'unknown'}`);
  if (main.ads.gt(T) && diff.gt(0) && main.ads.sub(diff).abs().lte(main.ads)) tags.push(`ads not loaded (${money(main.ads)})`);
  if (main.noRecapRows > 0) tags.push(`"ноу рекап" rows (${main.noRecapRows})`);
  if (main.overpayment.abs().gt(T)) tags.push(`overpayment rows (${money(main.overpayment)})`);
  if (erpPaid.lte(T) && main.expensePaid.gt(T)) tags.push(`payouts not loaded (Main ${money(main.expensePaid)})`);
  if (mainBalance.lt(T.neg()) && bal.total.payable.gte(0)) tags.push('Main balance negative (overpaid in Main)');
  if (tags.length === 0 && incomeDelta.abs().gt(T)) tags.push(incomeDelta.isNegative() ? 'participation/carve or split differences (ERP earned less)' : 'participation/carve or split differences (ERP earned more)');
  if (tags.length === 0 && outDelta.abs().gt(T)) tags.push(`paid/recoup differs (${money(outDelta)})`);
  if (tags.length === 0) tags.push('unclear');

  lines.push({
    ownerId, nick: ns[0] as string, nicks: ns.length, mainIncome: main.incomeAll, mainRoy: sumMap(main.royalties),
    mainPub: sumMap(main.publishing), mainExpense: main.expenseAll, mainAds: main.ads, mainBalance, erpEarnedB: earnedB,
    erpWaiting: bal.total.waiting, erpPaid, erpRecouped: bal.total.recouped, erpPayable: bal.total.payable, diff,
    monthsOff: mdiff.n + pdiff.n, monthsOffAbs: mdiff.abs.add(pdiff.abs), worst: mdiff.worst || pdiff.worst,
    guess: tags.join(' + '), waitingByReason, noRecap: main.noRecapRows, overpayment: main.overpayment,
    mainAdsCharged, erpAdsRecouped: bal.total.adsRecouped, erpAdsRemaining: sum(bal.ads.map((a) => a.remaining)),
  });
}

// ---------- per nickname ----------
const nickLines = [...nickArtist.entries()].map(([nk, artistId]) => {
  const main = mainByNick.get(nk) ?? newMain();
  const erp = masterByArtistMonth.get(artistId) ?? new Map();
  const d = monthDiffs(erp, main.royalties);
  return { nk, mainRoy: sumMap(main.royalties), erpB: sumMap(erp), diff: sumMap(erp).sub(sumMap(main.royalties)), monthsOff: d.n };
});

// ---------- report ----------
const bad = lines.filter((l) => l.diff.abs().gt(T)).sort((x, y) => y.diff.abs().cmp(x.diff.abs()));
const totMainIncome = sum(lines.map((l) => l.mainIncome));
const totErpEarned = sum(lines.map((l) => l.erpEarnedB.add(l.erpWaiting)));
const totErpB = sum(lines.map((l) => l.erpEarnedB));
const totWaiting = sum(lines.map((l) => l.erpWaiting));
const md = new Md();
md.h(1, 'Owner balances vs 0to8 Main (stage 5)');
md.p(
  'Generated by compare-main.ts. Main: `data/mvp-load/main/cash_rows.json` (Income and Expense rows by nickname; Advertising rows are Expense rows, ' +
    'the ads columns of the sheet are not in the json). Main balance = Σ Income − Σ Expense − Σ ads charged (the posted ads of `ads/main_ads_mapping.json`, D-156). ERP payable = `ownerBalance(...).total.payable` (earned B − recouped − paid ± returns/credits). ' +
    `Tolerance ${T.toFixed(2)}. Diff = ERP − Main.`,
);
md.table(
  ['Item', 'Value'],
  [
    ['Owners matched to a Main nickname', matchedOwners.length],
    ['Nicknames matched / ambiguous / unmatched', ['matched', 'ambiguous', 'unmatched'].map((s) => Object.values(nicks).filter((n) => n.status === s).length).join(' / ')],
    ['Σ Main income (matched owners)', money(totMainIncome)],
    ['Σ ERP earned B (matched owners)', money(totErpB)],
    ['Σ ERP waiting C (matched owners)', money(totWaiting)],
    ['Σ ERP earned B + C', money(totErpEarned)],
    ['(B + C) − Main income', money(totErpEarned.sub(totMainIncome))],
    ['Σ Main expense (matched owners)', money(sum(lines.map((l) => l.mainExpense)))],
    ['Σ ERP paid (counted out operations)', money(sum(lines.map((l) => l.erpPaid)))],
    ['Σ ERP payable', money(sum(lines.map((l) => l.erpPayable)))],
    ['Σ Main balance', money(sum(lines.map((l) => l.mainBalance)))],
    ['Owners with |payable − Main balance| > 1.00', `${bad.length} of ${lines.length}`],
    ['Σ|diff| over those owners', money(sum(bad.map((l) => l.diff.abs())))],
    ['Σ Main ads charged (posted ads, D-156)', money(sum(lines.map((l) => l.mainAdsCharged)))],
    ['Σ ERP ads recouped (from ERP income)', money(sum(lines.map((l) => l.erpAdsRecouped)))],
    ['Σ ERP ad debt not yet recouped (waits for income)', money(sum(lines.map((l) => l.erpAdsRemaining)))],
    [
      'Owners with |payable − ad debt left − Main balance| > 1.00 (as if the debt were taken at once, like Main)',
      `${lines.filter((l) => l.diff.sub(l.erpAdsRemaining).abs().gt(T)).length} of ${lines.length}; Σ|diff| ${money(sum(lines.map((l) => l.diff.sub(l.erpAdsRemaining).abs()).filter((d) => d.gt(T))))}`,
    ],
  ],
);

md.h(2, '1. Earned by report month (matched owners)');
const allMonths = new Set<string>();
const mainRoyM = new Map<string, Decimal>(), mainPubM = new Map<string, Decimal>(), erpMasterM = new Map<string, Decimal>(), erpPubM = new Map<string, Decimal>();
for (const l of lines) {
  for (const nk of nicksOfOwner.get(l.ownerId) as string[]) {
    const m = mainByNick.get(nk);
    if (!m) continue;
    for (const [k, v] of m.royalties) addTo(mainRoyM, k, v);
    for (const [k, v] of m.publishing) addTo(mainPubM, k, v);
  }
  for (const [k, v] of masterByOwnerMonth.get(l.ownerId) ?? []) addTo(erpMasterM, k, v);
  for (const [k, v] of pubBByOwnerMonth.get(l.ownerId) ?? []) addTo(erpPubM, k, v);
}
for (const m of [mainRoyM, mainPubM, erpMasterM, erpPubM]) for (const k of m.keys()) allMonths.add(k);
md.table(
  ['Month', 'Main Royalties', 'ERP master B', 'Diff', 'Main Publishing', 'ERP publishing B', 'Diff'],
  [...allMonths].sort().map((m) => {
    const a = mainRoyM.get(m) ?? ZERO, e = erpMasterM.get(m) ?? ZERO, pa = mainPubM.get(m) ?? ZERO, pe = erpPubM.get(m) ?? ZERO;
    return [m, money(a), money(e), money(e.sub(a)), money(pa), money(pe), money(pe.sub(pa))];
  }),
);

md.h(2, '2. Owners whose payable differs from the Main balance by more than 1.00');
md.p(`${bad.length} owners; the first 150 by |diff| (all of them in the CSV).`);
md.table(
  ['Owner', 'Nick', 'Main income', 'Main expense', 'Main balance', 'ERP B', 'ERP C', 'ERP paid', 'ERP recouped', 'ERP payable', 'Diff', 'Months off', 'Worst month', 'First-cause guess'],
  bad.slice(0, 150).map((l) => [
    l.ownerId.slice(0, 8), l.nick + (l.nicks > 1 ? ` (+${l.nicks - 1})` : ''), money(l.mainIncome), money(l.mainExpense), money(l.mainBalance),
    money(l.erpEarnedB), money(l.erpWaiting), money(l.erpPaid), money(l.erpRecouped), money(l.erpPayable), money(l.diff), l.monthsOff, l.worst,
    l.guess + (l.waitingByReason ? ` [C: ${l.waitingByReason}]` : ''),
  ]),
);
const guessCount = new Map<string, { n: number; abs: Decimal }>();
for (const l of bad) {
  const first = l.guess.split(' + ')[0]!.replace(/\(.*$/, '').replace(/:.*$/, '').trim();
  const e = guessCount.get(first) ?? { n: 0, abs: ZERO };
  e.n++;
  e.abs = e.abs.add(l.diff.abs());
  guessCount.set(first, e);
}
md.h(3, 'Differences by first-cause guess');
md.table(['First cause', 'Owners', 'Σ|diff|'], [...guessCount.entries()].sort((x, y) => y[1].abs.cmp(x[1].abs)).map(([k, e]) => [k, e.n, money(e.abs)]));

md.h(2, '3. Nicknames: Main Royalties income vs ERP master B of the pseudonym');
md.p('Top 60 by |diff| (master only; publishing is per owner above).');
md.table(
  ['Nickname', 'Main Royalties', 'ERP master B', 'Diff', 'Months off'],
  nickLines.sort((x, y) => y.diff.abs().cmp(x.diff.abs())).slice(0, 60).map((n) => [n.nk, money(n.mainRoy), money(n.erpB), money(n.diff), n.monthsOff]),
);

md.h(2, '4. Main nicknames with payouts but no owner');
const un = [...unmatchedExpense.entries()].sort((x, y) => y[1].sum.cmp(x[1].sum));
md.p(`${un.length} nicknames, Σ Expense ${money(sum(un.map(([, e]) => e.sum)))}. Top 60:`);
md.table(['Nickname', 'Status', 'Expense rows', 'Σ Expense'], un.slice(0, 60).map(([k, e]) => [k, e.status, e.n, money(e.sum)]));
const unInc = [...mainByNick.entries()].filter(([k]) => !nickOwner.has(k)).reduce((s, [, m]) => s.add(m.incomeAll), ZERO);
md.p(`Main income of nicknames without an owner: ${money(unInc)}.`);
md.write(out);

const csv = ['owner,nick,main_income,main_royalties,main_publishing,main_expense,main_ads,main_balance,erp_b,erp_c,erp_paid,erp_recouped,erp_payable,diff,months_off,guess,noRecap_rows']
  .concat(
    lines.map((l) =>
      [l.ownerId, JSON.stringify(l.nick), l.mainIncome, l.mainRoy, l.mainPub, l.mainExpense, l.mainAds, l.mainBalance, l.erpEarnedB, l.erpWaiting, l.erpPaid, l.erpRecouped, l.erpPayable, l.diff, l.monthsOff, JSON.stringify(l.guess), l.noRecap]
        .map((v) => (typeof v === 'object' && v !== null && 'toFixed' in v ? (v as Decimal).toFixed(2) : v))
        .join(','),
    ),
  );
writeFileSync(out.replace(/\.md$/, '') + '_owners.csv', csv.join('\n') + '\n');

console.log(
  `owners ${lines.length}; differ>1.00: ${bad.length}; Σ Main income ${money(totMainIncome)}; Σ ERP earned B ${money(totErpB)} + C ${money(totWaiting)} = ${money(totErpEarned)}; ` +
    `Σ ERP payable ${money(sum(lines.map((l) => l.erpPayable)))}; Σ Main balance ${money(sum(lines.map((l) => l.mainBalance)))}; unowned payout nicknames ${un.length}`,
);
console.log(`report: ${out} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
await b.close();
