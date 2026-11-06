import { centsToDecimal, Decimal, ZERO } from '../shared/money';
import { inMonthRange, monthOf } from '../shared/dates';
import { BLOCKING_KINDS } from '@erp/shared/operation-kinds';
import type { IncomeItem, OpeningBalanceView, OperationView, Position } from '../modules/settlements';
import { recoup } from './layers/recoup';
import {
  pubInPeriod,
  unitInPeriod,
  type Calculation,
  type CReason,
  type PeriodFilter,
  type PublishingResult,
  type UnitResult,
} from './calculation';

/**
 * The money of one artist per book (D-168, D-169): the fields of the artist row, partitioned by the book of the unit
 * (the label its file was loaded under: earned, waiting, recoupedFromMaster), of the income consumed (recouped) or of the position (unrecouped).
 */
export interface ArtistLabelBook {
  labelId: string | null;
  earned: Decimal;
  waiting: Decimal;
  recouped: Decimal;
  unrecouped: Decimal;
  recoupedFromMaster: Decimal;
  /** The effective forgiveness of the positions this pseudonym holds (D-173), by the label of the position. */
  forgiven: Decimal;
  /** The opening balance of the pseudonym in the book (D-174): its start and the adjustments of it. */
  start: Decimal;
  /** The position of the pseudonym in the book (D-181): start + earned − recouped − ads − paid + returns + credits + adjustments − writtenOff, plus the owner's operations shared to it. */
  position: Decimal;
  /** The position by area (D-181): Σ = `position`. */
  positionByArea: Record<Area, Decimal>;
}

export interface ArtistBalance {
  artistId: string;
  pseudonym: string;
  earned: Decimal;
  waiting: Decimal;
  recouped: Decimal;
  unrecouped: Decimal;
  /** Part of this artist's master income consumed by recoupment (of any position). */
  recoupedFromMaster: Decimal;
  /** The effective forgiveness of the positions this pseudonym holds (D-173). */
  forgiven: Decimal;
  /** The opening balance of the pseudonym (D-174). */
  start: Decimal;
  /**
   * The position of the pseudonym over its books (D-181, the owner's rule «ники не сальдируются»): what the label owes
   * this pseudonym (or what it owes the label when negative). The owner is paid Σ of the positive positions of its
   * pseudonyms; a negative one never offsets a positive one.
   */
  position: Decimal;
  /** position < 0 (computed here: the client compares no money). */
  positionNegative: boolean;
  tracks: { isrc: string; net: Decimal; amount: Decimal; waiting: Decimal }[];
  /** The row per book (by name, '?' = without a label); Σ over the books = the row (D-168, D-169). */
  byLabel: Record<string, ArtistLabelBook>;
}

export interface PositionView {
  operationId: string;
  artistId: string;
  amount: Decimal;
  recouped: Decimal;
  /** The effective forgiveness (D-173): amount = recouped + forgiven + remaining. */
  forgiven: Decimal;
  /** The counted forgivenesses as recorded (D-173): above `forgiven` = the signal `forgivenessReduced`. */
  forgivenRecorded: Decimal;
  remaining: Decimal;
  scope: unknown;
  date: string;
  /** The label of the operation (D-168); null = without a label (recouped from any income). */
  labelId: string | null;
}

/**
 * An amount charged by an advertising expense (D-155, D-157): an artist's recovered part or a sublabel's unrecovered
 * part. It is taken off payable at once and in full, like a payout, whatever the income (Main did the same).
 */
export interface AdChargeView {
  adId: string;
  isrc: string | null;
  month: string;
  artistId: string;
  role: 'artist' | 'sublabel';
  amount: Decimal;
  /** The label of record of the expense (D-168): the ISRC's line at the month, else the record's label; null = none. */
  labelId: string | null;
}

/**
 * The money of one area of a book (D-173 К10): earned and recouped by the stream of the income (master, publishing),
 * advertising master, the operations by their `area` (the history and every kind but a write-off: master).
 * Σ of the two areas = the book, field by field.
 */
export interface AreaBook {
  /** The opening balance of the area (D-174): the start rows and the adjustments, master or publishing cents. */
  start: Decimal;
  earned: Decimal;
  recouped: Decimal;
  adsCharged: Decimal;
  paid: Decimal;
  returns: Decimal;
  credits: Decimal;
  buyouts: Decimal;
  writtenOff: Decimal;
  adjustments: Decimal;
  /** The formula of the area (the net of its positions). */
  payable: Decimal;
  /** What the area pays (D-181): Σ of the positive positions of the pseudonyms in it, plus the owner's own if positive. */
  payableShown: Decimal;
  /** The position of the owner without a pseudonym in the area (D-181): its publishing, its operations without a pseudonym, less what was shared to the pseudonyms. */
  ownerPosition: Decimal;
}
export type Area = 'master' | 'publishing';

/**
 * The book of one label (D-168): every money field of the owner's total, partitioned by label. earned and waiting by
 * the label the unit's file was loaded under, publishing by the label of its statement (D-169); recouped by the label of the income consumed; adsCharged by the
 * charge's label; paid, returns, credits by the operation's label. Σ over the books, «without a label» included,
 * equals the total field by field.
 */
export interface LabelBook {
  labelId: string | null;
  earned: Decimal;
  waiting: Decimal;
  recouped: Decimal;
  adsCharged: Decimal;
  paid: Decimal;
  returns: Decimal;
  credits: Decimal;
  /** Counted buyouts under the label (D-173): neither paid nor in payable (README §5). */
  buyouts: Decimal;
  /** The effective forgiveness of the positions of the label (D-173): reduces what is unrecouped, not payable. */
  forgiven: Decimal;
  /** Counted publishing write-offs (D-173): taken off payable. */
  writtenOff: Decimal;
  /** −Σ counted adjustments (D-173): added to payable with their sign. */
  adjustments: Decimal;
  /** The opening balance of the book (D-174): Σ of the active start rows and adjustments of the owner's pseudonyms. */
  start: Decimal;
  /** A start row without an amount (the cabinet gave none, D-174): the payout of the book is closed. */
  startMissing: boolean;
  /** The formula (D-050 … D-174): the net of every position of the book; negative when the owner owes the label. */
  payable: Decimal;
  /**
   * What the book pays (D-181, the owner's rule «ники не сальдируются»): Σ of the positive positions of the pseudonyms
   * plus the owner's own position when positive; the gate and the button take this. Equals max(payable, 0) for an owner
   * with one pseudonym and nothing of its own.
   */
  payableShown: Decimal;
  /** Some position of the book is negative (a pseudonym's or the owner's own): the screen names them. */
  payableNegative: boolean;
  /** The position of the owner without a pseudonym (D-181): publishing of the owner, operations without a pseudonym, less what was shared. */
  ownerPosition: Decimal;
  /** The two areas of the book (D-173 К10): Σ = the book, field by field. */
  byArea: Record<Area, AreaBook>;
}

/** The cut a book of the owner is under (D-174): inputs of report months ≤ `cutoffMonth` and operations dated ≤ `syncedDay` are inside the start. */
export interface StartCut {
  labelId: string | null;
  cutoffMonth: string;
  /** The day of `synced_at` (UTC): an operation of the book dated up to it is inside the start. */
  syncedDay: string;
  syncedAt: string;
}

/** What the start replaced (D-174): the sums of the inputs the cut removed, for the screen; never in `payable`. */
export interface InsideStart {
  earned: Decimal;
  waiting: Decimal;
  paid: Decimal;
  advances: Decimal;
  adsCharged: Decimal;
  /** Operations of every kind the cut removed. */
  operations: number;
}

/** The start block of a balance (D-174): null when no pseudonym of the owner has an opening balance. */
export interface StartView {
  cuts: StartCut[];
  rows: (OpeningBalanceView & { pseudonym: string })[];
  insideStart: InsideStart;
}

