/**
 * D-168 check on real data: for every owner the books of the labels, «without a label» included, add up to the full
 * balance field by field (the artist rows too); the view under a label through the facade equals the book of the full
 * balance; and the balance with the labels of the operations stripped equals the balance with them (no label changes
 * the money of a real owner: the marking script labels only operations whose income is under one label). Also the
 * reconciliation rows: Σ books = the row. Prints the owners that differ (none expected) and the times.
 *
 *   npx tsx packages/backend/scripts/check-label-books.ts [dataDir] [limit]
 *
 * Read-only. Needs the stack of `.env` (docker compose up -d).
 */
import { join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectSources } from '../src/connect-sources';
import { calculate, reconcile } from '../src/facade/calculation';
import { ownerBalance, ownerIndex } from '../src/facade/balance';
import { ZERO, type Decimal } from '../src/shared/money';

const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(process.argv[2] ?? join(root, 'data'));
const limit = Number(process.argv[3] ?? 0);
const stack = connectSources(join(dataDir, 'files', 'sources'));
const f = openFacade({ db: stack.db, dataDir, payoutThresholdCents: 10000, sources: stack.sources });

const text = (x: unknown) => JSON.stringify(x, (k, v: unknown) => (k === 'calculatedAt' ? undefined : v));
const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), ZERO).toFixed();
const FIELDS = ['earned', 'waiting', 'recouped', 'adsCharged', 'paid', 'returns', 'credits', 'payable'] as const;
const ROW = ['earned', 'waiting', 'recouped', 'unrecouped', 'recoupedFromMaster'] as const;

try {
  const { owners: ownersModule, settlements } = f.modules;
  const modules = { ...f.modules, db: stack.db };
  const owners = await ownersModule.listOwners();
  const list = limit > 0 ? owners.slice(0, limit) : owners;
  console.log(`${list.length} owners of ${owners.length}`);
  const docIds = (await settlements.allOperations()).flatMap((o) => [o.documentId, o.paymentProofId].filter((x): x is string => !!x));
  const t0 = performance.now();
  const full = await calculate(modules, docIds);
  console.log(`full calculation: ${((performance.now() - t0) / 1000).toFixed(1)} s, ${full.units.length} units`);
  const rows = reconcile(full);
  let badRows = 0;
  for (const r of rows) {
    const books = Object.values(r.byLabel);
    if (
      sum(books.map((b) => b.A_received)) !== r.A_received.toFixed() ||
      sum(books.map((b) => b.B_notOurs)) !== r.B_notOurs.toFixed() ||
      sum(books.map((b) => b.C_waiting)) !== r.C_waiting.toFixed() ||
      sum(books.map((b) => b.ourShare)) !== r.ourShare.toFixed()
    )
      badRows += 1;
  }
  console.log(`reconciliation rows: ${rows.length}, Σ books ≠ row: ${badRows}`);
  const index = ownerIndex(full);
  const allOps = await settlements.listOperations({});
  const opsOf = new Map<string, typeof allOps>();
  for (const o of allOps) if (o.ownerId) opsOf.set(o.ownerId, [...(opsOf.get(o.ownerId) ?? []), o]);
  const differing: string[] = [];
  let withBooks = 0;
  let labelled = 0;
  let viewMs = 0;
  let views = 0;
  const t1 = performance.now();
  for (const [n, o] of list.entries()) {
    const ops = opsOf.get(o.id) ?? [];
    const idx = index.get(o.id) ?? { units: [], publishing: [] };
    const b = ownerBalance(full, o.id, ops, {}, idx);
    const books = Object.values(b.byLabel);
    if (books.length > 1) withBooks += 1;
    for (const k of FIELDS)
      if (sum(books.map((x) => x[k])) !== b.total[k].toFixed()) differing.push(`${o.id}: Σ books ${k} ${sum(books.map((x) => x[k]))} ≠ total ${b.total[k].toFixed()}`);
    for (const a of b.artists) {
      const rs = Object.values(a.byLabel);
      for (const k of ROW) if (sum(rs.map((x) => x[k])) !== a[k].toFixed()) differing.push(`${o.id} ${a.artistId}: Σ books ${k} ≠ row`);
    }
    // the labels of the operations change nothing for a real owner (the marking labels single-label income only)
    if (ops.some((x) => x.labelId !== null)) {
      labelled += 1;
      const stripped = ownerBalance(full, o.id, ops.map((x) => ({ ...x, labelId: null })), {}, idx);
      if (text(stripped.total) !== text(b.total)) differing.push(`${o.id}: the labels of the operations change the total (${stripped.total.payable.toFixed()} → ${b.total.payable.toFixed()})`);
    }
    // the view through the facade (by reach) = the book of the full balance, for the first owners
    if (n < 20) {
      for (const [name, book] of Object.entries(b.byLabel)) {
        if (!book.labelId) continue;
        const t2 = performance.now();
        const v = await f.ownerBalance(o.id, {}, book.labelId);
        viewMs += performance.now() - t2;
        views += 1;
        const pick = (x: typeof v.total) => FIELDS.map((k) => x[k].toFixed());
        if (text(pick(v.total)) !== text(pick(book)) || Object.keys(v.byLabel).join() !== name)
          differing.push(`${o.id}: the view under ${name} differs from the book`);
      }
    }
    if ((n + 1) % 100 === 0 || n + 1 === list.length)
      console.log(`${n + 1}/${list.length}: differing ${differing.length}, owners with several books ${withBooks}, with labelled operations ${labelled}; ${((performance.now() - t1) / (n + 1)).toFixed(0)} ms per owner`);
  }
  if (views) console.log(`${views} views through the facade: ${(viewMs / views / 1000).toFixed(2)} s each`);
  for (const d of differing) console.log(`  differs: ${d}`);
  console.log(`differing: ${differing.length}`);
  process.exitCode = differing.length === 0 && badRows === 0 ? 0 : 1;
} finally {
  await stack.close();
}
