import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../../shared/errors';
import { assertIsrc, newId } from '../../shared/identifiers';
import { assertDate, nowIso } from '../../shared/dates';
import { createSettlementsRepository } from './repository';
import type { OperationFilter, OperationRow } from './repository';
export type { OperationFilter };
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import type { Scope, ScopeKind } from './recoup-types';

export interface OperationView {
  id: string;
  direction: 'in' | 'out';
  amountCents: number;
  ownerId: string | null;
  artistId: string | null;
  date: string;
  period: string | null;
  scope: Scope | null;
  documentId: string | null;
  paymentProofId: string | null;
  operationRef: string | null;
  deferred: boolean;
  migration: boolean;
  comment: string;
  externalRef: string | null;
  createdAt: string;
  active: boolean;
  deactivatedReason: string | null;
  /** Derived meaning, for display only (there are no operation types in the model). */
  meaning: 'payout' | 'recoupable_payout' | 'deduction' | 'credit' | 'return';
  /** The own label of the operation (D-168); null = without a label. */
  labelId: string | null;
}

export interface OperationInput {
  direction: 'in' | 'out';
  amountCents: number;
  ownerId?: string | null;
  artistId?: string | null;
  date: string;
  period?: string | null;
  scope?: Scope | null;
  documentId?: string | null;
  paymentProofId?: string | null;
  operationRef?: string | null;
  deferred?: boolean;
  migration?: boolean;
  comment: string;
  externalRef?: string | null;
  labelId?: string | null;
}

const SCOPE_KINDS: ScopeKind[] = ['any', 'master', 'publishing', 'master_publishing', 'isrcs'];

export function meaningOf(
  o: Pick<OperationRow, 'direction' | 'amountCents' | 'scope' | 'operationRef'>,
): OperationView['meaning'] {
  if (o.direction === 'out') return o.scope ? 'recoupable_payout' : 'payout';
  if (o.amountCents < 0) return o.operationRef ? 'return' : 'credit';
  return 'deduction';
}

function view(o: OperationRow): OperationView {
  return {
    id: o.id,
    direction: o.direction,
    amountCents: o.amountCents,
    ownerId: o.ownerId,
    artistId: o.artistId,
    date: o.date,
    period: o.period,
    scope: o.scope ? (JSON.parse(o.scope) as Scope) : null,
    documentId: o.documentId,
    paymentProofId: o.paymentProofId,
    operationRef: o.operationRef,
    deferred: o.deferred,
    migration: o.migration,
    comment: o.comment,
    externalRef: o.externalRef,
    createdAt: o.createdAt,
    active: o.deactivatedAt === null,
    deactivatedReason: o.deactivatedReason,
    meaning: meaningOf(o),
    labelId: o.labelId,
  };
}

function validateScope(scope: Scope): Scope {
  if (!SCOPE_KINDS.includes(scope.kind)) throw new ValidationError(`Unknown scope kind ${scope.kind}`);
  if (scope.kind === 'isrcs' && !(scope.isrcs && scope.isrcs.length > 0))
    throw new ValidationError('Scope "isrcs" needs a list of ISRCs');
  const norm = (list?: string[]) => list?.map((i) => assertIsrc(i));
  const isrcs = norm(scope.isrcs);
  const excludeIsrcs = norm(scope.excludeIsrcs);
  return { kind: scope.kind, ...(isrcs ? { isrcs } : {}), ...(excludeIsrcs ? { excludeIsrcs } : {}) };
}

