/**
 * D-249 check on real data: `masterRows` gives, character for character, the money of the answer it replaces
 * (`trackSummary({ label }).items`), and is not slower than it is. The comparison of a release with the old
 * `release()` left with D-257: that answer has no money any more (the release rows are pinned by the fixed numbers of
 * `tests/money-rows.test.ts`).
 *
 * For every own label (a book) and for «all»:
 *  - every ISRC (no list): the rows by ISRC against the items of the old summary, with their months;
 *  - for a book only: the ISRCs of «all» in chunks of 500 (the most the old summary takes, and the way the track page
 *    asks), each chunk under the label against `trackSummary({ isrcs, label }).items`, the totals against them added up;
 *  - the times of the old and of the new answer for «every ISRC» and for one chunk of a book: one warm-up, then five
 *    rounds old / new in turn, the median of each; the threshold is `new ≤ 1.2 × old` or `new − old ≤ 0.3 s`.
 * The comparison rules are those of `tests/money-rows.test.ts` (`scripts/lib/master-rows-compare.ts`).
 *
 *   PGOPTIONS='-c default_transaction_read_only=on' npx tsx packages/backend/scripts/check-master-rows.ts [dataDir]
 *
 * Read-only, and it refuses to start unless the PostgreSQL session is read-only (`PGOPTIONS` reaches node-postgres as
 * the `options` of the startup packet, so every connection of the pool is). The organization is `ERP_DEFAULT_ORG`
 * (no `--org`). The console gets counters, times, sizes and the verdict only: the books are numbered, nothing is
 * named. The keys of the differences (ISRC) and their money go to
 * `<repo>/data/mvp-load/verify/master-rows-<date>.json` and `.md` (git-ignored), without titles and pseudonyms.
 *
 * Every call is a step (`book N | isrc list old`, `all | isrcs new`, `book N | timing isrcs old`, …). A comparison whose
 * call fails is recorded as failed, with the side, and the run goes on: only the class of the error (for ClickHouse its
 * code and exception type) and the step are written, never the message. The log lines of the ClickHouse client are
 * dropped (they may quote a query).
 *
 * Exit code: 0 = no difference and every timing within the threshold; 2 = differences, or a comparison where only the
 * new answer failed; 3 = no difference, a timing outside the threshold; 1 = not proven: it did not run, a slice failed
 * on both sides (or on the old one), a call failed, or there was nothing to compare (no own label, no row under «all»).
 */
import { loadavg } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectStores, resolveOrg, sourcesFor } from '../src/connect-sources';
import type { MasterRow } from '../src/facade/money';
import {
  chunksOf,
  describeError,
  diffPairs,
  diffTotals,
  emptyRunReasons,
  exitCodeOf,
  failedOf,
  median,
  newPairs,
  oldPairs,
  THRESHOLD_MS,
  THRESHOLD_RATIO,
  withinThreshold,
  type Difference,
  type Failed,
} from './lib/master-rows-compare';

const ROUNDS = 5;
/** The most ISRCs the old summary takes in one request (`parseIsrcList`, `aggregates.ts`). */
const LIST_CHUNK = 500;

const root = resolve(import.meta.dirname, '..', '..', '..');
const dataDir = resolve(process.argv[2] ?? join(root, 'data'));

type Facade = ReturnType<typeof openFacade>;
/** A book of the run: `book 1…N` in the order of the label list, or «all» (no label). */
interface Book {
  name: string;
  labelId: string | undefined;
}

/** One comparison: what was compared, how many rows of each side, the differences; or why it could not be made. */
interface Check {
  book: string;
  labelId: string | null;
  scope: 'isrcs' | 'isrc-list';
  /** A list of ISRCs: the number of the chunk (from 1) and how many ISRCs it asks. */
  chunk?: number;
  asked?: number;
  part: 'isrc' | 'totals';
  oldRows: number;
  newRows: number;
  differences: Difference[];
  failed?: Failed;
}

interface Timing {
  book: string;
  labelId: string | null;
  what: 'isrcs' | 'isrc-list';
  chunk?: number;
  asked?: number;
  oldMs: number[];
  newMs: number[];
  oldMedianMs: number;
  newMedianMs: number;
  oldBytes: number;
  newBytes: number;
  within: boolean;
}