/** A balance restricted to one label (D-168): the same computation projected to that label's book. */
export interface BalanceView {
  labelId: string;
}

export interface OwnerBalance {
  ownerId: string;
  /**
   * The owner may be paid: an approved contract; under a view, one whose document has the view's label or none
   * (D-169).
   */
  confirmed: boolean;
  /**
   * Internal (the payout gate's input, never in the response, D-169): an approved contract of any label, so that the
   * gate tells "no contract at all" from "no contract with this label".
   */
  confirmedAny: boolean;
  /** The label the balance is restricted to (D-168); null = the whole owner, every book. */
  label: { id: string; name: string } | null;
  /** Figures for the requested period (by report or sales date). */
  period: {
    from: string | null;
    to: string | null;
    basis: 'report' | 'sales';
    received: Decimal;
    notOurs: Decimal;
    waiting: Decimal;
    waitingBreakdown: Partial<Record<CReason, Decimal>>;
    otherParticipants: Decimal;
    ourShare: Decimal;
    earnedMaster: Decimal;
    earnedPublishing: Decimal;
    paid: Decimal;
    advancesPaid: Decimal;
    recouped: Decimal;
  };
  /** All-time figures "as of today": what payable means (recalculated from scratch, not an obligation). */
  total: {
    earned: Decimal;
    waiting: Decimal;
    recouped: Decimal;
    /** Advertising charged to the owner's pseudonyms, taken off payable at once (D-157). */
    adsCharged: Decimal;
    paid: Decimal;
    returns: Decimal;
    credits: Decimal;
    /** D-173: buyouts (outside payable), effective forgiveness (outside payable), write-offs (−), adjustments (+). */
    buyouts: Decimal;
    forgiven: Decimal;
    writtenOff: Decimal;
    adjustments: Decimal;
    /** The opening balance (D-174): Σ of the books; in payable. */
    start: Decimal;
    startMissing: boolean;
    /** The formula: the net of every position (D-050 … D-174); kept as is when negative. */
    payable: Decimal;
    /** What is paid (D-181): Σ of the positive positions of the pseudonyms and of the owner's own; the gate's amount. */
    payableShown: Decimal;
    /** Some position is negative (the screen names the pseudonyms; the client does not compare money). */
    payableNegative: boolean;
    /** The position of the owner without a pseudonym (D-181). */
    ownerPosition: Decimal;
    /** The two areas of the owner (D-173 К10): Σ = total, field by field. */
    byArea: Record<Area, AreaBook>;
  };
  /**
   * The book of every label (by name, '?' = without a label: a file or a statement, an operation or a charge without a
   * label), D-168. Under a view, the one book of that label.
   */
  byLabel: Record<string, LabelBook>;
  /** The opening balances of the owner's pseudonyms and the cut they make (D-174); null without any. */
  start: StartView | null;
  artists: ArtistBalance[];
  publishing: {
    period: string;
    workTitle: string;
    payable: Decimal;
    percent: Decimal;
    amount: Decimal;
    category: string;
    reason: string | null;
  }[];
  positions: PositionView[];
  /** Advertising charged to the owner's pseudonyms, newest month first (D-157). */
  ads: AdChargeView[];
  pendingOperations: { operationId: string; why: string }[];
  blockingPayouts: string[];
  /** Part of the owner's publishing income consumed by recoupment. */
  publishingRecouped: Decimal;
}

type DocStatus = Calculation['documentStatus'];

/** Which operations take part in the balance, and why the others wait. */
export function classifyOperation(
  o: OperationView,
  documentStatus: DocStatus,
): { counted: boolean; why?: string } {
  if (!o.active) return { counted: false, why: 'inactive' };
  if (o.migration) return { counted: true };
  if (o.direction === 'out') {
    if (documentStatus(o.paymentProofId) !== 'approved')
      return { counted: false, why: 'no payment proof yet' };
    // A recoupable payout (advance) applies, with its scope, only when its basis document is approved (07, question 8);
    // a buyout likewise with its buyout document (D-173).
    if ((o.kind === 'advance' || o.kind === 'buyout') && documentStatus(o.documentId) !== 'approved')
      return { counted: false, why: 'basis document not approved' };
    return { counted: true };
  }
  // Deductions, credits, forgivenesses, write-offs and adjustments need an approved basis document; a return is
  // confirmed by its return document.
  const docOk = documentStatus(o.documentId) === 'approved';
  if (!docOk) return { counted: false, why: 'no approved document' };
  return { counted: true };
}

/** The internal key of a label: its id, '' for «without a label». */
const NONE = '';
const keyOf = (labelId: string | null | undefined): string => labelId ?? NONE;

/** A map of accumulators by label key, created on demand. */
class ByKey<T> {
  readonly map = new Map<string, T>();
  constructor(private readonly make: () => T) {}
  of(key: string): T {
    let v = this.map.get(key);
    if (!v) this.map.set(key, (v = this.make()));
    return v;
  }
}

type AreaAcc = Omit<AreaBook, 'payable' | 'payableShown' | 'ownerPosition'>;
const newArea = (): AreaAcc => ({
  start: ZERO,
  earned: ZERO,
  recouped: ZERO,
  adsCharged: ZERO,
  paid: ZERO,
  returns: ZERO,
  credits: ZERO,
  buyouts: ZERO,
  writtenOff: ZERO,
  adjustments: ZERO,
});
const AREA_FIELDS = Object.keys(newArea()) as (keyof AreaAcc)[];

interface BookAcc {
  start: Decimal;
  startMissing: boolean;
  earned: Decimal;
  waiting: Decimal;
  recouped: Decimal;
  adsCharged: Decimal;
  paid: Decimal;
  returns: Decimal;
  credits: Decimal;
  buyouts: Decimal;
  forgiven: Decimal;
  writtenOff: Decimal;
  adjustments: Decimal;
  publishingRecouped: Decimal;
  area: Record<Area, AreaAcc>;
}
const newBook = (): BookAcc => ({
  start: ZERO,
  startMissing: false,
  earned: ZERO,
  waiting: ZERO,
  recouped: ZERO,
  adsCharged: ZERO,
  paid: ZERO,
  returns: ZERO,
  credits: ZERO,
  buyouts: ZERO,
  forgiven: ZERO,
  writtenOff: ZERO,
  adjustments: ZERO,
  publishingRecouped: ZERO,
  area: { master: newArea(), publishing: newArea() },
});
/** Adds `v` to a field of the area `area` of a book (D-173 К10). */
const addArea = (b: BookAcc, area: Area, field: keyof AreaAcc, v: Decimal) => {
  b.area[area][field] = b.area[area][field].add(v);
};
/**
 * payable = start + earned − recouped − paid − adsCharged + returns + credits + adjustments − writtenOff (D-050, D-157,
 * D-173, D-174); buyouts and forgiveness stay outside. The terms of D-173 and the start are added after the earlier
 * ones, so a book without them keeps its exact value.
 */
const payableOf = (b: Omit<AreaAcc, 'buyouts'>) =>
  b.earned.sub(b.recouped).sub(b.paid).sub(b.adsCharged).add(b.returns).add(b.credits).add(b.adjustments).sub(b.writtenOff).add(b.start);
/**
 * The position of a pseudonym (or of the owner without one) in a book and an area (D-181): the same formula as the book,
 * plus `shared` = the owner's operations without a pseudonym shared to it (a payout without an allocation).
 */
