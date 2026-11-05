/**
 * Self-check of the e2e seed: `tsx scripts/e2e/verify-seed.ts <name>` opens the facade on the stores seeded by
 * `seed.ts <name>`, reads `data/test-tmp/e2e-keys[-<name>].json` and compares the P1 rows (reconciliation) and the
 * owner balances of docs/agents/19_golden_screens.md with exact decimal strings. PASS/FAIL per check, exit 1 on a FAIL.
 * Read-only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectSources } from '../../src/connect-sources';
import { ZERO } from '../../src/shared/money';
import type { SeedKeys } from './keys';

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('usage: tsx scripts/e2e/verify-seed.ts <name>');
  process.exit(1);
}
const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');
const keys = JSON.parse(
  readFileSync(join(repoRoot, 'data', 'test-tmp', name === 'e2e' ? 'e2e-keys.json' : `e2e-keys-${name}.json`), 'utf8'),
) as SeedKeys;

try {
  process.loadEnvFile(join(repoRoot, '.env'));
} catch {
  // no .env
}
process.env.DB_DATABASE = keys.stores.pg;
process.env.CLICKHOUSE_DATABASE = keys.stores.ch;
const { db, sources, close } = connectSources(join(keys.dataDir, 'files', 'sources'));
const f = openFacade({ db, dataDir: keys.dataDir, payoutThresholdCents: 0, sources });

let fails = 0;
let passes = 0;
function check(label: string, actual: unknown, expected: unknown, note = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passes++;
    console.log(`PASS  ${label}  ${a}`);
  } else {
    fails++;
    console.log(`FAIL  ${label}  computed ${a}  expected(19) ${e}${note ? '  ' + note : ''}`);
  }
}

const case$ = (id: string, k: number) => {
  const c = keys.scenarios[id]?.[`k${k}`];
  if (!c) throw new Error(`no keys for ${id}/${k}`);
  return c;
};

// ---- P1 rows ----
const rows = await f.reconciliation();
type Row = (typeof rows)[number];
const find = (source: string, account: string, month: string): Row | undefined =>
  rows.find((r) => r.source === source && r.account === account && r.month === month);
const p1 = (r: Pick<Row, 'A_received' | 'B_notOurs' | 'C_waiting' | 'ourShare'>) => [r.A_received.toFixed(), r.B_notOurs.toFixed(), r.C_waiting.toFixed(), r.ourShare.toFixed()];
const map = (o: Record<string, { toFixed(): string }>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toFixed()]));

interface Want {
  s: string;
  k: number;
  a?: number;
  m: string;
  row: [string, string, string, string];
  /** `ourShareByLabel`: our share by the label string (the label of record), D-168. */
  byLabel?: Record<string, string>;
  /** The book of the row (`byLabel` key): the label its file was loaded under, D-169; default the label of the account. */
  book?: string;
  breakdown?: Record<string, string>;
  noSplit?: string;
}
const M3 = '2026-03';
const want: Want[] = [];
const add = (s: string, k: number, m: string, row: [string, string, string, string], more: Partial<Want> = {}, a = 0) =>
  want.push({ s, k, m, row, a, ...more });
const std = (s: string, k: number, row: [string, string, string, string], more: Partial<Want> = {}) => add(s, k, M3, row, more);

