import { centsToDecimal, Decimal, ZERO } from '../shared/money';
import { inMonthRange, monthOf } from '../shared/dates';
import type { IncomeItem, OperationView, Position } from '../modules/settlements';
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
  tracks: { isrc: string; net: Decimal; amount: Decimal; waiting: Decimal }[];
  /** The row per book (by name, '?' = without a label); Σ over the books = the row (D-168, D-169). */
  byLabel: Record<string, ArtistLabelBook>;
}

export interface PositionView {
  operationId: string;
  artistId: string;
  amount: Decimal;
  recouped: Decimal;
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
 * The book of one label (D-168): every money field of the owner's total, partitioned by label. earned and waiting by
 * the label the unit's file was loaded under (D-169; publishing has none yet); recouped by the label of the income consumed; adsCharged by the
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
  payable: Decimal;
  payableShown: Decimal;
  payableNegative: boolean;
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
    payable: Decimal;
    /** Negative payable is kept as is; the owner sees 0. */
    payableShown: Decimal;
    /** True when payable < 0 (the screen shows `payableShown` and a note; the client does not compare money). */
    payableNegative: boolean;
  };
  /**
   * The book of every label (by name, '?' = without a label: an unmapped label string, publishing, an operation or a
   * charge without a label), D-168. Under a view, the one book of that label.
   */
  byLabel: Record<string, LabelBook>;
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
    // A recoupable payout (advance) applies, with its scope, only when its basis document is approved (07, question 8).
    if (o.scope && documentStatus(o.documentId) !== 'approved')
      return { counted: false, why: 'basis document not approved' };
    return { counted: true };
  }
  // Deductions and credits need an approved basis document; a return is confirmed by its return document.
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