/** A call of the run that failed outside a comparison (a timing, the lists of ISRCs). */
interface CallFailure {
  step: string;
  error: string;
}

const isrcOf = (r: MasterRow) => r.isrc as string;
const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
const seconds = (ms: number) => (ms / 1000).toFixed(2);
const load = () => loadavg().map((x) => x.toFixed(2)).join(' ');

/** The current step, `<book> | <call>`: named when an error stops or fails it. No ISRC, no UPC, no name in it. */
let step = 'start';
let bookOfStep = '';
const enter = (call: string) => {
  step = bookOfStep === '' ? call : `${bookOfStep} | ${call}`;
};

/** The class of an error (for ClickHouse: its code and exception type) and the place it was thrown at; never its message. */
function errorText(e: unknown): string {
  const at = e instanceof Error ? (e.stack ?? '').split('\n').find((l) => l.trimStart().startsWith('at ')) : undefined;
  return at ? `${describeError(e)} ${at.trim()}` : describeError(e);
}

/** One call of the facade as a step: its answer, or the text of its error. */
async function attempt<T>(call: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  enter(call);
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

// The ClickHouse client logs a failed query to the console with the text of the server's answer (it may quote the
// query): those lines are dropped for this process and counted.
let clientLogLines = 0;
for (const level of ['error', 'warn', 'info', 'debug'] as const) {
  const write = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('[@clickhouse/client]')) clientLogLines += 1;
    else write(...args);
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; answer: T }> {
  const t = performance.now();
  const answer = await fn();
  return { ms: performance.now() - t, answer };
}

/** Every ISRC of a book (no list) against the old `trackSummary({ label })`. */
async function compareIsrcsWithOld(f: Facade, book: Book): Promise<{ checks: Check[]; isrcs?: string[] }> {
  const base = { book: book.name, labelId: book.labelId ?? null, scope: 'isrcs' as const };
  const old = await attempt('isrcs old', () => f.trackSummary(book.labelId ? { label: book.labelId } : {}));
  const now = await attempt('isrcs new', () => f.masterRows({ scope: { kind: 'isrcs' }, grain: 'isrc' }, book.labelId));
  if (!old.ok || !now.ok) {
    const failed = failedOf(old.ok ? undefined : old.error, now.ok ? undefined : now.error);
    return { checks: [{ ...base, part: 'isrc', oldRows: 0, newRows: 0, differences: [], ...(failed ? { failed } : {}) }] };
  }
  const itemsOld = oldPairs(old.value.items, (i) => i.isrc, (i) => i.months);
  const rowsNew = newPairs(now.value.rows, isrcOf, { months: true });
  const checks: Check[] = [
    { ...base, part: 'isrc', oldRows: itemsOld.length, newRows: rowsNew.length, differences: diffPairs(itemsOld, rowsNew) },
    { ...base, part: 'totals', oldRows: 1, newRows: 1, differences: diffTotals(old.value.items, now.value.totals) },
  ];
  // the keys of the new answer: the list the books are asked by chunks (no other read gives it)
  return { checks, isrcs: now.value.rows.map(isrcOf) };
}

/**
 * The money of a book by lists of ISRCs, the way the track page asks it: the ISRCs of «all» in chunks, each chunk of
 * the new answer against the old `trackSummary({ isrcs, label })`. An ISRC that is not of the book is dropped by both.
 */
async function compareIsrcListsWithOld(f: Facade, book: Book & { labelId: string }, lists: string[][]): Promise<Check[]> {
  const out: Check[] = [];
  const base = { book: book.name, labelId: book.labelId, scope: 'isrc-list' as const };
  for (const [i, isrcs] of lists.entries()) {
    const at = { ...base, chunk: i + 1, asked: isrcs.length };
    const old = await attempt('isrc list old', () => f.trackSummary({ isrcs: isrcs.join(','), label: book.labelId }));
    const now = await attempt('isrc list new', () => f.masterRows({ scope: { kind: 'isrcs', isrcs }, grain: 'isrc' }, book.labelId));
    if (!old.ok || !now.ok) {
      const failed = failedOf(old.ok ? undefined : old.error, now.ok ? undefined : now.error);
      out.push({ ...at, part: 'isrc', oldRows: 0, newRows: 0, differences: [], ...(failed ? { failed } : {}) });
      continue;
    }
    const itemsOld = oldPairs(old.value.items, (x) => x.isrc, (x) => x.months);
    const rowsNew = newPairs(now.value.rows, isrcOf, { months: true });
    out.push({ ...at, part: 'isrc', oldRows: itemsOld.length, newRows: rowsNew.length, differences: diffPairs(itemsOld, rowsNew) });
    out.push({ ...at, part: 'totals', oldRows: 1, newRows: 1, differences: diffTotals(old.value.items, now.value.totals) });
  }
  return out;
}

