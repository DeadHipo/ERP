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
 * The release slice, against a baseline saved from the old code (the same script file and library, two runs):
 *  - `--save-release-baseline <file>`, on the code before D-257 only (where `release()` still gives money; elsewhere
 *    it ends with code 1): for every book and «all», the 20 releases with the largest net of the files and, for each,
 *    the money of the tracks and of the months of the old `release(upc, label)` (keys and money strings, no title, no
 *    pseudonym), plus the median time of the old call for the largest release (one warm-up, five rounds), the load
 *    average of that moment and a fingerprint of the data (the count and the net of the release list of each book).
 *    It writes the file (never over an existing one) and compares nothing. Exit code 0 = written, 1 = not written.
 *  - `--release-baseline <file>`, in the run of the check: besides everything above, every release of the file under
 *    its book: `masterRows` (scope `release`) by ISRC against the tracks, by month against the months, the totals
 *    against the tracks added up. The books of the file must be the books of the run (by label id) and their release
 *    lists the ones the baseline saw («the data changed since the baseline was taken», code 1, before any comparison);
 *    a run that compared no release, or releases without a money row in the baseline, proves nothing (code 1). The time of the new call for the largest release is set against the
 *    time of the file, with the same threshold: that old time was taken in another process (`baseline timing`).
 *
 * Read-only, and it refuses to start unless the PostgreSQL session is read-only (`PGOPTIONS` reaches node-postgres as
 * the `options` of the startup packet, so every connection of the pool is). The organization is `ERP_DEFAULT_ORG`
 * (no `--org`). The console gets counters, times, sizes and the verdict only: the books are numbered, nothing is
 * named. The keys of the differences (ISRC; with a baseline also UPC and month) and their money go to
 * `<repo>/data/mvp-load/verify/master-rows-<date>.json` and `.md` (git-ignored), without titles and pseudonyms.
 *
 * Every call is a step (`book N | isrc list old`, `all | isrcs new`, `book N | timing isrcs old`, …). A comparison whose
 * call fails is recorded as failed, with the side, and the run goes on: only the class of the error (for ClickHouse its
 * code and exception type) and the step are written, never the message. The log lines of the ClickHouse client are
 * dropped (they may quote a query).
 *
 * Exit code: 0 = no difference and every timing within the threshold; 2 = differences, or a comparison where only the
 * new answer failed; 3 = no difference, a timing outside the threshold; 1 = not proven: it did not run, a slice failed
 * on both sides (or on the old one), a call failed, or there was nothing to compare (no own label, no row under «all»,
 * with `--release-baseline` no release compared); also a baseline of other books, a file that is no baseline, a wrong
 * argument.
 */
import { loadavg } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openFacade } from '../src/facade';
import { connectStores, resolveOrg, sourcesFor } from '../src/connect-sources';
import type { MasterRow } from '../src/facade/money';
import {
  badRowText,
  BASELINE_KIND,
  baselineReleaseOf,
  chunksOf,
  compareReleaseWithBaseline,
  DATA_CHANGED,
  describeError,
  diffPairs,
  diffTotals,
  emptyRunReasons,
  exitCodeOf,
  failedOf,
  listFingerprint,
  median,
  newPairs,
  NO_MONEY_HERE,
  oldPairs,
  OTHER_BOOKS,
  parseArgs,
  parseBaseline,
  sameBooks,
  sameFingerprint,
  THRESHOLD_MS,
  THRESHOLD_RATIO,
  topByNet,
  withinThreshold,
  type BaselineBook,
  type BaselineRelease,
  type Difference,
  type Failed,
  type ReleaseBaseline,
} from './lib/master-rows-compare';

const ROUNDS = 5;
/** The most ISRCs the old summary takes in one request (`parseIsrcList`, `aggregates.ts`). */
const LIST_CHUNK = 500;
/** The releases of a book the baseline takes: those with the largest net of the files. */
const TOP_RELEASES = 20;

const root = resolve(import.meta.dirname, '..', '..', '..');
const args = parseArgs(process.argv.slice(2));
const dataDir = resolve((args.ok ? args.dataDir : undefined) ?? join(root, 'data'));

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
  /** `release`: a release of the baseline (`--release-baseline`), the old side is the file. */
  scope: 'isrcs' | 'isrc-list' | 'release';
  upc?: string;
  /** A list of ISRCs: the number of the chunk (from 1) and how many ISRCs it asks. */
  chunk?: number;
  asked?: number;
  part: 'isrc' | 'month' | 'totals';
  oldRows: number;
  newRows: number;
  differences: Difference[];
  failed?: Failed;
}

