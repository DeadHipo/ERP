import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../../shared/errors';
import { assertIsrc, newId } from '../../shared/identifiers';
import { assertDate, nowIso } from '../../shared/dates';
import { createSettlementsRepository } from './repository';
import type { CutRow, HoldRow, OperationFilter, OperationRow, PayeeRow, PayoutAnswerRow } from './repository';
export type { OperationFilter };
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import type { Scope, ScopeKind } from './recoup-types';
import {
  BLOCKING_KINDS,
  DERIVED_KINDS,
  KIND_DIRECTION,
  KIND_SIGN,
  kindOf,
  type DerivedKind,
  type LabelSource,
  type OperationKind,
} from '@erp/shared/operation-kinds';
export { kindOf, type OperationKind, type LabelSource };

export interface OperationView {
  id: string;
  /** The stored kind (D-173). */
  kind: OperationKind;
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
  /**
   * The name of the kind before D-173, kept as an alias for this stage (`advance` is `recoupable_payout`); the balance
   * reads it until it branches by `kind` (D-173 commit 2).
   */
  meaning: Meaning;
  /** The own label of the operation (D-168); null = without a label. */
  labelId: string | null;
  /** Who set the label (D-173); null until `assign-operation-labels.ts --mark-source`. */
  labelSource: LabelSource | null;
  channel: string | null;
  /** The area of the book (D-173): the history is `master`. */
  area: 'master' | 'publishing';
  /** A payout of the button (D-181): what it took from which position, cents by pseudonym id ('' = the owner's own); null for the history and every other kind. */
  allocation: Record<string, number> | null;
  /** The cut the operation is attributed to (D-198); null = by its date. */
  cutId: string | null;
}

/** A cut (D-198): the bounds are first days, «before this day is inside». */
export interface CutView {
  id: string;
  labelId: string;
  name: string;
  cutDate: string;
  masterTo: string;
  publishingTo: string;
  adsTo: string;
  comment: string;
  createdAt: string;
  createdBy: string;
}

export interface CutInput {
  labelId: string;
  name: string;
  cutDate: string;
  masterTo?: string;
  publishingTo?: string;
  adsTo?: string;
  comment?: string;
  createdBy: string;
}

export type Meaning = 'payout' | 'recoupable_payout' | 'deduction' | 'credit' | 'return';

// ---- the admission (D-176) ----

export type PayeeChannel = 'tipalti' | 'easystaff' | 'other';
export type HoldKind = 'decision' | 'artist_request' | 'question' | 'dispute';
export type AnswerDecision = 'pay' | 'pay_task';

/** The payee of an owner: the channel and the reference in the cash register; one active per owner. */
export interface PayeeView {
  id: string;
  ownerId: string;
  channel: PayeeChannel;
  payeeRef: string | null;
  status: 'confirmed' | 'proposed';
  basis: string;
  validFrom: string;
  source: string | null;
  createdAt: string;
  active: boolean;
  deactivatedReason: string | null;
}

/** A hold on the payouts of an owner: blocks the payout or informs only (a disputed item without impact). */
export interface HoldView {
  id: string;
  ownerId: string;
  labelId: string | null;
  kind: HoldKind;
  blocks: boolean;
  reason: string;
  releaseWhen: string | null;
  amountCents: number | null;
  period: string | null;
  reviewOn: string | null;
  since: string;
  source: string | null;
  status: 'active' | 'released';
  releasedAt: string | null;
  releasedReason: string | null;
  createdAt: string;
}

/** An answer «pay» to the check of a payout: valid for the same amount only. */
export interface PayoutAnswerView {
  id: string;
  ownerId: string;
  labelId: string | null;
  dueCents: number;
  decision: AnswerDecision;
  why: string;
  about: string;
  answeredBy: string;
  source: string | null;
  createdAt: string;
  active: boolean;
  deactivatedReason: string | null;
}

