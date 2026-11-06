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
 *   npx tsx packages/backend/scripts/assign-operation-labels.ts [dataDir] --mark-source [--apply] [--force]
 *
 * Dry run by default: prints the counters and changes nothing. `--apply` writes through the settlements module
 * (`setLabel` with the label source of the decision: `one`, `default` for mixed / no units, `payout` for a return),
 * without an audit row (a migration script, like D-131's).
 *
 * `--mark-source` (D-173): for every active operation repeats the same decision on the same units; when it gives the
 * operation's current label the source is `one` / `default` (mixed, none) / `payout`, else `operator` (the operator
 * changed it). The 7 operations of the step `operations-echo8` of `assign-label-books.ts` (the owner's decision of
 * 2026-11-05, written without an audit row) get `operator` and are printed on a line of their own. The real data are
 * expected to give `default` = 1 315 (D-168); another count stops the step unless `--force`. `--apply` writes only
 * the sources that differ (idempotent: a second run changes nothing). Needs the stack of `.env` (docker compose up -d).
 */
import { join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectOrg, takeOrgArgument } from '../src/connect-sources';
import { monthStart } from '../src/shared/dates';
import type { LabelSource } from '../src/modules/settlements';

// the organization (D-170): --org <id> anywhere on the line, else ERP_ORG / ERP_DEFAULT_ORG
const ORG = takeOrgArgument();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const markSource = args.includes('--mark-source');
const force = args.includes('--force');
/** D-168: the history put under 0to8 by default (mixed 1 152 + 68 + 35, no units 48 + 12). */
const EXPECTED_DEFAULT = 1315;
const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'data'));
const stack = await connectOrg({ dataDir: dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 10000, sources: stack.sources });

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

  const all = await settlements.allOperations();
  // the kinds of the history (D-173 K1): the five derived kinds only, no buyout
  const kinds = new Map<string, number>();
  for (const o of all) kinds.set(o.kind, (kinds.get(o.kind) ?? 0) + 1);
  console.log(`kinds: ${[...kinds.entries()].sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
  const ops = all.filter((o) => o.active && (markSource || o.labelId === null));
  console.log(markSource ? `${ops.length} active operations` : `${ops.length} active operations without a label`);
  const decided = new Map<string, { labelId: string; why: Why }>();
  type Why = 'one' | 'mixed' | 'none' | 'payout';
  const sourceOf = (why: Why): LabelSource => (why === 'one' ? 'one' : why === 'payout' ? 'payout' : 'default');
  const counters = new Map<string, Record<Why, number>>();
  const count = (kind: string, k: Why) => {
    const c = counters.get(kind) ?? { one: 0, mixed: 0, none: 0, payout: 0 };
    c[k] += 1;
    counters.set(kind, c);
  };
  const byLabel = new Map<string, number>();
  const decide = (o: (typeof ops)[number]): { labelId: string; why: Why } => {
    if (o.kind === 'return') {
      // a return follows its payout; a return whose payout is unknown goes to the default too
      const ref = o.operationRef
        ? (decided.get(o.operationRef)?.labelId ?? all.find((x) => x.id === o.operationRef)?.labelId ?? null)
        : null;
      return ref ? { labelId: ref, why: 'payout' } : { labelId: zero, why: 'none' };
    }
    const set = o.kind === 'payout' ? ownerLabels.get(o.ownerId ?? '') : artistLabels.get(canon(o.artistId ?? ''));
    if (set && set.size === 1) return { labelId: [...set][0] as string, why: 'one' };
    // the owner's decision of 2026-11-05: the undecidable history is 0to8 (mixed: both labels; none: no units)
    return { labelId: zero, why: set && set.size > 1 ? 'mixed' : 'none' };
  };
  // payouts first: a return follows its payout
  const ordered = [...ops.filter((o) => o.kind !== 'return'), ...ops.filter((o) => o.kind === 'return')];
  for (const o of ordered) {
    const d = decide(o);
    decided.set(o.id, d);
    count(o.kind, d.why);
    byLabel.set(d.labelId, (byLabel.get(d.labelId) ?? 0) + 1);
  }
  for (const [kind, c] of [...counters.entries()].sort())
    console.log(`  ${kind}: by its one label ${c.one}, mixed → 0to8 ${c.mixed}, no units → 0to8 ${c.none}${c.payout ? `, by its payout ${c.payout}` : ''}`);
  for (const [id, n] of byLabel) console.log(`  → ${names.get(id) ?? id}: ${n}`);

  if (!markSource) {
    console.log(`to assign: ${decided.size}; left without a label: ${ops.length - decided.size}`);
    if (apply) {
      let n = 0;
      for (const [id, d] of decided) {
        await settlements.setLabel(id, d.labelId, sourceOf(d.why));
        if (++n % 500 === 0) console.log(`  applied ${n}/${decided.size}`);
      }
      console.log(`applied ${n} labels`);
    } else console.log('dry run: nothing changed (add --apply)');
  } else {
    // D-173: who set the label of every active operation
    const echo = labelIndex.ownLabels().find((l) => l.name === 'Echo8')?.id;
    const source = new Map<string, LabelSource>();
    const bySource = new Map<string, number>();
    let ownerDecision = 0;
    for (const o of ops) {
      const d = decided.get(o.id) as { labelId: string; why: Why };
      const s: LabelSource = d.labelId === o.labelId ? sourceOf(d.why) : 'operator';
      // the step operations-echo8 (assign-label-books.ts): decided Echo8 by its one label, moved to 0to8 by the owner
      if (s === 'operator' && o.migration && d.why === 'one' && d.labelId === echo && o.labelId === zero) ownerDecision += 1;
      source.set(o.id, s);
      bySource.set(s, (bySource.get(s) ?? 0) + 1);
    }
    for (const s of ['one', 'default', 'payout', 'operator'] as const) console.log(`  source ${s}: ${bySource.get(s) ?? 0}`);
    console.log(`    of them by the owner's decision of 2026-11-05 (operations-echo8, Echo8 → 0to8): ${ownerDecision}`);
    const changes = ops.filter((o) => o.labelSource !== source.get(o.id));
    console.log(`  to change: ${changes.length}; already marked: ${ops.length - changes.length}`);
    const defaults = bySource.get('default') ?? 0;
    if (defaults !== EXPECTED_DEFAULT && !force) {
      console.log(`  stop: expected default = ${EXPECTED_DEFAULT} (D-168), got ${defaults}; check the counters, then rerun with --force`);
      process.exitCode = 1;
    } else if (apply) {
      let n = 0;
      for (const o of changes) {
        await settlements.setLabelSource(o.id, source.get(o.id) as LabelSource);
        if (++n % 500 === 0) console.log(`  applied ${n}/${changes.length}`);
      }
      console.log(`applied ${n} label sources`);
    } else console.log('dry run: nothing changed (add --apply)');
  }
} finally {
  await stack.close();
}