interface Timing {
  book: string;
  labelId: string | null;
  what: 'isrcs' | 'isrc-list' | 'release';
  upc?: string;
  /** The old times are those of the baseline file: taken in another process (and on the code before D-257). */
  baseline?: true;
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
const loadText = (xs: number[]) => xs.map((x) => x.toFixed(2)).join(' ');
const load = () => loadText(loadavg());

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

/**
 * `--save-release-baseline`: the money of the old `release()` for the largest releases of every book, and the time of
 * the old call for the largest one, written to `file`. Reads only; whatever fails stops it before the file is written.
 */
async function saveBaseline(f: Facade, books: Book[], labels: number, file: string): Promise<number> {
  // an existing file is never written over (checked here before the work, and again by the write itself)
  const exists = 'the file of --save-release-baseline exists already: a baseline is not written over (name another file)';
  enter('baseline file');
  if (existsSync(file)) {
    console.error(exists);
    return 1;
  }
  const loadAtSave = loadavg();
  const entries: BaselineBook[] = [];
  for (const book of books) {
    bookOfStep = book.name;
    enter('releases');
    // the UPCs with the net of the files (no calculation), the largest first
    const list = await f.releases(undefined, book.labelId);
    const top = topByNet(list.items, TOP_RELEASES).map((r) => r.upc);
    const releases: BaselineRelease[] = [];
    for (const upc of top) {
      enter('release old');
      // the final code has no money in the type of this answer: it is read as unknown and checked row by row
      const answer: unknown = await f.release(upc, book.labelId);
      const made = baselineReleaseOf(upc, answer);
      if (!made.ok) {
        console.error(made.reason === 'no_money' ? NO_MONEY_HERE : badRowText(book.name, top.indexOf(upc) + 1, top.length, made.reason));
        return 1;
      }
      releases.push(made.release);
    }
    let timing: BaselineBook['timing'] = null;
    const largest = top[0];
    if (largest !== undefined) {
      enter('timing release old (warm-up)');
      await f.release(largest, book.labelId);
      enter('timing release old');
      const ms: number[] = [];
      let answer: unknown;
      for (let i = 0; i < ROUNDS; i++) {
        const t = await timed(() => f.release(largest, book.labelId));
        ms.push(t.ms);
        answer = t.answer;
      }
      timing = { upc: largest, ms, medianMs: median(ms), bytes: bytes(answer) };
    }
    entries.push({ book: book.name, labelId: book.labelId ?? null, list: listFingerprint(list.items), releases, timing });
    console.log(
      `${book.name}: releases saved ${releases.length}: ${releases.reduce((n, r) => n + r.tracks.length, 0)} track rows, ${releases.reduce((n, r) => n + r.months.length, 0)} month rows` +
        (timing ? `; largest release old ${seconds(timing.medianMs)} s (median of ${ROUNDS}), ${timing.bytes} B` : '; no release'),
    );
  }
  bookOfStep = '';
  enter('baseline file');
  if (entries.every((e) => e.releases.length === 0)) {
    console.error('no release in any book: the baseline is not written');
    return 1;
  }
  const baseline: ReleaseBaseline = {
    kind: BASELINE_KIND,
    version: 1,
    takenAt: new Date().toISOString(),
    loadavg: loadAtSave,
    books: labels,
    topReleases: TOP_RELEASES,
    rounds: ROUNDS,
    entries,
  };
  // what is written must read back as a baseline (nothing but keys and amounts in it)
  const text = `${JSON.stringify(baseline, null, 2)}\n`;
  const back = parseBaseline(JSON.parse(text), { topReleases: TOP_RELEASES, rounds: ROUNDS });
  if (!back.ok) {
    console.error(`the baseline does not read back (${back.reason}): not written`);
    return 1;
  }
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, text, { flag: 'wx' });
  } catch (e) {
    if ((e as { code?: unknown }).code !== 'EEXIST') throw e;
    console.error(exists);
    return 1;
  }
  console.log(`load average: ${load()}`);
  console.log(`baseline: ${entries.reduce((n, e) => n + e.releases.length, 0)} releases of ${labels} books and «all» written to the file of --save-release-baseline`);
  return 0;
}

/**
 * `--release-baseline`: the releases of the baseline under one book against `masterRows` (scope `release`), the old
 * side read from the file. A call of the new answer that fails is a comparison where only the new answer failed.
 */
