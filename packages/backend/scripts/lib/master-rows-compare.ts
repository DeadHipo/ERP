import { Decimal, ZERO } from '../../src/shared/money';
import type { Sums } from '../../src/facade/aggregates';
import type { MasterRow } from '../../src/facade/money';

// The pure rules of `scripts/check-master-rows.ts` (D-249): the comparison of `masterRows` with the answers it
// replaces is the one of `tests/money-rows.test.ts` (JSON strings of the money fields `net, B, C, ours, cByReason` and
// of `months`; a row whose sums are all zero with no C reason is dropped on both sides), plus the timing threshold and
// the exit code. No storage, no side effect on import; money is compared as text and added only through `Decimal`.

/** The money fields of a row, in one fixed order (the reasons keep the order `sumUnits` gave them). */
export const moneyOf = (s: Sums) => ({ net: s.net, B: s.B, C: s.C, ours: s.ours, cByReason: s.cByReason });
export const moneyText = (s: Sums): string => JSON.stringify(moneyOf(s));
export const isZero = (s: Sums): boolean =>
  [s.net, s.B, s.C, s.ours].every((x) => x.isZero()) && Object.keys(s.cByReason).length === 0;

/** `[key, JSON of the money (and months)]` of one row. */
export type Pair = [key: string, text: string];

/** The non-zero rows of the new answer; `months` rides along only where asked (a track of `release()` has none). */
export const newPairs = (rows: MasterRow[], key: (r: MasterRow) => string, opts: { months: boolean }): Pair[] =>
  rows
    .filter((r) => !isZero(r.sums))
    .map((r) => [key(r), JSON.stringify({ ...moneyOf(r.sums), ...(opts.months && r.months ? { months: r.months } : {}) })]);

/** The same of an old answer (its rows carry the sums flat). */
export const oldPairs = <T extends Sums>(items: T[], key: (x: T) => string, months?: (x: T) => unknown): Pair[] =>
  items
    .filter((x) => !isZero(x))
    .map((x) => [key(x), JSON.stringify({ ...moneyOf(x), ...(months ? { months: months(x) } : {}) })]);

/** One difference: the key (an ISRC, a month, `totals`, …) and the money text of each side (`null` = no such row). */
export interface Difference {
  key: string;
  old: string | null;
  new: string | null;
}

/**
 * The differences of two lists of pairs: a key of one side only, a key with another text, a key met twice on a side,
 * and, when the keys are the same set, another order (the test of M1 compares the lists in order).
 */
export function diffPairs(oldList: Pair[], newList: Pair[]): Difference[] {
  const out: Difference[] = [];
  const index = (list: Pair[], side: 'old' | 'new') => {
    const map = new Map<string, string>();
    for (const [k, text] of list) {
      if (map.has(k)) out.push({ key: `${k} (twice in ${side})`, old: side === 'old' ? text : null, new: side === 'new' ? text : null });
      else map.set(k, text);
    }
    return map;
  };
  const olds = index(oldList, 'old');
  const news = index(newList, 'new');
  for (const [k, text] of olds) {
    const other = news.get(k);
    if (other === undefined) out.push({ key: k, old: text, new: null });
    else if (other !== text) out.push({ key: k, old: text, new: other });
  }
  for (const [k, text] of news) if (!olds.has(k)) out.push({ key: k, old: null, new: text });
  if (out.length === 0 && oldList.some(([k], i) => newList[i]?.[0] !== k)) out.push({ key: '(order of the rows)', old: null, new: null });
  return out;
}

/** The sums of several rows, added exactly. */
export function addSums(list: Sums[]): Sums {
  const s: Sums = { net: ZERO, B: ZERO, C: ZERO, ours: ZERO, cByReason: {} };
  for (const x of list) {
    s.net = s.net.add(x.net);
    s.B = s.B.add(x.B);
    s.C = s.C.add(x.C);
    s.ours = s.ours.add(x.ours);
    for (const [k, v] of Object.entries(x.cByReason) as [keyof Sums['cByReason'], Decimal][])
      s.cByReason[k] = (s.cByReason[k] ?? ZERO).add(v);
  }
  return s;
}

