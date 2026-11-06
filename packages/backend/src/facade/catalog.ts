import { ConflictError, ValidationError } from '../shared/errors';
import { assertDate, inMonthRange, monthOf, monthStart } from '../shared/dates';
import { assertIsrc } from '../shared/identifiers';
import { Decimal, ZERO } from '../shared/money';
import type { TrackLabelView } from '../modules/owners';
import type { FacadeContext } from './context';
import type { PeriodFilter, UnitResult } from './calculation';
import { ALL_VIEWER, labelForbidden, type Viewer } from './viewer';

/**
 * The label history of an ISRC (D-172, plan «этап4_онбординг.md» §1.5): navigation, not money (README §1 п. 8). The
 * calculation never reads it (`boundaries.test.ts`); the signals `catalogOutsideAccount` / `tracksWithoutLabel` compare
 * it with the books of the units. Intervals `[validFrom, validTo)` from the first of a month (M52); `source = 'files'`
 * is derived from the loaded files (rebuilt, never edited by hand), `source = 'operator'` is a correction that wins only
 * its own months.
 */

// ---------------------------------------------------------------- pure: the derivation from the files

/** One observation: the ISRC is in a loaded file of `labelId` whose reporting month is `month` (YYYY-MM). */
export interface Observation {
  month: string;
  labelId: string;
  /** When the file was loaded (the tie rule: the later file wins). */
  loadedAt: string;
}

export interface Interval {
  labelId: string;
  /** YYYY-MM-01 */
  validFrom: string;
  /** YYYY-MM-01, exclusive; null = open. */
  validTo: string | null;
}

export interface IsrcDerivation {
  /** The runs as intervals, before the operator intervals are cut out. */
  intervals: Interval[];
  /** Observations of a label outside its run (a tail: the money of such a unit is `catalogOutsideAccount`). */
  tails: { month: string; labelId: string }[];
  /** Runs opened by a label that had a run before (A → B → A). */
  returned: number;
  /** Months where two labels competed for a new run (decided by `loadedAt`, then `labelId`). */
  ties: number;
  /** Every boundary between two runs: the first month of the later run and the boundary chosen. */
  boundaries: { fromLabelId: string; toLabelId: string; firstMonth: string; boundary: string }[];
}

