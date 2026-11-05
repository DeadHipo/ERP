/**
 * D-169: marks the label of the data loaded before a file or a statement was loaded under a label, so that the books
 * of the labels (R6: the book of a unit is the label of its file) cover the history. One step per kind of record:
 *
 *   files       every Believe file without a label → the own label its account is registered under (`label_accounts`),
 *               through `sources.assignFileLabel` (only `WHERE label_id IS NULL`: a label is never changed). An
 *               unregistered account is printed and stops the step (register it on the label page, then rerun).
 *   statements  (D-169 commit 5) every B17 statement → 0to8.
 *   ads         (D-169 commit 3) every active advertising record with an ISRC and without a label → 0to8.
 *   operations-echo8 (D-169 commit 3) the migrated operations under Echo8 → 0to8.
 *
 *   npx tsx packages/backend/scripts/assign-label-books.ts [dataDir] [--apply] [--step <name>]
 *
 * Without `--step` every step that exists runs, in the order above. Dry run by default: prints the counters and changes
 * nothing. Idempotent: a second dry run after `--apply` prints only `already_done`. Writes without an audit row (a
 * migration script, like D-131's). Needs the stack of `.env` (docker compose up -d).
 */
import { join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectSources } from '../src/connect-sources';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const stepAt = args.indexOf('--step');
const only = stepAt >= 0 ? args[stepAt + 1] : undefined;
const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(args.find((a, i) => !a.startsWith('--') && (stepAt < 0 || i !== stepAt + 1)) ?? join(root, 'data'));
const stack = connectSources(join(dataDir, 'files', 'sources'));
const f = openFacade({ db: stack.db, dataDir, payoutThresholdCents: 10000, sources: stack.sources });

type Facade = typeof f;
/** A step returns false when it stopped on a problem the operator must fix first. */
type Step = (f: Facade) => Promise<boolean>;

/** Every Believe file without a label gets the label of its account (R6). */
const files: Step = async (f) => {
  const { sources, labels } = f.modules;
  const index = await labels.index();
  const nameOf = (id: string) => index.labelName(id) ?? id;
  // the loaded files only: a failed or replaced file has no book and may carry an unregistered account
  const all = (await sources.listFiles()).filter((x) => x.source === 'believe' && x.status === 'loaded');
  const counters = new Map<string, number>();
  const count = (k: string) => counters.set(k, (counters.get(k) ?? 0) + 1);
  const todo: { id: string; labelId: string }[] = [];
  const unregistered = new Map<string, number>();
  for (const file of all) {
    const labelId = index.labelOfAccount(file.account);
    if (file.labelId !== null) {
      count('already_done');
      if (labelId !== undefined && labelId !== file.labelId)
        console.log(`  note: file ${file.id} (${file.account} ${file.reportingMonth}) is under ${nameOf(file.labelId)}, its account under ${nameOf(labelId)}`);
      continue;
    }
    if (labelId === undefined) {
      unregistered.set(file.account, (unregistered.get(file.account) ?? 0) + 1);
      continue;
    }
    todo.push({ id: file.id, labelId });
    count(`→ ${nameOf(labelId)}`);
  }
  console.log(`step files: ${all.length} Believe files (${all.filter((x) => x.status === 'loaded').length} loaded)`);
  for (const [k, n] of [...counters.entries()].sort()) console.log(`  ${k}: ${n}`);
  if (unregistered.size > 0) {
    for (const [account, n] of unregistered) console.log(`  unregistered account ${account}: ${n} files without a label`);
    console.log('  stop: register the account under its label (POST /labels/:id/accounts), then rerun');
    return false;
  }
  if (!apply) return true;
  let n = 0;
  for (const t of todo) if (await sources.assignFileLabel(t.id, t.labelId)) n += 1;
  console.log(`  applied ${n} labels`);
  return true;
};

// The steps `statements`, `ads` and `operations-echo8` come with D-169 commits 5 and 3; add them here in this order.
const STEPS: [string, Step][] = [['files', files]];

try {
  if (only !== undefined && !STEPS.some(([name]) => name === only))
    throw new Error(`unknown step "${only}"; the steps: ${STEPS.map(([name]) => name).join(', ')}`);
  let ok = true;
  for (const [name, step] of STEPS) {
    if (only !== undefined && name !== only) continue;
    if (!(await step(f))) ok = false;
  }
  if (!apply) console.log('dry run: nothing changed (add --apply)');
  process.exitCode = ok ? 0 : 1;
} finally {
  await stack.close();
}
