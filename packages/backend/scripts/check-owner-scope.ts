/**
 * D-163 check on real data: for every owner, the balance from the units of the owner's reach equals the balance from
 * the full calculation. One full calculation serves every owner; the reach calculation runs per owner. The facade path
 * (`ownerBalance`, by reach since D-164) is compared with the full balance for the first owners too. Prints the owners
 * that differ (none expected), the reach sizes and the times.
 *
 *   npx tsx packages/backend/scripts/check-owner-scope.ts [dataDir] [limit]
 *
 * Read-only. Needs the stack of `.env` (docker compose up -d).
 */
import { join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectSources } from '../src/connect-sources';
import { calculate } from '../src/facade/calculation';
import { ownerBalance } from '../src/facade/balance';
import { ownerReach } from '../src/facade/owner-scope';
import { scoped } from '../src/facade/scope';

const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(process.argv[2] ?? join(root, 'data'));
const limit = Number(process.argv[3] ?? 0);
const stack = connectSources(join(dataDir, 'files', 'sources'));
const f = openFacade({ db: stack.db, dataDir, payoutThresholdCents: 10000, sources: stack.sources });

const text = (x: unknown) => JSON.stringify(x, (k, v: unknown) => (k === 'calculatedAt' ? undefined : v));

try {
  const { owners: ownersModule, settlements } = f.modules;
  const modules = { ...f.modules, db: stack.db };
  const owners = await ownersModule.listOwners();
  const list = limit > 0 ? owners.slice(0, limit) : owners;
  console.log(`${list.length} owners of ${owners.length}`);
  const docIds = (await settlements.allOperations()).flatMap((o) =>
    [o.documentId, o.paymentProofId].filter((x): x is string => !!x),
  );
  const t0 = performance.now();
  const full = await calculate(modules, docIds);
  console.log(`full calculation: ${((performance.now() - t0) / 1000).toFixed(1)} s, ${full.units.length} units`);
  let equal = 0;
  let reachMs = 0;
  const sizes: number[] = [];
  const differing: string[] = [];
  for (const [n, o] of list.entries()) {
    const ops = await settlements.listOperations({ ownerId: o.id });
    const fullBalance = ownerBalance(full, o.id, ops, {});
    const a = text(fullBalance);
    const t1 = performance.now();
    const reach = await ownerReach(modules, o.id);
    const calc = await calculate(scoped(modules, { isrcs: reach.isrcs }), docIds);
    const b = text(ownerBalance(calc, o.id, ops, {}));
    reachMs += performance.now() - t1;
    sizes.push(reach.isrcs.length);
    if (a === b) equal += 1;
    else differing.push(`${o.id} (reach ${reach.isrcs.length} ISRCs, ${reach.artistIds.length} pseudonyms)`);
    // the facade path, for the first owners: the public method (by reach) gives the balance of the full calculation
    if (n < 5) {
      const viaApi = text((({ owner: _o, payout: _p, ...rest }) => rest)(await f.ownerBalance(o.id)));
      // the answer has no `confirmedAny` (the gate's input only, D-169)
      if (viaApi !== text((({ confirmedAny: _c, ...rest }) => rest)(fullBalance))) differing.push(`${o.id}: ownerBalance (facade, by reach) differs from the full balance`);
    }
    if ((n + 1) % 25 === 0 || n + 1 === list.length)
      console.log(`${n + 1}/${list.length}: equal ${equal}, differing ${differing.length}; by reach ${(reachMs / (n + 1) / 1000).toFixed(2)} s per owner`);
  }
  sizes.sort((x, y) => x - y);
  console.log(`reach ISRCs: min ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}, max ${sizes.at(-1)}; differing owners: ${differing.length}`);
  for (const d of differing) console.log(`  differs: ${d}`);
  process.exitCode = differing.length === 0 ? 0 : 1;
} finally {
  await stack.close();
}
