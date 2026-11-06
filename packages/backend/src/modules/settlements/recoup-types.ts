import type { Decimal } from '../../shared/money';

// The data shapes of recoupment stay in the module (operations carry a scope); the algorithm lives in the facade
// (src/facade/layers/recoup.ts, D-127).

/**
 * Scope of recoupment: which income a recoupable position (advance, bonus, penalty) is recouped from.
 * - any: any further income (default for penalties)
 * - master / publishing / master_publishing
 * - isrcs: master income of the listed ISRCs only
 * excludeIsrcs removes ISRCs from any scope (e.g. one release excluded from an advance).
 */
export type ScopeKind = 'any' | 'master' | 'publishing' | 'master_publishing' | 'isrcs';
export interface Scope {
  kind: ScopeKind;
  isrcs?: string[];
  excludeIsrcs?: string[];
}

export interface IncomeItem {
  id: string;
  stream: 'master' | 'publishing';
  ownerId: string;
  /** Master income belongs to an artist; publishing income belongs to the owner (artistId null). */
  artistId: string | null;
  isrc: string | null;
  reportMonth: string;
  amount: Decimal;
  /** The label of record of the income (D-168): the unit's own label; publishing has none. */
  labelId: string | null;
}

export interface Position {
  id: string;
  ownerId: string;
  artistId: string;
  /**
   * Month of the operation date; only income with report month >= this month recoups it (advances: "after the date").
   * null: no date restriction (deductions reduce what is payable from any income in scope).
   */
  month: string | null;
  amount: Decimal;
  scope: Scope;
  /** The label of the position (D-168): recouped from the master income of that label only; null = any label. */
  labelId: string | null;
  /**
   * The counted forgivenesses of the position (D-173, `operation_ref` = the advance): the month of each date and its
   * amount, in the order (date, id). A forgiveness frees the income of the months from its date on; absent = none.
   */
  forgiven?: { month: string; amount: Decimal }[];
}

export interface RecoupResult {
  positionId: string;
  amount: Decimal;
  recouped: Decimal;
  /** The effective forgiveness (D-173): ≤ the recorded one; amount = recouped + forgiven + remaining. */
  forgiven: Decimal;
  remaining: Decimal;
  consumed: { itemId: string; amount: Decimal }[];
}