interface PosAcc {
  start: Decimal;
  earned: Decimal;
  recouped: Decimal;
  adsCharged: Decimal;
  paid: Decimal;
  returns: Decimal;
  credits: Decimal;
  adjustments: Decimal;
  writtenOff: Decimal;
  shared: Decimal;
}
const newPos = (): PosAcc => ({ start: ZERO, earned: ZERO, recouped: ZERO, adsCharged: ZERO, paid: ZERO, returns: ZERO, credits: ZERO, adjustments: ZERO, writtenOff: ZERO, shared: ZERO });
const positionOf = (p: PosAcc) => payableOf(p).add(p.shared);
const newPosByArea = (): Record<Area, PosAcc> => ({ master: newPos(), publishing: newPos() });
/** The key of the owner's own position among the pseudonyms (D-181): a payout allocation names it ''. */
export const OWNER_POSITION = '';
/** `total` cents split pro rata to `weights` (an allocation), floored, the residue to the largest weight (ties: the first key). */
export function splitCents(total: number, weights: Record<string, number>): Record<string, number> {
  const keys = Object.keys(weights).sort((x, y) => (weights[y] ?? 0) - (weights[x] ?? 0) || x.localeCompare(y));
  const sum = keys.reduce((s, k) => s + (weights[k] ?? 0), 0);
  const out: Record<string, number> = {};
  if (keys.length === 0 || sum === 0) return { [OWNER_POSITION]: total };
  let given = 0;
  for (const k of keys) {
    const c = new Decimal(total).mul(weights[k] ?? 0).div(sum).floor().toNumber();
    out[k] = c;
    given += c;
  }
  out[keys[0] as string] = (out[keys[0] as string] ?? 0) + (total - given);
  return out;
}

interface PeriodAcc {
  received: Decimal;
  notOurs: Decimal;
  waiting: Decimal;
  waitingBreakdown: Partial<Record<CReason, Decimal>>;
  otherParticipants: Decimal;
  ourShare: Decimal;
  earnedMaster: Decimal;
  earnedPublishing: Decimal;
  paid: Decimal;
  advancesPaid: Decimal;
  recouped: Decimal;
}
const newPeriod = (): PeriodAcc => ({
  received: ZERO,
  notOurs: ZERO,
  waiting: ZERO,
  waitingBreakdown: {},
  otherParticipants: ZERO,
  ourShare: ZERO,
  earnedMaster: ZERO,
  earnedPublishing: ZERO,
  paid: ZERO,
  advancesPaid: ZERO,
  recouped: ZERO,
});

type TrackAcc = { isrc: string; net: Decimal; amount: Decimal; waiting: Decimal };
interface ArtistAcc {
  earned: Decimal;
  waiting: Decimal;
  recouped: Decimal;
  unrecouped: Decimal;
  recoupedFromMaster: Decimal;
  forgiven: Decimal;
  start: Decimal;
  tracks: Map<string, TrackAcc>;
  /** The position of the pseudonym by area (D-181): every all-time term, whatever the period. */
  pos: Record<Area, PosAcc>;
}
const newArtistAcc = (): ArtistAcc => ({
  earned: ZERO,
  waiting: ZERO,
  recouped: ZERO,
  unrecouped: ZERO,
  recoupedFromMaster: ZERO,
  forgiven: ZERO,
  start: ZERO,
  tracks: new Map(),
  pos: newPosByArea(),
});

/**
 * The cuts of the opening balances (D-174), per book over the owner's pseudonyms: a row of any pseudonym of the owner
 * in a book cuts that book for the whole owner (a pseudonym of the owner without a row had no position in the cabinet:
 * its start is 0 and its history up to the cut is inside the start too). The latest cut month and synchronisation day
 * win when several rows of one book differ. The pseudonym is the surviving id (`calc.artistIndex`).
 */
function startCuts(calc: Calculation, rows: OpeningBalanceView[]) {
  const canon = (id: string) => calc.artistIndex.get(id)?.id ?? id;
  const byOwner = new Map<string, StartCut>();
  const upsert = (m: Map<string, StartCut>, key: string, cut: StartCut) => {
    const prev = m.get(key);
    if (!prev) m.set(key, cut);
    else {
      if (cut.cutoffMonth > prev.cutoffMonth) prev.cutoffMonth = cut.cutoffMonth;
      if (cut.syncedDay > prev.syncedDay) {
        prev.syncedDay = cut.syncedDay;
        prev.syncedAt = cut.syncedAt;
      }
    }
  };
  for (const r of rows) {
    const cut: StartCut = { labelId: r.labelId, cutoffMonth: r.cutoffMonth, syncedDay: r.syncedAt.slice(0, 10), syncedAt: r.syncedAt };
    upsert(byOwner, keyOf(r.labelId), { ...cut });
  }
  const kept = new Set(rows.map((r) => r.operationRef).filter((x): x is string => !!x));
  return { byOwner, kept, canon };
}

const addBreakdown = (b: Partial<Record<CReason, Decimal>>, r: CReason, v: Decimal) => {
  b[r] = (b[r] ?? ZERO).add(v);
};

const sumOver = <T>(items: T[], pick: (t: T) => Decimal) => items.reduce((s, t) => s.add(pick(t)), ZERO);

/** The name of a label key for the output ('?' = without a label); keys ordered by name, '?' last. */
function namedKeys(calc: Calculation, keys: Iterable<string>): { key: string; name: string }[] {
  const out = [...new Set(keys)].map((key) => ({ key, name: key === NONE ? '?' : (calc.labelName(key) ?? '?') }));
  return out.sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : a.name.localeCompare(b.name) || a.key.localeCompare(b.key)));
}

/**
 * Balance of one owner, recalculated from scratch:
 * payable = earned (B) - recouped (positions in scope) - payouts with proof - advertising charged + returns + credits
 * + adjustments - write-offs (D-173). Advances are not subtracted as such; only their recouped part reduces the payable
 * amount; a forgiveness frees the later income of its advance, a buyout is outside the balance.
 *
 * Every field is partitioned by label (D-168, `byLabel`): the recoup always runs over every income of the owner, then
 * the consumed amounts are attributed to the label of the income they took. A `view` restricts the answer to one
 * label's book: the same computation, projected (never a separate calculation, so the books of the labels and
 * «without a label» always add up to the whole owner).
 */
