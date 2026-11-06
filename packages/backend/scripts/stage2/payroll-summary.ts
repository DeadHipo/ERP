/**
 * D-175: the September payroll of the book of 0to8 on the live data, in numbers: the reconciliation row of the month
 * (A = B + C + ours, the C reasons), the payroll at `asOf` (rows, the gates, Σ payable), the largest payables. Reads only.
 *
 *   npx tsx packages/backend/scripts/stage2/payroll-summary.ts [--month 2026-09] [--org <id>] [dataDir]
 */
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { Decimal, ZERO } from '../../src/shared/money';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const mIdx = args.indexOf('--month');
const month = mIdx >= 0 ? (args[mIdx + 1] as string) : '2026-09';
const dataDirArg = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--month')[0];
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), ZERO);

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const zero = (await f.modules.labels.index()).ownLabels().find((l) => l.name === '0to8');
  if (!zero) throw new Error('no own label named 0to8');
  const rec = (await f.reconciliation({ from: month, to: month })).filter((r) => r.source === 'believe');
  for (const r of rec) {
    console.log(`reconciliation ${r.account} ${r.month}: A ${r.A_received.toFixed(2)} = B ${r.B_notOurs.toFixed(2)} + C ${r.C_waiting.toFixed(2)} + ours ${r.ourShare.toFixed(2)} (no split ${r.ourShareNoSplit.toFixed(2)}); discrepancy ${r.discrepancy.toFixed()}`);
    for (const [k, v] of Object.entries(r.C_breakdown)) console.log(`  C ${k}: ${(v as Decimal).toFixed(2)}`);
  }
  const t0 = performance.now();
  const p = await f.payroll(zero.id, { asOf: month, area: 'master' });
  const totals = p.rows.filter((r) => r.rowKind === 'total');
  console.log(`payroll 0to8 asOf ${month} master: ${Math.round(performance.now() - t0)} ms; owners ${totals.length}; Σ payable ${p.totals.payable.toFixed(2)}, Σ payableShown ${p.totals.payableShown.toFixed(2)}; bookB ${p.totals.bookB.toFixed(2)} = reconciliationB ${p.totals.reconciliationB.toFixed(2)} ${p.totals.bookBMatches}`);
  const gates = new Map<string, { n: number; sum: Decimal }>();
  for (const r of totals) {
    const key = r.gate?.allowed ? 'allowed' : (r.gate?.reason ?? '?');
    const g = gates.get(key) ?? { n: 0, sum: ZERO };
    g.n++;
    g.sum = g.sum.add(r.payable ?? ZERO);
    gates.set(key, g);
  }
  for (const [k, g] of [...gates].sort((a, b) => b[1].n - a[1].n)) console.log(`  gate ${k}: ${g.n} owners, Σ payable ${g.sum.toFixed(2)}`);
  const positive = totals.filter((r) => (r.payable ?? ZERO).gt(0));
  const negative = totals.filter((r) => (r.payable ?? ZERO).lt(0));
  console.log(`  positive ${positive.length} (Σ ${sum(positive.map((r) => r.payable as Decimal)).toFixed(2)}), negative ${negative.length} (Σ ${sum(negative.map((r) => r.payable as Decimal)).toFixed(2)}), start Σ ${sum(totals.map((r) => r.start)).toFixed(2)}, earned Σ ${sum(totals.map((r) => r.earned)).toFixed(2)}`);
  console.log('  largest payables:');
  for (const r of [...positive].sort((a, b) => (b.payable as Decimal).cmp(a.payable as Decimal)).slice(0, 12))
    console.log(`    ${r.ownerName.slice(0, 30).padEnd(30)} payable ${(r.payable as Decimal).toFixed(2).padStart(12)} start ${r.start.toFixed(2).padStart(12)} earned ${r.earned.toFixed(2).padStart(10)} gate ${r.gate?.allowed ? 'ok' : r.gate?.reason}`);
  console.log(`  waiting rows ${p.waiting.length}: Σ ${sum(p.waiting.map((w) => w.amount)).toFixed(2)}; buyouts ${p.buyouts.length}`);
} finally {
  await stack.close();
}
