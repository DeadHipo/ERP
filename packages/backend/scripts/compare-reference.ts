/**
 * Proves a rework did not change the calculation: reads the reference answers of the API saved before the work
 * (`data/backup/2026-11-05-before-org/reference/*.json`), asks the running API the same GETs and prints the
 * differences field by field. The spec is the table of §6 in `docs/идеи/лейбл_с_нуля/api/этап1_D-169.md` and §3 of
 * `docs/идеи/лейбл_с_нуля/инструкция_агенту.md`.
 *
 *   npx tsx packages/backend/scripts/compare-reference.ts [referenceDir] [--api http://localhost:3001] [--strict]
 *       [--cookie <value>] [--org-cookie <value>]
 *
 * Default mode (after a stage): the money invariants must match; the books (`byLabel`) may move, the move is printed
 * and checked (a Believe row sits in the one book of its account, publishing in 0to8, Σ books = the row, ads only
 * 0to8); owners whose `recouped` / `payable` changed are listed, not failed.
 * `--strict` (the first load on a clean stack, before any stage code): the books, `recouped`, `payable`,
 * `payableShown` and the per-label payables must match too; the book check is off.
 *
 * Owners are keyed by `name|kind` (ids are not stable across rebuilds), the duplicates ordered by earned, waiting,
 * paid; labels by name. People's names are never printed: an owner shows as its new `ownerId` (`ref:<id>` when it is
 * missing in the API), a sublabel as its id. Decimal strings are equal when equal as decimals (`1.50` = `1.5`).
 * `--cookie` and `--org-cookie` are both sent in the `Cookie` header.
 *
 * Read-only: GET requests only. Exit 0 = invariants hold, 1 = a violation, 2 = the comparison could not run.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Decimal } from '../src/shared/money';

// ---------------------------------------------------------------- shapes (only what is compared)

type Money = string;
type Totals = Record<
  'received' | 'notOurs' | 'waiting' | 'ourShare' | 'ourShareNoSplit' | 'discrepancy',
  Money
>;
type Book = Record<'A_received' | 'B_notOurs' | 'C_waiting' | 'ourShare' | 'ourShareNoSplit', Money>;
type ReconRow = {
  source: string;
  account: string;
  month: string;
  A_received: Money;
  B_notOurs: Money;
  C_waiting: Money;
  C_breakdown: Record<string, Money>;
  ourShare: Money;
  ourShareByLabel: Record<string, Money>;
  ourShareNoSplit: Money;
  discrepancy: Money;
  byLabel: Record<string, Book>;
  fileTotal: Money;
  fileDiscrepancy: Money;
  negativeRemainders: number;
};
type Overview = {
  reconciliation: ReconRow[];
  totals: {
    all: Totals;
    bySource: Record<string, Totals>;
    byAccount: (Totals & { source: string; account: string })[];
    byLabel: Record<string, Totals>;
  };
  queue: { reason: string; amount: Money; groups: number; isrcs: number }[];
  signals: { name: string; count: number }[];
  files: Record<string, number>;
};
type Signals = {
  unallocated: { total: Money; withoutIsrc: Money };
  labelOutsideAccount: {
    account: string;
    month: string;
    labelName: string;
    ourLabelName: string;
    accountLabelName: string;
    net: Money;
    units: number;
  }[];
  counts: Record<string, number>;
} & Record<string, unknown>;
type Track = {
  isrc: string;
  net: Money;
  B: Money;
  C: Money;
  ours: Money;
  cByReason: Record<string, Money>;
  months: { from: string; to: string; count: number };
  hasSplit: boolean;
  hasParticipations: boolean;
};
type Payable = {
  ownerId: string;
  name: string;
  kind: string;
  status: string;
  confirmed: boolean;
  earned: Money;
  waiting: Money;
  waitingBreakdown: Record<string, Money>;
  recouped: Money;
  paid: Money;
  returns: Money;
  credits: Money;
  payable: Money;
  payableShown: Money;
  payout: { allowed: boolean; reason?: string; amountCents: number };
  adsCharged?: Money;
  /** D-173: absent in the reference (= 0). */
  buyouts?: Money;
  forgiven?: Money;
  writtenOff?: Money;
  adjustments?: Money;
};
type Label = {
  id: string;
  name: string;
  kind: string;
  ownLabelId: string | null;
  aliases: string[];
  accounts: string[];
  rules: { percent: string; validFrom: string; validTo: string | null }[];
};
type AdRow = { month: string; label: string } & Record<AdField, Money | number>;
type AdField = 'count' | 'amount' | 'recoveredFromArtists' | 'borneBySublabels' | 'borneByUs' | 'noSplit';
type Ads = { rows: AdRow[]; totals: Record<AdField, Money | number> };
type QueueGroup = {
  key: { kind: string; id: string; label: string };
  ownerId: string | null;
  amount: Money;
  isrcCount: number;
  months: { from: string; to: string };
};
type Queue = { total: number; amount: Money; items: QueueGroup[] };
type Files = { believe: { status: string; lineCount: number | null }[]; b17: unknown[] };

