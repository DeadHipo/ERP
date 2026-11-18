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

/** The `n` rows with the largest `net` (a decimal string), ties by UPC. */
export function topByNet<T extends { upc: string; net: string }>(items: T[], n: number): T[] {
  return items
    .map((item) => ({ item, net: new Decimal(item.net) }))
    .sort((a, b) => b.net.comparedTo(a.net) || (a.item.upc < b.item.upc ? -1 : a.item.upc > b.item.upc ? 1 : 0))
    .slice(0, n)
    .map((x) => x.item);
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
 * every ISRC under «all» (`null` = that comparison failed, which is counted elsewhere), or, while releases are compared
 * with the old answer, not one release compared. Empty = the run counts; otherwise the run ends with code 1.
 */
export function emptyRunReasons(r: { labels: number; allIsrcRows: number | null; releasesCompared: number; compareReleases: boolean }): string[] {
  const out: string[] = [];
  if (r.labels === 0) out.push('no own label');
  if (r.allIsrcRows === 0) out.push('no row for every ISRC under «all»');
  if (r.compareReleases && r.releasesCompared === 0) out.push('no release compared');
  return out;
}

/**
 * The exit code. 2: a difference, or a comparison where only the new answer failed. 1: something was not compared
 * (both sides or the old one failed, a call of the run failed, nothing to compare). 3: all equal, a timing outside the
 * threshold. 0: all equal and within the threshold.
 */
export const exitCodeOf = (r: { differences: number; newOnlyFailures: number; notCompared: number; timingsOutside: number }): 0 | 1 | 2 | 3 =>
  r.differences + r.newOnlyFailures > 0 ? 2 : r.notCompared > 0 ? 1 : r.timingsOutside > 0 ? 3 : 0;