export const nextMonth = (m: string): string => {
  const y = Number.parseInt(m.slice(0, 4), 10);
  const mo = Number.parseInt(m.slice(5, 7), 10);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const maxMonth = (a: string, b: string) => (a > b ? a : b);
const minMonth = (a: string, b: string) => (a < b ? a : b);

/**
 * The runs of one ISRC (FIX-1): the months in order, a «current» label.
 * 1. a month where only the current label (or nothing) is observed continues its run;
 * 2. a label without a run so far opens one in the month, even when the current one is observed too (the latest wins);
 *    two such labels in one month: the one with the later loaded file, then the smaller `labelId` (`ties`);
 * 3. a label that had a run is a tail while the current label is still observed in that month or later; otherwise it
 *    returns: a new run from that month (`returned`);
 * 4. the boundary between runs A and B is `min(max(last_A + 1, start_B), first_B)`, where `start_B` is the first
 *    reporting month of any loaded file of B (the start of its account). The first run starts at its first observation,
 *    the last one is open.
 */
export function deriveIsrc(observations: readonly Observation[], startOf: ReadonlyMap<string, string>): IsrcDerivation {
  const byMonth = new Map<string, Map<string, string>>();
  for (const o of observations) {
    const m = byMonth.get(o.month) ?? new Map<string, string>();
    const prev = m.get(o.labelId);
    if (prev === undefined || o.loadedAt > prev) m.set(o.labelId, o.loadedAt);
    byMonth.set(o.month, m);
  }
  const months = [...byMonth.keys()].sort();
  const lastSeen = new Map<string, string>();
  for (const m of months) for (const l of (byMonth.get(m) as Map<string, string>).keys()) lastSeen.set(l, m);

  const runs: { labelId: string; first: string; last: string }[] = [];
  const hadRun = new Set<string>();
  const tails: { month: string; labelId: string }[] = [];
  let returned = 0;
  let ties = 0;
  let cur: (typeof runs)[number] | undefined;
  for (const m of months) {
    const labels = byMonth.get(m) as Map<string, string>;
    const pick = (cands: string[]): string => {
      if (cands.length > 1) ties += 1;
      const sorted = [...cands].sort((a, b) => {
        const la = labels.get(a) as string;
        const lb = labels.get(b) as string;
        return la !== lb ? (la > lb ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0;
      });
      return sorted[0] as string;
    };
    const open = (labelId: string) => {
      cur = { labelId, first: m, last: m };
      runs.push(cur);
      hadRun.add(labelId);
    };
    const fresh = [...labels.keys()].filter((l) => !hadRun.has(l));
    if (!cur || fresh.length > 0) open(pick(fresh.length > 0 ? fresh : [...labels.keys()]));
    else if (labels.has(cur.labelId)) cur.last = m;
    // only labels that had a run: tails while the current label is still observed later, else a return
    else if ((lastSeen.get(cur.labelId) ?? '') <= m) {
      open(pick([...labels.keys()]));
      returned += 1;
    }
    const current = cur as (typeof runs)[number];
    for (const l of labels.keys()) if (l !== current.labelId) tails.push({ month: m, labelId: l });
  }

  const starts: string[] = runs.map((r, i) => {
    if (i === 0) return r.first;
    const prev = runs[i - 1] as (typeof runs)[number];
    const startB = startOf.get(r.labelId) ?? r.first;
    return minMonth(maxMonth(nextMonth(prev.last), startB), r.first);
  });
  const intervals = runs.map((r, i) => ({
    labelId: r.labelId,
    validFrom: monthStart(starts[i] as string),
    validTo: i + 1 < runs.length ? monthStart(starts[i + 1] as string) : null,
  }));
  const boundaries = runs.slice(1).map((r, i) => ({
    fromLabelId: (runs[i] as (typeof runs)[number]).labelId,
    toLabelId: r.labelId,
    firstMonth: r.first,
    boundary: starts[i + 1] as string,
  }));
  return { intervals, tails, returned, ties, boundaries };
}

/** `a < b` for exclusive ends where null is +∞. */
const endBefore = (a: string | null, b: string | null) => a !== null && (b === null || a < b);
const overlaps = (a: { validFrom: string; validTo: string | null }, b: { validFrom: string; validTo: string | null }) =>
  endBefore(a.validFrom, b.validTo) && endBefore(b.validFrom, a.validTo);

/** The derived intervals minus the months of the operator intervals (FIX-2): shortened or split, never moved. */
export function cutByOperator(
  intervals: readonly Interval[],
  operator: readonly { validFrom: string; validTo: string | null }[],
): Interval[] {
  let out = [...intervals];
  for (const op of operator) {
    const next: Interval[] = [];
    for (const iv of out) {
      if (!overlaps(iv, op)) {
        next.push(iv);
        continue;
      }
      if (iv.validFrom < op.validFrom) next.push({ ...iv, validTo: op.validFrom });
      if (op.validTo !== null && endBefore(op.validTo, iv.validTo)) next.push({ ...iv, validFrom: op.validTo });
    }
    out = next;
  }
  return out.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}

/** The interval of the history holding month `m` (YYYY-MM). */
export function labelAt<T extends { validFrom: string; validTo: string | null }>(history: readonly T[], m: string): T | undefined {
  const d = monthStart(m);
  return history.find((h) => h.validFrom <= d && (h.validTo === null || d < h.validTo));
}

// ---------------------------------------------------------------- pure: the two signals

export interface CatalogOutsideAccount {
  isrc: string;
  account: string;
  bookLabelId: string;
  catalogLabelId: string | null;
  firstMonth: string;
  lastMonth: string;
  units: number;
  net: Decimal;
}
export interface TrackWithoutLabel {
  isrc: string;
  lastMonth: string;
  bookLabelId: string | null;
  net: Decimal;
}

/**
 * `catalogOutsideAccount`: units of an ISRC with a history whose book (the label of the file) is not the catalog label of
 * the ISRC in their reporting month (`catalogLabelId` null: no interval holds the month). `tracksWithoutLabel`: ISRCs
 * of the units with no interval holding their last reporting month (the book of that month's first unit). Units without
 * a book (a file without a label) are only in the second list. Information only: the money stays in the book.
 */
export function catalogSignals(
  units: readonly Pick<UnitResult, 'isrc' | 'account' | 'bookLabelId' | 'reportingMonth' | 'salesMonth' | 'net'>[],
  history: readonly Pick<TrackLabelView, 'isrc' | 'labelId' | 'validFrom' | 'validTo'>[],
  f: PeriodFilter = {},
): { catalogOutsideAccount: CatalogOutsideAccount[]; tracksWithoutLabel: TrackWithoutLabel[] } {
  const byIsrc = new Map<string, Pick<TrackLabelView, 'labelId' | 'validFrom' | 'validTo'>[]>();
  for (const h of history) (byIsrc.get(h.isrc) ?? byIsrc.set(h.isrc, []).get(h.isrc))?.push(h);
  const outside = new Map<string, CatalogOutsideAccount>();
  const last = new Map<string, TrackWithoutLabel>();
  for (const u of units) {
    if (u.isrc === '') continue;
    if (!inMonthRange((f.basis ?? 'report') === 'sales' ? u.salesMonth : u.reportingMonth, f.from, f.to)) continue;
    const hist = byIsrc.get(u.isrc) ?? [];
    const l = last.get(u.isrc);
    if (!l || u.reportingMonth > l.lastMonth)
      last.set(u.isrc, { isrc: u.isrc, lastMonth: u.reportingMonth, bookLabelId: u.bookLabelId, net: (l?.net ?? ZERO).add(u.net) });
    else l.net = l.net.add(u.net);
    if (u.bookLabelId === null || hist.length === 0) continue;
    const catalog = labelAt(hist, u.reportingMonth)?.labelId ?? null;
    if (catalog === u.bookLabelId) continue;
    const k = `${u.isrc}|${u.account}|${u.bookLabelId}|${catalog ?? ''}`;
    const r = outside.get(k);
    if (!r)
      outside.set(k, {
        isrc: u.isrc,
        account: u.account,
        bookLabelId: u.bookLabelId,
        catalogLabelId: catalog,
        firstMonth: u.reportingMonth,
        lastMonth: u.reportingMonth,
        units: 1,
        net: u.net,
      });
    else {
      r.firstMonth = minMonth(r.firstMonth, u.reportingMonth);
      r.lastMonth = maxMonth(r.lastMonth, u.reportingMonth);
      r.units += 1;
      r.net = r.net.add(u.net);
    }
  }
  const tracksWithoutLabel = [...last.values()]
    .filter((t) => !labelAt(byIsrc.get(t.isrc) ?? [], t.lastMonth))
    .sort((a, b) => b.net.cmp(a.net) || a.isrc.localeCompare(b.isrc));
  const catalogOutsideAccount = [...outside.values()].sort(
    (a, b) => a.isrc.localeCompare(b.isrc) || a.account.localeCompare(b.account) || a.firstMonth.localeCompare(b.firstMonth),
  );
  return { catalogOutsideAccount, tracksWithoutLabel };
}

// ---------------------------------------------------------------- the facade methods

export interface DeriveReport {
  isrcs: number;
  intervals: { one: number; two: number; threeOrMore: number };
  returned: number;
  ties: number;
  tails: { isrcs: number; observations: number };
  withOperator: number;
  changedIsrcs: number;
  unchangedIsrcs: number;
  inserted: number;
  deleted: number;
  filesWithoutLabel: number;
  /** `fromLabelId → toLabelId | first month of the later run | boundary` → ISRCs. */
  boundaries: { fromLabelId: string; toLabelId: string; firstMonth: string; boundary: string; isrcs: number }[];
  applied: boolean;
}

const rowKey = (r: Interval) => `${r.labelId}|${r.validFrom}|${r.validTo ?? ''}`;
/** M52: a date of the history is the first of its month. */
const floorToMonth = (d: string) => monthStart(monthOf(assertDate(d)));

export function catalogApi(ctx: FacadeContext) {
  const { db, owners, labels, sources, assertOwnLabel } = ctx;

  /** The observations of the loaded labelled Believe files (one ClickHouse read) and the first month of each label. */
  async function observations(isrcs?: string[]) {
    const files = (await sources.listFiles()).filter((f) => f.status === 'loaded' && f.source === 'believe');
    const labelled = files.filter((f) => f.labelId !== null);
    const startOf = new Map<string, string>();
    for (const f of labelled) {
      const l = f.labelId as string;
      const s = startOf.get(l);
      if (s === undefined || f.reportingMonth < s) startOf.set(l, f.reportingMonth);
    }
    const byId = new Map(labelled.map((f) => [f.id, f]));
    const byIsrc = new Map<string, Observation[]>();
    for (const p of await sources.isrcFilePairs(labelled.map((f) => f.id), isrcs)) {
      const file = byId.get(p.fileId);
      if (!file) continue;
      const list = byIsrc.get(p.isrc) ?? byIsrc.set(p.isrc, []).get(p.isrc);
      list?.push({ month: p.reportingMonth, labelId: file.labelId as string, loadedAt: file.updatedAt });
    }
    return { byIsrc, startOf, filesWithoutLabel: files.length - labelled.length };
  }

  /** The derivation (and, with `apply`, the rewrite of the `files` rows) of the given ISRCs or of every ISRC. */
  async function derive(opts: { apply: boolean; isrcs?: string[] }): Promise<DeriveReport> {
    const { byIsrc, startOf, filesWithoutLabel } = await observations(opts.isrcs);
    const existing = await owners.trackLabels.list(opts.isrcs ? { isrcs: opts.isrcs } : {});
    const exByIsrc = new Map<string, TrackLabelView[]>();
    for (const r of existing) (exByIsrc.get(r.isrc) ?? exByIsrc.set(r.isrc, []).get(r.isrc))?.push(r);
    const all = new Set([...byIsrc.keys(), ...existing.filter((r) => r.source === 'files').map((r) => r.isrc), ...(opts.isrcs ?? [])]);
    const report: DeriveReport = {
      isrcs: 0,
      intervals: { one: 0, two: 0, threeOrMore: 0 },
      returned: 0,
      ties: 0,
      tails: { isrcs: 0, observations: 0 },
      withOperator: 0,
      changedIsrcs: 0,
      unchangedIsrcs: 0,
      inserted: 0,
      deleted: 0,
      filesWithoutLabel,
      boundaries: [],
      applied: opts.apply,
    };
    const boundaries = new Map<string, DeriveReport['boundaries'][number]>();
    const changes: { isrc: string; rows: Interval[] }[] = [];
    for (const isrc of [...all].sort()) {
      const d = deriveIsrc(byIsrc.get(isrc) ?? [], startOf);
      const ex = exByIsrc.get(isrc) ?? [];
      const operator = ex.filter((r) => r.source === 'operator');
      const rows = cutByOperator(d.intervals, operator);
      if (d.intervals.length > 0) report.isrcs += 1;
      const n = d.intervals.length;
      if (n === 1) report.intervals.one += 1;
      else if (n === 2) report.intervals.two += 1;
      else if (n >= 3) report.intervals.threeOrMore += 1;
      report.returned += d.returned;
      report.ties += d.ties;
      if (d.tails.length > 0) {
        report.tails.isrcs += 1;
        report.tails.observations += d.tails.length;
      }
      if (operator.length > 0) report.withOperator += 1;
      for (const b of d.boundaries) {
        const k = `${b.fromLabelId}|${b.toLabelId}|${b.firstMonth}|${b.boundary}`;
        const e = boundaries.get(k) ?? { ...b, isrcs: 0 };
        e.isrcs += 1;
        boundaries.set(k, e);
      }
      const before = new Set(ex.filter((r) => r.source === 'files').map(rowKey));
      const after = new Set(rows.map(rowKey));
      const inserted = [...after].filter((k) => !before.has(k)).length;
      const deleted = [...before].filter((k) => !after.has(k)).length;
      if (inserted === 0 && deleted === 0) {
        report.unchangedIsrcs += 1;
        continue;
      }
      report.changedIsrcs += 1;
      report.inserted += inserted;
      report.deleted += deleted;
      changes.push({ isrc, rows });
    }
    report.boundaries = [...boundaries.values()].sort(
      (a, b) => a.fromLabelId.localeCompare(b.fromLabelId) || a.toLabelId.localeCompare(b.toLabelId) || a.firstMonth.localeCompare(b.firstMonth) || a.boundary.localeCompare(b.boundary),
    );
    if (opts.apply) for (const c of changes) await owners.trackLabels.replaceOfIsrc(c.isrc, 'files', c.rows);
    return report;
  }

  async function history(isrc: string) {
    const [rows, list] = [await owners.trackLabels.list({ isrcs: [isrc] }), await labels.listLabels()];
    const names = new Map(list.map((l) => [l.id, l.name]));
    return rows.map((r) => ({
      id: r.id,
      labelId: r.labelId,
      labelName: names.get(r.labelId) ?? '?',
      validFrom: r.validFrom,
      validTo: r.validTo,
      source: r.source,
      note: r.note,
      createdAt: r.createdAt,
    }));
  }

  return {
    /** The label history of one ISRC by `validFrom` (D-172); none = `[]`. Navigation only. */
    async trackLabels(isrcRaw: string) {
      const isrc = assertIsrc(isrcRaw);
      return db.snapshot(() => history(isrc));
    },

    /**
     * Sets (or replaces) an operator interval of the history of an ISRC (D-172, FIX-2): `[from, to)` floored to the
     * first of the month (M52; `to` empty = open). A `from` equal to that of an operator interval of the ISRC replaces
     * it (label, end, note: the way to fix it from its first month and to close it); otherwise a new operator interval,
     * which may not overlap another operator one (`409 catalog_overlap`). The `files` intervals of the ISRC are rebuilt
     * in the same transaction: the operator interval wins only its own months. A viewer of some labels sets only its
     * label and touches only intervals of its labels (`403 label_forbidden`).
     */
    async setTrackLabel(
      isrcRaw: string,
      input: { labelId: string; from: string; to?: string | null; note?: string | null },
      viewer: Viewer = ALL_VIEWER,
    ) {
      const isrc = assertIsrc(isrcRaw);
      await assertOwnLabel(input.labelId);
      const mine = (l: string) => viewer.kind === 'all' || viewer.labelIds.includes(l);
      if (!mine(input.labelId)) throw labelForbidden();
      const from = floorToMonth(input.from);
      const to = input.to === null || input.to === undefined || input.to === '' ? null : floorToMonth(input.to);
      if (to !== null && to <= from)
        throw new ValidationError(
          `The period ${from} .. ${to} is empty after flooring the end date to the month start`,
          { validFrom: from, validTo: to },
          'empty_period',
        );
      const want = { validFrom: from, validTo: to };
      return db.transaction(async () => {
        const ex = await owners.trackLabels.list({ isrcs: [isrc] });
        const operator = ex.filter((r) => r.source === 'operator');
        const same = operator.find((r) => r.validFrom === from);
        const note = input.note === undefined ? (same?.note ?? null) : input.note;
        if (same && same.labelId === input.labelId && same.validTo === to && same.note === note)
          throw new ConflictError('The interval already says this', 'catalog_same_label', {
            interval: { id: same.id, labelId: same.labelId, validFrom: same.validFrom, validTo: same.validTo },
          });
        const clash = operator.find((r) => r !== same && overlaps(r, want));
        if (clash)
          throw new ConflictError('The interval overlaps another operator interval of this ISRC', 'catalog_overlap', {
            interval: { id: clash.id, labelId: clash.labelId, validFrom: clash.validFrom, validTo: clash.validTo },
          });
        // the viewer touches only intervals of its labels: the replaced one and every interval of the new months
        if (viewer.kind !== 'all' && ((same && !mine(same.labelId)) || ex.some((r) => overlaps(r, want) && !mine(r.labelId))))
          throw labelForbidden();
        // the files rows go first (the EXCLUDE constraint), then the operator row, then the files rows rebuilt
        await owners.trackLabels.replaceOfIsrc(isrc, 'files', []);
        await owners.trackLabels.upsert({
          id: same?.id,
          isrc,
          labelId: input.labelId,
          validFrom: from,
          validTo: to,
          source: 'operator',
          note,
        });
        await derive({ apply: true, isrcs: [isrc] });
        return history(isrc);
      });
    },

    /**
     * Derives the `files` intervals of the history from the loaded files (D-172, FIX-1; `deriveIsrc`, then the operator
     * intervals cut out). Dry run by default; `apply` rewrites the `files` rows of the changed ISRCs in one write
     * transaction (the operator rows are never touched). Idempotent: a second run changes nothing.
     */
    async deriveTrackLabels(opts: { apply?: boolean; isrcs?: string[] } = {}): Promise<DeriveReport> {
      const isrcs = opts.isrcs?.map(assertIsrc);
      const run = () => derive({ apply: opts.apply === true, isrcs });
      return opts.apply ? db.transaction(run) : db.snapshot(run);
    },

    /** The open interval of every ISRC that has one (the catalog label now), with the label names. */
    async openCatalog(): Promise<Map<string, { labelId: string; labelName: string; validFrom: string }>> {
      const [rows, list] = await db.snapshot(async () => [await owners.trackLabels.list(), await labels.listLabels()] as const);
      const names = new Map(list.map((l) => [l.id, l.name]));
      return new Map(
        rows
          .filter((r) => r.validTo === null)
          .map((r) => [r.isrc, { labelId: r.labelId, labelName: names.get(r.labelId) ?? '?', validFrom: r.validFrom }]),
      );
    },
  };
}