std('S01', 1, ['100', '50', '0', '50'], { byLabel: { '0to8': '50' } });
std('S01', 2, ['100', '50', '0', '50']);
std('S02', 1, ['100', '49.8', '0', '50.2']);
std('S02', 2, ['100', '50', '0', '50']);
std('S02', 3, ['100', '50', '0', '50']);
std('S02', 4, ['100', '66.6', '0', '33.4']);
std('S02', 5, ['100', '25', '0', '75']);
std('S03', 1, ['100', '50', '0', '50']);
std('S03', 2, ['100', '57.5', '0', '42.5']);
std('S03', 3, ['100', '57.5', '0', '42.5']);
std('S03', 4, ['100', '50', '0', '50']);
std('S03', 5, ['100', '100', '0', '0']);
std('S03', 6, ['100', '62.5', '0', '37.5']);
std('S03', 7, ['100', '65', '0', '35']);
std('S03', 8, ['100', '100', '0', '0']);
for (const m of ['2026-01', '2026-03']) add('S04', 1, m, ['100', '50', '0', '50']);
for (const m of ['2026-01', '2026-03']) add('S04', 2, m, ['100', '50', '0', '50']);
for (const m of ['2026-01', '2026-02']) add('S04', 3, m, ['100', '50', '0', '50']);
std('S05', 1, ['100', '75', '0', '25'], { byLabel: { '0to8': '25' } });
std('S05', 2, ['100', '85', '0', '15']);
std('S05', 3, ['100', '100', '0', '0']);
std('S05', 4, ['100', '50', '0', '50']);
std('S06', 1, ['100', '50', '0', '50'], { byLabel: { '0to8': '50' } });
// the string `Echo8` in a file of account(0): our share by the string Echo8, the book 0to8 (D-169)
std('S06', 2, ['100', '50', '0', '50'], { byLabel: { Echo8: '50' }, book: '0to8' });
std('S06', 3, ['100', '75', '0', '25']);
add('S06', 3, '2026-04', ['100', '50', '0', '50']);
std('S07', 1, ['-100', '-78.75', '0', '-21.25']);
std('S07', 2, ['0', '0', '0', '0']);
std('S08', 1, ['100', '57.5', '23.375', '19.125']);
std('S08', 2, ['100', '57.5', '23.375', '19.125']);
std('S08', 3, ['100', '50', '25', '25'], { byLabel: { Echo8: '25' }, book: '0to8' });
std('S08', 4, ['100', '0', '50', '50'], { noSplit: '50' });
std('S09', 1, ['100', '49.8', '0', '50.2']);
std('S09', 2, ['100', '10', '0', '90']);
std('S10', 1, ['100', '50', '0', '50'], { byLabel: { '0to8': '50' } });
want.push({ s: 'S10', k: 1, a: 1, m: M3, row: ['50', '25', '0', '25'], byLabel: { Echo8: '25' }, book: 'Echo8' });
std('S10', 2, ['100', '50', '0', '50'], { byLabel: { Echo8: '50' }, book: '0to8' });
want.push({ s: 'S10', k: 2, a: 1, m: M3, row: ['57', '25', '7', '25'], byLabel: { Echo8: '25' }, book: 'Echo8', breakdown: { unknown_pair: '7' } });
std('S11', 1, ['150', '82.5', '0', '67.5']);
std('S12', 1, ['100', '5', '50', '45']);
add('S13', 1, M3, ['100', '30', '20', '50']);
add('S13', 1, '2026-05', ['100', '7', '20', '73']);
std('S14', 1, ['100', '0', '50', '50']);
std('S15', 1, ['100', '0', '50', '50']);
std('S16', 1, ['100', '50', '50', '0'], { breakdown: { label_unmapped: '50' } });
std('S17', 1, ['100', '50', '50', '0']);
std('S20', 1, ['9', '0', '9', '0'], { breakdown: { no_isrc: '2', unknown_pair: '7' } });
std('S21', 1, ['100', '10', '0', '90']);
for (const m of ['2026-03', '2026-04']) add('S22', 1, m, ['100', '57.5', '0', '42.5']);
add('S22', 2, M3, ['100', '57.5', '0', '42.5']);
add('S22', 2, '2026-04', ['-100', '-57.5', '0', '-42.5']);
std('S23', 1, ['100', '75', '0', '25']);
for (const k of [1, 2, 3]) std('S24', k, ['100', '50', '0', '50']);
for (const m of ['2026-02', '2026-03', '2026-05']) add('S25', 1, m, ['100', '50', '0', '50']);
for (const m of ['2026-05', '2026-06']) add('S26', 1, m, ['100', '50', '0', '50']);
add('S26', 2, '2026-05', ['100', '50', '0', '50']);
add('S26', 2, '2026-06', ['100', '100', '0', '0']);
for (const m of ['2026-03', '2026-04']) add('S27', 1, m, m === '2026-03' ? ['100', '57.5', '0', '42.5'] : ['100', '57.5', '0', '42.5']);
std('S28', 1, ['100', '50', '0', '50']);
std('S30', 1, ['100', '0', '0', '100']);
std('S32', 1, ['100', '50', '5', '45']);
std('S33', 1, ['200', '50', '50', '100']);
std('S35', 4, ['100', '50', '5', '45']);
for (const m of ['2026-03', '2026-04']) add('S37', 1, m, ['100', '75', '0', '25']);
// S38 (G50, D-169): one file per account, each its own book
std('S38', 1, ['100', '50', '0', '50'], { book: '0to8' });
add('S38', 1, M3, ['60', '30', '0', '30'], { book: 'Echo8' }, 1);

for (const w of want) {
  const c = case$(w.s, w.k);
  const acct = c.accounts[w.a ?? 0] as string;
  const r = find('believe', acct, w.m);
  const label = `P1 ${w.s}/${w.k} ${acct} ${w.m}`;
  if (!r) {
    fails++;
    console.log(`FAIL  ${label}  no row`);
    continue;
  }
  check(label, p1(r), w.row);
  if (w.byLabel) check(`${label} ourShareByLabel`, map(r.ourShareByLabel), w.byLabel);
  // the book (D-169): one key, the label of the file (account(0) of a case is 0to8's, account(1) Echo8's), the whole row
  const book = w.book ?? (w.a === 1 ? 'Echo8' : '0to8');
  check(`${label} byLabel (book)`, Object.fromEntries(Object.entries(r.byLabel).map(([k, v]) => [k, p1(v)])), { [book]: w.row });
  if (w.breakdown) check(`${label} C_breakdown`, map(r.C_breakdown as never), w.breakdown);
  if (w.noSplit) check(`${label} ourShareNoSplit`, r.ourShareNoSplit.toFixed(), w.noSplit);
}

