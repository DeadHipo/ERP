/**
 * D-174: proves the start on the live data. One calculation (`ownerPayables` under the own label `0to8` at
 * `asOf = <cutoff>`): for every owner that has active opening balance rows, the payable of the book at the cut must be
 * exactly the sum of its rows (the cut removed everything else of the book: units, publishing, advertising, operations),
 * and an owner with a missing row is `start_missing`. Prints the counts and every owner that differs.
 *
 *   npx tsx packages/backend/scripts/start/check-start.ts [--cutoff 2026-08] [--org <id>] [dataDir]
 */
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { centsToDecimal, Decimal, ZERO } from '../../src/shared/money';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const cutoffIdx = args.indexOf('--cutoff');
const cutoff = cutoffIdx >= 0 ? (args[cutoffIdx + 1] as string) : '2026-08';
const dataDirArg = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--cutoff')[0];
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const zero = (await f.modules.labels.index()).ownLabels().find((l) => l.name === '0to8');
  if (!zero) throw new Error('no own label named 0to8');
  const list = await f.listStart({ labelId: zero.id });
  const expected = new Map<string, { sum: Decimal; missing: boolean; rows: number }>();
  for (const r of list.rows) {
    if (!r.active || r.cutoffMonth !== cutoff || !r.ownerId) continue;
    const e = expected.get(r.ownerId) ?? { sum: ZERO, missing: false, rows: 0 };
    e.sum = e.sum.add(centsToDecimal(r.masterCents)).add(centsToDecimal(r.publishingCents));
    e.missing = e.missing || r.missing;
    e.rows++;
    expected.set(r.ownerId, e);
  }
  console.log(`owners with start rows at ${cutoff}: ${expected.size} (rows ${list.totals.starts + list.totals.adjustments}, missing ${list.totals.missing})`);
  const t0 = performance.now();
  const payables = await f.ownerPayables({ label: zero.id, asOf: cutoff });
  console.log(`one calculation of ${payables.items.length} owners: ${Math.round(performance.now() - t0)} ms`);
  let equal = 0;
  let missing = 0;
  const differ: string[] = [];
  for (const item of payables.items) {
    const e = expected.get(item.ownerId);
    if (!e) continue;
    if (e.missing) {
      if (item.payout.reason === 'start_missing' || !item.payout.allowed) missing++;
      else differ.push(`${item.name}: missing start but the gate says ${item.payout.reason ?? 'allowed'}`);
      continue;
    }
    if (item.payable.eq(e.sum) && item.start !== undefined && item.start.eq(e.sum)) equal++;
    else differ.push(`${item.name}: payable ${item.payable.toFixed()} start ${item.start?.toFixed() ?? '?'} expected ${e.sum.toFixed()} (earned ${item.earned.toFixed()}, paid ${item.paid.toFixed()})`);
  }
  console.log(`equal to the cabinet: ${equal}; missing (gate closed): ${missing}; differ: ${differ.length}`);
  for (const d of differ.slice(0, 50)) console.log(`  ${d}`);
  process.exitCode = differ.length === 0 ? 0 : 1;
} finally {
  await stack.close();
}