/** A canonical text of sums: the reasons sorted (adding rows up may meet them in another order than `sumUnits`). */
export const canonText = (s: Sums): string =>
  JSON.stringify({
    net: s.net,
    B: s.B,
    C: s.C,
    ours: s.ours,
    cByReason: Object.fromEntries(Object.entries(s.cByReason).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  });

/** The totals of the new answer against the old rows added up: at most one difference, under the key `totals`. */
export function diffTotals(oldRows: Sums[], totals: Sums): Difference[] {
  const a = canonText(addSums(oldRows));
  const b = canonText(totals);
  return a === b ? [] : [{ key: 'totals', old: a, new: b }];
}

/** The list cut into chunks of at most `size`, in order (the old summary takes at most 500 ISRCs a request). */
export function chunksOf<T>(list: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('The chunk size must be a positive integer');
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The median of the times (milliseconds). */
export function median(xs: number[]): number {
  if (xs.length === 0) throw new Error('No measurements');
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export const THRESHOLD_RATIO = 1.2;
export const THRESHOLD_MS = 300;

/** The threshold of M3: `new ≤ 1.2 × old` or `new − old ≤ 0.3 s` (times in milliseconds). */
export const withinThreshold = (oldMs: number, newMs: number): boolean =>
  newMs <= THRESHOLD_RATIO * oldMs || newMs - oldMs <= THRESHOLD_MS;

/**
 * What may be said of an error: its class and, for a ClickHouse error, the code and the type of the exception. The
 * message itself may quote a query or its parameters, so only fixed patterns are taken out of it.
 */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return 'error';
  const parts: string[] = [];
  // an error the ClickHouse client parsed: `code` and `type` are the server's own
  const { code, type } = e as { code?: unknown; type?: unknown };
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)) parts.push(`code ${code}`);
  if (typeof type === 'string' && /^[A-Z0-9_]{1,60}$/.test(type)) parts.push(type);
  if (parts.length === 0) {
    // an answer the client could not parse (the HTTP layer of the server): `Poco::Exception. Code: 1000, HTML Form Exception: …`
    const exception = /\b((?:[A-Za-z]+::)*[A-Za-z]*Exception)\b/.exec(e.message)?.[1];
    const num = /\bCode: (\d{1,6})\b/.exec(e.message)?.[1];
    const form = /\bHTML Form Exception: ([A-Za-z ]{1,60})/.exec(e.message)?.[1]?.trim();
    if (exception) parts.push(exception);
    if (num) parts.push(`code ${num}`);
    if (form) parts.push(`HTML Form Exception: ${form}`);
  }
  const name = /^[A-Za-z0-9_]{1,60}$/.test(e.name) ? e.name : 'Error';
  return parts.length > 0 ? `${name} (${parts.join(', ')})` : name;
}

/** A comparison that could not be made: which side failed, and whether both failed the same way. */
export interface Failed {
  side: 'old' | 'new' | 'both';
  /** Both sides gave the same error (the slice itself cannot be read): not a difference of the new answer. */
  same: boolean;
  old?: string;
  new?: string;
}

export function failedOf(oldError: string | undefined, newError: string | undefined): Failed | undefined {
  if (oldError === undefined && newError === undefined) return undefined;
  return {
    side: oldError !== undefined && newError !== undefined ? 'both' : oldError !== undefined ? 'old' : 'new',
    same: oldError !== undefined && oldError === newError,
    ...(oldError !== undefined ? { old: oldError } : {}),
    ...(newError !== undefined ? { new: newError } : {}),
  };
}

/**
 * Why a run proves nothing (an empty selection must not read as «equal»): no own label, no row of the new answer for
 * every ISRC under «all» (`null` = that comparison failed, which is counted elsewhere), or, in a run against a release
 * baseline (`baselineReleases` given), not one release compared or not one money row of the baseline in them. Empty = the run counts; otherwise the run ends with
 * code 1. (The releases are no longer compared with the old answer in the same process, D-257.)
 */