export function ownerBalance(
  calc: Calculation,
  ownerId: string,
  ops: OperationView[],
  f: PeriodFilter,
  /**
   * A prebuilt per-owner index (`ownerIndex`): only the units / publishing lines where the owner has an allocation, in
   * calculation order. The same loops run over it, so the result equals the one from the whole calculation.
   */
  index: {
    units?: UnitResult[];
    publishing?: PublishingResult[];
    /** The active opening balance rows of the owner's pseudonyms (D-174): the cut and the start of every book. */
    starts?: OpeningBalanceView[];
  } = {},
  view?: BalanceView,
  /** Diagnostics only (`scripts/check-label-books.ts` (ж)): every amount a position took from an income item. */
  onConsumed?: (position: Position, item: IncomeItem, amount: Decimal) => void,
): OwnerBalance {
  const basis = f.basis ?? 'report';
  // The cut of the opening balances (D-174): an owner with a start row in a book loses the units, the publishing, the
  // advertising of that book up to the cut month and its operations of the book up to the synchronisation day (an
  // operation a row reopens stays). Nothing is recomputed differently: the inputs are fewer, and the start is added.
  const starts = index.starts ?? [];
  const cuts = startCuts(calc, starts);
  const inside: InsideStart = { earned: ZERO, waiting: ZERO, paid: ZERO, advances: ZERO, adsCharged: ZERO, operations: 0 };
  const ownerCut = (key: string, month: string) => {
    const c = cuts.byOwner.get(key);
    return c !== undefined && month <= c.cutoffMonth;
  };
  const opCut = (o: OperationView) => {
    if (cuts.kept.has(o.id)) return false;
    const c = cuts.byOwner.get(keyOf(o.labelId));
    return c !== undefined && o.date <= c.syncedDay;
  };
  const confirmedAny = calc.confirmedOwners.has(ownerId);
  const confirmed = view ? calc.confirmedOwnersUnder(view.labelId).has(ownerId) : confirmedAny;
  const inView = (key: string) => !view || key === view.labelId;
  const artistsOfOwner = new Map<string, { id: string; pseudonym: string }>();
  for (const [, a] of calc.artistIndex)
    if (a.ownerId === ownerId && !artistsOfOwner.has(a.id)) artistsOfOwner.set(a.id, { id: a.id, pseudonym: a.pseudonym });

  const books = new ByKey(newBook);
  const periods = new ByKey(newPeriod);
  /** Per artist, per label key. */
  const artistAcc = new Map<string, ByKey<ArtistAcc>>();
  const artistOf = (artistId: string, key: string): ArtistAcc | undefined => {
    if (!artistsOfOwner.has(artistId)) return undefined;
    let by = artistAcc.get(artistId);
    if (!by) artistAcc.set(artistId, (by = new ByKey(newArtistAcc)));
    return by.of(key);
  };
  /** The owner's own position per book (D-181): publishing, operations without a pseudonym. */
  const pools = new ByKey(newPosByArea);
  /** The position accumulator an operation's money goes to: its pseudonym's (the surviving id), else the owner's own. */
  const posOf = (artistId: string | null | undefined, key: string, area: Area): PosAcc => {
    const id = artistId ? (calc.artistIndex.get(artistId)?.id ?? artistId) : null;
    const artist = id ? artistOf(id, key) : undefined;
    return (artist ?? { pos: pools.of(key) }).pos[area];
  };
  const trackOf = (a: ArtistAcc, isrc: string): TrackAcc => {
    let t = a.tracks.get(isrc);
    if (!t) a.tracks.set(isrc, (t = { isrc, net: ZERO, amount: ZERO, waiting: ZERO }));
    return t;
  };

  const income: IncomeItem[] = [];
  const incomeById = new Map<string, IncomeItem>();
  const itemInPeriod = new Set<string>();

  for (const u of index.units ?? calc.units) {
    const key = keyOf(u.bookLabelId);
    const mine = u.allocations.filter((a) => {
      if (a.ownerId !== ownerId) return false;
      if (!ownerCut(key, u.reportingMonth)) return true;
      if (a.category === 'B') inside.earned = inside.earned.add(a.amount);
      else inside.waiting = inside.waiting.add(a.amount);
      return false;
    });
    if (mine.length === 0) continue;
    const book = books.of(key);
    const period = periods.of(key);
    const inP = unitInPeriod(u, f);
    if (inP) {
      period.received = period.received.add(u.net);
      period.ourShare = period.ourShare.add(u.ours);
      period.otherParticipants = period.otherParticipants.add(
        u.allocations.filter((a) => a.ownerId !== ownerId).reduce((s, a) => s.add(a.amount), ZERO),
      );
    }
    for (const a of mine) {
      const artist = artistOf(a.artistId, key);
      const t = artist ? trackOf(artist, u.isrc) : undefined;
      if (a.category === 'B') {
        book.earned = book.earned.add(a.amount);
        addArea(book, 'master', 'earned', a.amount);
        // Income items are netted per artist + ISRC + report month + book, so negative lines reduce recoup capacity;
        // the book is a suffix (D-169): the order of the items in the recoup stays, and one ISRC-month from the files of
        // two labels gives two items, each recouping only the positions of its own book.
        const id = `m|${a.artistId}|${u.isrc}|${u.reportingMonth}|${key}`;
        const prev = incomeById.get(id);
        if (prev) prev.amount = prev.amount.add(a.amount);
        else {
          const item: IncomeItem = {
            id,
            stream: 'master',
            ownerId,
            artistId: a.artistId,
            isrc: u.isrc,
            reportMonth: u.reportingMonth,
            amount: a.amount,
            labelId: u.bookLabelId,
          };
          incomeById.set(id, item);
          income.push(item);
        }
        if (artist) artist.pos.master.earned = artist.pos.master.earned.add(a.amount);
        if (inP) {
          itemInPeriod.add(id);
          period.notOurs = period.notOurs.add(a.amount);
          period.earnedMaster = period.earnedMaster.add(a.amount);
          if (artist) artist.earned = artist.earned.add(a.amount);
          if (t) t.amount = t.amount.add(a.amount);
        }
      } else {
        book.waiting = book.waiting.add(a.amount);
        if (inP) {
          period.waiting = period.waiting.add(a.amount);
          addBreakdown(period.waitingBreakdown, a.reason as CReason, a.amount);
          if (artist) artist.waiting = artist.waiting.add(a.amount);
          if (t) t.waiting = t.waiting.add(a.amount);
        }
      }
      if (inP && t) t.net = t.net.add(u.net);
    }
  }

  // Publishing sits in the book of the label of its statement (D-169), «without a label» before the marking.
  // The income id `p|<month>` stays unique per book: a quarter belongs to one statement, hence to one label (D-041).
  const publishing: (OwnerBalance['publishing'][number] & { key: string })[] = [];
  (index.publishing ?? calc.publishing).forEach((p) => {
    if (p.ownerId !== ownerId) return;
    const key = keyOf(p.labelId);
    if (ownerCut(key, p.reportMonth)) {
      if (p.category === 'B') inside.earned = inside.earned.add(p.authorAmount);
      else inside.waiting = inside.waiting.add(p.authorAmount);
      return;
    }
    const book = books.of(key);
    const period = periods.of(key);
    const inP = pubInPeriod(p, f);
    if (p.category === 'B') {
      book.earned = book.earned.add(p.authorAmount);
      addArea(book, 'publishing', 'earned', p.authorAmount);
      pools.of(key).publishing.earned = pools.of(key).publishing.earned.add(p.authorAmount);
      const id = `p|${p.reportMonth}`;
      const prev = incomeById.get(id);
      if (prev) prev.amount = prev.amount.add(p.authorAmount);
      else {
        const item: IncomeItem = {
          id,
          stream: 'publishing',
          ownerId,
          artistId: null,
          isrc: null,
          reportMonth: p.reportMonth,
          amount: p.authorAmount,
          labelId: p.labelId,
        };
        incomeById.set(id, item);
        income.push(item);
      }
      if (inP) {
        itemInPeriod.add(id);
        period.notOurs = period.notOurs.add(p.authorAmount);
        period.earnedPublishing = period.earnedPublishing.add(p.authorAmount);
      }
    } else {
      book.waiting = book.waiting.add(p.authorAmount);
      if (inP) {
        period.waiting = period.waiting.add(p.authorAmount);
        addBreakdown(period.waitingBreakdown, p.reason as CReason, p.authorAmount);
      }
    }
    if (inP) {
      period.received = period.received.add(p.payable);
      period.ourShare = period.ourShare.add(p.labelAmount);
      publishing.push({
        period: p.period,
        workTitle: p.workTitle,
        payable: p.payable,
        percent: p.percent,
        amount: p.authorAmount,
        category: p.category,
        reason: p.reason,
        key,
      });
    }
  });

  // Operations of the owner (payouts go to the owner; settlements are tied to the artist), each under its label.
  const positions: Position[] = [];
  const pending: { operationId: string; why: string; key: string }[] = [];
  const opInPeriod = (o: OperationView) => inMonthRange(monthOf(o.date), f.from, f.to);
  // the counted forgivenesses per advance (D-173), in the order (date, id)
  const forgivenOf = new Map<string, { date: string; id: string; amount: Decimal }[]>();
  for (const o of ops) {
    if (opCut(o)) {
      if (o.active && classifyOperation(o, calc.documentStatus).counted) {
        inside.operations++;
        if (o.kind === 'payout') inside.paid = inside.paid.add(centsToDecimal(o.amountCents));
        if (o.kind === 'advance') inside.advances = inside.advances.add(centsToDecimal(o.amountCents));
      }
      continue;
    }
    const c = classifyOperation(o, calc.documentStatus);
    const key = keyOf(o.labelId);
    if (!c.counted) {
      if (o.active) pending.push({ operationId: o.id, why: c.why ?? 'pending', key });
      continue;
    }
    const amount = centsToDecimal(o.amountCents);
    const book = books.of(key);
    // by the stored kind (D-173); the history has the five kinds of `kindOf`
    switch (o.kind) {
      case 'payout':
        book.paid = book.paid.add(amount);
        addArea(book, o.area, 'paid', amount);
        // the position it reduces (D-181): its pseudonym's, the ones of its allocation (the button), else the owner's own
        if (o.allocation && !o.artistId)
          for (const [who, c] of Object.entries(o.allocation)) {
            const target = posOf(who === OWNER_POSITION ? null : who, key, o.area);
            target.paid = target.paid.add(centsToDecimal(c));
          }
        else {
          const target = posOf(o.artistId, key, o.area);
          target.paid = target.paid.add(amount);
        }
        if (opInPeriod(o)) periods.of(key).paid = periods.of(key).paid.add(amount);
        break;
      case 'advance':
      case 'deduction':
        if (o.kind === 'advance' && opInPeriod(o))
          periods.of(key).advancesPaid = periods.of(key).advancesPaid.add(amount);
        positions.push({
          id: o.id,
          ownerId,
          artistId: calc.artistIndex.get(o.artistId as string)?.id ?? (o.artistId as string),
          month: o.kind === 'advance' ? monthOf(o.date) : null,
          amount,
          scope: o.scope ?? { kind: 'any' },
          labelId: o.labelId,
        });
        break;
      case 'return': {
        book.returns = book.returns.add(amount.neg());
        addArea(book, o.area, 'returns', amount.neg());
        // the money comes back to the positions its payout took from (D-181): by the payout's allocation, pro rata
        const ref = !o.artistId && o.operationRef ? ops.find((x) => x.id === o.operationRef) : undefined;
        if (ref?.allocation)
          for (const [who, c] of Object.entries(splitCents(-o.amountCents, ref.allocation))) {
            const target = posOf(who === OWNER_POSITION ? null : who, key, o.area);
            target.returns = target.returns.add(centsToDecimal(c));
          }
        else {
          const target = posOf(o.artistId, key, o.area);
          target.returns = target.returns.add(amount.neg());
        }
        break;
      }
      case 'credit': {
        book.credits = book.credits.add(amount.neg());
        addArea(book, o.area, 'credits', amount.neg());
        const target = posOf(o.artistId, key, o.area);
        target.credits = target.credits.add(amount.neg());
        break;
      }
      case 'buyout':
        book.buyouts = book.buyouts.add(amount);
        addArea(book, o.area, 'buyouts', amount);
        break;
      case 'writeoff': {
        book.writtenOff = book.writtenOff.add(amount);
        addArea(book, o.area, 'writtenOff', amount);
        const target = posOf(o.artistId, key, o.area);
        target.writtenOff = target.writtenOff.add(amount);
        break;
      }
      case 'adjustment': {
        book.adjustments = book.adjustments.add(amount.neg());
        addArea(book, o.area, 'adjustments', amount.neg());
        const target = posOf(o.artistId, key, o.area);
        target.adjustments = target.adjustments.add(amount.neg());
        break;
      }
      case 'forgiveness': {
        const list = forgivenOf.get(o.operationRef as string) ?? [];
        list.push({ date: o.date, id: o.id, amount });
        forgivenOf.set(o.operationRef as string, list);
        break;
      }
    }
  }
  // the forgivenesses go with their advance (a forgiveness of an advance that does not count frees nothing)
  for (const p of positions) {
    const list = forgivenOf.get(p.id);
    if (!list) continue;
    list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    p.forgiven = list.map((x) => ({ month: monthOf(x.date), amount: x.amount }));
  }

  // Advertising is taken off payable at once and in full, like a payout (D-157): not recouped from income.
  const adViews: AdChargeView[] = (calc.adPositions.get(ownerId) ?? []).map((ad) => ({
    adId: ad.adId,
    isrc: ad.isrc,
    month: ad.adMonth,
    artistId: ad.artistId,
    role: ad.role,
    amount: ad.amount,
    labelId: ad.labelId,
  }));
  adViews.sort((a, b) => (a.month !== b.month ? (a.month < b.month ? 1 : -1) : a.adId.localeCompare(b.adId)));
  const adsAfterCut = adViews.filter((a) => {
    if (!ownerCut(keyOf(a.labelId), a.month)) return true;
    inside.adsCharged = inside.adsCharged.add(a.amount);
    return false;
  });
  for (const a of adsAfterCut) {
    books.of(keyOf(a.labelId)).adsCharged = books.of(keyOf(a.labelId)).adsCharged.add(a.amount);
    addArea(books.of(keyOf(a.labelId)), 'master', 'adsCharged', a.amount);
    const target = posOf(a.artistId, keyOf(a.labelId), 'master');
    target.adsCharged = target.adsCharged.add(a.amount);
  }

  // The opening balances themselves (D-174): the start and the adjustments of every pseudonym, in the book of the row,
  // master and publishing cents in their areas; a missing start closes the payout of its book.
  const startRows: StartView['rows'] = [];
  for (const r of starts) {
    const key = keyOf(r.labelId);
    const book = books.of(key);
    const master = centsToDecimal(r.masterCents);
    const pub = centsToDecimal(r.publishingCents);
    book.start = book.start.add(master).add(pub);
    addArea(book, 'master', 'start', master);
    addArea(book, 'publishing', 'start', pub);
    if (r.missing) book.startMissing = true;
    const artistId = cuts.canon(r.artistId);
    const artist = artistOf(artistId, key);
    if (artist) {
      artist.start = artist.start.add(master).add(pub);
      artist.pos.master.start = artist.pos.master.start.add(master);
      artist.pos.publishing.start = artist.pos.publishing.start.add(pub);
    }
    startRows.push({ ...r, artistId, pseudonym: calc.artistIndex.get(artistId)?.pseudonym ?? artistsOfOwner.get(artistId)?.pseudonym ?? '?' });
  }

  // The recoup runs over every income of the owner; what a position took is attributed to the label of that income.
  const results = recoup(positions, income);
  const positionViews: (PositionView & { key: string })[] = [];
  for (const r of results) {
    const p = positions.find((x) => x.id === r.positionId) as Position;
    for (const c of r.consumed) {
      const item = incomeById.get(c.itemId) as IncomeItem;
      onConsumed?.(p, item, c.amount);
      const key = keyOf(item.labelId);
      const book = books.of(key);
      book.recouped = book.recouped.add(c.amount);
      addArea(book, item.stream, 'recouped', c.amount);
      if (itemInPeriod.has(c.itemId)) periods.of(key).recouped = periods.of(key).recouped.add(c.amount);
      if (item.stream === 'publishing') book.publishingRecouped = book.publishingRecouped.add(c.amount);
      else {
        const source = artistOf(item.artistId as string, key);
        if (source) source.recoupedFromMaster = source.recoupedFromMaster.add(c.amount);
      }
      const artist = artistOf(p.artistId, key);
      if (artist) artist.recouped = artist.recouped.add(c.amount);
      // the position the recoup leaves (D-181) is the one holding the income consumed: the pseudonym of a master item
      // (a position recoups only its own pseudonym's income), the owner's own for its publishing
      const target = posOf(item.artistId, key, item.stream);
      target.recouped = target.recouped.add(c.amount);
    }
    const holder = artistOf(p.artistId, keyOf(p.labelId));
    if (holder) holder.unrecouped = holder.unrecouped.add(r.remaining);
    // the effective forgiveness (D-173) in the book of the position's label and of its holder
    if (!r.forgiven.isZero()) {
      books.of(keyOf(p.labelId)).forgiven = books.of(keyOf(p.labelId)).forgiven.add(r.forgiven);
      if (holder) holder.forgiven = holder.forgiven.add(r.forgiven);
    }
    const op = ops.find((o) => o.id === r.positionId) as OperationView;
    positionViews.push({
      operationId: r.positionId,
      artistId: p.artistId,
      amount: r.amount,
      recouped: r.recouped,
      forgiven: r.forgiven,
      forgivenRecorded: sumOver(p.forgiven ?? [], (x) => x.amount),
      remaining: r.remaining,
      scope: p.scope,
      date: op.date,
      labelId: p.labelId,
      key: keyOf(p.labelId),
    });
  }

  // The owner's own operations without a pseudonym that leave its own position negative (a payout without an
  // allocation, a write-off above the owner's publishing) are shared to the pseudonyms with a positive position of the
  // same book and area, the largest first (D-181: a payment to the payee «разносится по его участникам»); what no
  // positive position can take stays on the owner's own position.
  for (const [key, pool] of pools.map) {
    for (const area of ['master', 'publishing'] as const) {
      let deficit = positionOf(pool[area]).neg();
      if (deficit.lte(0)) continue;
      const takers = [...artistAcc.entries()]
        .map(([id, by]) => ({ id, pos: by.map.get(key)?.pos[area] }))
        .filter((x): x is { id: string; pos: PosAcc } => x.pos !== undefined && positionOf(x.pos).gt(0))
        .sort((x, y) => positionOf(y.pos).cmp(positionOf(x.pos)) || x.id.localeCompare(y.id));
      for (const t of takers) {
        const take = Decimal.min(positionOf(t.pos), deficit);
        if (take.lte(0)) break;
        t.pos.shared = t.pos.shared.sub(take);
        pool[area].shared = pool[area].shared.add(take);
        deficit = deficit.sub(take);
        if (deficit.lte(0)) break;
      }
    }
  }
  /** The positions of the book's pseudonyms (D-181) by area and in all; the owner's own one under `OWNER_POSITION`. */
  const positionsOf = (key: string, area?: Area): { id: string; position: Decimal }[] => {
    const of = (pos: Record<Area, PosAcc>) => (area ? positionOf(pos[area]) : positionOf(pos.master).add(positionOf(pos.publishing)));
    const list = [...artistAcc.entries()].map(([id, by]) => ({ id, position: by.map.has(key) ? of(by.of(key).pos) : ZERO }));
    list.push({ id: OWNER_POSITION, position: pools.map.has(key) ? of(pools.of(key)) : ZERO });
    return list;
  };
  /** What a book or an area pays (D-181): Σ of the positive positions. */
  const shownOf = (key: string, area?: Area) => positionsOf(key, area).reduce((s, x) => (x.position.gt(0) ? s.add(x.position) : s), ZERO);
  const negativeIn = (key: string) => positionsOf(key).some((x) => x.position.lt(0));
  const ownerPositionOf = (key: string, area?: Area) => positionsOf(key, area).find((x) => x.id === OWNER_POSITION)?.position ?? ZERO;

  // The answer: every book, or the one of the view.
  const named = namedKeys(calc, [...books.map.keys(), ...periods.map.keys(), ...(view ? [view.labelId] : [])]).filter((k) =>
    inView(k.key),
  );
  const bookOf = (acc: BookAcc, labelId: string | null, key: string): LabelBook => {
    const payable = payableOf(acc);
    return {
      labelId,
      earned: acc.earned,
      waiting: acc.waiting,
      recouped: acc.recouped,
      adsCharged: acc.adsCharged,
      paid: acc.paid,
      returns: acc.returns,
      credits: acc.credits,
      buyouts: acc.buyouts,
      forgiven: acc.forgiven,
      writtenOff: acc.writtenOff,
      adjustments: acc.adjustments,
      start: acc.start,
      startMissing: acc.startMissing,
      payable,
      payableShown: shownOf(key),
      payableNegative: negativeIn(key),
      ownerPosition: ownerPositionOf(key),
      byArea: { master: areaBook(acc.area.master, key, 'master'), publishing: areaBook(acc.area.publishing, key, 'publishing') },
    };
  };
  const areaBook = (a: AreaAcc, key: string, area: Area): AreaBook => ({ ...a, payable: payableOf(a), payableShown: shownOf(key, area), ownerPosition: ownerPositionOf(key, area) });
  const byLabel: OwnerBalance['byLabel'] = {};
  const selectedBooks: BookAcc[] = [];
  const selectedPeriods: PeriodAcc[] = [];
  const isZero = (b: LabelBook) =>
    [b.earned, b.waiting, b.recouped, b.adsCharged, b.paid, b.returns, b.credits, b.buyouts, b.forgiven, b.writtenOff, b.adjustments, b.start].every((x) =>
      x.isZero(),
    ) && !b.startMissing;
  for (const { key, name } of named) {
    const acc = books.of(key);
    const book = bookOf(acc, key === NONE ? null : key, key);
    // a key touched by nothing that counts (a position recouped in full, a pending operation) is not a book
    if (isZero(book) && !(view && key === view.labelId)) continue;
    byLabel[name] = book;
    selectedBooks.push(acc);
    selectedPeriods.push(periods.of(key));
  }
  const tot = (pick: (b: BookAcc) => Decimal) => sumOver(selectedBooks, pick);
  const per = (pick: (p: PeriodAcc) => Decimal) => sumOver(selectedPeriods, pick);
  const waitingBreakdown: Partial<Record<CReason, Decimal>> = {};
  for (const p of selectedPeriods) for (const [r, v] of Object.entries(p.waitingBreakdown)) addBreakdown(waitingBreakdown, r as CReason, v);
  const payable = tot(payableOf);
  const selectedKeys = named.filter(({ name }) => byLabel[name] !== undefined).map(({ key }) => key);
  const totalArea = (area: Area): AreaBook => {
    const acc = newArea();
    for (const k of AREA_FIELDS) acc[k] = tot((b) => b.area[area][k]);
    return {
      ...acc,
      payable: payableOf(acc),
      payableShown: sumOver(selectedKeys, (k) => shownOf(k, area)),
      ownerPosition: sumOver(selectedKeys, (k) => ownerPositionOf(k, area)),
    };
  };

  const artists: ArtistBalance[] = [...artistsOfOwner.values()].map((a) => {
    const by = artistAcc.get(a.id);
    const keys = namedKeys(calc, by ? [...by.map.keys()] : []).filter((k) => inView(k.key));
    const row: ArtistBalance = {
      artistId: a.id,
      pseudonym: a.pseudonym,
      earned: ZERO,
      waiting: ZERO,
      recouped: ZERO,
      unrecouped: ZERO,
      recoupedFromMaster: ZERO,
      forgiven: ZERO,
      start: ZERO,
      position: ZERO,
      positionNegative: false,
      tracks: [],
      byLabel: {},
    };
    const tracks = new Map<string, TrackAcc>();
    for (const { key, name } of keys) {
      const acc = (by as ByKey<ArtistAcc>).of(key);
      const positionByArea = { master: positionOf(acc.pos.master), publishing: positionOf(acc.pos.publishing) };
      const position = positionByArea.master.add(positionByArea.publishing);
      if ([acc.earned, acc.waiting, acc.recouped, acc.unrecouped, acc.recoupedFromMaster, acc.forgiven, acc.start, position].every((x) => x.isZero()) && acc.tracks.size === 0 && !(view && key === view.labelId)) continue;
      row.byLabel[name] = {
        labelId: key === NONE ? null : key,
        earned: acc.earned,
        waiting: acc.waiting,
        recouped: acc.recouped,
        unrecouped: acc.unrecouped,
        recoupedFromMaster: acc.recoupedFromMaster,
        forgiven: acc.forgiven,
        start: acc.start,
        position,
        positionByArea,
      };
      row.position = row.position.add(position);
      row.earned = row.earned.add(acc.earned);
      row.waiting = row.waiting.add(acc.waiting);
      row.recouped = row.recouped.add(acc.recouped);
      row.unrecouped = row.unrecouped.add(acc.unrecouped);
      row.recoupedFromMaster = row.recoupedFromMaster.add(acc.recoupedFromMaster);
      row.forgiven = row.forgiven.add(acc.forgiven);
      row.start = row.start.add(acc.start);
      for (const t of acc.tracks.values()) {
        const m = tracks.get(t.isrc) ?? { isrc: t.isrc, net: ZERO, amount: ZERO, waiting: ZERO };
        m.net = m.net.add(t.net);
        m.amount = m.amount.add(t.amount);
        m.waiting = m.waiting.add(t.waiting);
        tracks.set(t.isrc, m);
      }
    }
    row.tracks = [...tracks.values()]
      .filter((t) => !t.net.isZero() || !t.amount.isZero() || !t.waiting.isZero())
      .sort((x, y) => y.amount.add(y.waiting).cmp(x.amount.add(x.waiting)));
    row.positionNegative = row.position.lt(0);
    return row;
  });

  return {
    ownerId,
    confirmed,
    confirmedAny,
    label: view ? { id: view.labelId, name: calc.labelName(view.labelId) ?? '?' } : null,
    period: {
      from: f.from ?? null,
      to: f.to ?? null,
      basis,
      received: per((p) => p.received),
      notOurs: per((p) => p.notOurs),
      waiting: per((p) => p.waiting),
      waitingBreakdown,
      otherParticipants: per((p) => p.otherParticipants),
      ourShare: per((p) => p.ourShare),
      earnedMaster: per((p) => p.earnedMaster),
      earnedPublishing: per((p) => p.earnedPublishing),
      paid: per((p) => p.paid),
      advancesPaid: per((p) => p.advancesPaid),
      recouped: per((p) => p.recouped),
    },
    total: {
      earned: tot((b) => b.earned),
      waiting: tot((b) => b.waiting),
      recouped: tot((b) => b.recouped),
      adsCharged: tot((b) => b.adsCharged),
      paid: tot((b) => b.paid),
      returns: tot((b) => b.returns),
      credits: tot((b) => b.credits),
      buyouts: tot((b) => b.buyouts),
      forgiven: tot((b) => b.forgiven),
      writtenOff: tot((b) => b.writtenOff),
      adjustments: tot((b) => b.adjustments),
      start: tot((b) => b.start),
      startMissing: selectedBooks.some((b) => b.startMissing),
      payable,
      payableShown: sumOver(selectedKeys, (k) => shownOf(k)),
      payableNegative: selectedKeys.some(negativeIn),
      ownerPosition: sumOver(selectedKeys, (k) => ownerPositionOf(k)),
      byArea: { master: totalArea('master'), publishing: totalArea('publishing') },
    },
    byLabel,
    start:
      starts.length === 0
        ? null
        : {
            cuts: [...cuts.byOwner.entries()].filter(([k]) => inView(k)).map(([, c]) => c),
            rows: startRows.filter((r) => inView(keyOf(r.labelId))),
            insideStart: inside,
          },
    artists,
    publishingRecouped: tot((b) => b.publishingRecouped),
    publishing: publishing.filter((p) => inView(p.key)).map(({ key: _k, ...p }) => p),
    positions: positionViews.filter((p) => inView(p.key)).map(({ key: _k, ...p }) => p),
    ads: adsAfterCut.filter((a) => inView(keyOf(a.labelId))),
    pendingOperations: pending.filter((p) => inView(p.key)).map(({ key: _k, ...p }) => p),
    blockingPayouts: ops // the same rule as the facade's payout gate: no proof, deferred, or proof not approved
      .filter(
        (o) =>
          // the blocking kinds (D-173 FIX-5): payouts and advances, never a buyout; nothing inside the start (D-174)
          !opCut(o) &&
          (BLOCKING_KINDS as readonly string[]).includes(o.kind) &&
          o.active &&
          !o.migration &&
          (o.paymentProofId === null || o.deferred || calc.documentStatus(o.paymentProofId) !== 'approved'),
      )
      .map((o) => o.id),
  };
}