// the identity on every row of the whole seed
let bad = 0;
for (const r of rows) {
  const ok = r.discrepancy.toFixed() === '0' && r.B_notOurs.add(r.C_waiting).add(r.ourShare).toFixed() === r.A_received.toFixed();
  if (!ok) {
    bad++;
    console.log(`FAIL  identity ${r.source} ${r.account} ${r.month} discrepancy ${r.discrepancy.toFixed()}`);
  }
}
check(`identity A = B + C + ours, discrepancy 0 on all ${rows.length} rows`, bad, 0);

// every Believe row sits in exactly one named book: every seed file is loaded under a label (D-169)
const believe = rows.filter((r) => r.source === 'believe');
const unbooked = believe.filter((r) => Object.keys(r.byLabel).length !== 1 || '?' in r.byLabel);
for (const r of unbooked) console.log(`FAIL  book ${r.account} ${r.month} ${JSON.stringify(Object.keys(r.byLabel))}`);
check(`one named book on all ${believe.length} Believe rows`, unbooked.length, 0);

// ---- B17 rows (keyed by month) ----
const b17 = (m: string) => find('b17', 'b17', m);
for (const [m, exp, bd] of [
  ['2026-03', ['400', '170', '50', '180'], undefined],
  ['2025-12', ['100', '0', '100', '0'], { writer_unmapped: '100' }],
] as const) {
  const r = b17(m);
  if (!r) {
    fails++;
    console.log(`FAIL  P1 b17 ${m}  no row`);
    continue;
  }
  check(`P1 b17 ${m}`, p1(r), exp);
  if (bd) check(`P1 b17 ${m} C_breakdown`, map(r.C_breakdown as never), bd);
}
const r2606 = b17('2026-06');
console.log(`INFO  P1 b17 2026-06 (S31, not in 19) ${r2606 ? JSON.stringify(p1(r2606)) : 'no row'}`);

// ---- owner balances ----
async function bal(s: string, k: number, letter: string) {
  const b = await f.ownerBalance(case$(s, k).owners[letter] as string);
  const t = b.total;
  return {
    confirmed: b.confirmed,
    earned: t.earned.toFixed(),
    waiting: t.waiting.toFixed(),
    recouped: t.recouped.toFixed(),
    paid: t.paid.toFixed(),
    payable: t.payable.toFixed(),
    payableShown: t.payableShown.toFixed(),
    remaining: b.positions[0]?.remaining.toFixed() ?? null,
    blocking: b.blockingPayouts.length,
    earnedPublishing: b.period.earnedPublishing.toFixed(),
  };
}
async function balCheck(label: string, s: string, k: number, letter: string, want: Record<string, unknown>) {
  const got = await bal(s, k, letter);
  const picked = Object.fromEntries(Object.keys(want).map((x) => [x, (got as Record<string, unknown>)[x]]));
  check(`balance ${label}`, picked, want);
}
await balCheck('S01/1 A', 'S01', 1, 'A', { earned: '50', payable: '50' });
await balCheck('S10/2 A (G40)', 'S10', 2, 'A', { earned: '75' });
await balCheck('S11 A / P', 'S11', 1, 'A', { earned: '75' });
await balCheck('S11 P', 'S11', 1, 'P', { earned: '7.5' });
await balCheck('S14 A before', 'S14', 1, 'A', { confirmed: false, earned: '0', waiting: '50', payable: '0' });
await balCheck('S22/1 P (G27)', 'S22', 1, 'P', { earned: '15', recouped: '10', remaining: '0', payable: '5' });
await balCheck('S22/2 P (G27b)', 'S22', 2, 'P', { earned: '0', recouped: '0', remaining: '10', payable: '0' });
await balCheck('S23 NG (G29)', 'S23', 1, 'NG', { earned: '25', recouped: '25', remaining: '25', payable: '0' });
await balCheck('S24/1 A (G28)', 'S24', 1, 'A', { paid: '30', payable: '20' });
await balCheck('S24/2 A (G28)', 'S24', 2, 'A', { paid: '70', payable: '-20', payableShown: '0' });
await balCheck('S24/3 A before (G39)', 'S24', 3, 'A', { earned: '50', paid: '50', payable: '0' });
await balCheck('S25 A', 'S25', 1, 'A', { earned: '150' });
await balCheck('S27 P', 'S27', 1, 'P', { earned: '15' });
await balCheck('S31/1 A', 'S31', 1, 'A', { earned: '80', payable: '80' });
await balCheck('S31/2 A', 'S31', 2, 'A', { earned: '80', payable: '80' });
await balCheck('S31/3 A', 'S31', 3, 'A', { paid: '20', payable: '60' });
await balCheck('S31/4 A', 'S31', 4, 'A', { payable: '50' });
await balCheck('S33 X', 'S33', 1, 'X', { earned: '50' });
await balCheck('S33 Y', 'S33', 1, 'Y', { earned: '0', waiting: '50' });
await balCheck('S18 W1 (G26)', 'S18', 1, 'W1', { earnedPublishing: '100' });
await balCheck('S18 W2 (G26)', 'S18', 1, 'W2', { earnedPublishing: '70' });
await balCheck('S18 W3 before (G26d)', 'S18', 1, 'W3', { waiting: '50', earned: '0' });
await balCheck('S19 W4a (before mapping)', 'S19', 1, 'W4a', { earned: '0', waiting: '0' });