export interface OperationInput {
  /** Without it the kind is derived from the fields (`kindOf`), as before D-173. */
  kind?: OperationKind;
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
  labelSource?: LabelSource | null;
  channel?: string | null;
  /** A payout of the button (D-181): what it takes from which position (cents by pseudonym id, '' = the owner's own); Σ = amountCents. */
  allocation?: Record<string, number>;
  area?: 'master' | 'publishing';
  /** The cut the operation is attributed to (D-198); the facade checks it is a cut of the operation's label. */
  cutId?: string | null;
}

const SCOPE_KINDS: ScopeKind[] = ['any', 'master', 'publishing', 'master_publishing', 'isrcs'];

/** The meaning before D-173, derived from the fields; `kindOf` of `@erp/shared/operation-kinds` is the same rule. */
export function meaningOf(
  o: Pick<OperationRow, 'direction' | 'amountCents' | 'scope' | 'operationRef'>,
): Meaning {
  const k = kindOf(o);
  return k === 'advance' ? 'recoupable_payout' : k;
}

/** The alias `meaning` of a stored kind: the five kinds of the history by name, the others by their fields. */
function meaningOfKind(o: Pick<OperationRow, 'kind' | 'direction' | 'amountCents' | 'scope' | 'operationRef'>): Meaning {
  if (o.kind === 'advance') return 'recoupable_payout';
  if ((DERIVED_KINDS as readonly string[]).includes(o.kind)) return o.kind as Exclude<DerivedKind, 'advance'>;
  return meaningOf(o);
}

/** The stored kind of a `meaning` filter value (the alias, D-173). */
export const kindOfMeaning = (m: Meaning): DerivedKind => (m === 'recoupable_payout' ? 'advance' : m);

function view(o: OperationRow): OperationView {
  return {
    id: o.id,
    kind: o.kind,
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
    meaning: meaningOfKind(o),
    labelId: o.labelId,
    labelSource: o.labelSource,
    channel: o.channel,
    area: o.area,
    allocation: o.allocation ? (JSON.parse(o.allocation) as Record<string, number>) : null,
    cutId: o.cutId,
  };
}

const cutView = (r: CutRow): CutView => ({ ...r });

/** The first day of the month of a date (YYYY-MM-DD). */
const firstOf = (d: string): string => `${d.slice(0, 7)}-01`;

/** Cumulative cuts (D-198): a later cut of a label never has an earlier bound than an earlier one. */
function assertCutOrder(list: CutView[]): void {
  const sorted = [...list].sort((a, b) => a.cutDate.localeCompare(b.cutDate) || a.id.localeCompare(b.id));
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as CutView;
    const b = sorted[i] as CutView;
    if (a.cutDate === b.cutDate) throw new ConflictError(`Two cuts of the label on ${a.cutDate}`, 'cut_order', { cutIds: [a.id, b.id] });
    for (const k of ['masterTo', 'publishingTo', 'adsTo'] as const)
      if (b[k] < a[k]) throw new ConflictError(`The cut «${b.name}» has an earlier ${k} than the earlier cut «${a.name}»`, 'cut_order', { cutIds: [a.id, b.id], bound: k });
  }
}

const payeeView = (r: PayeeRow): PayeeView => ({
  id: r.id,
  ownerId: r.ownerId,
  channel: r.channel,
  payeeRef: r.payeeRef,
  status: r.status,
  basis: r.basis,
  validFrom: r.validFrom,
  source: r.source,
  createdAt: r.createdAt,
  active: r.deactivatedAt === null,
  deactivatedReason: r.deactivatedReason,
});
const holdView = (r: HoldRow): HoldView => ({
  id: r.id,
  ownerId: r.ownerId,
  labelId: r.labelId,
  kind: r.kind,
  blocks: r.blocks,
  reason: r.reason,
  releaseWhen: r.releaseWhen,
  amountCents: r.amountCents,
  period: r.period,
  reviewOn: r.reviewOn,
  since: r.since,
  source: r.source,
  status: r.status,
  releasedAt: r.releasedAt,
  releasedReason: r.releasedReason,
  createdAt: r.createdAt,
});
const answerView = (r: PayoutAnswerRow): PayoutAnswerView => ({
  id: r.id,
  ownerId: r.ownerId,
  labelId: r.labelId,
  dueCents: r.dueCents,
  decision: r.decision,
  why: r.why,
  about: r.about,
  answeredBy: r.answeredBy,
  source: r.source,
  createdAt: r.createdAt,
  active: r.deactivatedAt === null,
  deactivatedReason: r.deactivatedReason,
});

