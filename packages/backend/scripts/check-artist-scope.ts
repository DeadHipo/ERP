/**
 * D-165 check on real data: for every pseudonym (or the first `limit`), the money from the units of the pseudonym's
 * reach equals the money from the full calculation, and its row equals the artist row of its owner's full balance.
 * One full calculation serves every pseudonym; the reach calculation runs per pseudonym. The facade path
 * (`artistBalance`) is compared for the first pseudonyms too. Prints the pseudonyms that differ (none expected), the
 * reach sizes and the times.
 *
 *   npx tsx packages/backend/scripts/check-artist-scope.ts [dataDir] [limit]
 *
 * Read-only. Needs the stack of `.env` (docker compose up -d).
 */
import { join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectSources } from '../src/connect-sources';
import { calculate } from '../src/facade/calculation';
import { artistBalance, ownerBalance } from '../src/facade/balance';
import { artistReach } from '../src/facade/owner-scope';
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
  const index = await ownersModule.artistIndex();
  const artists = [...index.entries()].filter(([id, a]) => id === a.id).map(([, a]) => a);
  const list = limit > 0 ? artists.slice(0, limit) : artists;
  console.log(`${list.length} pseudonyms of ${artists.length}`);
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
  const row = (x: ReturnType<typeof artistBalance>) => [x.period.earned, x.period.waiting, x.total.recouped, x.total.unrecouped, x.total.recoupedFromMaster, x.tracks];
  for (const [n, a] of list.entries()) {
    const ops = a.ownerId ? await settlements.listOperations({ ownerId: a.ownerId }) : [];
    const fromFull = artistBalance(full, a.id, ops, {});
    const t1 = performance.now();
    const reach = await artistReach(modules, a.id);
    const calc = await calculate(scoped(modules, { isrcs: reach.isrcs }), docIds);
    const byReach = artistBalance(calc, a.id, ops, {});
    reachMs += performance.now() - t1;
    sizes.push(reach.isrcs.length);
    let ok = text(fromFull) === text(byReach);
    if (a.ownerId) {
      const ownerRow = ownerBalance(full, a.ownerId, ops, {}).artists.find((x) => x.artistId === a.id);
      const r = ownerRow && row({ period: ownerRow, total: ownerRow, tracks: ownerRow.tracks } as unknown as ReturnType<typeof artistBalance>);
      if (text(r) !== text(row(byReach))) ok = false;
    }
    if (ok) equal += 1;
    else differing.push(`${a.id} (reach ${reach.isrcs.length} ISRCs)`);
    // the facade path, for the first pseudonyms: the public method (by reach) gives the money of the full calculation
    if (n < 5) {
      const viaApi = text((({ artist: _a, owner: _o, ...rest }) => rest)(await f.artistBalance(a.id)));
      if (viaApi !== text(fromFull)) differing.push(`${a.id}: artistBalance (facade, by reach) differs from the full one`);
    }
    if ((n + 1) % 25 === 0 || n + 1 === list.length)
      console.log(`${n + 1}/${list.length}: equal ${equal}, differing ${differing.length}; by reach ${(reachMs / (n + 1) / 1000).toFixed(2)} s per pseudonym`);
  }
  sizes.sort((x, y) => x - y);
  console.log(`reach ISRCs: min ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}, max ${sizes.at(-1)}; differing pseudonyms: ${differing.length}`);
  for (const d of differing) console.log(`  differs: ${d}`);
  process.exitCode = differing.length === 0 ? 0 : 1;
} finally {
  await stack.close();
}
