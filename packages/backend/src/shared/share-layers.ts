import { dollarGap, type DollarGap } from './coverage-check';
import { Decimal } from './money';

/**
 * Label share of one recording, as layers on top of the remainder.
 * A listed party is deducted. A buyout removes the named party from that deduction.
 * A percent settled outside the split is a further deduction, unless it only repeats the parties.
 * When nobody is itemized, the term carries its own label percent; with no percent, nothing is allocated.
 * No name, ISRC or imprint is special-cased here.
 */

export type ShareRule = 'remainder' | 'buyout' | 'outside_repeat' | 'outside_extra' | 'explicit' | 'unallocated';

export interface PartyPercent {
  /** Letters and digits only, for comparison. */
  key: string;
  percent: Decimal;
}

export interface DerivedShare {
  /** Points: 50 means the label keeps half of the net. */
  percent: Decimal;
  rule: ShareRule;
}

const PARTY_RE = /([^;%]+?)\s+(\d+(?:[.,]\d+)?)\s*%/g;
const PERCENT_RE = /(\d+(?:[.,]\d+)?)\s*%/g;
const BUYOUT_RE = /выкуп:\s*([^;]+)/i;

export function partyKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/[^a-z0-9а-я]+/giu, '');
}

export function parseParties(text: string): PartyPercent[] {
  const found: PartyPercent[] = [];
  for (const match of text.matchAll(PARTY_RE)) {
    const raw = match[2];
    if (!raw) continue;
    found.push({ key: partyKey(match[1] ?? ''), percent: new Decimal(raw.replace(',', '.')) });
  }
  return found;
}

export function parsePercents(text: string): Decimal[] {
  const found: Decimal[] = [];
  for (const match of text.matchAll(PERCENT_RE)) {
    const raw = match[1];
    if (raw) found.push(new Decimal(raw.replace(',', '.')));
  }
  return found;
}

/** The party named after a buyout mark. Empty when the text does not record one. */
export function parseBuyoutParty(source: string): string {
  const match = BUYOUT_RE.exec(source);
  return match?.[1] ? partyKey(match[1]) : '';
}

function sameParty(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 3 || right.length < 3) return false;
  return left.includes(right) || right.includes(left);
}

function sum(percents: readonly Decimal[]): Decimal {
  return percents.reduce((left, percent) => left.add(percent), new Decimal(0));
}

/**
 * Label percent for one term.
 * `explicitLabelPercent` is read only when no party is itemized.
 */
export function deriveLabelPercent(input: {
  parties: readonly PartyPercent[];
  outsidePercents?: readonly Decimal[];
  buyoutParty?: string | null;
  explicitLabelPercent?: Decimal | null;
}): DerivedShare {
  const parties = input.parties;
  const outside = input.outsidePercents ?? [];
  const itemized = parties.some((party) => party.key.length > 0);
  if (!itemized) {
    if (input.explicitLabelPercent != null) return { percent: input.explicitLabelPercent, rule: 'explicit' };
    return { percent: new Decimal(0), rule: 'unallocated' };
  }
  const buyout = input.buyoutParty ?? '';
  const extinguished = parties.map((party) => sameParty(party.key, buyout));
  const active = parties.filter((_, index) => !extinguished[index]).map((party) => party.percent);
  const activeSum = sum(active);
  if (extinguished.some(Boolean)) return { percent: new Decimal(100).sub(activeSum), rule: 'buyout' };
  const outsideSum = sum(outside);
  const listedSum = sum(parties.map((party) => party.percent));
  if (outside.length > 0 && outsideSum.sub(listedSum).abs().lte('0.6')) {
    return { percent: new Decimal(100).sub(activeSum), rule: 'outside_repeat' };
  }
  if (outside.length > 0) {
    return { percent: new Decimal(100).sub(activeSum).sub(outsideSum), rule: 'outside_extra' };
  }
  return { percent: new Decimal(100).sub(activeSum), rule: 'remainder' };
}

export interface ShareTerm {
  from: string;
  to: string;
  /** Points. */
  percent: Decimal;
}

/** Receipts in a month that no term covers contribute nothing. Overlapping terms that disagree return null. */
export function labelAmount(
  months: readonly { month: string; receipts: Decimal }[],
  terms: readonly ShareTerm[],
): Decimal | null {
  let total = new Decimal(0);
  for (const month of months) {
    const hits = terms.filter((term) => term.from <= month.month && month.month <= term.to);
    const percent = hits[0]?.percent;
    if (!percent) continue;
    if (hits.some((term) => term.percent.sub(percent).abs().gt('0.05'))) return null;
    total = total.add(month.receipts.mul(percent).div(100));
  }
  return total;
}

export function shareGap(computed: Decimal | null, reference: Decimal): DollarGap {
  if (!computed) return 'case';
  return dollarGap(computed, reference);
}
