import type { PayoutGate } from '@erp/shared/api-responses';

export type { PayoutGate };

/**
 * The admission of an owner (D-176, the owner's module 17): what the gate reads besides the balance. `active` = the
 * organization uses the admission (at least one payee row exists; without it a world pays as before D-176);
 * `thresholdCents` = the threshold of the owner's contract under the label (null = the organization's default).
 */
export interface Admission {
  active: boolean;
  thresholdCents: number | null;
  /** An active payee of the owner exists. */
  hasPayee: boolean;
  /** An active hold that blocks, in the book or in every book. */
  held: boolean;
  /** The owner had a payout (any status) in the book: the first payout needs an answer. */
  hadPayout: boolean;
  /** The amounts (cents) of the active answers «pay» of the owner in the book. */
  answeredCents: number[];
}

/**
 * The one decision "may this owner be paid now" (17 N19). `createPayout` throws the code of `reason`, the balance
 * and the payables list show the same object, so the button and the screen cannot disagree. The order (D-176, the
 * owner's module 17): the owner's contract (owner confirmed; under a label one with that label or none, D-169), nothing to pay and the threshold («вне ведомости»), a hold, a payout without a
 * proof, no payee, the first payout without an answer («нужен ответ»: an active answer for exactly this amount lets it
 * through), ready. `amountCents` is the payable amount floored to whole cents, never negative: what the button would pay.
 */
export function payoutGate(input: {
  confirmed: boolean;
  /** An approved contract of any label; defaults to `confirmed`. */
  confirmedAny?: boolean;
  blocking: string[];
  payableCents: number;
  thresholdCents: number;
  admission?: Admission;
}): PayoutGate {
  const amountCents = Math.max(input.payableCents, 0);
  const deny = (reason: NonNullable<PayoutGate['reason']>): PayoutGate => ({
    allowed: false,
    reason,
    amountCents,
  });
  const a = input.admission;
  const threshold = a?.thresholdCents ?? input.thresholdCents;
  if (!(input.confirmedAny ?? input.confirmed)) return deny('owner_not_confirmed');
  if (!input.confirmed) return deny('no_contract_for_label');
  if (input.payableCents <= 0) return deny('nothing_to_pay');
  if (input.payableCents < threshold) return deny('below_threshold');
  if (a?.held) return deny('hold');
  if (input.blocking.length > 0) return deny('payout_blocked');
  if (a?.active && !a.hasPayee) return deny('no_payee');
  if (a?.active && !a.hadPayout && !a.answeredCents.includes(amountCents)) return deny('needs_answer');
  return { allowed: true, reason: null, amountCents };
}