/** The active opening balance rows of the owner's pseudonyms (D-174), by the surviving pseudonym's owner. */
export function startsOfOwner(calc: Calculation, ownerId: string, rows: OpeningBalanceView[]): OpeningBalanceView[] {
  return rows.filter((r) => r.active && calc.artistIndex.get(r.artistId)?.ownerId === ownerId);
}

/** The active opening balance rows per owner (D-174), for the lists that balance every owner (payables, payroll). */
export function startsByOwner(calc: Calculation, rows: OpeningBalanceView[]): Map<string, OpeningBalanceView[]> {
  const out = new Map<string, OpeningBalanceView[]>();
  for (const r of rows) {
    if (!r.active) continue;
    const ownerId = calc.artistIndex.get(r.artistId)?.ownerId;
    if (!ownerId) continue;
    const list = out.get(ownerId);
    if (list) list.push(r);
    else out.set(ownerId, [r]);
  }
  return out;
}

/**
 * Per owner, the units where it has at least one allocation and its publishing lines, both in calculation order
 * (recoupment depends on the order). Built in one pass for the payables list (17 N4).
 */
export function ownerIndex(calc: Calculation): Map<string, { units: UnitResult[]; publishing: PublishingResult[] }> {
  const index = new Map<string, { units: UnitResult[]; publishing: PublishingResult[] }>();
  const of = (id: string) => {
    let e = index.get(id);
    if (!e) index.set(id, (e = { units: [], publishing: [] }));
    return e;
  };
  for (const u of calc.units) {
    const seen = new Set<string>();
    for (const a of u.allocations) {
      if (!a.ownerId || seen.has(a.ownerId)) continue;
      seen.add(a.ownerId);
      of(a.ownerId).units.push(u);
    }
  }
  for (const p of calc.publishing) if (p.ownerId) of(p.ownerId).publishing.push(p);
  return index;
}

