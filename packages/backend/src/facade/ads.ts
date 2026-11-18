import { centsToDecimal, Decimal, ZERO } from '../shared/money';
import { monthStart } from '../shared/dates';
import type { AdExpense, AdScope } from '../modules/ads';
import type { Position, Scope } from '../modules/settlements';
import { distribute, pct, sumOf } from './layers/exact';
import type { LayerContext } from './layers';

// Advertising expenses (D-155, D-156) as a pure function over one snapshot: who bears an expense and which debt
// positions it creates. Nothing is stored; calculate() runs it for every active expense.

export type AdStatus = 'allocated' | 'pre_allocated' | 'no_split' | 'no_artist';

export interface AdPart {
  artistId: string;
  ownerId: string | null;
  /** The weight of the artist: its split percent (100 for an allocated expense). */
  weight: Decimal;
  /** The artist's part of the expense. */
  amount: Decimal;
  /** part × recovery percent: the debt position on the artist. */
  recovered: Decimal;
}

export interface AdResult {
  adId: string;
  isrc: string | null;
  month: string;
  amount: Decimal;
  recoveryPercent: Decimal;
  scope: AdScope;
  status: AdStatus;
  /** The payer (D-169, R9): the record's own label, the book the expense charges; null = the record has no label ('?'). */
  ourLabelId: string | null;
  ourLabelName: string | null;
  /**
   * The book of the ISRC's income at the month of the expense (the label of the files of its units, D-169); null when
   * the ISRC has no unit (or no ISRC) or its units sit in files without a label. Information only: decides no money.
   */
  incomeBookLabelId: string | null;
  incomeBookLabelName: string | null;
  /** Who bears the unrecovered part for a sublabel's report, set by hand (D-231); the money never reads it. */
  bearerSublabelId: string | null;
  parts: AdPart[];
  /** amount − Σ recovered: the label's in the money (D-232: no sublabel rule bears it). */
  unrecovered: Decimal;
  borneBy: { kind: 'ours'; amount: Decimal };
}

export interface AdContext {
  splitAt: LayerContext['splitAt'];
  labelOf: LayerContext['labelOf'];
  labelName: LayerContext['labelName'];
  artistIndex: LayerContext['artistIndex'];
  /** Owners of kind label (brand, sublabels, buyers): their rows never bear advertising. */
  labelOwners: Set<string>;
  /** The Believe label string of an ISRC at a month (the nearest month that has a line), or undefined. */
  labelStringOf: (isrc: string, month: string) => string | undefined;
  /**
   * The book of an ISRC's income at a month (the same nearest month as `labelStringOf`; of several books that month the
   * one with the larger net, a tie: the first by name): an own label id, null = files without a label, undefined = no unit.
   */
  bookOf: (isrc: string, month: string) => string | null | undefined;
}

/** One expense: the split of its month, the parts of the artists, the recovered and unrecovered parts. */
export function allocateAd(ad: AdExpense, ctx: AdContext): AdResult {
  const amount = centsToDecimal(ad.amountCents);
  const percent = new Decimal(ad.recoveryPercent);
  const date = monthStart(ad.month);
  // the payer is the record's label (D-169, R9), whatever the line says
  const ourLabelId = ad.labelId;
  const incomeBookLabelId = ad.isrc ? (ctx.bookOf(ad.isrc, ad.month) ?? null) : null;
  const canon = (id: string) => ctx.artistIndex.get(id);

  let status: AdStatus;
  let weights: { artistId: string; weight: Decimal }[] = [];
  if (ad.artistId) {
    status = 'pre_allocated';
    weights = [{ artistId: canon(ad.artistId)?.id ?? ad.artistId, weight: new Decimal(100) }];
  } else {
    const sp = ctx.splitAt(ad.isrc as string, date);
    if (!sp) status = 'no_split';
    else {
      weights = sp.shares
        .filter((sh) => !sh.percent.isZero())
        // an MC row of the split in force never bears advertising (D-155 by the mark of the row, D-233; never by the name)
        .filter((sh) => sh.isMc !== true)
        .map((sh) => ({ a: canon(sh.artistId), id: sh.artistId, weight: sh.percent }))
        .filter((x) => !(x.a && x.a.ownerId && ctx.labelOwners.has(x.a.ownerId)))
        .map((x) => ({ artistId: x.a?.id ?? x.id, weight: x.weight }));
      status = weights.length > 0 ? 'allocated' : 'no_artist';
    }
  }
  const amounts = distribute(
    amount,
    weights.map((w) => ({ key: w.artistId, weight: w.weight })),
  );
  const parts: AdPart[] = weights.map((w, i) => {
    const part = amounts[i] as Decimal;
    return {
      artistId: w.artistId,
      ownerId: canon(w.artistId)?.ownerId ?? null,
      weight: w.weight,
      amount: part,
      recovered: pct(part, percent),
    };
  });
  // the rest by subtraction: Σ recovered + unrecovered = amount exactly
  const unrecovered = amount.sub(sumOf(parts.map((p) => p.recovered)));
  // the unrecovered part is the label's (D-232: no sublabel rule; who bears it for a sublabel's report is set by hand, D-231)
  const borneBy: AdResult['borneBy'] = { kind: 'ours', amount: unrecovered };
  return {
    adId: ad.id,
    isrc: ad.isrc,
    month: ad.month,
    amount,
    recoveryPercent: percent,
    scope: ad.scope,
    status,
    ourLabelId,
    ourLabelName: ourLabelId ? (ctx.labelName(ourLabelId) ?? null) : null,
    incomeBookLabelId,
    incomeBookLabelName: incomeBookLabelId ? (ctx.labelName(incomeBookLabelId) ?? null) : null,
    parts,
    bearerSublabelId: ad.bearerSublabelId,
    unrecovered,
    borneBy,
  };
}