export function emptyRunReasons(r: {
  labels: number;
  allIsrcRows: number | null;
  baselineReleases?: number;
  /** The non-zero track and month rows of the baseline in the releases that were compared. */
  baselineMoneyRows?: number;
}): string[] {
  const out: string[] = [];
  if (r.labels === 0) out.push('no own label');
  if (r.allIsrcRows === 0) out.push('no row for every ISRC under «all»');
  if (r.baselineReleases === 0) out.push('no release compared with the baseline');
  // a baseline of zero rows only would be «equal» to anything empty
  if (r.baselineMoneyRows === 0) out.push('no money row in the baseline releases');
  return out;
}

/**
 * The exit code. 2: a difference, or a comparison where only the new answer failed. 1: something was not compared
 * (both sides or the old one failed, a call of the run failed, nothing to compare). 3: all equal, a timing outside the
 * threshold. 0: all equal and within the threshold.
 */
export const exitCodeOf = (r: { differences: number; newOnlyFailures: number; notCompared: number; timingsOutside: number }): 0 | 1 | 2 | 3 =>
  r.differences + r.newOnlyFailures > 0 ? 2 : r.notCompared > 0 ? 1 : r.timingsOutside > 0 ? 3 : 0;

// ---- The release slice against a saved baseline -------------------------------------------------------------------
// The old `release()` gave the money of a release until D-257. `--save-release-baseline` writes it down on the code
// before D-257; `--release-baseline` compares `masterRows` (scope `release`) of the final code with that file, by the
// rules above. The file holds keys (label id, UPC, ISRC, month) and money strings only: no title, no pseudonym.

/** The `n` rows with the largest `net` (a decimal string), ties by UPC. */
export function topByNet<T extends { upc: string; net: string }>(items: T[], n: number): T[] {
  return items
    .map((item) => ({ item, net: new Decimal(item.net) }))
    .sort((a, b) => b.net.comparedTo(a.net) || (a.item.upc < b.item.upc ? -1 : a.item.upc > b.item.upc ? 1 : 0))
    .slice(0, n)
    .map((x) => x.item);
}

/** The money of a row as the JSON of the old answer gives it: plain decimal strings, the reasons in its order. */
export interface BaselineMoney {
  net: string;
  B: string;
  C: string;
  ours: string;
  cByReason: Record<string, string>;
}
export type BaselineTrack = { isrc: string } & BaselineMoney;
export type BaselineMonth = { reportingMonth: string } & BaselineMoney;
export interface BaselineRelease {
  upc: string;
  tracks: BaselineTrack[];
  months: BaselineMonth[];
}
/** The time of the old `release()` of the largest release of a book: taken in the process that saved the baseline. */
export interface BaselineTiming {
  upc: string;
  ms: number[];
  medianMs: number;
  /** The size of the old JSON answer (a number only; the answer itself is not kept). */
  bytes: number;
}
export interface BaselineBook {
  /** `book N` in the order of the label list of the saving run, or `all`. */
  book: string;
  labelId: string | null;
  /** The fingerprint of the data the baseline was taken on: the release list of the book (no calculation). */
  list: ListFingerprint;
  releases: BaselineRelease[];
  timing: BaselineTiming | null;
}
/** How many releases `releases(undefined, label)` lists and their `net` added up exactly. */
export interface ListFingerprint {
  releases: number;
  net: string;
}
export const listFingerprint = (items: { net: string }[]): ListFingerprint => ({
  releases: items.length,
  net: items.reduce((sum, x) => sum.add(new Decimal(x.net)), ZERO).toJSON(),
});
/** The same list: the same count and the same sum (as amounts, not as text). */
export const sameFingerprint = (a: ListFingerprint, b: ListFingerprint): boolean =>
  a.releases === b.releases && new Decimal(a.net).equals(new Decimal(b.net));
/** The message of a run whose release lists are not those the baseline was taken on. */
export const DATA_CHANGED = 'the data changed since the baseline was taken';
export const BASELINE_KIND = 'master-rows-release-baseline';
export interface ReleaseBaseline {
  kind: typeof BASELINE_KIND;
  version: 1;
  takenAt: string;
  /** The load average (1, 5, 15 minutes) when the baseline was saved: its timings were taken under it. */
  loadavg: number[];
  /** The own labels of the saving run («all» is one more entry). */
  books: number;
  topReleases: number;
  rounds: number;
  entries: BaselineBook[];
}