/**
 * Per pseudonym (the surviving id), the units where it has at least one allocation, in calculation order. Built in one
 * pass for the balances of a list of pseudonyms (D-167), as `ownerIndex` is for the payables.
 */
export function artistUnitIndex(calc: Calculation): Map<string, UnitResult[]> {
  const index = new Map<string, UnitResult[]>();
  for (const u of calc.units) {
    const seen = new Set<string>();
    for (const a of u.allocations) {
      if (seen.has(a.artistId)) continue;
      seen.add(a.artistId);
      const list = index.get(a.artistId);
      if (list) list.push(u);
      else index.set(a.artistId, [u]);
    }
  }
  return index;
}

/** The money of one pseudonym under one label (D-168): the fields of `ArtistMoney.total` per label key. */
export interface ArtistMoneyBook {
  labelId: string | null;
  earned: Decimal;
  waiting: Decimal;
  recouped: Decimal;
  unrecouped: Decimal;
  recoupedFromMaster: Decimal;
  adsCharged: Decimal;
  paid: Decimal;
  /** The opening balance of the pseudonym in the book (D-174). */
  start: Decimal;
  /** The position of the pseudonym in the book (D-181). */
  position: Decimal;
}

/** What one pseudonym sees of its money (D-165): the artist row of `ownerBalance()` with the owner-level parts of it. */
export interface ArtistMoney {
  artistId: string;
  pseudonym: string;
  ownerId: string | null;
  /** The label the money is restricted to (D-168); null = every book. */
  label: { id: string; name: string } | null;
  period: {
    from: string | null;
    to: string | null;
    basis: 'report' | 'sales';
    /** Σ net of the units where the pseudonym has an allocation (the whole unit, not its part). */
    received: Decimal;
    earned: Decimal;
    waiting: Decimal;
    waitingBreakdown: Partial<Record<CReason, Decimal>>;
  };
  total: {
    earned: Decimal;
    waiting: Decimal;
    recouped: Decimal;
    unrecouped: Decimal;
    recoupedFromMaster: Decimal;
    /** Advertising charged to this pseudonym (its recovered part, or the unrecovered part it bears as a sublabel). */
    adsCharged: Decimal;
    /** Payouts tied to this pseudonym (the button pays the owner: those carry no pseudonym). */
    paid: Decimal;
    /** The opening balance of the pseudonym (D-174). */
    start: Decimal;
    /** The position of the pseudonym (D-181): what the label owes it over its books; 0 without an owner. */
    position: Decimal;
  };
  /** The book of every label of the pseudonym (by name, '?' = without a label); Σ books = total (D-168). */
  byLabel: Record<string, ArtistMoneyBook>;
  tracks: ArtistBalance['tracks'];
  positions: PositionView[];
  ads: AdChargeView[];
  pendingOperations: { operationId: string; why: string }[];
}