// ---------------------------------------------------------------- the spec

const TOTAL_FIELDS = [
  'received',
  'notOurs',
  'waiting',
  'ourShare',
  'ourShareNoSplit',
  'discrepancy',
] as const;
const BOOK_FIELDS = ['A_received', 'B_notOurs', 'C_waiting', 'ourShare', 'ourShareNoSplit'] as const;
const RECON_FIELDS = [
  'A_received',
  'B_notOurs',
  'C_waiting',
  'C_breakdown',
  'ourShare',
  'ourShareByLabel',
  'ourShareNoSplit',
  'discrepancy',
  'fileTotal',
  'fileDiscrepancy',
  'negativeRemainders',
] as const;
const TRACK_FIELDS = [
  'net',
  'B',
  'C',
  'ours',
  'cByReason',
  'months',
  'hasSplit',
  'hasParticipations',
] as const;
/** `adsCharged` is not in the answer: derived on both sides (О13). */
const OWNER_FIELDS = [
  'earned',
  'waiting',
  'waitingBreakdown',
  'paid',
  'returns',
  'credits',
  'status',
  'confirmed',
  'adsCharged',
] as const;
/** Move with the books in default mode (listed), must match in strict. */
const OWNER_BOOK_FIELDS = ['recouped', 'payable'] as const;
const AD_FIELDS: readonly AdField[] = [
  'count',
  'amount',
  'recoveredFromArtists',
  'borneBySublabels',
  'borneByUs',
  'noSplit',
];
const QUEUE_FIELDS = ['amount', 'isrcCount', 'months'] as const;
/** New signals of stage 1: must be empty when present; `adOutsideBook` is printed. */
const NEW_ZERO_SIGNALS = ['filesWithoutLabel', 'statementsWithoutLabel', 'adsWithoutLabel'] as const;
/** The book of the publishing rows after stage 1 (B17 = 0to8). */
const PUBLISHING_BOOK = '0to8';
const EXPECTED_FILES = 47;
const EXPECTED_LINES = 75_744_752;
const SHOW = 20;
/** The kinds of the payroll (D-173): none in the history (К1), so 0 on a rebuilt stack. */
const PAYROLL_KINDS = ['buyout', 'forgiveness', 'writeoff', 'adjustment'] as const;

// ---------------------------------------------------------------- arguments

const root = resolve(import.meta.dirname, '..', '..', '..');
const usage =
  'usage: npx tsx packages/backend/scripts/compare-reference.ts [referenceDir] [--api http://localhost:3001] [--strict] [--cookie <value>] [--org-cookie <value>]';
let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    allowPositionals: true,
    options: {
      api: { type: 'string', default: 'http://localhost:3001' },
      strict: { type: 'boolean', default: false },
      cookie: { type: 'string' },
      'org-cookie': { type: 'string' },
    },
  });
}
try {
  args = parse();
} catch (e) {
  console.error(`${(e as Error).message}\n${usage}`);
  process.exit(2);
}
const strict = args.values.strict;
const api = args.values.api.replace(/\/+$/, '');
const refDir = resolve(args.positionals[0] ?? join(root, 'data/backup/2026-11-05-before-org/reference'));
const cookie = [args.values.cookie, args.values['org-cookie']].filter((x): x is string => !!x).join('; ');

// ---------------------------------------------------------------- io

function readRef<T>(file: string): T {
  return JSON.parse(readFileSync(join(refDir, file), 'utf8')) as T;
}