const AMOUNT_RE = /^-?\d+(\.\d+)?$/;
const REASON_RE = /^[a-z][a-z0-9_]{0,60}$/;
/** A key of the file: an ISRC, a UPC, a label id. Never free text. */
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isKey = (x: unknown): x is string => typeof x === 'string' && KEY_RE.test(x);
const isAmount = (x: unknown): x is string => typeof x === 'string' && AMOUNT_RE.test(x);

/** What of a row the baseline does not take (never the value itself). */
export type BadField = 'upc' | 'isrc' | 'month' | 'amount' | 'reason';

function moneyOrWhy(x: unknown): { ok: true; money: BaselineMoney } | { ok: false; why: 'amount' | 'reason' } {
  const amount = { ok: false as const, why: 'amount' as const };
  if (!isRecord(x)) return amount;
  let j: unknown;
  try {
    j = JSON.parse(JSON.stringify({ net: x.net, B: x.B, C: x.C, ours: x.ours, cByReason: x.cByReason }));
  } catch {
    return amount;
  }
  if (!isRecord(j) || !isAmount(j.net) || !isAmount(j.B) || !isAmount(j.C) || !isAmount(j.ours)) return amount;
  if (!isRecord(j.cByReason)) return { ok: false, why: 'reason' };
  const cByReason: Record<string, string> = {};
  for (const [k, v] of Object.entries(j.cByReason)) {
    if (!REASON_RE.test(k)) return { ok: false, why: 'reason' };
    if (!isAmount(v)) return amount;
    cByReason[k] = v;
  }
  return { ok: true, money: { net: j.net, B: j.B, C: j.C, ours: j.ours, cByReason } };
}

/**
 * The money fields of a row of unknown shape (a row of the old answer, whose amounts are `Decimal`, or a row of the
 * file, whose amounts are strings): through JSON, so both give the same strings. `undefined` = not a money row.
 */
export function baselineMoney(x: unknown): BaselineMoney | undefined {
  const made = moneyOrWhy(x);
  return made.ok ? made.money : undefined;
}

/** The message of the save mode on a code where `release()` has no money (D-257 and later). */
export const NO_MONEY_HERE = 'release() gives no money here: the baseline is taken on the code before D-257';

/**
 * The baseline record of one release from the old answer of `release(upc, label)`, read as unknown (the final code has
 * no money fields in its type): the keys and the money of its tracks and months, nothing else. `no_money` = the
 * answer has no money (a track without `net`, no `months`); otherwise the field the file does not take: the UPC, an
 * ISRC, a month, an amount, a C reason.
 */
export function baselineReleaseOf(upc: string, answer: unknown): { ok: true; release: BaselineRelease } | { ok: false; reason: 'no_money' | BadField } {
  if (!isRecord(answer) || !Array.isArray(answer.tracks) || !Array.isArray(answer.months)) return { ok: false, reason: 'no_money' };
  const rows: unknown[] = [...(answer.tracks as unknown[]), ...(answer.months as unknown[])];
  if (rows.some((r) => !isRecord(r) || r.net === undefined)) return { ok: false, reason: 'no_money' };
  if (!isKey(upc)) return { ok: false, reason: 'upc' };
  const tracks: BaselineTrack[] = [];
  for (const t of answer.tracks as Record<string, unknown>[]) {
    if (!isKey(t.isrc)) return { ok: false, reason: 'isrc' };
    const made = moneyOrWhy(t);
    if (!made.ok) return { ok: false, reason: made.why };
    tracks.push({ isrc: t.isrc, ...made.money });
  }
  const months: BaselineMonth[] = [];
  for (const m of answer.months as Record<string, unknown>[]) {
    if (typeof m.reportingMonth !== 'string' || !MONTH_RE.test(m.reportingMonth)) return { ok: false, reason: 'month' };
    const made = moneyOrWhy(m);
    if (!made.ok) return { ok: false, reason: made.why };
    months.push({ reportingMonth: m.reportingMonth, ...made.money });
  }
  return { ok: true, release: { upc, tracks, months } };
}