interface BookAcc {
  earned: Decimal;
  waiting: Decimal;
  recouped: Decimal;
  adsCharged: Decimal;
  paid: Decimal;
  returns: Decimal;
  credits: Decimal;
  publishingRecouped: Decimal;
}
const newBook = (): BookAcc => ({
  earned: ZERO,
  waiting: ZERO,
  recouped: ZERO,
  adsCharged: ZERO,
  paid: ZERO,
  returns: ZERO,
  credits: ZERO,
  publishingRecouped: ZERO,
});

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
  tracks: Map<string, TrackAcc>;
}
const newArtistAcc = (): ArtistAcc => ({
  earned: ZERO,
  waiting: ZERO,
  recouped: ZERO,
  unrecouped: ZERO,
  recoupedFromMaster: ZERO,
  tracks: new Map(),
});

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
 * payable = earned (B) - recouped (positions in scope) - payouts with proof - advertising charged + returns + credits.
 * Advances are not subtracted as such; only their recouped part reduces the payable amount.
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
  index: { units?: UnitResult[]; publishing?: PublishingResult[] } = {},
  view?: BalanceView,
): OwnerBalance {
  const basis = f.basis ?? 'report';
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
  const trackOf = (a: ArtistAcc, isrc: string): TrackAcc => {
    let t = a.tracks.get(isrc);
    if (!t) a.tracks.set(isrc, (t = { isrc, net: ZERO, amount: ZERO, waiting: ZERO }));
    return t;
  };

  const income: IncomeItem[] = [];
  const incomeById = new Map<string, IncomeItem>();
  const itemInPeriod = new Set<string>();

  for (const u of index.units ?? calc.units) {
    const mine = u.allocations.filter((a) => a.ownerId === ownerId);
    if (mine.length === 0) continue;
    const key = keyOf(u.bookLabelId);
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

  // Publishing has no label of record (08 decision 7): its book is «without a label».
  const publishing: OwnerBalance['publishing'] = [];
  (index.publishing ?? calc.publishing).forEach((p) => {
    if (p.ownerId !== ownerId) return;
    const book = books.of(NONE);
    const period = periods.of(NONE);
    const inP = pubInPeriod(p, f);
    if (p.category === 'B') {
      book.earned = book.earned.add(p.authorAmount);
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
          labelId: null,
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
      });
    }
  });

  // Operations of the owner (payouts go to the owner; settlements are tied to the artist), each under its label.
  const positions: Position[] = [];
  const pending: { operationId: string; why: string; key: string }[] = [];
  const opInPeriod = (o: OperationView) => inMonthRange(monthOf(o.date), f.from, f.to);
  for (const o of ops) {
    const c = classifyOperation(o, calc.documentStatus);
    const key = keyOf(o.labelId);
    if (!c.counted) {
      if (o.active) pending.push({ operationId: o.id, why: c.why ?? 'pending', key });
      continue;
    }
    const amount = centsToDecimal(o.amountCents);
    const book = books.of(key);
    if (o.meaning === 'payout') {
      book.paid = book.paid.add(amount);
      if (opInPeriod(o)) periods.of(key).paid = periods.of(key).paid.add(amount);
    } else if (o.meaning === 'recoupable_payout' || o.meaning === 'deduction') {
      if (o.meaning === 'recoupable_payout' && opInPeriod(o))
        periods.of(key).advancesPaid = periods.of(key).advancesPaid.add(amount);
      positions.push({
        id: o.id,
        ownerId,
        artistId: calc.artistIndex.get(o.artistId as string)?.id ?? (o.artistId as string),
        month: o.meaning === 'recoupable_payout' ? monthOf(o.date) : null,
        amount,
        scope: o.scope ?? { kind: 'any' },
        labelId: o.labelId,
      });
    } else if (o.meaning === 'return') {
      book.returns = book.returns.add(amount.neg());
    } else {
      book.credits = book.credits.add(amount.neg());
    }
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
  for (const a of adViews) books.of(keyOf(a.labelId)).adsCharged = books.of(keyOf(a.labelId)).adsCharged.add(a.amount);

  // The recoup runs over every income of the owner; what a position took is attributed to the label of that income.
  const results = recoup(positions, income);
  const positionViews: (PositionView & { key: string })[] = [];
  for (const r of results) {
    const p = positions.find((x) => x.id === r.positionId) as Position;
    for (const c of r.consumed) {
      const item = incomeById.get(c.itemId) as IncomeItem;
      const key = keyOf(item.labelId);
      const book = books.of(key);
      book.recouped = book.recouped.add(c.amount);
      if (itemInPeriod.has(c.itemId)) periods.of(key).recouped = periods.of(key).recouped.add(c.amount);
      if (item.stream === 'publishing') book.publishingRecouped = book.publishingRecouped.add(c.amount);
      else {
        const source = artistOf(item.artistId as string, key);
        if (source) source.recoupedFromMaster = source.recoupedFromMaster.add(c.amount);
      }
      const artist = artistOf(p.artistId, key);
      if (artist) artist.recouped = artist.recouped.add(c.amount);
    }
    const holder = artistOf(p.artistId, keyOf(p.labelId));
    if (holder) holder.unrecouped = holder.unrecouped.add(r.remaining);
    const op = ops.find((o) => o.id === r.positionId) as OperationView;
    positionViews.push({
      operationId: r.positionId,
      artistId: p.artistId,
      amount: r.amount,
      recouped: r.recouped,
      remaining: r.remaining,
      scope: p.scope,
      date: op.date,
      labelId: p.labelId,
      key: keyOf(p.labelId),
    });
  }

  // The answer: every book, or the one of the view.
  const named = namedKeys(calc, [...books.map.keys(), ...periods.map.keys(), ...(view ? [view.labelId] : [])]).filter((k) =>
    inView(k.key),
  );
  const bookOf = (acc: BookAcc, labelId: string | null): LabelBook => {
    const payable = acc.earned.sub(acc.recouped).sub(acc.paid).sub(acc.adsCharged).add(acc.returns).add(acc.credits);
    return {
      labelId,
      earned: acc.earned,
      waiting: acc.waiting,
      recouped: acc.recouped,
      adsCharged: acc.adsCharged,
      paid: acc.paid,
      returns: acc.returns,
      credits: acc.credits,
      payable,
      payableShown: Decimal.max(payable, 0),
      payableNegative: payable.isNegative() && !payable.isZero(),
    };
  };
  const byLabel: OwnerBalance['byLabel'] = {};
  const selectedBooks: BookAcc[] = [];
  const selectedPeriods: PeriodAcc[] = [];
  const isZero = (b: LabelBook) => [b.earned, b.waiting, b.recouped, b.adsCharged, b.paid, b.returns, b.credits].every((x) => x.isZero());
  for (const { key, name } of named) {
    const acc = books.of(key);
    const book = bookOf(acc, key === NONE ? null : key);
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
  const payable = tot((b) => b.earned.sub(b.recouped).sub(b.paid).sub(b.adsCharged).add(b.returns).add(b.credits));

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
      tracks: [],
      byLabel: {},
    };
    const tracks = new Map<string, TrackAcc>();
    for (const { key, name } of keys) {
      const acc = (by as ByKey<ArtistAcc>).of(key);
      if ([acc.earned, acc.waiting, acc.recouped, acc.unrecouped, acc.recoupedFromMaster].every((x) => x.isZero()) && acc.tracks.size === 0 && !(view && key === view.labelId)) continue;
      row.byLabel[name] = {
        labelId: key === NONE ? null : key,
        earned: acc.earned,
        waiting: acc.waiting,
        recouped: acc.recouped,
        unrecouped: acc.unrecouped,
        recoupedFromMaster: acc.recoupedFromMaster,
      };
      row.earned = row.earned.add(acc.earned);
      row.waiting = row.waiting.add(acc.waiting);
      row.recouped = row.recouped.add(acc.recouped);
      row.unrecouped = row.unrecouped.add(acc.unrecouped);
      row.recoupedFromMaster = row.recoupedFromMaster.add(acc.recoupedFromMaster);
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
      payable,
      payableShown: Decimal.max(payable, 0),
      payableNegative: payable.isNegative() && !payable.isZero(),
    },
    byLabel,
    artists,
    publishingRecouped: tot((b) => b.publishingRecouped),
    publishing: inView(NONE) ? publishing : [],
    positions: positionViews.filter((p) => inView(p.key)).map(({ key: _k, ...p }) => p),
    ads: adViews.filter((a) => inView(keyOf(a.labelId))),
    pendingOperations: pending.filter((p) => inView(p.key)).map(({ key: _k, ...p }) => p),
    blockingPayouts: ops // the same rule as the facade's payout gate: no proof, deferred, or proof not approved
      .filter(
        (o) =>
          o.direction === 'out' &&
          o.active &&
          !o.migration &&
          (o.paymentProofId === null || o.deferred || calc.documentStatus(o.paymentProofId) !== 'approved'),
      )
      .map((o) => o.id),
  };
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
  index: { units?: UnitResult[]; owner?: { units?: UnitResult[]; publishing?: PublishingResult[] } } = {},
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

  const paidBy = new ByKey(() => ({ paid: ZERO }));
  for (const o of ops) {
    if (o.meaning !== 'payout' || !o.artistId || (calc.artistIndex.get(o.artistId)?.id ?? o.artistId) !== id) continue;
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
  const total: ArtistMoney['total'] = { earned: ZERO, waiting: ZERO, recouped: ZERO, unrecouped: ZERO, recoupedFromMaster: ZERO, adsCharged: ZERO, paid: ZERO };
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
    };
    byLabel[name] = b;
    total.earned = total.earned.add(b.earned);
    total.waiting = total.waiting.add(b.waiting);
    total.recouped = total.recouped.add(b.recouped);
    total.unrecouped = total.unrecouped.add(b.unrecouped);
    total.recoupedFromMaster = total.recoupedFromMaster.add(b.recoupedFromMaster);
    total.adsCharged = total.adsCharged.add(b.adsCharged);
    total.paid = total.paid.add(b.paid);
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
