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
}

export interface PositionView {
  operationId: string;
  artistId: string;
  amount: Decimal;
  recouped: Decimal;
  remaining: Decimal;
  scope: unknown;
  date: string;
}

export interface OwnerBalance {
  ownerId: string;
  confirmed: boolean;
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
    paid: Decimal;
    returns: Decimal;
    credits: Decimal;
    payable: Decimal;
    /** Negative payable is kept as is; the owner sees 0. */
    payableShown: Decimal;
  };
  /**
   * All-time master earned (B) and waiting (C) per label of record (the units' `ourLabelName`, '?' for an unmapped
   * label string), D-130. One balance per owner: recouped and paid stay one total (operations carry no label), and
   * publishing has no label of record, so Σ byLabel = the master part of `total.earned` / `total.waiting`.
   */
  byLabel: Record<string, { earned: Decimal; waiting: Decimal }>;
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

/**
 * Balance of one owner, recalculated from scratch:
 * payable = earned (B) - recouped (positions in scope) - payouts with proof + returns + credits.
 * Advances are not subtracted as such; only their recouped part reduces the payable amount.
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
): OwnerBalance {
  const basis = f.basis ?? 'report';
  const confirmed = calc.confirmedOwners.has(ownerId);
  const artistsOfOwner = new Map<string, ArtistBalance>();
  for (const [, a] of calc.artistIndex) {
    if (a.ownerId === ownerId && !artistsOfOwner.has(a.id)) {
      artistsOfOwner.set(a.id, {
        artistId: a.id,
        pseudonym: a.pseudonym,
        earned: ZERO,
        waiting: ZERO,
        recouped: ZERO,
        unrecouped: ZERO,
        recoupedFromMaster: ZERO,
        tracks: [],
      });
    }
  }

  const income: IncomeItem[] = [];
  const incomeById = new Map<string, IncomeItem>();
  const itemInPeriod = new Set<string>();
  let pReceived = ZERO;
  let pNotOurs = ZERO;
  let pWaiting = ZERO;
  let pOthers = ZERO;
  let pOurs = ZERO;
  let pMaster = ZERO;
  let pPub = ZERO;
  const waitingBreakdown: Partial<Record<CReason, Decimal>> = {};
  let tEarned = ZERO;
  let tWaiting = ZERO;
  const trackAgg = new Map<string, { isrc: string; net: Decimal; amount: Decimal; waiting: Decimal }>();
  const byLabel: OwnerBalance['byLabel'] = {};

  for (const u of index.units ?? calc.units) {
    const mine = u.allocations.filter((a) => a.ownerId === ownerId);
    if (mine.length === 0) continue;
    const inP = unitInPeriod(u, f);
    if (inP) {
      pReceived = pReceived.add(u.net);
      pOurs = pOurs.add(u.ours);
      pOthers = pOthers.add(
        u.allocations.filter((a) => a.ownerId !== ownerId).reduce((s, a) => s.add(a.amount), ZERO),
      );
    }
    const lb = (byLabel[u.ourLabelName ?? '?'] ??= { earned: ZERO, waiting: ZERO });
    for (const a of mine) {
      if (a.category === 'B') lb.earned = lb.earned.add(a.amount);
      else lb.waiting = lb.waiting.add(a.amount);
      const artist = artistsOfOwner.get(a.artistId);
      const tk = `${a.artistId}|${u.isrc}`;
      const t = trackAgg.get(tk) ?? { isrc: u.isrc, net: ZERO, amount: ZERO, waiting: ZERO };
      if (a.category === 'B') {
        tEarned = tEarned.add(a.amount);
        // Income items are netted per artist + ISRC + report month, so negative lines reduce recoup capacity.
        const id = `m|${a.artistId}|${u.isrc}|${u.reportingMonth}`;
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
          };
          incomeById.set(id, item);
          income.push(item);
        }
        if (inP) {
          itemInPeriod.add(id);
          pNotOurs = pNotOurs.add(a.amount);
          pMaster = pMaster.add(a.amount);
          if (artist) artist.earned = artist.earned.add(a.amount);
          t.amount = t.amount.add(a.amount);
        }
      } else {
        tWaiting = tWaiting.add(a.amount);
        if (inP) {
          pWaiting = pWaiting.add(a.amount);
          const r = a.reason as CReason;
          waitingBreakdown[r] = (waitingBreakdown[r] ?? ZERO).add(a.amount);
          if (artist) artist.waiting = artist.waiting.add(a.amount);
          t.waiting = t.waiting.add(a.amount);
        }
      }
      if (inP) t.net = t.net.add(u.net);
      trackAgg.set(tk, t);
    }
  }
  for (const [k, t] of trackAgg) {
    const artist = artistsOfOwner.get(k.split('|')[0] as string);
    if (artist && (!t.net.isZero() || !t.amount.isZero() || !t.waiting.isZero())) artist.tracks.push(t);
  }
  for (const a of artistsOfOwner.values())
    a.tracks.sort((x, y) => y.amount.add(y.waiting).cmp(x.amount.add(x.waiting)));

  const publishing: OwnerBalance['publishing'] = [];
  (index.publishing ?? calc.publishing).forEach((p) => {
    if (p.ownerId !== ownerId) return;
    const inP = pubInPeriod(p, f);
    if (p.category === 'B') {
      tEarned = tEarned.add(p.authorAmount);
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
        };
        incomeById.set(id, item);
        income.push(item);
      }
      if (inP) {
        itemInPeriod.add(id);
        pNotOurs = pNotOurs.add(p.authorAmount);
        pPub = pPub.add(p.authorAmount);
      }
    } else {
      tWaiting = tWaiting.add(p.authorAmount);
      if (inP) {
        pWaiting = pWaiting.add(p.authorAmount);
        const r = p.reason as CReason;
        waitingBreakdown[r] = (waitingBreakdown[r] ?? ZERO).add(p.authorAmount);
      }
    }
    if (inP) {
      pReceived = pReceived.add(p.payable);
      pOurs = pOurs.add(p.labelAmount);
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

  // Operations of the owner (payouts go to the owner; settlements are tied to the artist).
  const positions: Position[] = [];
  const pending: { operationId: string; why: string }[] = [];
  let tPaid = ZERO;
  let tReturns = ZERO;
  let tCredits = ZERO;
  let pPaid = ZERO;
  let pAdvances = ZERO;
  const opInPeriod = (o: OperationView) => inMonthRange(monthOf(o.date), f.from, f.to);
  for (const o of ops) {
    const c = classifyOperation(o, calc.documentStatus);
    if (!c.counted) {
      if (o.active) pending.push({ operationId: o.id, why: c.why ?? 'pending' });
      continue;
    }
    const amount = centsToDecimal(o.amountCents);
    if (o.meaning === 'payout') {
      tPaid = tPaid.add(amount);
      if (opInPeriod(o)) pPaid = pPaid.add(amount);
    } else if (o.meaning === 'recoupable_payout' || o.meaning === 'deduction') {
      if (o.meaning === 'recoupable_payout' && opInPeriod(o)) pAdvances = pAdvances.add(amount);
      positions.push({
        id: o.id,
        ownerId,
        artistId: calc.artistIndex.get(o.artistId as string)?.id ?? (o.artistId as string),
        month: o.meaning === 'recoupable_payout' ? monthOf(o.date) : null,
        amount,
        scope: o.scope ?? { kind: 'any' },
      });
    } else if (o.meaning === 'return') {
      tReturns = tReturns.add(amount.neg());
    } else {
      tCredits = tCredits.add(amount.neg());
    }
  }

  const results = recoup(positions, income);
  let tRecouped = ZERO;
  let publishingRecouped = ZERO;
  let pRecouped = ZERO;
  const positionViews: PositionView[] = results.map((r) => {
    const p = positions.find((x) => x.id === r.positionId) as Position;
    tRecouped = tRecouped.add(r.recouped);
    for (const c of r.consumed) {
      if (itemInPeriod.has(c.itemId)) pRecouped = pRecouped.add(c.amount);
      if (c.itemId.startsWith('p|')) publishingRecouped = publishingRecouped.add(c.amount);
      else {
        const source = artistsOfOwner.get(c.itemId.split('|')[1] as string);
        if (source) source.recoupedFromMaster = source.recoupedFromMaster.add(c.amount);
      }
    }
    const artist = artistsOfOwner.get(p.artistId);
    if (artist) {
      artist.recouped = artist.recouped.add(r.recouped);
      artist.unrecouped = artist.unrecouped.add(r.remaining);
    }
    const op = ops.find((o) => o.id === r.positionId) as OperationView;
    return {
      operationId: r.positionId,
      artistId: p.artistId,
      amount: r.amount,
      recouped: r.recouped,
      remaining: r.remaining,
      scope: p.scope,
      date: op.date,
    };
  });

  const payable = tEarned.sub(tRecouped).sub(tPaid).add(tReturns).add(tCredits);
  return {
    ownerId,
    confirmed,
    period: {
      from: f.from ?? null,
      to: f.to ?? null,
      basis,
      received: pReceived,
      notOurs: pNotOurs,
      waiting: pWaiting,
      waitingBreakdown,
      otherParticipants: pOthers,
      ourShare: pOurs,
      earnedMaster: pMaster,
      earnedPublishing: pPub,
      paid: pPaid,
      advancesPaid: pAdvances,
      recouped: pRecouped,
    },
    total: {
      earned: tEarned,
      waiting: tWaiting,
      recouped: tRecouped,
      paid: tPaid,
      returns: tReturns,
      credits: tCredits,
      payable,
      payableShown: Decimal.max(payable, 0),
    },
    byLabel,
    artists: [...artistsOfOwner.values()],
    publishingRecouped,
    publishing,
    positions: positionViews,
    pendingOperations: pending,
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
