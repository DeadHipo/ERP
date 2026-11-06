/**
 * D-169: marks the label of the data loaded before a file or a statement was loaded under a label, so that the books
 * of the labels (R6: the book of a unit is the label of its file) cover the history. One step per kind of record:
 *
 *   files       every Believe file without a label → the own label its account is registered under (`label_accounts`),
 *               through `sources.assignFileLabel` (only `WHERE label_id IS NULL`: a label is never changed). An
 *               unregistered account is printed and stops the step (register it on the label page, then rerun).
 *   statements  (D-169 commit 5) every B17 statement → 0to8.
 *   ads         (D-169 commit 3, R9) every active advertising record with an ISRC and without a label → 0to8 (the
 *               payer of the history), through `ads.assignLabel` (only `WHERE label_id IS NULL`). The dry run prints the
 *               disputable records: those whose ISRC income at the month of the expense sits in another book (from one
 *               full calculation, `AdResult.incomeBookLabelId`); after `--apply` they are the signal `adOutsideBook`.
 *               A record without an ISRC and without a label is printed and stops the step.
 *   operations-echo8 (D-169 commit 3) the active migrated operations under Echo8 → 0to8 through
 *               `facade.setOperationLabel` (D-168 marked 7 of them by the label string; by R6 Main 0to8 paid them).
 *               Another count than 7 is printed and stops the step unless `--force`.
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
import { calculate } from '../src/facade/calculation';
import { centsToDecimal, ZERO, type Decimal } from '../src/shared/money';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const force = args.includes('--force');
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

/** The own label named `name`, or a stop. */
async function ownLabel(f: Facade, name: string): Promise<string | undefined> {
  const l = (await f.modules.labels.listLabels()).find((x) => x.kind === 'own' && x.name === name);
  if (!l) console.log(`  stop: no own label named ${name}`);
  return l?.id;
}

/** Every active advertising record with an ISRC and without a label → 0to8, the payer of the history (R9). */
const ads: Step = async (f) => {
  const zero = await ownLabel(f, '0to8');
  if (!zero) return false;
  const all = await f.modules.ads.list({ active: true });
  const todo = all.filter((r) => r.labelId === null && r.isrc !== null);
  const orphans = all.filter((r) => r.labelId === null && r.isrc === null);
  console.log(`step ads: ${all.length} active records`);
  console.log(`  already_done: ${all.length - todo.length - orphans.length}`);
  console.log(`  → 0to8: ${todo.length} (Σ ${todo.reduce((s, r) => s.add(centsToDecimal(r.amountCents)), ZERO).toFixed(2)})`);
  if (orphans.length > 0) {
    for (const r of orphans) console.log(`  without an ISRC and a label: ${r.id} ${r.month} ${centsToDecimal(r.amountCents).toFixed(2)}`);
    console.log('  stop: set the payer of these records (PATCH /ads/:id), then rerun');
    return false;
  }
  // the income book of every record from one full calculation (it does not depend on the payer)
  const calc = await calculate({ ...f.modules, db: stack.db });
  const byId = new Map(calc.ads.map((r) => [r.adId, r]));
  const nameOf = (id: string | null) => (id === null ? '?' : (calc.labelName(id) ?? id));
  const disputable: { id: string; isrc: string; month: string; amount: Decimal; book: string }[] = [];
  const books = new Map<string, { n: number; sum: Decimal }>();
  for (const r of todo) {
    const book = byId.get(r.id)?.incomeBookLabelId ?? null;
    const k = book === null ? '? (no unit, or files without a label)' : nameOf(book);
    const cur = books.get(k) ?? { n: 0, sum: ZERO };
    books.set(k, { n: cur.n + 1, sum: cur.sum.add(centsToDecimal(r.amountCents)) });
    if (book !== null && book !== zero)
      disputable.push({ id: r.id, isrc: r.isrc as string, month: r.month, amount: centsToDecimal(r.amountCents), book: nameOf(book) });
  }
  for (const [k, v] of [...books.entries()].sort()) console.log(`  income book ${k}: ${v.n} records, Σ ${v.sum.toFixed(2)}`);
  disputable.sort((a, b) => a.month.localeCompare(b.month) || a.isrc.localeCompare(b.isrc) || a.id.localeCompare(b.id));
  console.log(`  disputable (the income book is not 0to8): ${disputable.length}, Σ ${disputable.reduce((s, d) => s.add(d.amount), ZERO).toFixed(2)}`);
  for (const d of disputable) console.log(`    ${d.id} ${d.isrc} ${d.month} ${d.amount.toFixed(2)} ${d.book}`);
  if (!apply) return true;
  let n = 0;
  for (const r of todo) if (await f.modules.ads.assignLabel(r.id, zero)) n += 1;
  console.log(`  applied ${n} labels`);
  return true;
};

const EXPECTED_ECHO8_OPERATIONS = 7;

/** The active migrated operations under Echo8 → 0to8: by R6 Main 0to8 paid them (D-168 marked them by the string). */
const operationsEcho8: Step = async (f) => {
  const zero = await ownLabel(f, '0to8');
  const echo = await ownLabel(f, 'Echo8');
  if (!zero || !echo) return false;
  const ops = (await f.modules.settlements.listOperations({ labelId: echo, active: true })).filter((o) => o.migration);
  console.log(`step operations-echo8: ${ops.length} active migrated operations under Echo8 → 0to8`);
  const meanings = new Map<string, number>();
  for (const o of ops) meanings.set(o.meaning, (meanings.get(o.meaning) ?? 0) + 1);
  for (const [k, v] of [...meanings.entries()].sort()) console.log(`  ${k}: ${v}`);
  console.log(`  Σ ${ops.reduce((s, o) => s.add(centsToDecimal(o.amountCents)), ZERO).toFixed(2)}`);
  if (ops.length === 0) {
    console.log('  already_done');
    return true;
  }
  if (ops.length !== EXPECTED_ECHO8_OPERATIONS && !force) {
    console.log(`  stop: expected ${EXPECTED_ECHO8_OPERATIONS}; check the list, then rerun with --force`);
    return false;
  }
  if (!apply) return true;
  for (const o of ops) await f.setOperationLabel(o.id, zero);
  console.log(`  applied ${ops.length} labels`);
  return true;
};

// The step `statements` comes with D-169 commit 5; it goes between `files` and `ads`.
const STEPS: [string, Step][] = [
  ['files', files],
  ['ads', ads],
  ['operations-echo8', operationsEcho8],
];

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