/** One warm-up of each, then `ROUNDS` rounds old / new in turn; the medians, the sizes of the answers, the verdict. */
async function measure(
  head: Pick<Timing, 'book' | 'labelId' | 'what' | 'chunk' | 'asked'>,
  oldFn: () => Promise<unknown>,
  newFn: () => Promise<unknown>,
): Promise<Timing> {
  const of = (side: string) => `timing ${head.what} ${side}`;
  enter(of('old (warm-up)'));
  await oldFn();
  enter(of('new (warm-up)'));
  await newFn();
  const oldMs: number[] = [];
  const newMs: number[] = [];
  let oldAnswer: unknown;
  let newAnswer: unknown;
  // strictly old / new in turn; nothing else runs between the rounds
  for (let i = 0; i < ROUNDS; i++) {
    enter(of('old'));
    const o = await timed(oldFn);
    enter(of('new'));
    const n = await timed(newFn);
    oldMs.push(o.ms);
    newMs.push(n.ms);
    oldAnswer = o.answer;
    newAnswer = n.answer;
  }
  const oldMedianMs = median(oldMs);
  const newMedianMs = median(newMs);
  // the sizes: serialised once, outside the rounds
  return {
    ...head,
    oldMs,
    newMs,
    oldMedianMs,
    newMedianMs,
    oldBytes: bytes(oldAnswer),
    newBytes: bytes(newAnswer),
    within: withinThreshold(oldMedianMs, newMedianMs),
  };
}

const failedLine = (x: Failed) =>
  x.side === 'both'
    ? x.same
      ? `both sides failed the same way: ${x.old}`
      : `both sides failed: old ${x.old}; new ${x.new}`
    : x.side === 'old'
      ? `the old answer failed: ${x.old}`
      : `only the new answer failed: ${x.new}`;

