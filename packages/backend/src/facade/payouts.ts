import { RuleViolationError, ValidationError } from '../shared/errors';
import { centsToDecimal, Decimal, ZERO } from '../shared/money';
import { todayIso } from '../shared/dates';
import { type Scope } from '../modules/settlements';
import type { FacadeContext } from './context';

export function payoutsApi(ctx: FacadeContext) {
  const { db, config, owners, settlements, publishing, payments, blockingPayoutsOf, balanceWithFiles } = ctx;
  const api = {
    /**
     * Adjustments (deduction, credit) and recoupable payouts (advance with scope). Settlements are tied to the artist;
     * the owner comes from module 1. A plain payout of earned money is made only by the payout button (createPayout),
     * except migrated payouts confirmed during data transfer.
     */
    createOperation(input: {
      direction: 'in' | 'out';
      amount: string;
      artistId?: string | null;
      ownerId?: string | null;
      date: string;
      period?: string | null;
      scope?: Scope | null;
      documentId?: string | null;
      paymentProofId?: string | null;
      operationRef?: string | null;
      comment: string;
      migration?: boolean;
    }) {
      return db.transaction(async () => {
        const cents = new Decimal(input.amount).mul(100);
        if (!cents.isInteger()) throw new ValidationError('Settlement amounts are whole cents');
        if (input.direction === 'out' && !input.scope && !input.migration) {
          throw new RuleViolationError(
            'A payout of earned money is made with the payout button; an advance needs a scope',
            'use_payout_button',
          );
        }
        if (input.operationRef) throw new ValidationError('Use the return action for returns');
        let ownerId = input.ownerId ? await owners.resolveOwnerId(input.ownerId) : null;
        if (input.artistId) {
          const a = await owners.getArtist(input.artistId);
          if (!a.ownerId) throw new RuleViolationError('The artist has no owner yet', 'artist_without_owner');
          const artistOwner = await owners.resolveOwnerId(a.ownerId);
          if (ownerId && ownerId !== artistOwner)
            throw new ValidationError('The artist belongs to another owner');
          ownerId = artistOwner;
        }
        if (ownerId) await owners.getOwner(ownerId);
        // An advance (recoupable payout) is a payout: same gate as the payout button (README 5, 07 rule 2).
        if (input.direction === 'out' && !input.migration && ownerId) {
          if (!(await owners.isOwnerConfirmed(ownerId))) {
            throw new RuleViolationError(
              'The owner has no approved contract: payout is not possible',
              'owner_not_confirmed',
            );
          }
          const blocking = await blockingPayoutsOf(ownerId);
          if (blocking.length > 0) {
            throw new RuleViolationError(
              'A previous payout has no approved payment proof yet: new payouts are blocked',
              'payout_blocked',
              {
                operationIds: blocking.map((b) => b.id),
              },
            );
          }
        }
        // The basis document must fit the operation: an advance by an advance agreement (or the contract),
        // an adjustment by an adjustment basis (or the contract / other).
        if (input.documentId) {
          const kind = (await owners.getDocument(input.documentId)).kind;
          const allowed =
            input.direction === 'out'
              ? ['advance_basis', 'contract']
              : ['adjustment_basis', 'contract', 'other'];
          if (!allowed.includes(kind))
            throw new ValidationError(
              `A ${input.direction === 'out' ? 'recoupable payout' : 'adjustment'} cannot be based on a document of kind "${kind}"`,
            );
        }
        for (const d of [input.documentId, input.paymentProofId]) {
          if (!d) continue;
          const doc = await owners.getDocument(d);
          if (doc.ownerId && ownerId && doc.ownerId !== ownerId)
            throw new RuleViolationError('The document belongs to another owner', 'document_owner_mismatch');
        }
        if (input.paymentProofId && input.direction === 'in') {
          throw new ValidationError('Payment proofs belong to payouts; an adjustment needs a basis document');
        }
        if (
          input.paymentProofId &&
          (await owners.getDocument(input.paymentProofId)).kind !== 'payment_proof'
        ) {
          throw new ValidationError('A payment proof must be a document of kind "payment_proof"');
        }
        return settlements.createOperation({ ...input, amountCents: cents.toNumber(), ownerId });
      });
    },

    /**
     * The "Payout" button: recalculates the owner, checks documents, blocking payouts and the threshold, records the
     * payout with its snapshot (deferred until the payment proof), then sends it to the (stub) payment service.
     * One amount per owner. The checks, the calculation and the recorded payout are one write transaction (D-121);
     * the payment service is called after it commits.
     */
    async createPayout(ownerId: string, input: { comment?: string } = {}) {
      const { op, id, cents } = await db.transaction(async () => {
        const id = await owners.resolveOwnerId(ownerId);
        const { balance, files: believeFiles } = await balanceWithFiles(id);
        // One decision for the button and the screen (N19): the order owner_not_confirmed, payout_blocked,
        // nothing_to_pay, below_threshold is the order of payoutGate().
        const gate = balance.payout;
        const cents = gate.amountCents;
        if (!gate.allowed) {
          const threshold = centsToDecimal(config.payoutThresholdCents).toFixed(2);
          switch (gate.reason) {
            case 'owner_not_confirmed':
              throw new RuleViolationError(
                'The owner has no approved contract: payout is not possible',
                'owner_not_confirmed',
              );
            case 'payout_blocked':
              throw new RuleViolationError(
                'A previous payout has no payment proof yet: new payouts are blocked',
                'payout_blocked',
                { operationIds: balance.blockingPayouts },
              );
            case 'below_threshold':
              throw new RuleViolationError(
                `Payable ${centsToDecimal(cents).toFixed(2)} is below the payout threshold ${threshold}`,
                'below_threshold',
              );
            default:
              throw new RuleViolationError('Nothing to pay', 'nothing_to_pay');
          }
        }
        // "Which artist this payout is for": the payout split pro rata over the positive per-artist net
        // (earned minus recouped) and the owner's publishing net; the exact all-time figures are kept as well.
        const amount = centsToDecimal(cents);
        const parts = [
          ...balance.artists.map((a) => ({
            key: a.artistId,
            label: a.pseudonym,
            net: Decimal.max(a.earned.sub(a.recoupedFromMaster), 0),
          })),
          {
            key: 'publishing',
            label: 'Publishing (owner)',
            net: Decimal.max(balance.period.earnedPublishing.sub(balance.publishingRecouped), 0),
          },
        ];
        const totalNet = parts.reduce((s, p) => s.add(p.net), ZERO);
        const snapshot = {
          computedAt: new Date().toISOString(),
          ownerId: id,
          amountCents: cents,
          payableExact: balance.total.payable.toFixed(),
          total: balance.total,
          payoutByArtist: parts
            .filter((p) => !p.net.isZero())
            .map((p) => ({
              key: p.key,
              label: p.label,
              net: p.net,
              shareOfPayout: totalNet.isZero() ? ZERO : amount.mul(p.net).div(totalNet).toDecimalPlaces(2),
            })),
          perArtist: balance.artists.map((a) => ({
            artistId: a.artistId,
            pseudonym: a.pseudonym,
            earned: a.earned,
            recouped: a.recouped,
            unrecouped: a.unrecouped,
            waiting: a.waiting,
            tracks: a.tracks.slice(0, 200),
          })),
          publishing: balance.publishing,
          positions: balance.positions,
          ads: balance.ads,
          files: { believe: believeFiles, b17: await publishing.activeStatements() },
        };
        const op = await settlements.recordPayout({
          ownerId: id,
          amountCents: cents,
          date: todayIso(),
          comment: input.comment ?? 'Payout on demand',
          snapshot,
        });
        return { op, id, cents };
      });
      // Sent only after it is recorded: if sending fails, the payout stays deferred and blocks a second payout.
      const sent = payments.send({ ownerId: id, amountCents: cents });
      await settlements.setExternalRef(op.id, sent.externalRef);
      return settlements.getOperation(op.id);
    },

    /** Attaches the payment proof (from the payment service) as a document; the payout then counts. */
    attachPaymentProof(operationId: string, input: { fileRef: string; title?: string }) {
      return db.transaction(async () => {
        const op = await settlements.getOperation(operationId);
        if (op.direction !== 'out' || !op.active || op.paymentProofId)
          throw new ValidationError('This operation cannot take a payment proof');
        const doc = await owners.createDocument({
          kind: 'payment_proof',
          title: input.title ?? `Payment proof ${op.externalRef ?? op.id.slice(0, 8)}`,
          fileRef: input.fileRef,
          ownerId: op.ownerId,
          requiresApproval: false,
        });
        return settlements.attachPaymentProof(operationId, doc.id);
      });
    },

    /** A payout that did not arrive: a separate return operation with a confirming document. */
    returnPayout(operationId: string, input: { fileRef: string; date: string; comment: string }) {
      return db.transaction(async () => {
        const op = await settlements.getOperation(operationId);
        if (op.meaning !== 'payout' || !op.active || (!op.paymentProofId && !op.migration)) {
          throw new RuleViolationError(
            'Only a counted payout (with payment proof) can be returned',
            'payout_not_counted',
          );
        }
        if (input.date < op.date) throw new ValidationError('A return cannot be dated before its payout');
        const doc = await owners.createDocument({
          kind: 'return_proof',
          title: `Return of ${op.externalRef ?? op.id.slice(0, 8)}`,
          fileRef: input.fileRef,
          ownerId: op.ownerId,
          requiresApproval: false,
        });
        return settlements.createOperation({
          direction: 'in',
          amountCents: -op.amountCents,
          ownerId: op.ownerId,
          date: input.date,
          operationRef: op.id,
          documentId: doc.id,
          comment: input.comment,
        });
      });
    },
  };
  return api;
}