const BAD_FIELD: Record<BadField, string> = {
  upc: 'the UPC is not a key',
  isrc: 'an ISRC is not a key',
  month: 'a month is not YYYY-MM',
  amount: 'an amount is not a plain decimal string',
  reason: 'a C reason is not a reason code',
};
/** The refusal of the save mode for one release: its place in the book and the field, never the value. */
export const badRowText = (book: string, place: number, of: number, field: BadField): string =>
  `${book}: release ${place} of ${of}: ${BAD_FIELD[field]} in the old answer (the baseline takes keys and amounts only)`;

/**
 * A baseline file read back: checked field by field (nothing but keys, months and amounts gets through). Its header
 * is checked against its own content (`books` = the entries of a label, one entry «all», at most `topReleases`
 * releases a book and no more than its list has, `rounds` times a timing) and, with `expected`, against the constants
 * of the run.
 */
export function parseBaseline(
  x: unknown,
  expected?: { topReleases: number; rounds: number },
): { ok: true; baseline: ReleaseBaseline } | { ok: false; reason: string } {
  const bad = (reason: string) => ({ ok: false as const, reason });
  if (!isRecord(x) || x.kind !== BASELINE_KIND || x.version !== 1) return bad('not a release baseline of version 1');
  if (typeof x.takenAt !== 'string' || Number.isNaN(Date.parse(x.takenAt))) return bad('no date of the baseline');
  const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!int(x.books) || !int(x.topReleases) || !int(x.rounds) || !Array.isArray(x.entries)) return bad('a broken header');
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!Array.isArray(x.loadavg) || x.loadavg.length !== 3 || !(x.loadavg as unknown[]).every(finite)) return bad('no load average of the baseline');
  if (expected && (x.topReleases !== expected.topReleases || x.rounds !== expected.rounds)) return bad('taken with another number of releases or rounds than this run uses');
  const entries: BaselineBook[] = [];
  for (const e of x.entries as unknown[]) {
    if (!isRecord(e) || typeof e.book !== 'string' || !/^(all|book \d{1,4})$/.test(e.book)) return bad('a broken book');
    if (!(e.labelId === null || isKey(e.labelId)) || (e.labelId === null) !== (e.book === 'all') || !Array.isArray(e.releases)) return bad('a broken book');
    const list = e.list;
    if (!isRecord(list) || !int(list.releases) || !isAmount(list.net)) return bad('a broken fingerprint of a release list');
    if (e.releases.length > x.topReleases || e.releases.length > list.releases) return bad('more releases in a book than the header allows');
    const releases: BaselineRelease[] = [];
    for (const r of e.releases as unknown[]) {
      if (!isRecord(r) || !isKey(r.upc)) return bad('a broken release');
      const made = baselineReleaseOf(r.upc, r);
      if (!made.ok) return bad('a broken release');
      releases.push(made.release);
    }
    let timing: BaselineTiming | null = null;
    if (e.timing !== null) {
      const t = e.timing;
      const ms = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
      if (!isRecord(t) || !isKey(t.upc) || !Array.isArray(t.ms) || t.ms.length === 0 || !(t.ms as unknown[]).every(ms) || !ms(t.medianMs) || !int(t.bytes)) return bad('a broken timing');
      if (!releases.some((r) => r.upc === t.upc)) return bad('a timing of a release that is not in the baseline');
      if (t.ms.length !== x.rounds) return bad('a timing of another number of rounds than the header says');
      timing = { upc: t.upc, ms: t.ms as number[], medianMs: t.medianMs, bytes: t.bytes };
    }
    entries.push({ book: e.book, labelId: e.labelId, list: { releases: list.releases, net: list.net }, releases, timing });
  }
  if (entries.filter((e) => e.labelId !== null).length !== x.books || entries.filter((e) => e.labelId === null).length !== 1) return bad('the header names another number of books than the file has');
  return {
    ok: true,
    baseline: { kind: BASELINE_KIND, version: 1, takenAt: x.takenAt, loadavg: x.loadavg as number[], books: x.books, topReleases: x.topReleases, rounds: x.rounds, entries },
  };
}

/** The message of a run whose books are not those of the baseline. */
export const OTHER_BOOKS = 'baseline of another organization or label set';

