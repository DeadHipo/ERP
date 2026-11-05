import { centsToDecimal, Decimal, ZERO } from '../shared/money';
import { monthStart } from '../shared/dates';
import type { AdExpense, AdScope } from '../modules/ads';
import type { Position, Scope } from '../modules/settlements';
import { distribute, pct, sumOf } from './layers/exact';
import type { LayerContext } from './layers';

// Advertising expenses (D-155, D-156) as a pure function over one snapshot: who bears an expense and which debt
// positions it creates. Nothing is stored; calculate() runs it for every active expense.

/**
 * MC pseudonyms never bear advertising (D-155): the same rule as the ads pipeline of report-processor, by the
 * pseudonym ("MC …", "MC_…", "MC-…"). A flag on the pseudonym card is out of this version (docs/реклама_тз.md §7).
 */
export const isMcPseudonym = (pseudonym: string): boolean => /^mc[\s_-]/i.test(pseudonym.trim());

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
  ourLabelId: string | null;
  ourLabelName: string | null;
  sublabelName: string | null;
  parts: AdPart[];
  /** amount − Σ recovered: borne by the sublabel (its rule's recipient pseudonym) or by us. */
  unrecovered: Decimal;
  borneBy:
    | { kind: 'sublabel'; artistId: string; ownerId: string | null; amount: Decimal }
    | { kind: 'ours'; amount: Decimal };
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
}

/** One expense: the split of its month, the parts of the artists, the recovered and unrecovered parts. */
export function allocateAd(ad: AdExpense, ctx: AdContext): AdResult {
  const amount = centsToDecimal(ad.amountCents);
  const percent = new Decimal(ad.recoveryPercent);
  const date = monthStart(ad.month);
  const labelString = ad.isrc ? ctx.labelStringOf(ad.isrc, ad.month) : undefined;
  const l = labelString !== undefined ? ctx.labelOf(labelString, date) : undefined;
  // the label of the ISRC's line at the month; the record's own label when no line of the ISRC is mapped (D-168)
  const ourLabelId = l ? (l.kind === 'own' ? l.id : l.ownLabelId) : ad.labelId;
  const rule = l && l.kind === 'sublabel' && l.rule && !l.rule.percent.isZero() ? l.rule : null;
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
        .map((sh) => ({ a: canon(sh.artistId), id: sh.artistId, weight: sh.percent }))
        .filter((x) => !(x.a && (isMcPseudonym(x.a.pseudonym) || (x.a.ownerId && ctx.labelOwners.has(x.a.ownerId)))))
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
  const borneBy: AdResult['borneBy'] =
    status !== 'no_split' && rule && unrecovered.gt(0)
      ? {
          kind: 'sublabel',
          artistId: canon(rule.recipientArtistId)?.id ?? rule.recipientArtistId,
          ownerId: canon(rule.recipientArtistId)?.ownerId ?? null,
          amount: unrecovered,
        }
      : { kind: 'ours', amount: unrecovered };
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
    sublabelName: l && l.kind === 'sublabel' ? l.name : null,
    parts,
    unrecovered,
    borneBy,
  };
}

/** The recoup scope of an expense position (an artist's part or the sublabel's): like an advance (D-155). */
export function scopeOf(r: Pick<AdResult, 'scope' | 'isrc'>, bearer: 'artist' | 'sublabel'): Scope {
  if (bearer === 'sublabel') return { kind: 'any' };
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
  role: 'artist' | 'sublabel';
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
        scope: scopeOf(r, 'artist'),
        labelId: r.ourLabelId,
        adId: r.adId,
        isrc: r.isrc,
        adMonth: r.month,
        role: 'artist',
      });
    }
    const b = r.borneBy;
    if (b.kind === 'sublabel' && b.ownerId && b.amount.gt(0))
      add({
        id: `ad:${r.adId}:${b.artistId}:sublabel`,
        ownerId: b.ownerId,
        artistId: b.artistId,
        month: null,
        amount: b.amount,
        scope: scopeOf(r, 'sublabel'),
        labelId: r.ourLabelId,
        adId: r.adId,
        isrc: r.isrc,
        adMonth: r.month,
        role: 'sublabel',
      });
  }
  return out;
}

export interface AdSummaryRow {
  month: string;
  /** Our label of record by name ('?' when the ISRC has no mapped label line). */
  label: string;
  count: number;
  amount: Decimal;
  recoveredFromArtists: Decimal;
  borneBySublabels: Decimal;
  borneByUs: Decimal;
  noSplit: Decimal;
}

/** Per month and label of record: the whole expense, what artists return, what sublabels and we bear. */
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
    if (r.borneBy.kind === 'sublabel') row.borneBySublabels = row.borneBySublabels.add(r.borneBy.amount);
    else row.borneByUs = row.borneByUs.add(r.borneBy.amount);
    if (r.status === 'no_split') row.noSplit = row.noSplit.add(r.amount);
  }
  return [...rows.values()].sort((a, b) =>
    a.month !== b.month ? (a.month < b.month ? 1 : -1) : a.label.localeCompare(b.label),
  );
}