// ---- signals (19 §4 "P21 rows from other scenarios") ----
const sig = await f.signals();
const unm = Object.fromEntries(sig.labelUnmapped.map((x) => [x.labelName, x.net.toFixed()]));
check('signals labelUnmapped Mystery Records (S16)', unm['Mystery Records'], '100');
check('signals labelUnmapped Mystery Records B (S17)', unm['Mystery Records B'], '100');
const missing = (s: string, k: number) =>
  sig.unfunded
    .filter((x) => case$(s, k).isrcs.includes(x.isrc))
    .reduce((a, x) => a.add(x.missing), ZERO)
    .toFixed();
check('signals unfunded S03/8 (G37)', missing('S03', 8), '20');
check('signals unfunded S21 (G22)', missing('S21', 1), '10');
check('signals unfunded S09/2 (G44)', missing('S09', 2), '29');
const noSplit = Object.fromEntries(sig.isrcsWithoutSplit.map((x) => [x.isrc, x.net.toFixed()]));
check('signals isrcsWithoutSplit S08/4 (G21)', noSplit[case$('S08', 4).isrcs[0] as string], '100');
check('signals isrcsWithoutSplit S30', noSplit[case$('S30', 1).isrcs[0] as string], '100');
check('signals unallocated S20 pairs', sig.unallocated.pairs.filter((p) => p.isrc === case$('S20', 1).isrcs[0]).map((p) => [p.isrc, p.net.toFixed()]), [[case$('S20', 1).isrcs[0], '7']]);
check('signals unallocated S20 withoutIsrc', String(sig.unallocated.withoutIsrc), '2');
check(
  'signals sublabelWithoutRule S35/1 and S37 (after the spec) or S35/1 only',
  sig.sublabelWithoutRule.map((x) => [x.label, x.month, x.net.toFixed()]),
  [['Ghost Label 35', '2026-03', '140']],
);
check('signals ruleRecipientIsRow S35/1', sig.ruleRecipientIsRow.map((x) => [x.isrc, x.month]), [[case$('S35', 1).isrcs[0], '2026-06']]);
check('signals twoRowsOneOwner S35/2', sig.twoRowsOneOwner.map((x) => [x.isrc, x.month, x.pseudonyms]), [
  [case$('S35', 2).isrcs[0], '2026-03', [case$('S35', 2).names.A, case$('S35', 2).names.A2].sort()],
]);
check('signals tracksWithNote empty', sig.tracksWithNote.length, 0);
check(
  'signals participantsWithoutOwner S35/4',
  sig.participantsWithoutOwner.map((p) => [p.isrc, p.pseudonym, p.fundedFrom, p.amount.toFixed()]),
  [[case$('S35', 4).isrcs[0], case$('S35', 4).names.P, 'label_share', '5']],
);
check('signals ambiguousWriters S19', sig.ambiguousWriters.map((w) => w.displayName), ['HOLDER W4']);
check(
  'signals assumptions: S13 Q1 40, S08/3 QQ 25, q11 4.25 and 19.125 for each of S08/1 and S08/2, S08/4 r1 50',
  sig.assumptions.map((a) => [a.basis, a.amount.toFixed()]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
  [
    ['document', '25'],
    ['document', '40'],
    ['q11', '19.125'],
    ['q11', '19.125'],
    ['q11', '4.25'],
    ['q11', '4.25'],
    ['r1', '50'],
  ].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
);

console.log(`\n${passes} PASS, ${fails} FAIL`);
await close();
process.exit(fails > 0 ? 1 : 0);
