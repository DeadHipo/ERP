/**
 * D-168 check on real data: for every owner the books of the labels, «without a label» included, add up to the full
 * balance field by field (the artist rows too); the view under a label through the facade equals the book of the full
 * balance; and how many owners' totals the labels of the operations change (an advance under a label is recouped from
 * that label's income only: after the owner's decision to mark the history as 0to8 a mixed owner's advance no longer
 * takes Echo8 income, so this is a count to report, not a failure). Also the reconciliation rows: Σ books = the row.
 * Prints the owners that differ (none expected) and the times.
 *
 * D-169 (the book of a unit is the label of its file): (а) every loaded Believe file carries the label its account is
 * registered under; (б) every Believe reconciliation row has exactly one named book; (в) the books of the owner and
 * the pseudonym given by id (`--owner <id>`, `--artist <id>`; ids and numbers only); (д) the number of owners with a
 * non-empty book '?' (0 expected once the files and the statements are marked by `assign-label-books`); (е)
 * `--dump <file>` writes every owner's total payable (id → payable), `--compare <file>` prints the owners whose payable
 * differs from such a dump (ids and Δ only); (ж) the residual leak В1 (D-169): the recoupments of a position under a
 * label L that took publishing income of another book (`layers/recoup.ts` checks the label only for master income),
 * count and Σ — counted, not fixed (Open В1).
 *
 *   npx tsx packages/backend/scripts/check-label-books.ts [dataDir] [limit] [--owner <id>] [--artist <id>]
 *     [--dump <file> | --compare <file>]
 *
 * Read-only. Needs the stack of `.env` (docker compose up -d).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectOrg, takeOrgArgument } from '../src/connect-sources';
import { calculate, reconcile } from '../src/facade/calculation';
import { ownerBalance, ownerIndex } from '../src/facade/balance';
import { Decimal, ZERO } from '../src/shared/money';

// the organization (D-170): --org <id> anywhere on the line, else ERP_ORG / ERP_DEFAULT_ORG
const ORG = takeOrgArgument();

const root = resolve(import.meta.dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const VALUED = ['--owner', '--artist', '--dump', '--compare'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(argv[i - 1] as string)));
const dataDir = resolve(positional[0] ?? join(root, 'data'));
const limit = Number(positional[1] ?? 0);
const askedOwner = flag('--owner');
const askedArtist = flag('--artist');
const dumpTo = flag('--dump');
const compareWith = flag('--compare');
const stack = await connectOrg({ dataDir: dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 10000, sources: stack.sources });

const text = (x: unknown) => JSON.stringify(x, (k, v: unknown) => (k === 'calculatedAt' ? undefined : v));
const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), ZERO).toFixed();
const FIELDS = ['earned', 'waiting', 'recouped', 'adsCharged', 'paid', 'returns', 'credits', 'payable'] as const;
const ROW = ['earned', 'waiting', 'recouped', 'unrecouped', 'recoupedFromMaster'] as const;

try {
  const { owners: ownersModule, settlements, sources, labels } = f.modules;
  // (а) the label of every loaded Believe file = the label of its account (D-169)
  const labelIndex = await labels.index();
  let fileMismatch = 0;
  const loadedFiles = (await sources.listFiles()).filter((x) => x.source === 'believe' && x.status === 'loaded');
  for (const file of loadedFiles) {
    const account = labelIndex.labelOfAccount(file.account);
    if (file.labelId === null || account === undefined || file.labelId !== account) {
      fileMismatch += 1;
      console.log(`  (а) file ${file.id} ${file.account} ${file.reportingMonth}: label ${file.labelId ?? 'none'}, account ${account ?? 'unregistered'}`);
    }
  }
  console.log(`(а) loaded Believe files: ${loadedFiles.length}, label ≠ the label of the account: ${fileMismatch}`);
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
  // (б) a Believe row is the book of its files' label: exactly one named key
  const notOneBook = rows.filter((r) => r.source === 'believe' && (Object.keys(r.byLabel).length !== 1 || '?' in r.byLabel));
  for (const r of notOneBook) console.log(`  (б) ${r.account} ${r.month}: books ${Object.keys(r.byLabel).join(', ')}`);
  console.log(`(б) Believe rows: ${rows.filter((r) => r.source === 'believe').length}, without exactly one named book: ${notOneBook.length}`);
  const index = ownerIndex(full);
  const allOps = await settlements.listOperations({});
  const opsOf = new Map<string, typeof allOps>();
  for (const o of allOps) if (o.ownerId) opsOf.set(o.ownerId, [...(opsOf.get(o.ownerId) ?? []), o]);
  const differing: string[] = [];
  let withBooks = 0;
  let labelled = 0;
  const changed: string[] = [];
  let viewMs = 0;
  let views = 0;
  let unlabelledBook = 0;
  // (ж) В1: a position under a label L recouped from publishing income of another book
  let leakCount = 0;
  let leakSum = ZERO;
  const leakOwners = new Set<string>();
  const payables = new Map<string, string>();
  const t1 = performance.now();
  for (const [n, o] of list.entries()) {
    const ops = opsOf.get(o.id) ?? [];
    const idx = index.get(o.id) ?? { units: [], publishing: [] };
    const b = ownerBalance(full, o.id, ops, {}, idx, undefined, (p, item, amount) => {
      if (p.labelId !== null && item.stream === 'publishing' && item.labelId !== p.labelId && !amount.isZero()) {
        leakCount += 1;
        leakSum = leakSum.add(amount);
        leakOwners.add(o.id);
      }
    });
    payables.set(o.id, b.total.payable.toFixed());
    const books = Object.values(b.byLabel);
    if (books.length > 1) withBooks += 1;
    // (д) an owner with money in the book '?' (a file or a statement without a label, an operation without one)
    const q = b.byLabel['?'];
    if (q && FIELDS.some((k) => !q[k].isZero())) unlabelledBook += 1;
    for (const k of FIELDS)
      if (sum(books.map((x) => x[k])) !== b.total[k].toFixed()) differing.push(`${o.id}: Σ books ${k} ${sum(books.map((x) => x[k]))} ≠ total ${b.total[k].toFixed()}`);
    for (const a of b.artists) {
      const rs = Object.values(a.byLabel);
      for (const k of ROW) if (sum(rs.map((x) => x[k])) !== a[k].toFixed()) differing.push(`${o.id} ${a.artistId}: Σ books ${k} ≠ row`);
    }
    // what the labels of the operations change: the owner's totals with them against without them (a report, not a failure)
    if (ops.some((x) => x.labelId !== null)) {
      labelled += 1;
      const stripped = ownerBalance(full, o.id, ops.map((x) => ({ ...x, labelId: null })), {}, idx);
      if (text(stripped.total) !== text(b.total)) changed.push(`${o.id}: payable ${stripped.total.payable.toFixed()} without the labels → ${b.total.payable.toFixed()} with them`);
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
  console.log(`owners whose totals the labels of the operations change: ${changed.length}`);
  for (const c of changed) console.log(`  changed: ${c}`);
  console.log(`(д) owners with a non-empty book '?': ${unlabelledBook}`);
  console.log(`(ж) В1: recoupments of a labelled position from publishing of another book: ${leakCount}, Σ ${leakSum.toFixed()}, owners ${leakOwners.size}`);
  for (const id of [...leakOwners].sort()) console.log(`  (ж) owner ${id}`);
  // (е) the owners whose payable changed against a dump
  if (dumpTo) {
    writeFileSync(dumpTo, JSON.stringify(Object.fromEntries([...payables.entries()].sort()), null, 1));
    console.log(`(е) ${payables.size} payables written to ${dumpTo}`);
  }
  if (compareWith) {
    const before = JSON.parse(readFileSync(compareWith, 'utf8')) as Record<string, string>;
    let n = 0;
    let delta = ZERO;
    for (const id of [...new Set([...Object.keys(before), ...payables.keys()])].sort()) {
      const was = new Decimal(before[id] ?? '0');
      const now = new Decimal(payables.get(id) ?? '0');
      if (was.eq(now)) continue;
      n += 1;
      delta = delta.add(now.sub(was));
      console.log(`  (е) ${id}: Δ payable ${now.sub(was).toFixed()}`);
    }
    console.log(`(е) owners whose payable changed against ${compareWith}: ${n}, Σ Δ ${delta.toFixed()}`);
  }
  // (в) the books of one owner and one pseudonym, by id
  const bookLine = (name: string, x: object) =>
    `  ${name}: ${Object.entries(x)
      .filter(([, v]) => v instanceof Decimal)
      .map(([k, v]) => `${k} ${(v as Decimal).toFixed()}`)
      .join(', ')}`;
  if (askedOwner) {
    const id = await ownersModule.resolveOwnerId(askedOwner);
    const b = ownerBalance(full, id, opsOf.get(id) ?? [], {}, index.get(id) ?? { units: [], publishing: [] });
    console.log(`(в) the books of owner ${id}:`);
    for (const [name, book] of Object.entries(b.byLabel)) console.log(bookLine(name, { ...book }));
  }
  if (askedArtist) {
    const m = await f.artistBalance(askedArtist);
    console.log(`(в) the books of pseudonym ${askedArtist}:`);
    for (const [name, book] of Object.entries(m.byLabel)) console.log(bookLine(name, { ...book }));
  }
  console.log(`differing: ${differing.length}`);
  process.exitCode = differing.length === 0 && badRows === 0 && fileMismatch === 0 && notOneBook.length === 0 ? 0 : 1;
} finally {
  await stack.close();
}