function markdown(report: {
  date: string;
  books: number;
  loadBefore: string;
  loadAfter: string;
  checks: Check[];
  timings: Timing[];
  differences: number;
  newOnlyFailures: number;
  notCompared: number;
  timingsOutside: number;
  exitCode: number;
  empty: string[];
  callFailures: CallFailure[];
}): string {
  const lines = [
    `# masterRows against the old answers, ${report.date}`,
    '',
    `Books: ${report.books} and «all». Comparisons: ${report.checks.length}, differences: ${report.differences}, only the new answer failed: ${report.newOnlyFailures}, not compared: ${report.notCompared}. Timings: ${report.timings.length}, outside the threshold: ${report.timingsOutside}. Exit code ${report.exitCode}.`,
    `Load average before: ${report.loadBefore}; after: ${report.loadAfter}.`,
    ...(report.empty.length > 0 ? [`**The run proves nothing: ${report.empty.join('; ')}.**`] : []),
    '',
    '## Comparisons',
    '',
    '| book | scope | comparisons | old rows | new rows | differences | failed |',
    '|---|---|---|---|---|---|---|',
  ];
  const groups = new Map<string, Check[]>();
  for (const c of report.checks) groups.set(`${c.book}|${c.scope}`, [...(groups.get(`${c.book}|${c.scope}`) ?? []), c]);
  for (const [key, cs] of groups) {
    const [book, scope] = key.split('|');
    const total = (pick: (c: Check) => number) => cs.reduce((n, c) => n + pick(c), 0);
    lines.push(`| ${book} | ${scope} | ${cs.length} | ${total((c) => c.oldRows)} | ${total((c) => c.newRows)} | ${total((c) => c.differences.length)} | ${cs.filter((c) => c.failed).length} |`);
  }
  lines.push('', '## Timings (median of 5, seconds; size of the JSON answer, bytes)', '', '| book | what | old | new | old bytes | new bytes | verdict |', '|---|---|---|---|---|---|---|');
  for (const t of report.timings)
    lines.push(
      `| ${t.book} | ${t.what}${t.chunk ? ` chunk ${t.chunk} (${t.asked} ISRCs)` : ''} | ${seconds(t.oldMedianMs)} | ${seconds(t.newMedianMs)} | ${t.oldBytes} | ${t.newBytes} | ${t.within ? 'within' : 'OUTSIDE'} |`,
    );
  lines.push('', '## Failed', '');
  const failed = report.checks.filter((c) => c.failed);
  if (failed.length === 0 && report.callFailures.length === 0) lines.push('None.');
  for (const c of failed) lines.push(`- ${c.book}, ${c.scope}${c.chunk ? ` chunk ${c.chunk}` : ''}: ${failedLine(c.failed as Failed)}`);
  for (const x of report.callFailures) lines.push(`- ${x.step}: ${x.error}`);
  lines.push('', '## Differences', '');
  const differing = report.checks.filter((c) => c.differences.length > 0);
  if (differing.length === 0) lines.push('None.');
  for (const c of differing) {
    lines.push(`### ${c.book}, ${c.scope}${c.chunk ? ` chunk ${c.chunk}` : ''}, ${c.part}`, '');
    for (const d of c.differences) lines.push(`- \`${d.key}\``, `  - old: \`${d.old ?? '(no row)'}\``, `  - new: \`${d.new ?? '(no row)'}\``);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** The whole run; the exit code. Whatever it throws is reported by the caller as a step, a class and a place. */
async function main(): Promise<number> {
  enter('connect');
  const stores = connectStores();
  try {
    // the very first query, on the pool every later read uses: the session must be read-only
    enter('read-only check');
    const shown = await stores.pool.query<{ default_transaction_read_only: string }>('SHOW default_transaction_read_only');
    if (shown.rows[0]?.default_transaction_read_only !== 'on') {
      console.error("The PostgreSQL session is not read-only: запусти с PGOPTIONS='-c default_transaction_read_only=on'");
      return 1;
    }
    // the organization: ERP_DEFAULT_ORG only (no --org, no ERP_ORG); neither its name nor its id is printed
    enter('organization');
    const found = await resolveOrg(stores, [process.env.ERP_DEFAULT_ORG]);
    if (!found.ok) {
      console.error('ERP_DEFAULT_ORG is not set or names no organization of this database');
      return 1;
    }
    const orgId = found.org.id;
    // a second lock: this script has no write, and the facade it opens cannot start one
    const db = {
      ...stores.db,
      transaction: () => Promise.reject(new Error('check-master-rows is read-only: a write transaction was asked')),
    };
    enter('open the facade');
    const f = openFacade({ db, orgId, dataDir, payoutThresholdCents: 10000, sources: sourcesFor(stores, orgId, dataDir) });

    enter('own labels');
    const labels = await f.modules.labels.listLabels();
    const books: Book[] = [...labels.map((l, i) => ({ name: `book ${i + 1}`, labelId: l.id })), { name: 'all', labelId: undefined }];
    console.log(`books: ${labels.length} and «all»`);

    const loadBefore = load();
    console.log(`load average before: ${loadBefore}`);
    const checks: Check[] = [];
    const timings: Timing[] = [];
    const callFailures: CallFailure[] = [];
    /** The ISRCs of the new answer under «all» (every ISRC): the lists the books are asked by. */
    let allIsrcList: string[] | undefined;
    for (const book of books) {
      bookOfStep = book.name;
      const mine: Check[] = [];
      const whole = await compareIsrcsWithOld(f, book);
      mine.push(...whole.checks);
      if (book.labelId === undefined) allIsrcList = whole.isrcs;
      checks.push(...mine);
      const count = (scope: Check['scope']) => {
        const cs = mine.filter((c) => c.scope === scope);
        return `${cs.filter((c) => !c.failed).length} comparisons, ${cs.reduce((n, c) => n + c.newRows, 0)} rows, ${cs.reduce((n, c) => n + c.differences.length, 0)} differences, ${cs.filter((c) => c.failed).length} failed`;
      };
      console.log(`${book.name}: every ISRC: ${count('isrcs')}`);
      // a failed comparison: the side, with the class of the error
      for (const c of mine)
        if (c.failed)
          console.log(`${book.name}: FAILED every ISRC: ${failedLine(c.failed)}`);

      // the timings: only of the slices that were compared
      const head = { book: book.name, labelId: book.labelId ?? null };
      const failedScope = (scope: Check['scope']) => mine.some((c) => c.scope === scope && c.failed);
      const measured: Timing[] = [];
      const run = async (skip: boolean, fn: () => Promise<Timing>) => {
        if (skip) {
          console.log(`${book.name} timing every ISRC: skipped, its comparison failed`);
          return;
        }
        try {
          measured.push(await fn());
        } catch (e) {
          callFailures.push({ step, error: errorText(e) });
          console.log(`${book.name}: FAILED at «${step}»: ${errorText(e)}`);
        }
      };
      await run(failedScope('isrcs'), () =>
        measure(
          { ...head, what: 'isrcs' },
          () => f.trackSummary(book.labelId ? { label: book.labelId } : {}),
          () => f.masterRows({ scope: { kind: 'isrcs' }, grain: 'isrc' }, book.labelId),
        ),
      );
      timings.push(...measured);
      for (const t of measured)
        console.log(
          `${book.name} timing every ISRC: old ${seconds(t.oldMedianMs)} s, new ${seconds(t.newMedianMs)} s (median of ${ROUNDS}); old ${t.oldBytes} B, new ${t.newBytes} B: ${t.within ? 'within the threshold' : 'OUTSIDE the threshold'}`,
        );
    }
    // the books by lists of ISRCs (the way the track page asks): the ISRCs of «all» in chunks of 500
    const named = books.filter((b): b is Book & { labelId: string } => b.labelId !== undefined);
    if (named.length > 0 && allIsrcList === undefined) {
      bookOfStep = '';
      enter('ISRC lists');
      callFailures.push({ step, error: 'no list of ISRCs: «all | isrcs new» gave no answer' });
      console.log('ISRC lists: SKIPPED, «all» gave no list of ISRCs (not compared)');
    } else if (allIsrcList !== undefined) {
      const lists = chunksOf(allIsrcList, LIST_CHUNK);
      for (const book of named) {
        bookOfStep = book.name;
        const mine = await compareIsrcListsWithOld(f, book, lists);
        checks.push(...mine);
        const rows = mine.filter((c) => c.part === 'isrc');
        console.log(
          `${book.name}: ISRC lists: ${lists.length} chunks, ${rows.reduce((n, c) => n + c.newRows, 0)} rows, ${mine.reduce((n, c) => n + c.differences.length, 0)} differences, ${mine.filter((c) => c.failed).length} failed`,
        );
        for (const c of mine) if (c.failed) console.log(`${book.name}: FAILED ISRC list, chunk ${c.chunk} of ${lists.length}: ${failedLine(c.failed)}`);
        // the timing: the first chunk where the book has rows (else the first one)
        const pick = rows.find((c) => !c.failed && c.newRows > 0) ?? rows[0];
        const isrcs = pick?.chunk === undefined ? undefined : lists[pick.chunk - 1];
        if (!pick || !isrcs) continue;
        if (pick.failed) {
          console.log(`${book.name} timing ISRC list (${isrcs.length} ISRCs): skipped, its comparison failed`);
          continue;
        }
        try {
          const t = await measure(
            { book: book.name, labelId: book.labelId, what: 'isrc-list', chunk: pick.chunk, asked: isrcs.length },
            () => f.trackSummary({ isrcs: isrcs.join(','), label: book.labelId }),
            () => f.masterRows({ scope: { kind: 'isrcs', isrcs }, grain: 'isrc' }, book.labelId),
          );
          timings.push(t);
          console.log(
            `${book.name} timing ISRC list (${isrcs.length} ISRCs): old ${seconds(t.oldMedianMs)} s, new ${seconds(t.newMedianMs)} s (median of ${ROUNDS}); old ${t.oldBytes} B, new ${t.newBytes} B: ${t.within ? 'within the threshold' : 'OUTSIDE the threshold'}`,
          );
        } catch (e) {
          callFailures.push({ step, error: errorText(e) });
          console.log(`${book.name}: FAILED at «${step}»: ${errorText(e)}`);
        }
      }
    }
    bookOfStep = '';
    enter('report');
    const loadAfter = load();
    console.log(`load average after: ${loadAfter}`);

    const differences = checks.reduce((n, c) => n + c.differences.length, 0);
    const timingsOutside = timings.filter((t) => !t.within).length;
    const failed = checks.filter((c) => c.failed);
    // only the new answer failed: a difference; both sides (or the old one) failed: that slice was not compared
    const newOnlyFailures = failed.filter((c) => c.failed?.side === 'new').length;
    const bothFailed = failed.filter((c) => c.failed?.side === 'both').length;
    const oldOnlyFailures = failed.filter((c) => c.failed?.side === 'old').length;
    // an empty selection is not «equal»: the run did not prove anything
    const allIsrcs = checks.find((c) => c.book === 'all' && c.scope === 'isrcs' && c.part === 'isrc');
    const empty = emptyRunReasons({
      labels: labels.length,
      allIsrcRows: !allIsrcs || allIsrcs.failed ? null : allIsrcs.newRows,
    });
    const notCompared = bothFailed + oldOnlyFailures + callFailures.length + empty.length;
    const exitCode = exitCodeOf({ differences, newOnlyFailures, notCompared, timingsOutside });
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const report = {
      date,
      startedAt: now.toISOString(),
      books: labels.length,
      thresholds: { ratio: THRESHOLD_RATIO, ms: THRESHOLD_MS, rounds: ROUNDS, listChunk: LIST_CHUNK },
      loadBefore,
      loadAfter,
      differences,
      newOnlyFailures,
      bothFailed,
      bothFailedSameWay: failed.filter((c) => c.failed?.side === 'both' && c.failed.same).length,
      oldOnlyFailures,
      notCompared,
      timingsOutside,
      exitCode,
      empty,
      callFailures,
      clientLogLinesDropped: clientLogLines,
      timings,
      checks,
    };
    const dir = join(root, 'data', 'mvp-load', 'verify');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `master-rows-${date}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(dir, `master-rows-${date}.md`), markdown(report));

    console.log(
      `comparisons: ${checks.length - failed.length}, differences: ${differences}; failed: only the new answer ${newOnlyFailures}, both sides ${bothFailed}, only the old answer ${oldOnlyFailures}, other calls ${callFailures.length}; timings: ${timings.length}, outside the threshold: ${timingsOutside}`,
    );
    // the slices where both sides failed the same way, without keys: is it the only reason of a code 1?
    const sameWay = failed.filter((c) => c.failed?.side === 'both' && c.failed.same);
    if (sameWay.length > 0) {
      const slices = new Map<string, number>();
      for (const c of sameWay) {
        const k = `${c.book} ${c.scope === 'isrcs' ? 'every ISRC' : 'ISRC list'}`;
        slices.set(k, (slices.get(k) ?? 0) + 1);
      }
      const text = [...slices.entries()].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');
      console.log(`both sides failed the same way: ${sameWay.length} (slices: ${text})${exitCode === 1 && notCompared === sameWay.length ? '; the only reason of code 1' : ''}`);
    }
    if (clientLogLines > 0) console.log(`log lines of the ClickHouse client dropped: ${clientLogLines}`);
    console.log(`report: data/mvp-load/verify/master-rows-${date}.json and .md`);
    const verdict =
      exitCode === 0
        ? 'equal and within the threshold'
        : exitCode === 2
          ? differences > 0
            ? 'DIFFERENCES'
            : 'DIFFERENCES: only the new answer failed somewhere'
          : exitCode === 3
            ? 'equal, a timing OUTSIDE the threshold'
            : empty.length > 0
              ? `DID NOT RUN, nothing to compare: ${empty.join('; ')}`
              : bothFailed > 0
                ? 'NOT COMPARED: both sides failed somewhere; what was compared is equal'
                : 'NOT COMPARED: a call failed; what was compared is equal';
    console.log(`verdict: ${verdict}`);
    return exitCode;
  } finally {
    await stores.close();
  }
}

try {
  process.exitCode = await main();
} catch (e) {
  // the stores, the organization, the label list, the report: only the step, the class and the place of the error
  console.error(`check-master-rows did not run, stopped at «${step}»: ${errorText(e)}`);
  process.exitCode = 1;
}