async function compareReleasesWithBaseline(f: Facade, book: Book, entry: BaselineBook): Promise<Check[]> {
  const out: Check[] = [];
  const base = { book: book.name, labelId: book.labelId ?? null, scope: 'release' as const };
  for (const old of entry.releases) {
    const scope = { kind: 'release' as const, upc: old.upc };
    const byIsrc = await attempt('release new isrc', () => f.masterRows({ scope, grain: 'isrc' }, book.labelId));
    const byMonth = await attempt('release new month', () => f.masterRows({ scope, grain: 'month' }, book.labelId));
    if (!byIsrc.ok || !byMonth.ok) {
      const failed = failedOf(undefined, !byIsrc.ok ? byIsrc.error : !byMonth.ok ? byMonth.error : undefined);
      out.push({ ...base, upc: old.upc, part: 'isrc', oldRows: 0, newRows: 0, differences: [], ...(failed ? { failed } : {}) });
      continue;
    }
    for (const p of compareReleaseWithBaseline(old, byIsrc.value, byMonth.value)) out.push({ ...base, upc: old.upc, ...p });
  }
  return out;
}

/** The new call for the largest release of the baseline: one warm-up, `ROUNDS` rounds; the old times are the file's. */
async function measureAgainstBaseline(f: Facade, book: Book, old: NonNullable<BaselineBook['timing']>): Promise<Timing> {
  const call = () => f.masterRows({ scope: { kind: 'release', upc: old.upc }, grain: 'isrc' }, book.labelId);
  enter('timing release new (warm-up)');
  await call();
  enter('timing release new');
  const newMs: number[] = [];
  let answer: unknown;
  for (let i = 0; i < ROUNDS; i++) {
    const t = await timed(call);
    newMs.push(t.ms);
    answer = t.answer;
  }
  const newMedianMs = median(newMs);
  return {
    book: book.name,
    labelId: book.labelId ?? null,
    what: 'release',
    upc: old.upc,
    baseline: true,
    oldMs: old.ms,
    newMs,
    oldMedianMs: old.medianMs,
    newMedianMs,
    oldBytes: old.bytes,
    newBytes: bytes(answer),
    within: withinThreshold(old.medianMs, newMedianMs),
  };
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
  releaseBaseline?: { takenAt: string; loadavg: number[]; releases: number; releasesCompared: number };
}): string {
  const lines = [
    `# masterRows against the old answers, ${report.date}`,
    '',
    `Books: ${report.books} and «all». Comparisons: ${report.checks.length}, differences: ${report.differences}, only the new answer failed: ${report.newOnlyFailures}, not compared: ${report.notCompared}. Timings: ${report.timings.length}, outside the threshold: ${report.timingsOutside}. Exit code ${report.exitCode}.`,
    `Load average before: ${report.loadBefore}; after: ${report.loadAfter}.`,
    ...(report.empty.length > 0 ? [`**The run proves nothing: ${report.empty.join('; ')}.**`] : []),
    ...(report.releaseBaseline
      ? [
          `Releases: against the baseline of ${report.releaseBaseline.takenAt} (the old \`release()\` on the code before D-257): ${report.releaseBaseline.releasesCompared} of ${report.releaseBaseline.releases} compared. Baseline timing: the old time of a release was taken in another process, when the baseline was saved (load average then: ${loadText(report.releaseBaseline.loadavg)}).`,
        ]
      : []),
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
      `| ${t.book} | ${t.what}${t.upc ? ` ${t.upc}` : ''}${t.baseline ? ' (baseline timing)' : ''}${t.chunk ? ` chunk ${t.chunk} (${t.asked} ISRCs)` : ''} | ${seconds(t.oldMedianMs)} | ${seconds(t.newMedianMs)} | ${t.oldBytes} | ${t.newBytes} | ${t.within ? 'within' : 'OUTSIDE'} |`,
    );
  lines.push('', '## Failed', '');
  const failed = report.checks.filter((c) => c.failed);
  if (failed.length === 0 && report.callFailures.length === 0) lines.push('None.');
  for (const c of failed) lines.push(`- ${c.book}, ${c.scope}${c.upc ? ` ${c.upc}` : ''}${c.chunk ? ` chunk ${c.chunk}` : ''}: ${failedLine(c.failed as Failed)}`);
  for (const x of report.callFailures) lines.push(`- ${x.step}: ${x.error}`);
  lines.push('', '## Differences', '');
  const differing = report.checks.filter((c) => c.differences.length > 0);
  if (differing.length === 0) lines.push('None.');
  for (const c of differing) {
    lines.push(`### ${c.book}, ${c.scope}${c.upc ? ` ${c.upc}` : ''}${c.chunk ? ` chunk ${c.chunk}` : ''}, ${c.part}`, '');
    for (const d of c.differences) lines.push(`- \`${d.key}\``, `  - old: \`${d.old ?? '(no row)'}\``, `  - new: \`${d.new ?? '(no row)'}\``);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** The whole run; the exit code. Whatever it throws is reported by the caller as a step, a class and a place. */
async function main(): Promise<number> {
  enter('arguments');
  if (!args.ok) {
    console.error(`check-master-rows: ${args.error}`);
    return 1;
  }
  // the baseline is read and checked before anything is asked of the stores
  let baseline: ReleaseBaseline | undefined;
  if (args.baseline !== undefined) {
    enter('baseline file');
    const read = parseBaseline(JSON.parse(readFileSync(resolve(args.baseline), 'utf8')), { topReleases: TOP_RELEASES, rounds: ROUNDS });
    if (!read.ok) {
      console.error(`The file of --release-baseline is not a release baseline: ${read.reason}`);
      return 1;
    }
    baseline = read.baseline;
  }
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
    if (args.save !== undefined) return await saveBaseline(f, books, labels.length, resolve(args.save));
    if (baseline && !sameBooks(baseline.entries, books.map((b) => b.labelId ?? null))) {
      console.error(OTHER_BOOKS);
      return 1;
    }
    // the data of the baseline: the release list of every book (a read without a calculation) must be the one it saw
    if (baseline) {
      const changed: string[] = [];
      for (const book of books) {
        const entry = baseline.entries.find((e) => e.labelId === (book.labelId ?? null));
        if (!entry) continue;
        bookOfStep = book.name;
        enter('releases');
        const list = await f.releases(undefined, book.labelId);
        if (!sameFingerprint(entry.list, listFingerprint(list.items))) changed.push(book.name);
      }
      bookOfStep = '';
      if (changed.length > 0) {
        console.error(`${DATA_CHANGED}: the release list of ${changed.join(', ')} has another count or another net (baseline of ${baseline.takenAt}); take the baseline again`);
        return 1;
      }
    }

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
    // the releases of the baseline (`--release-baseline`): the old side is the file, taken on the code before D-257
    let releasesCompared = 0;
    if (baseline) {
      for (const book of books) {
        const entry = baseline.entries.find((e) => e.labelId === (book.labelId ?? null));
        if (!entry) continue;
        bookOfStep = book.name;
        const mine = await compareReleasesWithBaseline(f, book, entry);
        checks.push(...mine);
        const compared = mine.filter((c) => c.part === 'isrc' && !c.failed).length;
        releasesCompared += compared;
        console.log(
          `${book.name}: releases (baseline) ${entry.releases.length}: ${mine.filter((c) => !c.failed).length} comparisons, ${mine.reduce((n, c) => n + c.newRows, 0)} rows, ${mine.reduce((n, c) => n + c.differences.length, 0)} differences, ${mine.filter((c) => c.failed).length} failed`,
        );
        for (const c of mine)
          if (c.failed)
            console.log(`${book.name}: FAILED release ${entry.releases.findIndex((r) => r.upc === c.upc) + 1} of ${entry.releases.length} (baseline): ${failedLine(c.failed)}`);
        const old = entry.timing;
        if (!old) continue;
        if (mine.some((c) => c.upc === old.upc && c.failed)) {
          console.log(`${book.name} timing largest release (baseline timing): skipped, its comparison failed`);
          continue;
        }
        try {
          const t = await measureAgainstBaseline(f, book, old);
          timings.push(t);
          console.log(
            `${book.name} timing largest release (baseline timing, the old time was taken in another process under load average ${loadText(baseline.loadavg)}): old ${seconds(t.oldMedianMs)} s, new ${seconds(t.newMedianMs)} s (median of ${ROUNDS}); old ${t.oldBytes} B, new ${t.newBytes} B: ${t.within ? 'within the threshold' : 'OUTSIDE the threshold'}`,
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
      ...(baseline
        ? {
            baselineReleases: releasesCompared,
            baselineMoneyRows: checks.filter((c) => c.scope === 'release' && c.part !== 'totals').reduce((n, c) => n + c.oldRows, 0),
          }
        : {}),
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
      ...(baseline
        ? {
            releaseBaseline: {
              takenAt: baseline.takenAt,
              loadavg: baseline.loadavg,
              topReleases: baseline.topReleases,
              releases: baseline.entries.reduce((n, e) => n + e.releases.length, 0),
              releasesCompared,
              timing: 'baseline timing: the old time of a release was taken in another process, when the baseline was saved',
            },
          }
        : {}),
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
        const k = `${c.book} ${c.scope === 'isrcs' ? 'every ISRC' : c.scope === 'release' ? 'release' : 'ISRC list'}`;
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