/** The kinds that are paid out and take a payment proof (and may be deferred): the `out` kinds. */
const PAID_KINDS: readonly OperationKind[] = ['payout', 'advance', 'buyout'];

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
     * Records an operation of a kind (D-173); without `kind` the kind is derived from the fields as before (`kindOf`).
     * The shape of each kind (the CHECK `operations_kind_rules` of 0019 says the same):
     * - payout (out > 0): to an owner, no scope, no ref; advance (out > 0): an owner, an artist, a recoup scope and a
     *   basis document; buyout (out > 0): an owner and a document, outside the balance;
     * - deduction (in > 0): an artist, its scope defaults to "any"; credit (in < 0): an artist, no scope (a scope given
     *   without an explicit kind is dropped, as before); return (in < 0): refers to a counted payout, takes its owner
     *   and label;
     * - forgiveness (in > 0): refers to an active advance (its owner, artist and label) with a document; writeoff
     *   (in > 0): an owner and a document, the area is publishing; adjustment (in, any sign): an owner and a document.
     * The facade checks the rest (codes in the order of D-173 §1.1); these are the module's own guards.
     */
    async createOperation(input: OperationInput): Promise<OperationView> {
      return repo.transaction(async () => {
        if (!Number.isInteger(input.amountCents) || input.amountCents === 0)
          throw new ValidationError('Amount must be a non-zero number of cents');
        const date = assertDate(input.date);
        const explicit = input.kind !== undefined;
        const kind: OperationKind = input.kind ?? kindOf({ ...input, scope: input.scope ?? null });
        if (KIND_DIRECTION[kind] !== input.direction)
          throw new ValidationError(`A ${kind} is an "${KIND_DIRECTION[kind]}" operation`, { kind, expected: KIND_DIRECTION[kind] }, 'kind_direction');
        const sign = KIND_SIGN[kind];
        if ((sign === '+' && input.amountCents < 0) || (sign === '-' && input.amountCents > 0))
          throw new ValidationError(
            input.direction === 'out' ? 'An out operation has a positive amount; use a return (in) instead' : `The amount of a ${kind} has the sign ${sign}`,
            { kind, sign },
            'kind_sign',
          );
        if (input.operationRef && kind !== 'return' && kind !== 'forgiveness')
          throw new ValidationError(`A ${kind} refers to no operation`);
        let scope = input.scope ? validateScope(input.scope) : null;
        let area = input.area ?? 'master';
        let labelSource = input.labelSource ?? null;
        const needOwner = () => {
          if (!input.ownerId) throw new ValidationError(`A ${kind} goes to an owner`, undefined, 'owner_required');
        };
        const needArtist = () => {
          if (!input.artistId) throw new ValidationError(`A ${kind} is tied to an artist`, undefined, 'artist_required');
        };
        const needDocument = () => {
          if (!input.documentId)
            throw new RuleViolationError(`A ${kind} needs a basis document`, 'document_required');
        };
        const noScope = () => {
          if (scope && explicit) throw new ValidationError(`A ${kind} has no recoup scope`, undefined, 'scope_forbidden');
          scope = null;
        };
        switch (kind) {
          case 'payout':
            needOwner();
            noScope();
            break;
          case 'advance':
            needOwner();
            if (!scope) throw new ValidationError('An advance needs a recoup scope', undefined, 'scope_required');
            needArtist();
            needDocument();
            break;
          case 'deduction':
            needArtist();
            scope = scope ?? { kind: 'any' };
            break;
          case 'credit':
            needArtist();
            noScope();
            break;
          case 'buyout':
            needOwner();
            noScope();
            needDocument();
            break;
          case 'writeoff':
            needOwner();
            noScope();
            if (input.area && input.area !== 'publishing')
              throw new ValidationError('A write-off is of the publishing area', undefined, 'writeoff_area');
            area = 'publishing';
            needDocument();
            break;
          case 'adjustment':
            needOwner();
            noScope();
            needDocument();
            break;
          case 'return': {
            noScope();
            if (!input.operationRef) throw new ValidationError('A return refers to a payout');
            // A return reverses a payout that counted: plain payout, active, confirmed by a payment proof (or migrated).
            const ref = await get(input.operationRef);
            if (ref.kind !== 'payout') throw new ValidationError('A return refers to a payout');
            if (ref.deactivatedAt) throw new ValidationError('The payout is inactive');
            if (!ref.paymentProofId && !ref.migration)
              throw new RuleViolationError(
                'The payout never counted (no payment proof): deactivate it instead',
                'payout_not_counted',
              );
            const returned = (await repo.operationsReferring(ref.id))
              .filter((o) => o.deactivatedAt === null && o.kind === 'return')
              .reduce((sum, o) => sum - o.amountCents, 0);
            if (returned - input.amountCents > ref.amountCents)
              throw new ValidationError('Returns cannot exceed the payout');
            // a return belongs to the label (and the area) of its payout
            input = { ...input, ownerId: ref.ownerId, labelId: input.labelId ?? ref.labelId };
            if (input.labelId === ref.labelId) labelSource = 'payout';
            area = ref.area;
            break;
          }
          case 'forgiveness': {
            noScope();
            if (!input.operationRef) throw new ValidationError('A forgiveness refers to an advance');
            const ref = await get(input.operationRef);
            if (ref.kind !== 'advance' || ref.deactivatedAt)
              throw new RuleViolationError('A forgiveness refers to an active advance', 'operation_ref_not_advance');
            needDocument();
            // a forgiveness belongs to the owner, pseudonym, label and area of its advance
            input = { ...input, ownerId: ref.ownerId, artistId: ref.artistId, labelId: ref.labelId };
            labelSource = 'payout';
            area = ref.area;
            break;
          }
        }
        const id = newId();
        await repo.insertOperation({
          id,
          kind,
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
          labelSource: input.labelId ? labelSource : null,
          channel: input.channel ?? null,
          area,
          allocation: input.allocation ? JSON.stringify(input.allocation) : null,
          cutId: input.cutId ?? null,
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
        if (!PAID_KINDS.includes(o.kind)) throw new ValidationError('Payment proofs belong to payouts');
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
        if (!PAID_KINDS.includes(o.kind)) throw new ValidationError('Only payouts can be deferred');
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
        if (o.kind === 'payout' && o.externalRef) {
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
        // the operations referring to this one (D-173 FIX-4): a forgiveness of an advance, a return of a payout
        const referring = (await repo.operationsReferring(id)).filter((r) => r.deactivatedAt === null);
        if (referring.some((r) => r.kind === 'forgiveness'))
          throw new ConflictError('Deactivate the forgiveness of this advance first', 'has_forgiveness');
        if (referring.some((r) => r.kind === 'return'))
          throw new ConflictError('Deactivate the returns of this payout first', 'has_returns');
        await repo.setDeactivated(id, nowIso(), reason);
        return view(await get(id));
      });
    },

    /**
     * Payouts and advances of an owner that are not confirmed by a payment proof yet (or deferred): they block new
     * payouts (`BLOCKING_KINDS`, D-173: a buyout never blocks).
     */
    async blockingPayouts(ownerId: string): Promise<OperationView[]> {
      return (await repo.operationsOfOwner(ownerId))
        .filter(
          (o) =>
            BLOCKING_KINDS.includes(o.kind as (typeof BLOCKING_KINDS)[number]) &&
            o.deactivatedAt === null &&
            !o.migration &&
            (o.paymentProofId === null || o.deferred),
        )
        .map(view);
    },

    async setExternalRef(id: string, externalRef: string): Promise<void> {
      await repo.setExternalRef(id, externalRef);
    },

    /**
     * The label of an operation (D-168) and who set it (D-173): the operator on the history (`operator`), or the marking
     * script (`one`, `default`, `payout`).
     */
    async setLabel(id: string, labelId: string | null, source: LabelSource | null): Promise<OperationView> {
      return repo.transaction(async () => {
        const o = await get(id);
        if (o.deactivatedAt) throw new ValidationError('The operation is inactive');
        await repo.setLabel(id, labelId, labelId === null ? null : source);
        return view(await get(id));
      });
    },

    /** Attribute an operation to a cut, or take it back (null); D-198. The facade checks the cut and the label. */
    async setCut(id: string, cutId: string | null): Promise<OperationView> {
      return repo.transaction(async () => {
        await get(id);
        await repo.setCut(id, cutId);
        return view(await get(id));
      });
    },
    /** Who set the label of an operation, the label unchanged (D-173, `assign-operation-labels.ts --mark-source`). */
    async setLabelSource(id: string, source: LabelSource): Promise<void> {
      await repo.setLabelSource(id, source);
    },

    /** Stores a payout to an owner together with its snapshot (per-artist breakdown, file hashes). */
    async recordPayout(input: {
      ownerId: string;
      amountCents: number;
      date: string;
      comment: string;
      externalRef?: string | null;
      labelId?: string | null;
      /** The book area paid (D-173): master by default. */
      area?: 'master' | 'publishing';
      /** What the payout takes from which position (D-181): cents by pseudonym id, '' = the owner's own; Σ = amountCents. */
      allocation?: Record<string, number>;
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
          kind: 'payout',
          direction: 'out',
          amountCents: input.amountCents,
          ownerId: input.ownerId,
          date: input.date,
          comment: input.comment,
          externalRef: input.externalRef ?? null,
          deferred: true,
          labelId: input.labelId ?? null,
          labelSource: 'operator',
          area: input.area ?? 'master',
          ...(input.allocation ? { allocation: input.allocation } : {}),
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

    // ---- the admission (D-176): the module keeps the rows and their shape; the facade checks the owner and the label,
    // the gate reads them ----

    /** The payee of an owner: the previous active one is replaced (deactivated with the reason `replaced`). */
    async setPayee(input: { ownerId: string; channel: PayeeChannel; payeeRef?: string | null; status?: 'confirmed' | 'proposed'; basis: string; validFrom: string; source?: string | null }): Promise<PayeeView> {
      return repo.transaction(async () => {
        if (!['tipalti', 'easystaff', 'other'].includes(input.channel)) throw new ValidationError(`Unknown channel ${String(input.channel)}`, undefined, 'channel_unknown');
        const basis = input.basis.trim();
        if (basis.length < 1 || basis.length > 2000) throw new ValidationError('A payee names its basis (1-2000 characters)', undefined, 'basis_required');
        const validFrom = assertDate(input.validFrom);
        const now = nowIso();
        for (const prev of await repo.listPayees({ ownerId: input.ownerId, active: true })) await repo.setPayeeDeactivated(prev.id, now, 'replaced');
        const id = newId();
        await repo.insertPayee({ id, ownerId: input.ownerId, channel: input.channel, payeeRef: input.payeeRef?.trim() || null, status: input.status ?? 'confirmed', basis, validFrom, source: input.source ?? null, createdAt: now, deactivatedAt: null, deactivatedReason: null });
        return payeeView((await repo.getPayee(id)) as PayeeRow);
      });
    },
    async listPayees(f: { ownerId?: string; active?: boolean } = {}): Promise<PayeeView[]> {
      return (await repo.listPayees(f)).map(payeeView);
    },
    async deactivatePayee(id: string, reason: string): Promise<PayeeView> {
      return repo.transaction(async () => {
        const r = await repo.getPayee(id);
        if (!r) throw new NotFoundError('Payee', id);
        if (r.deactivatedAt) throw new ConflictError('The payee is inactive already', 'already_inactive');
        if (!reason.trim()) throw new ValidationError('A reason is required', undefined, 'reason_required');
        await repo.setPayeeDeactivated(id, nowIso(), reason.trim());
        return payeeView((await repo.getPayee(id)) as PayeeRow);
      });
    },

    async createHold(input: { ownerId: string; labelId?: string | null; kind: HoldKind; blocks?: boolean; reason: string; releaseWhen?: string | null; amountCents?: number | null; period?: string | null; reviewOn?: string | null; since: string; source?: string | null }): Promise<HoldView> {
      return repo.transaction(async () => {
        if (!['decision', 'artist_request', 'question', 'dispute'].includes(input.kind)) throw new ValidationError(`Unknown hold kind ${String(input.kind)}`, undefined, 'kind_unknown');
        const reason = input.reason.trim();
        if (reason.length < 1 || reason.length > 4000) throw new ValidationError('A hold names its reason (1-4000 characters)', undefined, 'reason_required');
        if (input.amountCents !== undefined && input.amountCents !== null && !Number.isInteger(input.amountCents)) throw new ValidationError('The amount of a hold is whole cents', undefined, 'amount_invalid');
        const id = newId();
        await repo.insertHold({
          id,
          ownerId: input.ownerId,
          labelId: input.labelId ?? null,
          kind: input.kind,
          blocks: input.blocks ?? input.kind !== 'dispute',
          reason,
          releaseWhen: input.releaseWhen?.trim() || null,
          amountCents: input.amountCents ?? null,
          period: input.period?.trim() || null,
          reviewOn: input.reviewOn ? assertDate(input.reviewOn) : null,
          since: assertDate(input.since),
          source: input.source ?? null,
          status: 'active',
          releasedAt: null,
          releasedReason: null,
          createdAt: nowIso(),
        });
        return holdView((await repo.getHold(id)) as HoldRow);
      });
    },
    async listHolds(f: { ownerId?: string; status?: 'active' | 'released' } = {}): Promise<HoldView[]> {
      return (await repo.listHolds(f)).map(holdView);
    },
    async getHold(id: string): Promise<HoldView> {
      const r = await repo.getHold(id);
      if (!r) throw new NotFoundError('Hold', id);
      return holdView(r);
    },
    async releaseHold(id: string, reason: string): Promise<HoldView> {
      return repo.transaction(async () => {
        const r = await repo.getHold(id);
        if (!r) throw new NotFoundError('Hold', id);
        if (r.status === 'released') throw new ConflictError('The hold is released already', 'already_released');
        if (!reason.trim()) throw new ValidationError('A reason is required', undefined, 'reason_required');
        await repo.setHoldReleased(id, nowIso(), reason.trim());
        return holdView((await repo.getHold(id)) as HoldRow);
      });
    },

    async createAnswer(input: { ownerId: string; labelId?: string | null; dueCents: number; decision: AnswerDecision; why: string; about: string; answeredBy: string; source?: string | null }): Promise<PayoutAnswerView> {
      return repo.transaction(async () => {
        if (!['pay', 'pay_task'].includes(input.decision)) throw new ValidationError(`Unknown decision ${String(input.decision)}`, undefined, 'decision_unknown');
        if (!Number.isInteger(input.dueCents) || input.dueCents <= 0) throw new ValidationError('The amount of an answer is a positive number of cents', undefined, 'amount_invalid');
        const why = input.why.trim();
        if (why.length < 1 || why.length > 4000) throw new ValidationError('An answer names its reason (1-4000 characters)', undefined, 'reason_required');
        if (!input.answeredBy.trim()) throw new ValidationError('An answer names who gave it', undefined, 'answered_by_required');
        const id = newId();
        await repo.insertAnswer({ id, ownerId: input.ownerId, labelId: input.labelId ?? null, dueCents: input.dueCents, decision: input.decision, why, about: input.about.trim(), answeredBy: input.answeredBy.trim(), source: input.source ?? null, createdAt: nowIso(), deactivatedAt: null, deactivatedReason: null });
        return answerView((await repo.getAnswer(id)) as PayoutAnswerRow);
      });
    },
    async listAnswers(f: { ownerId?: string; active?: boolean } = {}): Promise<PayoutAnswerView[]> {
      return (await repo.listAnswers(f)).map(answerView);
    },
    async deactivateAnswer(id: string, reason: string): Promise<PayoutAnswerView> {
      return repo.transaction(async () => {
        const r = await repo.getAnswer(id);
        if (!r) throw new NotFoundError('Payout answer', id);
        if (r.deactivatedAt) throw new ConflictError('The answer is inactive already', 'already_inactive');
        if (!reason.trim()) throw new ValidationError('A reason is required', undefined, 'reason_required');
        await repo.setAnswerDeactivated(id, nowIso(), reason.trim());
        return answerView((await repo.getAnswer(id)) as PayoutAnswerRow);
      });
    },

    // ---- the cuts (D-198): a label's book at a moment; the facade checks the label ----
    async listCuts(f: { labelId?: string } = {}): Promise<CutView[]> {
      return (await repo.listCuts(f)).map(cutView);
    },
    async getCut(id: string): Promise<CutView> {
      const r = await repo.getCut(id);
      if (!r) throw new NotFoundError('Cut', id);
      return cutView(r);
    },
    /** Every bound defaults to the first day of the month of the date: the months that ended before it are inside. */
    async createCut(input: CutInput): Promise<CutView> {
      return repo.transaction(async () => {
        const name = input.name.trim();
        if (!name) throw new ValidationError('A cut needs a name');
        const cutDate = assertDate(input.cutDate);
        const bound = (d: string | undefined) => firstOf(assertDate(d ?? cutDate));
        const row = {
          id: newId(),
          labelId: input.labelId,
          name,
          cutDate,
          masterTo: bound(input.masterTo),
          publishingTo: bound(input.publishingTo),
          adsTo: bound(input.adsTo ?? input.masterTo),
          comment: (input.comment ?? '').trim(),
          createdAt: nowIso(),
          createdBy: input.createdBy,
        };
        const others = (await repo.listCuts({ labelId: input.labelId })).map(cutView);
        if (others.some((c) => c.name === name)) throw new ConflictError(`The label already has a cut «${name}»`, 'cut_name_taken');
        assertCutOrder([...others, row]);
        await repo.insertCut(row);
        return cutView(row);
      });
    },
    /** The name, the date, the bounds and the comment; the label never changes. */
    async updateCut(id: string, patch: { name?: string; cutDate?: string; masterTo?: string; publishingTo?: string; adsTo?: string; comment?: string }): Promise<CutView> {
      return repo.transaction(async () => {
        const cur = await service.getCut(id);
        const next: CutView = {
          ...cur,
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.cutDate !== undefined ? { cutDate: assertDate(patch.cutDate) } : {}),
          ...(patch.masterTo !== undefined ? { masterTo: firstOf(assertDate(patch.masterTo)) } : {}),
          ...(patch.publishingTo !== undefined ? { publishingTo: firstOf(assertDate(patch.publishingTo)) } : {}),
          ...(patch.adsTo !== undefined ? { adsTo: firstOf(assertDate(patch.adsTo)) } : {}),
          ...(patch.comment !== undefined ? { comment: patch.comment.trim() } : {}),
        };
        if (!next.name) throw new ValidationError('A cut needs a name');
        // the operations attributed to the cut were placed against its moment (D-199): the moment stays
        if (next.cutDate !== cur.cutDate) {
          const n = await repo.countCutOperations(id);
          if (n > 0) throw new ConflictError(`${n} operation(s) are attributed to the cut: its date stays`, 'cut_in_use', { operations: n });
        }
        const others = (await repo.listCuts({ labelId: cur.labelId })).map(cutView).filter((c) => c.id !== id);
        if (others.some((c) => c.name === next.name)) throw new ConflictError(`The label already has a cut «${next.name}»`, 'cut_name_taken');
        assertCutOrder([...others, next]);
        const { name, cutDate, masterTo, publishingTo, adsTo, comment } = next;
        await repo.updateCut(id, { name, cutDate, masterTo, publishingTo, adsTo, comment });
        return next;
      });
    },
    /** Only a cut no operation is attributed to (active or not). */
    async deleteCut(id: string): Promise<CutView> {
      return repo.transaction(async () => {
        const cur = await service.getCut(id);
        const n = await repo.countCutOperations(id);
        if (n > 0) throw new ConflictError(`${n} operation(s) are attributed to the cut`, 'cut_in_use', { operations: n });
        await repo.deleteCut(id);
        return cur;
      });
    },

  };
  return service;
}

export type SettlementsService = ReturnType<typeof createSettlementsService>;
