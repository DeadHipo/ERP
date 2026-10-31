import { newId } from '../shared/identifiers';

/**
 * Payment service integration is out of scope for iteration 1: this stub "queues" a transfer and returns a reference.
 * The payout stays deferred until the payment proof document is attached.
 */
export interface PaymentService {
  send(input: { ownerId: string; amountCents: number }): { externalRef: string; status: 'queued' };
}

export const stubPaymentService: PaymentService = {
  send: () => ({ externalRef: `stub-${newId().slice(0, 8)}`, status: 'queued' }),
};