/**
 * The money of one pseudonym (D-165). With an owner, the row is the very `ArtistBalance` that `ownerBalance()` builds
 * for it (earned, waiting, recouped, unrecouped, recoupedFromMaster, tracks), and the positions, advertising and
 * pending operations are the owner's filtered to this pseudonym; the reasons of the waiting money, the per-label
 * sums, the net received and the all-time earned / waiting come from the same loop over the units, restricted to this
 * pseudonym's allocations. Without an owner there is no owner balance: everything comes from that loop (nothing is
 * earned, nothing recouped), and `ops` is empty. A `view` restricts everything to one label (D-168).
 */
export function artistBalance(
  calc: Calculation,
  artistId: string,
  ops: OperationView[],
  f: PeriodFilter,
  /**
   * Prebuilt indexes (`artistUnitIndex`, `ownerIndex`): the units where the pseudonym has an allocation and the owner's
   * entry, in calculation order. The same loops run over them, so the result equals the one from the whole calculation.
   */
  index: { units?: UnitResult[]; owner?: { units?: UnitResult[]; publishing?: PublishingResult[]; starts?: OpeningBalanceView[] } } = {},
  view?: BalanceView,
): ArtistMoney {
  const basis = f.basis ?? 'report';
  const entry = calc.artistIndex.get(artistId);
  const id = entry?.id ?? artistId;
  const ownerId = entry?.ownerId ?? null;
  const inView = (key: string) => !view || key === view.labelId;
  const owner = ownerId ? ownerBalance(calc, ownerId, ops, f, index.owner ?? {}, view) : null;
  const row = owner?.artists.find((a) => a.artistId === id);

  let received = ZERO;
  let pEarned = ZERO;
  let pWaiting = ZERO;
  const waitingBreakdown: Partial<Record<CReason, Decimal>> = {};
  const earnedBy = new ByKey(() => ({ earned: ZERO, waiting: ZERO }));
  const trackAgg = new Map<string, TrackAcc>();
  for (const u of index.units ?? calc.units) {
    const key = keyOf(u.bookLabelId);
    if (!inView(key)) continue;
    const mine = u.allocations.filter((a) => a.artistId === id);
    if (mine.length === 0) continue;
    const inP = unitInPeriod(u, f);
    if (inP) received = received.add(u.net);
    const lb = earnedBy.of(key);
    const t = trackAgg.get(u.isrc) ?? { isrc: u.isrc, net: ZERO, amount: ZERO, waiting: ZERO };
    for (const a of mine) {
      if (a.category === 'B') {
        lb.earned = lb.earned.add(a.amount);
        if (inP) {
          pEarned = pEarned.add(a.amount);
          t.amount = t.amount.add(a.amount);
        }
      } else {
        lb.waiting = lb.waiting.add(a.amount);
        if (inP) {
          pWaiting = pWaiting.add(a.amount);
          addBreakdown(waitingBreakdown, a.reason as CReason, a.amount);
          t.waiting = t.waiting.add(a.amount);
        }
      }
      if (inP) t.net = t.net.add(u.net);
    }
    trackAgg.set(u.isrc, t);
  }
  const tracks =
    row?.tracks ??
    [...trackAgg.values()]
      .filter((t) => !t.net.isZero() || !t.amount.isZero() || !t.waiting.isZero())
      .sort((x, y) => y.amount.add(y.waiting).cmp(x.amount.add(x.waiting)));

  // the operations inside the start of the owner (D-174) are not paid by us any more
  const cuts = startCuts(calc, index.owner?.starts ?? []);
  const paidBy = new ByKey(() => ({ paid: ZERO }));
  for (const o of ops) {
    if (o.kind !== 'payout' || !o.artistId || (calc.artistIndex.get(o.artistId)?.id ?? o.artistId) !== id) continue;
    if (!cuts.kept.has(o.id) && (cuts.byOwner.get(keyOf(o.labelId))?.syncedDay ?? '') >= o.date) continue;
    if (!inView(keyOf(o.labelId))) continue;
    if (classifyOperation(o, calc.documentStatus).counted) paidBy.of(keyOf(o.labelId)).paid = paidBy.of(keyOf(o.labelId)).paid.add(centsToDecimal(o.amountCents));
  }
  const opArtist = (operationId: string) => {
    const o = ops.find((x) => x.id === operationId);
    return o?.artistId ? (calc.artistIndex.get(o.artistId)?.id ?? o.artistId) : null;
  };
  const ads = (owner?.ads ?? []).filter((a) => a.artistId === id);
  const adsBy = new ByKey(() => ({ adsCharged: ZERO }));
  for (const a of ads) adsBy.of(keyOf(a.labelId)).adsCharged = adsBy.of(keyOf(a.labelId)).adsCharged.add(a.amount);

  const byLabel: ArtistMoney['byLabel'] = {};
  const rowBooks = row?.byLabel ?? {};
  const rowKeyOf = new Map(Object.entries(rowBooks).map(([name, b]) => [keyOf(b.labelId), name]));
  const keys = namedKeys(calc, [...earnedBy.map.keys(), ...paidBy.map.keys(), ...adsBy.map.keys(), ...rowKeyOf.keys()]);
  const total: ArtistMoney['total'] = { earned: ZERO, waiting: ZERO, recouped: ZERO, unrecouped: ZERO, recoupedFromMaster: ZERO, adsCharged: ZERO, paid: ZERO, start: ZERO, position: ZERO };
  for (const { key, name } of keys) {
    const rb = rowBooks[rowKeyOf.get(key) ?? ''];
    const b: ArtistMoneyBook = {
      labelId: key === NONE ? null : key,
      earned: earnedBy.of(key).earned,
      waiting: earnedBy.of(key).waiting,
      recouped: rb?.recouped ?? ZERO,
      unrecouped: rb?.unrecouped ?? ZERO,
      recoupedFromMaster: rb?.recoupedFromMaster ?? ZERO,
      adsCharged: adsBy.of(key).adsCharged,
      paid: paidBy.of(key).paid,
      start: rb?.start ?? ZERO,
      position: rb?.position ?? ZERO,
    };
    byLabel[name] = b;
    total.earned = total.earned.add(b.earned);
    total.waiting = total.waiting.add(b.waiting);
    total.recouped = total.recouped.add(b.recouped);
    total.unrecouped = total.unrecouped.add(b.unrecouped);
    total.recoupedFromMaster = total.recoupedFromMaster.add(b.recoupedFromMaster);
    total.adsCharged = total.adsCharged.add(b.adsCharged);
    total.paid = total.paid.add(b.paid);
    total.start = total.start.add(b.start);
    total.position = total.position.add(b.position);
  }
  return {
    artistId: id,
    pseudonym: entry?.pseudonym ?? '?',
    ownerId,
    label: view ? { id: view.labelId, name: calc.labelName(view.labelId) ?? '?' } : null,
    period: {
      from: f.from ?? null,
      to: f.to ?? null,
      basis,
      received,
      earned: row?.earned ?? pEarned,
      waiting: row?.waiting ?? pWaiting,
      waitingBreakdown,
    },
    total,
    byLabel,
    tracks,
    positions: (owner?.positions ?? []).filter((p) => p.artistId === id),
    ads,
    pendingOperations: (owner?.pendingOperations ?? []).filter((p) => opArtist(p.operationId) === id),
  };
}
