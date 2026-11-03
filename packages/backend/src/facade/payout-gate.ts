import type { PayoutGate } from '@erp/shared/api-responses';

export type { PayoutGate };

/**
 * The one decision "may this owner be paid now" (17 N19). `createPayout` throws the code of `reason`, the balance
 * and the payables list show the same object, so the button and the screen cannot disagree. The order of the checks
 * is the order of the button: owner confirmed, no blocking payout, something to pay, the threshold.
 *
 * `amountCents` is the payable amount floored to whole cents, never negative: what the button would pay.
 */
export function payoutGate(input: {
  confirmed: boolean;
  blocking: string[];
  payableCents: number;
  thresholdCents: number;
}): PayoutGate {
  const amountCents = Math.max(input.payableCents, 0);
  const deny = (reason: NonNullable<PayoutGate['reason']>): PayoutGate => ({
    allowed: false,
    reason,
    amountCents,
  });
  if (!input.confirmed) return deny('owner_not_confirmed');
  if (input.blocking.length > 0) return deny('payout_blocked');
  if (input.payableCents <= 0) return deny('nothing_to_pay');
  if (input.payableCents < input.thresholdCents) return deny('below_threshold');
  return { allowed: true, reason: null, amountCents };
}