export function createSettlementsService(db: Db, org: OrgScope) {
  const repo = createSettlementsRepository(db, org);

  async function get(id: string): Promise<OperationRow> {
    const o = await repo.getOperation(id);
    if (!o) throw new NotFoundError('Operation', id);
    return o;
  }

  const service = {
    /**
     * Records an operation. Rules:
     * - out (money left us) goes to an owner; a payout that must be recouped (advance, bonus) has a mandatory scope,
     *   an artist and a basis document;
     * - in with a positive amount is a deduction (penalty, recalculation) tied to an artist; its scope defaults to "any";
     * - in with a negative amount adds to the balance: a return of a failed payout (operationRef) or a credit (artist).
     */
    async createOperation(input: OperationInput): Promise<OperationView> {
      return repo.transaction(async () => {
        if (!Number.isInteger(input.amountCents) || input.amountCents === 0)
          throw new ValidationError('Amount must be a non-zero number of cents');
        const date = assertDate(input.date);
        let scope = input.scope ? validateScope(input.scope) : null;
        if (input.direction === 'out') {
          if (input.amountCents < 0)
            throw new ValidationError('An out operation has a positive amount; use a return (in) instead');
          if (!input.ownerId) throw new ValidationError('A payout goes to an owner');
          if (scope) {
            if (!input.artistId) throw new ValidationError('A recoupable payout is tied to an artist');
            if (!input.documentId)
              throw new RuleViolationError(
                'A recoupable payout (advance) needs a basis document',
                'document_required',
              );
          }
        } else if (input.amountCents > 0) {
          if (!input.artistId) throw new ValidationError('A deduction is tied to an artist');
          scope = scope ?? { kind: 'any' };
        } else if (input.operationRef) {
          // A return reverses a payout that counted: plain payout, active, confirmed by a payment proof (or migrated).
          const ref = await get(input.operationRef);
          if (ref.direction !== 'out' || ref.scope)
            throw new ValidationError('A return refers to a payout (out without scope)');
          if (ref.deactivatedAt) throw new ValidationError('The payout is inactive');
          if (!ref.paymentProofId && !ref.migration)
            throw new RuleViolationError(
              'The payout never counted (no payment proof): deactivate it instead',
              'payout_not_counted',
            );
          const returned = (await repo.operationsReferring(ref.id))
            .filter((o) => o.deactivatedAt === null)
            .reduce((s, o) => s - o.amountCents, 0);
          if (returned - input.amountCents > ref.amountCents)
            throw new ValidationError('Returns cannot exceed the payout');
          // a return belongs to the label of its payout
          input = { ...input, ownerId: ref.ownerId, labelId: input.labelId ?? ref.labelId };
          scope = null;
        } else {
          if (!input.artistId) throw new ValidationError('A credit is tied to an artist');
          scope = null;
        }
        const id = newId();
        await repo.insertOperation({
          id,
          direction: input.direction,
          amountCents: input.amountCents,
          ownerId: input.ownerId ?? null,
          artistId: input.artistId ?? null,
          date,
          period: input.period ?? null,
          scope: scope ? JSON.stringify(scope) : null,
          documentId: input.documentId ?? null,
          paymentProofId: input.paymentProofId ?? null,
          operationRef: input.operationRef ?? null,
          deferred: input.deferred ?? false,
          migration: input.migration ?? false,
          comment: input.comment,
          externalRef: input.externalRef ?? null,
          createdAt: nowIso(),
          deactivatedAt: null,
          deactivatedReason: null,
          labelId: input.labelId ?? null,
        });
        return view(await get(id));
      });
    },

    getOperation: async (id: string): Promise<OperationView> => view(await get(id)),

    async listOperations(filter: OperationFilter = {}): Promise<OperationView[]> {
      return (await repo.listOperations(filter)).map(view);
    },

    allOperations: async (): Promise<OperationView[]> => (await repo.allOperations()).map(view),

    /** The payment proof makes a payout count (from the transfer); the deferred flag is cleared. */
    async attachPaymentProof(id: string, documentId: string): Promise<OperationView> {
      return repo.transaction(async () => {
        const o = await get(id);
        if (o.direction !== 'out') throw new ValidationError('Payment proofs belong to payouts');
        if (o.deactivatedAt) throw new ValidationError('The operation is inactive');
        if (o.paymentProofId)
          throw new ConflictError('The payout already has a payment proof', 'proof_exists');
        await repo.setPaymentProof(id, documentId);
        return view(await get(id));
      });
    },

    /** A deferred payment (queued at the payment service) blocks new payouts for the owner until the proof arrives. */
    async setDeferred(id: string, deferred: boolean): Promise<OperationView> {
      return repo.transaction(async () => {
        const o = await get(id);
        if (o.direction !== 'out') throw new ValidationError('Only payouts can be deferred');
        if (o.deactivatedAt || o.migration)
          throw new ValidationError('Inactive or migrated payouts cannot be deferred');
        await repo.setDeferred(id, deferred);
        return view(await get(id));
      });
    },

    /** Soft rollback: the record stays with a reason, recalculation from scratch ignores it. */
    async deactivate(
      id: string,
      reason: string,
      opts: { transferFailed?: boolean } = {},
    ): Promise<OperationView> {
      return repo.transaction(async () => {
        const o = await get(id);
        if (o.deactivatedAt) throw new ConflictError('Operation is already inactive');
        if (!reason.trim()) throw new ValidationError('A reason is required');
        // A payout already sent to the payment service must not be rolled back silently, or the button would pay
        // the same money again (D-101): with a proof the money left (use a return); without one the operator
        // confirms that the transfer failed.
        if (o.direction === 'out' && !o.scope && o.externalRef) {
          if (o.paymentProofId)
            throw new ConflictError(
              'This payout was paid (proof attached): record a return instead',
              'payout_paid',
            );
          if (!opts.transferFailed)
            throw new ConflictError(
              'This payout was sent to the payment service: confirm that the transfer failed to deactivate it',
              'payout_sent',
            );
        }
        const activeReturns = (await repo.operationsReferring(id)).filter((r) => r.deactivatedAt === null);
        if (activeReturns.length > 0)
          throw new ConflictError('Deactivate the returns of this payout first', 'has_returns');
        await repo.setDeactivated(id, nowIso(), reason);
        return view(await get(id));
      });
    },

    /** Payouts of an owner that are not confirmed by a payment proof yet (or deferred): they block new payouts. */
    async blockingPayouts(ownerId: string): Promise<OperationView[]> {
      return (await repo.operationsOfOwner(ownerId))
        .filter(
          (o) =>
            o.direction === 'out' &&
            o.deactivatedAt === null &&
            !o.migration &&
            (o.paymentProofId === null || o.deferred),
        )
        .map(view);
    },

    async setExternalRef(id: string, externalRef: string): Promise<void> {
      await repo.setExternalRef(id, externalRef);
    },

    /** The label of an operation (D-168): set by the operator on the history, or by the marking script. */
    async setLabel(id: string, labelId: string | null): Promise<OperationView> {
      return repo.transaction(async () => {
        const o = await get(id);
        if (o.deactivatedAt) throw new ValidationError('The operation is inactive');
        await repo.setLabel(id, labelId);
        return view(await get(id));
      });
    },

    /** Stores a payout to an owner together with its snapshot (per-artist breakdown, file hashes). */
    async recordPayout(input: {
      ownerId: string;
      amountCents: number;
      date: string;
      comment: string;
      externalRef?: string | null;
      labelId?: string | null;
      snapshot: unknown;
    }): Promise<OperationView> {
      return repo.transaction(async () => {
        if ((await service.blockingPayouts(input.ownerId)).length > 0) {
          throw new RuleViolationError(
            'A previous payout of this owner has no payment proof yet',
            'payout_blocked',
          );
        }
        const op = await service.createOperation({
          direction: 'out',
          amountCents: input.amountCents,
          ownerId: input.ownerId,
          date: input.date,
          comment: input.comment,
          externalRef: input.externalRef ?? null,
          deferred: true,
          labelId: input.labelId ?? null,
        });
        await repo.insertSnapshot({
          operationId: op.id,
          createdAt: nowIso(),
          payload: JSON.stringify(input.snapshot),
        });
        return op;
      });
    },

    async getSnapshot(operationId: string): Promise<unknown> {
      const s = await repo.getSnapshot(operationId);
      if (!s) throw new NotFoundError('Payout snapshot', operationId);
      return JSON.parse(s.payload);
    },

    async reassignOwner(fromOwnerId: string, intoOwnerId: string): Promise<void> {
      await repo.reassignOwner(fromOwnerId, intoOwnerId);
    },
  };
  return service;
}

export type SettlementsService = ReturnType<typeof createSettlementsService>;
