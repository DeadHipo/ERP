/**
 * D-168: marks the existing operations with the own label they belong to. For a payout: the labels of the owner's units
 * (the units of every ISRC its pseudonyms have a split row or a participation on); for an advance, a deduction or a
 * credit: the labels of the pseudonym's units. When exactly one own label carries them, it is set. When none (no units)
 * or both (a mixed owner or pseudonym: the history before the split) the operation goes to 0to8 by the product owner's
 * decision of 2026-11-05 («по выплатам, давай пока укажем что это 0to8 был»), counted apart so he can revisit them; only
 * an owner or pseudonym whose units are exclusively Echo8 gets Echo8. A return takes the label of its payout. After
 * `--apply` no operation stays without a label; the NULL handling and the signal `operationsWithoutLabel` stay in the
 * code for an operation a future import could leave without one, and every label is editable through
 * PATCH /settlements/operations/:id.
 *
 *   npx tsx packages/backend/scripts/assign-operation-labels.ts [dataDir] [--apply]
 *
 * Dry run by default: prints the counters and changes nothing. `--apply` writes through the facade (`setOperationLabel`,
 * the same check as PATCH /settlements/operations/:id), without an audit row (a migration script, like D-131's).
 * Needs the stack of `.env` (docker compose up -d).
 */
import { join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectSources } from '../src/connect-sources';
import { monthStart } from '../src/shared/dates';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'data'));
const stack = connectSources(join(dataDir, 'files', 'sources'));
const f = openFacade({ db: stack.db, dataDir, payoutThresholdCents: 10000, sources: stack.sources });

try {
  const { owners, splits, labels, sources, settlements } = f.modules;
  const t0 = performance.now();
  const labelIndex = await labels.index();
  const names = new Map(labelIndex.ownLabels().map((l) => [l.id, l.name]));
  const zero = labelIndex.ownLabels().find((l) => l.name === '0to8')?.id;
  if (!zero) throw new Error('no own label named 0to8: the default of the history needs it');
  // the own labels of every ISRC, from the label string of every unit
  const isrcLabels = new Map<string, Set<string>>();
  const { units } = await sources.snapshot();
  for (const u of units) {
    const l = labelIndex.labelOf(u.labelName, monthStart(u.reportingMonth));
    const own = l ? (l.kind === 'own' ? l.id : l.ownLabelId) : null;
    if (!own || !u.isrc) continue;
    let set = isrcLabels.get(u.isrc);
    if (!set) isrcLabels.set(u.isrc, (set = new Set()));
    set.add(own);
  }
  console.log(`${units.length} units, ${isrcLabels.size} ISRCs with a label, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  // the labels of every pseudonym (every id it had) and of every owner
  const idx = await owners.artistIndex();
  const canon = (id: string) => idx.get(id)?.id ?? id;
  const artistLabels = new Map<string, Set<string>>();
  const add = (artistId: string, isrc: string) => {
    const a = canon(artistId);
    let set = artistLabels.get(a);
    if (!set) artistLabels.set(a, (set = new Set()));
    for (const l of isrcLabels.get(isrc) ?? []) set.add(l);
  };
  for (const s of await splits.listSplits()) for (const sh of s.shares) add(sh.artistId, s.isrc);
  for (const p of await splits.listParticipations()) {
    add(p.artistId, p.isrc);
    if (p.fromArtistId) add(p.fromArtistId, p.isrc);
  }
  const ownerLabels = new Map<string, Set<string>>();
  for (const [id, a] of idx) {
    if (id !== a.id || !a.ownerId) continue;
    let set = ownerLabels.get(a.ownerId);
    if (!set) ownerLabels.set(a.ownerId, (set = new Set()));
    for (const l of artistLabels.get(a.id) ?? []) set.add(l);
  }

  const ops = (await settlements.allOperations()).filter((o) => o.active && o.labelId === null);
  console.log(`${ops.length} active operations without a label`);
  const decided = new Map<string, string>();
  type Why = 'one' | 'mixed' | 'none' | 'payout';
  const counters = new Map<string, Record<Why, number>>();
  const count = (meaning: string, k: Why) => {
    const c = counters.get(meaning) ?? { one: 0, mixed: 0, none: 0, payout: 0 };
    c[k] += 1;
    counters.set(meaning, c);
  };
  const byLabel = new Map<string, number>();
  const decide = (o: (typeof ops)[number]): { labelId: string; why: Why } => {
    if (o.meaning === 'return') {
      // a return follows its payout; a return whose payout is unknown goes to the default too
      const ref = o.operationRef ? (decided.get(o.operationRef) ?? ops.find((x) => x.id === o.operationRef)?.labelId ?? null) : null;
      return ref ? { labelId: ref, why: 'payout' } : { labelId: zero, why: 'none' };
    }
    const set = o.meaning === 'payout' ? ownerLabels.get(o.ownerId ?? '') : artistLabels.get(canon(o.artistId ?? ''));
    if (set && set.size === 1) return { labelId: [...set][0] as string, why: 'one' };
    // the owner's decision of 2026-11-05: the undecidable history is 0to8 (mixed: both labels; none: no units)
    return { labelId: zero, why: set && set.size > 1 ? 'mixed' : 'none' };
  };
  // payouts first: a return follows its payout
  const ordered = [...ops.filter((o) => o.meaning !== 'return'), ...ops.filter((o) => o.meaning === 'return')];
  for (const o of ordered) {
    const { labelId, why } = decide(o);
    decided.set(o.id, labelId);
    count(o.meaning, why);
    byLabel.set(labelId, (byLabel.get(labelId) ?? 0) + 1);
  }
  for (const [meaning, c] of [...counters.entries()].sort())
    console.log(`  ${meaning}: by its one label ${c.one}, mixed → 0to8 ${c.mixed}, no units → 0to8 ${c.none}${c.payout ? `, by its payout ${c.payout}` : ''}`);
  for (const [id, n] of byLabel) console.log(`  → ${names.get(id) ?? id}: ${n}`);
  console.log(`to assign: ${decided.size}; left without a label: ${ops.length - decided.size}`);
  if (apply) {
    let n = 0;
    for (const [id, labelId] of decided) {
      await f.setOperationLabel(id, labelId);
      if (++n % 500 === 0) console.log(`  applied ${n}/${decided.size}`);
    }
    console.log(`applied ${n} labels`);
  } else console.log('dry run: nothing changed (add --apply)');
} finally {
  await stack.close();
}