/** The books of the baseline are exactly the books of the run, by label id (`null` = «all»), each once. */
export function sameBooks(baseline: { labelId: string | null }[], run: (string | null)[]): boolean {
  const a = baseline.map((e) => e.labelId ?? '');
  const b = run.map((id) => id ?? '');
  const distinct = new Set(a);
  return a.length === b.length && distinct.size === a.length && new Set(b).size === b.length && b.every((id) => distinct.has(id));
}

/** The sums of a baseline row (its strings read exactly). */
export const baselineSums = (m: BaselineMoney): Sums => ({
  net: new Decimal(m.net),
  B: new Decimal(m.B),
  C: new Decimal(m.C),
  ours: new Decimal(m.ours),
  cByReason: Object.fromEntries(Object.entries(m.cByReason).map(([k, v]) => [k, new Decimal(v)])) as Sums['cByReason'],
});

/** One part of the comparison of a release: the rows by ISRC, the rows by month, the totals. */
export interface ReleasePart {
  part: 'isrc' | 'month' | 'totals';
  oldRows: number;
  newRows: number;
  differences: Difference[];
}

/**
 * A release of the baseline against the two answers of `masterRows` (scope `release`, the grains `isrc` and `month`):
 * the comparison D-257 removed, with the baseline in the place of the old answer. The tracks against the rows by ISRC
 * (a track of the old answer has no months: the money alone), the months against the rows by month (`reportingMonth`
 * is `month`; a row by month that carries `months` differs), the totals against the old tracks added up, and the same
 * totals at both grains. Zero rows are dropped on both sides; a key of one side is a difference.
 */
export function compareReleaseWithBaseline(
  old: BaselineRelease,
  byIsrc: { rows: MasterRow[]; totals: Sums },
  byMonth: { rows: MasterRow[]; totals: Sums },
): ReleasePart[] {
  const tracks = old.tracks.map((t) => ({ isrc: t.isrc, ...baselineSums(t) }));
  const months = old.months.map((m) => ({ reportingMonth: m.reportingMonth, ...baselineSums(m) }));
  const tracksOld = oldPairs(tracks, (t) => t.isrc);
  const tracksNew = newPairs(byIsrc.rows, (r) => r.isrc as string, { months: false });
  const monthsOld = oldPairs(months, (m) => m.reportingMonth);
  const monthsNew = newPairs(byMonth.rows, (r) => r.month as string, { months: true });
  const totals = diffTotals(tracks, byIsrc.totals);
  const a = moneyText(byIsrc.totals);
  const b = moneyText(byMonth.totals);
  if (a !== b) totals.push({ key: 'totals (by ISRC against by month)', old: a, new: b });
  return [
    { part: 'isrc', oldRows: tracksOld.length, newRows: tracksNew.length, differences: diffPairs(tracksOld, tracksNew) },
    { part: 'month', oldRows: monthsOld.length, newRows: monthsNew.length, differences: diffPairs(monthsOld, monthsNew) },
    { part: 'totals', oldRows: 1, newRows: 1, differences: totals },
  ];
}

/** The arguments of the script: `[dataDir] [--save-release-baseline <file> | --release-baseline <file>]`. */
export type Args = { ok: true; dataDir?: string; save?: string; baseline?: string } | { ok: false; error: string };

export function parseArgs(argv: string[]): Args {
  const out: { ok: true; dataDir?: string; save?: string; baseline?: string } = { ok: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--save-release-baseline' || a === '--release-baseline') {
      const key = a === '--save-release-baseline' ? 'save' : 'baseline';
      const value = argv[++i];
      if (value === undefined || value === '' || value.startsWith('--')) return { ok: false, error: `${a} needs a file` };
      if (out[key] !== undefined) return { ok: false, error: `${a} is given twice` };
      out[key] = value;
    } else if (a.startsWith('--')) return { ok: false, error: `unknown option ${a}` };
    else if (out.dataDir !== undefined) return { ok: false, error: 'more than one data directory' };
    else out.dataDir = a;
  }
  if (out.save !== undefined && out.baseline !== undefined) return { ok: false, error: '--save-release-baseline and --release-baseline do not go together' };
  return out;
}