/** One GET without a timeout (a full calculation on a loaded machine may take longer than fetch's header timeout). */
function get<T>(path: string): Promise<T> {
  const t0 = performance.now();
  return new Promise<T>((resolve, reject) => {
    const req = httpRequest(
      `${api}/api/v1${path}`,
      { method: 'GET', headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          // the body of an error is not printed: it may carry names
          if ((res.statusCode ?? 0) >= 400) return reject(new Error(`GET ${path}: HTTP ${res.statusCode}`));
          console.error(`GET ${path}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------- comparison

const DECIMAL = /^[-+]?\d+(\.\d+)?$/;
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isZeroText = (x: unknown) =>
  (typeof x === 'string' && DECIMAL.test(x) && new Decimal(x).isZero()) || x === 0;
const dec = (x: unknown) =>
  new Decimal(typeof x === 'number' ? String(x) : typeof x === 'string' && DECIMAL.test(x) ? x : '0');
const show = (x: unknown) => (x === undefined ? 'absent' : typeof x === 'string' ? x : JSON.stringify(x));

function sameScalar(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string' && DECIMAL.test(a) && DECIMAL.test(b))
    return new Decimal(a).eq(new Decimal(b));
  return false;
}

/** Field paths that differ; inside a map (C_breakdown, byLabel…) an absent key equals a zero amount. */
function differences(path: string, a: unknown, b: unknown, inMap = false): string[] {
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => differences(`${path}.${k}`, a[k], b[k], true));
  }
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => differences('', x, b[i]).length === 0)
      ? []
      : [`${path}: ref ${show(a)}, new ${show(b)}`];
  if (inMap && ((a === undefined && isZeroText(b)) || (b === undefined && isZeroText(a)))) return [];
  if (inMap && a === undefined && isRecord(b) && Object.values(b).every(isZeroText)) return [];
  if (inMap && b === undefined && isRecord(a) && Object.values(a).every(isZeroText)) return [];
  if (sameScalar(a, b)) return [];
  const delta =
    typeof a === 'string' && typeof b === 'string' && DECIMAL.test(a) && DECIMAL.test(b)
      ? ` (Δ ${new Decimal(b).sub(a).toFixed()})`
      : '';
  return [`${path}: ref ${show(a)}, new ${show(b)}${delta}`];
}

class Section {
  compared = 0;
  differing = 0;
  readonly lines: string[] = [];
  /** Printed always, after the first lines. */
  readonly tail: string[] = [];
  constructor(
    readonly name: string,
    readonly info = false,
  ) {}
  line(text: string) {
    this.lines.push(text);
  }
  /** One compared item; `diffs` empty = equal. */
  item(label: string, diffs: string[]) {
    this.compared++;
    if (diffs.length === 0) return;
    this.differing++;
    for (const d of diffs) this.line(`${label} ${d}`);
  }
}
const sections: Section[] = [];
const section = (name: string, info = false) => {
  const s = new Section(name, info);
  sections.push(s);
  return s;
};
const unknownFields: string[] = [];

/** Compares rows keyed alike on both sides, field by field. */
function compareKeyed<T extends object>(
  s: Section,
  ref: Map<string, T>,
  cur: Map<string, T>,
  fields: readonly (keyof T & string)[],
  labelOf: (key: string, ref: T | undefined, cur: T | undefined) => string = (k) => k,
) {
  for (const k of new Set([...ref.keys(), ...cur.keys()])) {
    const a = ref.get(k);
    const b = cur.get(k);
    const label = labelOf(k, a, b);
    if (!a) s.item(label, ['not in the reference']);
    else if (!b) s.item(label, ['missing in the API']);
    else
      s.item(
        label,
        fields.flatMap((f) => differences(f, a[f], b[f])),
      );
  }
}

/** Keys rows by `keyOf`; equal keys are numbered in the order of `order`. */
function keyed<T>(
  rows: T[],
  keyOf: (r: T) => string,
  order: (a: T, b: T) => number = () => 0,
): Map<string, T> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out = new Map<string, T>();
  for (const [k, g] of groups)
    [...g].sort(order).forEach((r, i) => out.set(g.length > 1 ? `${k}#${i}` : k, r));
  return out;
}

function noteUnknown(where: string, ref: unknown, cur: unknown) {
  const keysOf = (x: unknown): Set<string> => {
    if (Array.isArray(x)) return new Set(x.flatMap((r) => (isRecord(r) ? Object.keys(r) : [])));
    if (isRecord(x)) return new Set(Object.keys(x));
    return new Set();
  };
  const a = keysOf(ref);
  const extra = [...keysOf(cur)].filter((k) => !a.has(k));
  if (extra.length) unknownFields.push(`${where}: ${extra.join(', ')}`);
}

const sumFields = <F extends string>(rows: Record<F, unknown>[], fields: readonly F[]) =>
  Object.fromEntries(
    fields.map((f) => [f, rows.reduce((s, r) => s.add(dec(r[f])), new Decimal(0)).toFixed()]),
  ) as Record<F, Money>;

// ---------------------------------------------------------------- the run

async function main() {
  console.log(`mode: ${strict ? 'strict' : 'default'}; api ${api}; reference ${refDir}`);

  // labels first: they name the sublabels (never printed) and bridge the label ids of the per-label payables
  const refLabels = readRef<Label[]>('labels.json');
  const curLabels = await get<Label[]>('/labels');
  const ownNames = new Set([...refLabels, ...curLabels].filter((l) => l.kind === 'own').map((l) => l.name));
  const safeLabel = (name: string) => (ownNames.has(name) || name === '?' ? name : '<a sublabel>');
  const accountBook = new Map(
    refLabels.filter((l) => l.kind === 'own').flatMap((l) => l.accounts.map((a) => [a, l.name] as const)),
  );
  accountBook.set('b17', PUBLISHING_BOOK);

  {
    const s = section('labels');
    const norm = (ls: Label[]) => {
      const nameOf = new Map(ls.map((l) => [l.id, l.name]));
      return keyed(
        ls.map((l) => ({
          id: l.id,
          name: l.name,
          kind: l.kind,
          ownLabel: l.ownLabelId ? (nameOf.get(l.ownLabelId) ?? `unknown id ${l.ownLabelId}`) : null,
          aliases: [...l.aliases].sort(),
          accounts: [...l.accounts].sort(),
          rules: l.rules
            .map((r) => `${new Decimal(r.percent).toFixed()}|${r.validFrom}|${r.validTo ?? '-'}`)
            .sort(),
        })),
        (l) => l.name,
      );
    };
    const ref = norm(refLabels);
    const cur = norm(curLabels);
    for (const k of new Set([...ref.keys(), ...cur.keys()])) {
      const a = ref.get(k);
      const b = cur.get(k);
      const label = a?.kind === 'own' || b?.kind === 'own' ? k : `sublabel ${b?.id ?? `ref:${a?.id}`}`;
      if (!a || !b) {
        s.item(label, [a ? 'missing in the API' : 'not in the reference']);
        continue;
      }
      const d = [
        ...differences('kind', a.kind, b.kind),
        ...differences('accounts', a.accounts, b.accounts),
        ...differences('rules', a.rules, b.rules),
      ];
      // the own label and the aliases may be names: counts only
      if (a.ownLabel !== b.ownLabel)
        d.push(
          `ownLabel differs${ownNames.has(a.ownLabel ?? '') ? `: ref ${a.ownLabel}, new ${b.ownLabel}` : ''}`,
        );
      const onlyRef = a.aliases.filter((x) => !b.aliases.includes(x)).length;
      const onlyNew = b.aliases.filter((x) => !a.aliases.includes(x)).length;
      if (onlyRef || onlyNew) d.push(`aliases: ${onlyRef} only in the reference, ${onlyNew} only in the API`);
      s.item(label, d);
    }
    noteUnknown('/labels[]', refLabels, curLabels);
  }

  // ---- overview
  const refOv = readRef<Overview>('overview.json');
  const curOv = await get<Overview>('/overview');
  noteUnknown('/overview', refOv, curOv);
  noteUnknown('/overview totals', refOv.totals, curOv.totals);
  section('overview.totals.all').item('all', differences('all', refOv.totals.all, curOv.totals.all));
  compareKeyed(
    section('overview.totals.bySource'),
    new Map(Object.entries(refOv.totals.bySource)),
    new Map(Object.entries(curOv.totals.bySource)),
    TOTAL_FIELDS,
  );
  compareKeyed(
    section('overview.totals.byAccount'),
    keyed(refOv.totals.byAccount, (r) => `${r.source}|${r.account}`),
    keyed(curOv.totals.byAccount, (r) => `${r.source}|${r.account}`),
    TOTAL_FIELDS,
  );
  compareKeyed(
    section('overview.queue'),
    keyed(refOv.queue, (r) => r.reason),
    keyed(curOv.queue, (r) => r.reason),
    ['amount', 'groups', 'isrcs'],
  );
  {
    const s = section('overview.signals (13 counters)');
    const cur = new Map(curOv.signals.map((x) => [x.name, x.count]));
    for (const x of refOv.signals) s.item(x.name, differences('count', x.count, cur.get(x.name)));
    const extra = curOv.signals
      .filter((x) => !refOv.signals.some((r) => r.name === x.name))
      .map((x) => `${x.name}=${x.count}`);
    if (extra.length) unknownFields.push(`/overview signals: ${extra.join(', ')}`);
  }
  section('overview.files').item('files', differences('files', refOv.files, curOv.files));
  if (strict)
    section('overview.totals.byLabel (strict)').item(
      'byLabel',
      differences('byLabel', refOv.totals.byLabel, curOv.totals.byLabel),
    );

  // ---- reconciliation
  const refRec = readRef<ReconRow[]>('reconciliation.json');
  const curRec = await get<ReconRow[]>('/reconciliation');
  noteUnknown('/reconciliation[]', refRec, curRec);
  const recKey = (r: ReconRow) => `${r.source}|${r.account}|${r.month}`;
  const refRows = keyed(refRec, recKey);
  const curRows = keyed(curRec, recKey);
  compareKeyed(section('reconciliation'), refRows, curRows, RECON_FIELDS);
  if (strict) compareKeyed(section('reconciliation.byLabel (strict)'), refRows, curRows, ['byLabel']);

  // ---- signals
  {
    const ref = readRef<Signals>('signals.json');
    const cur = await get<Signals>('/signals');
    noteUnknown('/signals', ref, cur);
    const s = section('signals');
    for (const name of Object.keys(ref.counts))
      s.item(`counts.${name}`, differences('count', ref.counts[name], cur.counts[name]));
    const extraCounts = Object.keys(cur.counts).filter((k) => !(k in ref.counts));
    if (extraCounts.length)
      unknownFields.push(`/signals counts: ${extraCounts.map((k) => `${k}=${cur.counts[k]}`).join(', ')}`);
    s.item('unallocated', [
      ...differences('total', ref.unallocated.total, cur.unallocated.total),
      ...differences('withoutIsrc', ref.unallocated.withoutIsrc, cur.unallocated.withoutIsrc),
    ]);
    const k = (r: Signals['labelOutsideAccount'][number]) => `${r.account}|${r.month}|${r.labelName}`;
    compareKeyed(
      section('signals.labelOutsideAccount'),
      keyed(ref.labelOutsideAccount, k),
      keyed(cur.labelOutsideAccount, k),
      ['net', 'units', 'ourLabelName', 'accountLabelName'],
      (_key, a, b) => {
        const r = (a ?? b)!;
        return `${r.account}|${r.month}|${safeLabel(r.labelName)}`;
      },
    );
    const sn = section('signals.new (stage 1)');
    const sizeOf = (name: string): number | undefined =>
      typeof cur.counts[name] === 'number'
        ? cur.counts[name]
        : Array.isArray(cur[name])
          ? cur[name].length
          : undefined;
    for (const name of NEW_ZERO_SIGNALS) {
      const n = sizeOf(name);
      if (n === undefined) sn.line(`${name}: not in the API (information)`);
      else sn.item(name, n === 0 ? [] : [`${n}, must be 0`]);
    }
    const out = sizeOf('adOutsideBook');
    sn.line(`adOutsideBook: ${out === undefined ? 'not in the API' : out} (information)`);
  }

  // ---- tracks
  {
    const ref = readRef<{ items: Track[] }>('tracks_summary.json');
    const cur = await get<{ items: Track[] }>('/tracks/summary');
    noteUnknown('/tracks/summary', ref, cur);
    noteUnknown('/tracks/summary items[]', ref.items, cur.items);
    compareKeyed(
      section('tracks_summary'),
      keyed(ref.items, (t) => t.isrc),
      keyed(cur.items, (t) => t.isrc),
      TRACK_FIELDS,
    );
  }

  // ---- owners
  // adsCharged is derived from payable (D-173: + adjustments − write-offs, both 0 in the reference)
  const withAds = (o: Payable): Payable => ({
    ...o,
    adsCharged: dec(o.earned)
      .sub(dec(o.recouped))
      .sub(dec(o.paid))
      .add(dec(o.returns))
      .add(dec(o.credits))
      .add(dec(o.adjustments))
      .sub(dec(o.writtenOff))
      .sub(dec(o.payable))
      .toFixed(),
  });
  const byOwner = (items: Payable[]) =>
    keyed(
      items.map(withAds),
      (o) => `${o.name}|${o.kind}`,
      (a, b) =>
        dec(a.earned).cmp(dec(b.earned)) ||
        dec(a.waiting).cmp(dec(b.waiting)) ||
        dec(a.paid).cmp(dec(b.paid)),
    );
  const ownerLabel = (_k: string, a?: Payable, b?: Payable) =>
    b ? `owner ${b.ownerId}` : `owner ref:${a?.ownerId}`;
  {
    const ref = readRef<{ items: Payable[] }>('owners_payables.json');
    const cur = await get<{ items: Payable[] }>('/owners/payables');
    noteUnknown('/owners/payables', ref, cur);
    noteUnknown('/owners/payables items[]', ref.items, cur.items);
    const a = byOwner(ref.items);
    const b = byOwner(cur.items);
    compareKeyed(
      section(`owners_payables (${ref.items.length} in the reference, ${cur.items.length} in the API)`),
      a,
      b,
      OWNER_FIELDS,
      ownerLabel,
    );
    if (strict)
      compareKeyed(
        section('owners_payables.books (strict)'),
        a,
        b,
        [...OWNER_BOOK_FIELDS, 'payableShown'],
        ownerLabel,
      );
    // default: the owners whose books moved, listed with the sums; the payout gate is information in both modes
    const moved = section(
      strict
        ? 'owners_payables.payout (information)'
        : 'owners_payables.moved: recouped, payable, payout (information)',
      true,
    );
    const ids: string[] = [];
    const sum = { recouped: new Decimal(0), payable: new Decimal(0) };
    for (const [k, x] of a) {
      const y = b.get(k);
      if (!y) continue;
      const d = [
        ...(strict ? [] : OWNER_BOOK_FIELDS.flatMap((f) => differences(f, x[f], y[f]))),
        ...differences('payout', x.payout, y.payout),
      ];
      moved.item(`owner ${y.ownerId}`, d);
      if (d.length) ids.push(y.ownerId);
      sum.recouped = sum.recouped.add(dec(y.recouped).sub(dec(x.recouped)));
      sum.payable = sum.payable.add(dec(y.payable).sub(dec(x.payable)));
    }
    if (!strict)
      moved.tail.push(`Σ Δ recouped ${sum.recouped.toFixed()}, Σ Δ payable ${sum.payable.toFixed()}`);
    if (ids.length) moved.tail.push(`changed ownerIds (${ids.length}): ${ids.join(' ')}`);

    // ---- kinds (D-173): the operations by kind; per owner Δpaid = 0 and Δpayable explained by the new terms and the
    // recoup (a forgiveness frees income: recouped falls, payable rises by as much): Δpayable + Δrecouped − Δadjustments
    // + ΔwrittenOff = 0. A buyout and a forgiveness stay outside payable. On the reference every Δ is 0.
    const ops = await get<{ kind: string; active: boolean }[]>('/settlements/operations');
    const byKind = new Map<string, number>();
    for (const o of ops) if (o.active) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
    const count = section('kinds.count (information)', true);
    count.line(
      `active operations by kind: ${[...byKind.entries()]
        .sort()
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')}`,
    );
    count.item('payroll kinds', PAYROLL_KINDS.filter((k) => byKind.has(k)).map((k) => `${k}: ${byKind.get(k)} (none in the history)`));
    const kinds = section('kinds');
    for (const [k, x] of a) {
      const y = b.get(k);
      if (!y) continue;
      const delta = (f: 'paid' | 'payable' | 'recouped' | 'adjustments' | 'writtenOff') => dec(y[f]).sub(dec(x[f]));
      const unexplained = delta('payable').add(delta('recouped')).sub(delta('adjustments')).add(delta('writtenOff'));
      kinds.item(`owner ${y.ownerId}`, [
        ...differences('paid', x.paid, y.paid),
        ...(unexplained.isZero() ? [] : [`payable moved by ${unexplained.toFixed()} beyond adjustments, write-offs and the recoup`]),
      ]);
    }
  }

  // ---- owners under a label: the file is named by the reference id, the new id comes by the name
  for (const file of readdirSync(refDir)
    .filter((f) => /^owners_payables_label_.+\.json$/.test(f))
    .sort()) {
    const refId = file.slice('owners_payables_label_'.length, -'.json'.length);
    const name = refLabels.find((l) => l.id === refId)?.name;
    const newId = name === undefined ? undefined : curLabels.find((l) => l.name === name)?.id;
    const title = `owners_payables label ${name === undefined ? `ref:${refId}` : safeLabel(name)}`;
    if (!newId) {
      section(title).item('label', [
        name === undefined ? 'reference id not in labels.json' : 'label not found by name in the API',
      ]);
      continue;
    }
    const ref = readRef<{ items: Payable[] }>(file);
    const cur = await get<{ items: Payable[] }>(`/owners/payables?label=${encodeURIComponent(newId)}`);
    const total = (xs: Payable[]) => xs.reduce((s, o) => s.add(dec(o.payable)), new Decimal(0)).toFixed();
    if (strict) {
      const s = section(`${title} (strict)`);
      s.line(
        `owners: ref ${ref.items.length}, new ${cur.items.length}; Σ payable: ref ${total(ref.items)}, new ${total(cur.items)}`,
      );
      compareKeyed(
        s,
        byOwner(ref.items),
        byOwner(cur.items),
        [...OWNER_FIELDS, ...OWNER_BOOK_FIELDS, 'payableShown'],
        ownerLabel,
      );
    } else {
      const s = section(`${title} (information)`, true);
      s.item('owners', differences('count', ref.items.length, cur.items.length));
      s.item('owners', differences('Σ payable', total(ref.items), total(cur.items)));
    }
  }

  // ---- ads
  const refAds = readRef<Ads>('ads_summary.json');
  const curAds = await get<Ads>('/ads/summary');
  noteUnknown('/ads/summary', refAds, curAds);
  noteUnknown('/ads/summary rows[]', refAds.rows, curAds.rows);
  {
    const s = section('ads_summary');
    s.item(
      'totals',
      AD_FIELDS.flatMap((f) => differences(f, refAds.totals[f], curAds.totals[f])),
    );
    const byMonth = (rows: AdRow[]) => {
      const m = new Map<string, AdRow[]>();
      for (const r of rows) m.set(r.month, [...(m.get(r.month) ?? []), r]);
      return new Map([...m].map(([k, rs]) => [k, sumFields(rs, AD_FIELDS)]));
    };
    compareKeyed(s, byMonth(refAds.rows), byMonth(curAds.rows), AD_FIELDS);
    if (strict) {
      const k = (r: AdRow) => `${r.month}|${r.label}`;
      compareKeyed(
        section('ads_summary.byLabel (strict)'),
        keyed(refAds.rows, k),
        keyed(curAds.rows, k),
        AD_FIELDS,
        (_k, a, b) => {
          const r = (a ?? b)!;
          return `${r.month}|${safeLabel(r.label)}`;
        },
      );
    }
  }

  // ---- the owner_unconfirmed queue: key kind|label (the label is an owner name: never printed)
  {
    const ref = readRef<Queue>('queue_owner_unconfirmed.json');
    const cur = await get<Queue>('/queue/owner_unconfirmed');
    noteUnknown('/queue/owner_unconfirmed', ref, cur);
    noteUnknown('/queue/owner_unconfirmed items[]', ref.items, cur.items);
    const s = section('queue_owner_unconfirmed');
    s.item('queue', [
      ...differences('total', ref.total, cur.total),
      ...differences('amount', ref.amount, cur.amount),
    ]);
    const k = (g: QueueGroup) => `${g.key.kind}|${g.key.label}`;
    const order = (a: QueueGroup, b: QueueGroup) => dec(b.amount).cmp(dec(a.amount));
    compareKeyed(s, keyed(ref.items, k, order), keyed(cur.items, k, order), QUEUE_FIELDS, (_k, a, b) =>
      b ? `${b.key.kind} ${b.ownerId ?? b.key.id}` : `${a?.key.kind} ref:${a?.ownerId ?? a?.key.id}`,
    );
  }

  // ---- source files
  {
    const cur = await get<Files>('/sources/files');
    const loaded = cur.believe.filter((f) => f.status === 'loaded');
    const lines = loaded.reduce((s, f) => s + (f.lineCount ?? 0), 0);
    section('sources_files').item('believe', [
      ...(loaded.length === EXPECTED_FILES
        ? []
        : [`loaded files: expected ${EXPECTED_FILES}, new ${loaded.length}`]),
      ...(lines === EXPECTED_LINES ? [] : [`Σ lineCount: expected ${EXPECTED_LINES}, new ${lines}`]),
    ]);
  }

  // ---- the books (default mode): the move is printed, the target state is checked
  if (!strict) {
    const check = section('books.check');
    for (const [key, r] of curRows) {
      const want = accountBook.get(r.account);
      const names = Object.keys(r.byLabel);
      const d: string[] = [];
      if (!want) d.push('account of no own label');
      else if (names.length !== 1 || names[0] !== want)
        d.push(`byLabel keys [${names.map(safeLabel).join(', ')}], expected [${want}]`);
      const sum = sumFields(Object.values(r.byLabel), BOOK_FIELDS);
      for (const f of BOOK_FIELDS) d.push(...differences(`Σ byLabel.${f} vs row`, r[f], sum[f]));
      check.item(key, d);
    }
    // totals.byLabel derived from the reference accounts: 0to8 = 1052428 + b17, Echo8 = 1055956, no '?'
    const expected: Record<string, Record<string, Money>> = {};
    for (const acc of refOv.totals.byAccount) {
      const book = accountBook.get(acc.account) ?? '?';
      const prev = expected[book] ?? Object.fromEntries(TOTAL_FIELDS.map((f) => [f, '0']));
      expected[book] = Object.fromEntries(
        TOTAL_FIELDS.map((f) => [f, dec(prev[f]).add(dec(acc[f])).toFixed()]),
      );
    }
    check.item('overview.totals.byLabel', differences('byLabel', expected, curOv.totals.byLabel));
    const foreign = curAds.rows.filter((r) => r.label !== PUBLISHING_BOOK);
    check.item(
      'ads_summary rows',
      foreign.length ? [`${foreign.length} rows with a label other than ${PUBLISHING_BOOK}`] : [],
    );

    const move = (
      s: Section,
      key: string,
      fields: readonly string[],
      a: Record<string, Record<string, unknown>>,
      b: Record<string, Record<string, unknown>>,
      acc?: Map<string, Map<string, Decimal>>,
    ) => {
      let moved = false;
      for (const label of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        const parts: string[] = [];
        for (const f of fields) {
          const d = dec(b[label]?.[f]).sub(dec(a[label]?.[f]));
          if (d.isZero()) continue;
          parts.push(`${f} ${d.toFixed()}`);
          if (acc) {
            const m = acc.get(label) ?? new Map<string, Decimal>();
            m.set(f, (m.get(f) ?? new Decimal(0)).add(d));
            acc.set(label, m);
          }
        }
        if (parts.length) {
          moved = true;
          s.line(`${key} ${safeLabel(label)}: ${parts.join(', ')}`);
        }
      }
      s.compared++;
      if (moved) s.differing++;
    };
    const tot = section('books.movement overview.totals.byLabel (information)', true);
    move(tot, 'totals', TOTAL_FIELDS, refOv.totals.byLabel, curOv.totals.byLabel);
    const byAcc = new Map<string, Map<string, Map<string, Decimal>>>();
    const rows = section('books.movement reconciliation rows (information)', true);
    for (const k of new Set([...refRows.keys(), ...curRows.keys()])) {
      const a = refRows.get(k);
      const b = curRows.get(k);
      const accKey = (a ?? b)!.source + '|' + (a ?? b)!.account;
      const acc = byAcc.get(accKey) ?? new Map<string, Map<string, Decimal>>();
      byAcc.set(accKey, acc);
      move(rows, k, BOOK_FIELDS, a?.byLabel ?? {}, b?.byLabel ?? {}, acc);
    }
    const accS = section('books.movement by account (information)', true);
    for (const [k, labels] of byAcc) {
      accS.compared++;
      if (labels.size) accS.differing++;
      for (const [label, m] of labels)
        accS.line(
          `${k} ${safeLabel(label)}: ${BOOK_FIELDS.filter((f) => m.has(f))
            .map((f) => `${f} ${m.get(f)?.toFixed()}`)
            .join(', ')}`,
        );
    }
  }

  // ---- the report
  let total = 0;
  let info = 0;
  for (const s of sections) {
    if (s.info) info += s.differing;
    else total += s.differing;
    console.log(`${s.info ? '(info) ' : ''}${s.name}: ${s.compared} compared, ${s.differing} differing`);
    for (const l of s.lines.slice(0, SHOW)) console.log(`  ${l}`);
    if (s.lines.length > SHOW) console.log(`  … and ${s.lines.length - SHOW} more`);
    for (const l of s.tail) console.log(`  ${l}`);
  }
  if (unknownFields.length) {
    console.log('fields new in the API (information):');
    for (const u of unknownFields) console.log(`  ${u}`);
  }
  console.log(`information items moved: ${info}`);
  console.log(`TOTAL differing: ${total}`);
  return total === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (e) {
  console.error(`compare-reference: ${(e as Error).message}`);
  process.exitCode = 2;
}