/** The recoup scope of an artist's expense position: like an advance (D-155). */
export function scopeOf(r: Pick<AdResult, 'scope' | 'isrc'>): Scope {
  if (r.scope === 'publishing') return { kind: 'publishing' };
  if (r.scope === 'isrc' && r.isrc) return { kind: 'isrcs', isrcs: [r.isrc] };
  return { kind: 'any' };
}

/**
 * An amount an expense charges to an owner, with what it is for. The balance takes it off payable at once (D-157); the
 * scope is kept on the record but no longer decides anything about money.
 */
export interface AdPosition extends Position {
  adId: string;
  isrc: string | null;
  adMonth: string;
  role: 'artist';
}

/** Every charge of every owner, by owner (the balance reads its own). */
export function adPositionsByOwner(results: AdResult[]): Map<string, AdPosition[]> {
  const out = new Map<string, AdPosition[]>();
  const add = (p: AdPosition) => {
    const list = out.get(p.ownerId);
    if (list) list.push(p);
    else out.set(p.ownerId, [p]);
  };
  for (const r of results) {
    for (const p of r.parts) {
      if (!p.ownerId || !p.recovered.gt(0)) continue;
      add({
        id: `ad:${r.adId}:${p.artistId}`,
        ownerId: p.ownerId,
        artistId: p.artistId,
        month: null,
        amount: p.recovered,
        scope: scopeOf(r),
        labelId: r.ourLabelId,
        adId: r.adId,
        isrc: r.isrc,
        adMonth: r.month,
        role: 'artist',
      });
    }
  }
  return out;
}

/** A record whose payer is not the book of its ISRC's income at the month (D-169, signal `adOutsideBook`). */
export interface AdOutsideBook {
  adId: string;
  isrc: string;
  month: string;
  amount: Decimal;
  payerLabelName: string;
  bookLabelName: string;
}

/**
 * The records whose payer differs from the book of the ISRC's income at the month (both known). One pure function for
 * the full signals and the signals under a label (D-169): newest month first, then by id.
 */
export function adsOutsideBook(results: readonly AdResult[]): AdOutsideBook[] {
  return results
    .filter((r) => r.isrc !== null && r.ourLabelId !== null && r.incomeBookLabelId !== null && r.ourLabelId !== r.incomeBookLabelId)
    .map((r) => ({
      adId: r.adId,
      isrc: r.isrc as string,
      month: r.month,
      amount: r.amount,
      payerLabelName: r.ourLabelName ?? '?',
      bookLabelName: r.incomeBookLabelName ?? '?',
    }))
    .sort((a, b) => b.month.localeCompare(a.month) || a.adId.localeCompare(b.adId));
}

export interface AdSummaryRow {
  month: string;
  /** The payer by name (D-169; '?' for a record without a label). */
  label: string;
  count: number;
  amount: Decimal;
  recoveredFromArtists: Decimal;
  borneBySublabels: Decimal;
  borneByUs: Decimal;
  noSplit: Decimal;
}

/** Per month and payer: the whole expense, what artists return, what we bear; `borneBySublabels` = the part a sublabel bears by hand (D-231), information only. */
export function adSummary(results: AdResult[], from?: string, to?: string): AdSummaryRow[] {
  const rows = new Map<string, AdSummaryRow>();
  for (const r of results) {
    if ((from && r.month < from) || (to && r.month > to)) continue;
    const label = r.ourLabelName ?? '?';
    const k = `${r.month}|${label}`;
    let row = rows.get(k);
    if (!row)
      rows.set(
        k,
        (row = {
          month: r.month,
          label,
          count: 0,
          amount: ZERO,
          recoveredFromArtists: ZERO,
          borneBySublabels: ZERO,
          borneByUs: ZERO,
          noSplit: ZERO,
        }),
      );
    row.count += 1;
    row.amount = row.amount.add(r.amount);
    row.recoveredFromArtists = row.recoveredFromArtists.add(sumOf(r.parts.map((p) => p.recovered)));
    if (r.bearerSublabelId) row.borneBySublabels = row.borneBySublabels.add(r.unrecovered);
    else row.borneByUs = row.borneByUs.add(r.unrecovered);
    if (r.status === 'no_split') row.noSplit = row.noSplit.add(r.amount);
  }
  return [...rows.values()].sort((a, b) =>
    a.month !== b.month ? (a.month < b.month ? 1 : -1) : a.label.localeCompare(b.label),
  );
}
