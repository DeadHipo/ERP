import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../shared/errors';
import { centsToDecimal, Decimal, ZERO } from '../shared/money';
import { assertDate } from '../shared/dates';
import { todayIso } from '../shared/dates';
import { type Scope } from '../modules/settlements';
import {
  KIND_DIRECTION,
  KIND_DOCUMENT_KINDS,
  KIND_SIGN,
  KIND_WITH_SCOPE,
  kindOf,
  type OperationKind,
  CUT_TRANSFER,
} from '@erp/shared/operation-kinds';

/** The kinds that go to an owner (no pseudonym needed) and need a basis document (D-173 §1.1). */
const OWNER_DOCUMENT_KINDS: readonly OperationKind[] = ['buyout', 'writeoff', 'adjustment'];
import type { FacadeContext, PayoutArea } from './context';
import { OWNER_POSITION } from './balance';
import { ALL_VIEWER, assertViewerHolds, viewerHolds, type Viewer } from './viewer';

export function payoutsApi(ctx: FacadeContext) {
  const { db, config, owners, settlements, publishing, sources, payments, blockingPayoutsOf, balanceWithFiles, assertOwnLabel } = ctx;
  /** A write on an operation by id (D-171): an operation of one of the viewer's labels, else 403 `label_forbidden`. */
  async function checkOperation(id: string, viewer: Viewer) {
    const op = await settlements.getOperation(id);
    if (viewer.kind !== 'all') assertViewerHolds(viewer, op.labelId);
    return op;
  }

  /** A cut an operation of `labelId` may be attributed to (D-198): a cut of that very label. */
  async function assertCutOf(cutId: string, labelId: string | null) {
    const cut = await settlements.getCut(cutId);
    if (cut.labelId !== labelId)
      throw new ConflictError('The cut belongs to another label than the operation', 'cut_label_mismatch', { cutLabelId: cut.labelId, labelId });
    return cut;
  }

  const api = {
    /**
     * An operation of a kind (D-173): advances, deductions, credits (and migrated payouts) here; a plain payout of
     * earned money is made only by the payout button (createPayout), a return by its action, a forgiveness by its own.
     * Without `kind` the kind is derived from the fields as before D-173 (`kindOf`), so every earlier caller and the
     * loader keep their answers. Settlements are tied to the artist; the owner comes from module 1. The refusals come in
     * the order of D-173 §1.1: label_required → kind_direction → kind_sign → use_payout_button / use_return_action /
     * use_forgive_action → owner_required / artist_required → scope_required / scope_forbidden / writeoff_area →
     * document_required → document_kind → document_owner_mismatch → the gate of an advance (owner_not_confirmed,
     * no_contract_for_label, payout_blocked) → writeoff_exceeds. A buyout, a write-off and an adjustment (D-173) go to
     * an owner with a basis document and no gate (the document under the label is enough); a write-off is of the
     * publishing area and at most the publishing the book still has (earned − recouped from it − earlier write-offs).
     */
    createOperation(input: {
      kind?: OperationKind;
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
      /** The own label the operation belongs to (D-168); required unless the operation is a migrated one. */
      labelId?: string | null;
      /** The area of the book (D-173): master by default, publishing for a write-off. */
      area?: 'master' | 'publishing';
      /** The cash register's id of the payment (the operation import, D-173 §1.5); the API body has none. */
      externalRef?: string | null;
      /** The payment channel, free text (the operation import, D-173 §1.5). */
      channel?: string | null;
      /** The cut the operation is attributed to (D-198): a cut of the operation's label. */
      cutId?: string | null;
    }) {
      return db.transaction(async () => {
        if (input.cutId) await assertCutOf(input.cutId, input.labelId ?? null);
        const cents = new Decimal(input.amount).mul(100);
        if (!cents.isInteger()) throw new ValidationError('Settlement amounts are whole cents');
        if (!input.labelId && !input.migration)
          throw new ValidationError('An operation needs the label it belongs to (labelId)', undefined, 'label_required');
        if (input.labelId) await assertOwnLabel(input.labelId);
        const explicit = input.kind !== undefined;
        const kind: OperationKind =
          input.kind ?? kindOf({ direction: input.direction, amountCents: cents.toNumber(), scope: input.scope ?? null, operationRef: input.operationRef });
        if (KIND_DIRECTION[kind] !== input.direction)
          throw new ValidationError(`A ${kind} is an "${KIND_DIRECTION[kind]}" operation`, { kind, expected: KIND_DIRECTION[kind] }, 'kind_direction');
        const sign = KIND_SIGN[kind];
        if (cents.isZero() || (sign === '+' && cents.isNegative()) || (sign === '-' && cents.isPositive()))
          throw new ValidationError(`The amount of a ${kind} has the sign ${sign}`, { kind, sign }, 'kind_sign');
        if (kind === 'payout' && !input.migration) {
          throw new RuleViolationError(
            'A payout of earned money is made with the payout button; an advance needs a scope',
            'use_payout_button',
          );
        }
        if (kind === 'return') throw new ValidationError('Use the return action for returns', undefined, 'use_return_action');
        if (kind === 'forgiveness')
          throw new ValidationError('Use the forgive action of the advance', undefined, 'use_forgive_action');
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
        if ((kind === 'payout' || OWNER_DOCUMENT_KINDS.includes(kind)) && !ownerId)
          throw new ValidationError(`A ${kind} goes to an owner`, undefined, 'owner_required');
        if ((kind === 'advance' || kind === 'deduction' || kind === 'credit') && !input.artistId)
          throw new ValidationError(`A ${kind} is tied to an artist`, undefined, 'artist_required');
        if (kind === 'advance' && !input.scope)
          throw new ValidationError('An advance needs a recoup scope', undefined, 'scope_required');
        if (explicit && input.scope && !(KIND_WITH_SCOPE as readonly string[]).includes(kind))
          throw new ValidationError(`A ${kind} has no recoup scope`, undefined, 'scope_forbidden');
        if (kind === 'writeoff' && input.area && input.area !== 'publishing')
          throw new ValidationError('A write-off is of the publishing area', undefined, 'writeoff_area');
        if (kind === 'advance' && !input.documentId)
          throw new RuleViolationError('A recoupable payout (advance) needs a basis document', 'document_required');
        if (OWNER_DOCUMENT_KINDS.includes(kind) && !input.documentId)
          throw new RuleViolationError(`A ${kind} needs a basis document`, 'document_required');
        // The basis document must fit the kind (KIND_DOCUMENT_KINDS): an advance by an advance agreement (or the
        // contract), a deduction or a credit by an adjustment basis (or the contract / other).
        if (input.documentId) {
          const docKind = (await owners.getDocument(input.documentId)).kind;
          const allowed: readonly string[] = KIND_DOCUMENT_KINDS[kind];
          if (!allowed.includes(docKind))
            throw new ValidationError(`A ${kind} cannot be based on a document of kind "${docKind}"`, { allowed }, 'document_kind');
        }
        for (const d of [input.documentId, input.paymentProofId]) {
          if (!d) continue;
          const doc = await owners.getDocument(d);
          if (doc.ownerId && ownerId && doc.ownerId !== ownerId)
            throw new RuleViolationError('The document belongs to another owner', 'document_owner_mismatch');
        }
        // An advance is a payout: same gate as the payout button (README 5, 07 rule 2).
        if (kind === 'advance' && !input.migration && ownerId) {
          if (!(await owners.isOwnerConfirmed(ownerId))) {
            throw new RuleViolationError(
              'The owner has no approved contract: payout is not possible',
              'owner_not_confirmed',
            );
          }
          // under a label: a contract whose document has that label or none (D-169)
          if (input.labelId && !(await owners.isOwnerConfirmedUnder(ownerId, input.labelId))) {
            throw new RuleViolationError(
              'The owner has no approved contract with this label: payout is not possible',
              'no_contract_for_label',
              { labelId: input.labelId },
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
        // a write-off takes at most the publishing the book still has (D-173 К6): earned − recouped from it − write-offs
        if (kind === 'writeoff' && ownerId) {
          const { balance } = await balanceWithFiles(ownerId, {}, input.labelId ? { labelId: input.labelId } : undefined);
          const pub = balance.total.byArea.publishing;
          const available = pub.earned.sub(pub.recouped).sub(balance.total.writtenOff);
          if (cents.div(100).gt(available))
            throw new RuleViolationError('The write-off is above the publishing the book has', 'writeoff_exceeds', {
              available: Decimal.max(available, 0).toFixed(),
            });
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
        // a new operation's label is the operator's (D-173 §1.2); the module derives the same kind when none is given
        return settlements.createOperation({
          ...input,
          kind: input.kind,
          amountCents: cents.toNumber(),
          ownerId,
          labelSource: input.labelId ? 'operator' : null,
        });
      });
    },

    /**
     * The "Payout" button: recalculates the owner, checks documents, blocking payouts and the threshold, records the
     * payout with its snapshot (deferred until the payment proof), then sends it to the (stub) payment service.
     * One amount per owner and label (D-168): the button pays the payable of the label's book, the gate keeps its
     * owner checks (the contract, the blocking payouts of the owner whatever their label). The checks, the calculation
     * and the recorded payout are one write transaction (D-121); the payment service is called after it commits.
     */
    async createPayout(ownerId: string, input: { labelId?: string; comment?: string; area?: PayoutArea } = {}) {
      if (!input.labelId) throw new ValidationError('A payout is made under a label (labelId)', undefined, 'label_required');
      const labelId = input.labelId;
      // D-173 К10: the button pays one area, master by default: min(payable of the area, payable of the book)
      const area: PayoutArea = input.area ?? 'master';
      const { op, id, cents } = await db.transaction(async () => {
        const label = await assertOwnLabel(labelId);
        const id = await owners.resolveOwnerId(ownerId);
        const { balance, files: believeFiles } = await balanceWithFiles(id, {}, { labelId }, { area });
        // One decision for the button and the screen (N19): the order owner_not_confirmed, no_contract_for_label,
        // payout_blocked, nothing_to_pay, below_threshold is the order of payoutGate().
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
            case 'no_contract_for_label':
              throw new RuleViolationError(
                'The owner has no approved contract with this label: payout is not possible',
                'no_contract_for_label',
                { labelId },
              );
            case 'hold':
              throw new RuleViolationError('A hold closes the payouts of the owner', 'hold', { labelId });
            case 'no_payee':
              throw new RuleViolationError('The owner has no payee (a channel and its reference): set one first', 'no_payee', { labelId });
            case 'needs_answer':
              throw new RuleViolationError('The first payout of the owner needs an answer «pay» for exactly this amount', 'needs_answer', { labelId, amountCents: cents });
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
        // "Which position this payout takes from" (D-181): the amount is split over the positive positions of the
        // pseudonyms in the area (and the owner's own, key '') pro rata, floored to cents, the residue to the largest;
        // the operation stores it (`allocation`), so that the balance reduces exactly those positions.
        const amount = centsToDecimal(cents);
        const positionIn = (a: (typeof balance.artists)[number]) =>
          area === 'all' ? a.position : Object.values(a.byLabel).reduce((s, x) => s.add(x.positionByArea[area]), ZERO);
        const ownerPosition = area === 'all' ? balance.total.ownerPosition : balance.total.byArea[area].ownerPosition;
        const parts = [
          ...balance.artists.map((a) => ({ key: a.artistId, label: a.pseudonym, net: positionIn(a) })),
          { key: OWNER_POSITION, label: 'Owner (no pseudonym)', net: ownerPosition },
        ].filter((p) => p.net.gt(0));
        const totalNet = parts.reduce((s, p) => s.add(p.net), ZERO);
        const allocation: Record<string, number> = {};
        if (parts.length > 0) {
          let given = 0;
          for (const p of parts) {
            const c = totalNet.isZero() ? 0 : amount.mul(p.net).div(totalNet).mul(100).floor().toNumber();
            allocation[p.key] = c;
            given += c;
          }
          const largest = [...parts].sort((x, y) => y.net.cmp(x.net) || x.key.localeCompare(y.key))[0] as (typeof parts)[number];
          allocation[largest.key] = (allocation[largest.key] ?? 0) + (cents - given);
        } else allocation[OWNER_POSITION] = cents;
        const snapshot = {
          computedAt: new Date().toISOString(),
          ownerId: id,
          labelId: label.id,
          labelName: label.name,
          amountCents: cents,
          area,
          payableExact: balance.total.payable.toFixed(),
          total: balance.total,
          // the positions the payout takes from (D-181): `net` = the position, `shareOfPayout` = the cents allocated
          payoutByArtist: parts.map((p) => ({ key: p.key, label: p.label, net: p.net, shareOfPayout: centsToDecimal(allocation[p.key] ?? 0) })),
          allocation,
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
          // the files of the book that was paid (D-169): the Believe files and the B17 statements loaded under the label
          files: await (async () => {
            const ofLabel = new Set((await sources.filesOfLabel(label.id)).map((f) => f.id));
            return {
              believe: believeFiles.filter((f) => ofLabel.has(f.id)),
              b17: (await publishing.activeStatements()).filter((s) => s.labelId === label.id),
            };
          })(),
        };
        const op = await settlements.recordPayout({
          ownerId: id,
          amountCents: cents,
          date: todayIso(),
          comment: input.comment ?? 'Payout on demand',
          labelId: label.id,
          // the book area of the payout (D-173): `all` is recorded as master, as the history (О5)
          area: area === 'publishing' ? 'publishing' : 'master',
          allocation,
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
    async attachPaymentProof(operationId: string, input: { fileRef: string; title?: string }, viewer: Viewer = ALL_VIEWER) {
      await checkOperation(operationId, viewer);
      return db.transaction(async () => {
        const op = await settlements.getOperation(operationId);
        if (!(['payout', 'advance', 'buyout'] as readonly string[]).includes(op.kind) || !op.active || op.paymentProofId)
          throw new ValidationError('This operation cannot take a payment proof');
        const doc = await owners.createDocument({
          kind: 'payment_proof',
          title: input.title ?? `Payment proof ${op.externalRef ?? op.id.slice(0, 8)}`,
          fileRef: input.fileRef,
          ownerId: op.ownerId,
          requiresApproval: false,
          labelId: op.labelId,
        });
        return settlements.attachPaymentProof(operationId, doc.id);
      });
    },

    /**
     * The label of an existing operation (D-168), with the operator's reason (D-173: `400 reason_required` without one;
     * the reason and the previous label go into the audit summary). The label source becomes `operator`.
     */
    async setOperationLabel(operationId: string, labelId: string, reason: string | undefined, viewer: Viewer = ALL_VIEWER) {
      if (!reason?.trim())
        throw new ValidationError('A change of the label needs a reason', undefined, 'reason_required');
      await assertOwnLabel(labelId);
      await checkOperation(operationId, viewer);
      if (viewer.kind !== 'all') assertViewerHolds(viewer, labelId);
      return db.transaction(async () => {
        const before = await settlements.getOperation(operationId);
        if (before.externalRef?.startsWith(CUT_TRANSFER))
          throw new ConflictError('A row of a transfer keeps the label of its cut', 'cut_transfer_pair');
        const fromLabelId = before.labelId;
        // a cut belongs to one label (D-199): the operation leaves a cut of its old label
        if (before.cutId && fromLabelId !== labelId) await settlements.setCut(operationId, null);
        return { ...(await settlements.setLabel(operationId, labelId, 'operator')), fromLabelId };
      });
    },

    /** A payout that did not arrive: a separate return operation with a confirming document (under the payout's label). */
    async returnPayout(operationId: string, input: { fileRef: string; date: string; comment: string }, viewer: Viewer = ALL_VIEWER) {
      await checkOperation(operationId, viewer);
      return db.transaction(async () => {
        const op = await settlements.getOperation(operationId);
        if (op.kind !== 'payout' || !op.active || (!op.paymentProofId && !op.migration)) {
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
          labelId: op.labelId,
        });
        return settlements.createOperation({
          kind: 'return',
          direction: 'in',
          amountCents: -op.amountCents,
          ownerId: op.ownerId,
          date: input.date,
          operationRef: op.id,
          documentId: doc.id,
          comment: input.comment,
          labelId: op.labelId,
        });
      });
    },

    /**
     * The forgiveness of an advance from a date (D-173 §1.3): the advance must be active (422 operation_ref_not_advance),
     * the date not before it (422 forgiveness_before_advance), the basis document of a forgiveness kind and of the same
     * owner, the amount at most the unrecouped part (`remaining` of the position in the full recalculation, earlier
     * forgivenesses included; an advance that does not count yet has 0: 422 forgiveness_exceeds { unrecouped }). The
     * forgiveness takes the owner, pseudonym, label and area of its advance (label source `payout`). The recoup frees the
     * income of the months from the date on (`layers/recoup.ts`): payable does not move at the moment.
     */
    async forgiveAdvance(
      operationId: string,
      input: { amount: string; date: string; documentId: string; comment: string },
      viewer: Viewer = ALL_VIEWER,
    ) {
      await checkOperation(operationId, viewer);
      return db.transaction(async () => {
        const advance = await settlements.getOperation(operationId);
        if (advance.kind !== 'advance' || !advance.active)
          throw new RuleViolationError('Only an active advance can be forgiven', 'operation_ref_not_advance');
        const cents = new Decimal(input.amount).mul(100);
        if (!cents.isInteger()) throw new ValidationError('Settlement amounts are whole cents');
        if (!cents.isPositive() || cents.isZero())
          throw new ValidationError('The amount of a forgiveness has the sign +', { kind: 'forgiveness', sign: '+' }, 'kind_sign');
        if (assertDate(input.date) < advance.date)
          throw new RuleViolationError('A forgiveness cannot be dated before its advance', 'forgiveness_before_advance', {
            advanceDate: advance.date,
          });
        const doc = await owners.getDocument(input.documentId);
        const allowed: readonly string[] = KIND_DOCUMENT_KINDS.forgiveness;
        if (!allowed.includes(doc.kind))
          throw new ValidationError(`A forgiveness cannot be based on a document of kind "${doc.kind}"`, { allowed }, 'document_kind');
        const ownerId = advance.ownerId ? await owners.resolveOwnerId(advance.ownerId) : null;
        if (doc.ownerId && ownerId && (await owners.resolveOwnerId(doc.ownerId)) !== ownerId)
          throw new RuleViolationError('The document belongs to another owner', 'document_owner_mismatch');
        const position = ownerId
          ? (await balanceWithFiles(ownerId)).balance.positions.find((p) => p.operationId === advance.id)
          : undefined;
        const unrecouped = position?.remaining ?? ZERO;
        if (cents.div(100).gt(unrecouped))
          throw new RuleViolationError('The forgiveness is above the unrecouped part of the advance', 'forgiveness_exceeds', {
            unrecouped: unrecouped.toFixed(),
          });
        return settlements.createOperation({
          kind: 'forgiveness',
          direction: 'in',
          amountCents: cents.toNumber(),
          date: input.date,
          operationRef: advance.id,
          documentId: doc.id,
          comment: input.comment,
        });
      });
    },

    /** Defers a payout or releases it (the operation's label for a viewer of some labels, D-171). */
    async setOperationDeferred(operationId: string, deferred: boolean, viewer: Viewer = ALL_VIEWER) {
      await checkOperation(operationId, viewer);
      return settlements.setDeferred(operationId, deferred);
    },

    /** Soft rollback of an operation (the operation's label for a viewer of some labels, D-171). */
    async deactivateOperation(operationId: string, reason: string, opts: { transferFailed?: boolean } = {}, viewer: Viewer = ALL_VIEWER) {
      const op = await checkOperation(operationId, viewer);
      // a transfer of a cut (D-198) is a pair: one goes, both go
      const pair = op.externalRef?.startsWith(CUT_TRANSFER) ? op.externalRef : null;
      if (!pair) return settlements.deactivate(operationId, reason, opts);
      return db.transaction(async () => {
        const out = await settlements.deactivate(operationId, reason, opts);
        for (const o of await settlements.listOperations({ ownerId: op.ownerId ?? undefined }))
          if (o.id !== operationId && o.active && o.externalRef === pair) await settlements.deactivate(o.id, reason);
        return out;
      });
    },

    /** Attribute an operation to a cut of its label, or take it back (null); D-198. */
    async setOperationCut(operationId: string, cutId: string | null, viewer: Viewer = ALL_VIEWER) {
      const op = await checkOperation(operationId, viewer);
      if (!op.active) throw new ValidationError('The operation is inactive', undefined, 'operation_inactive');
      if (op.externalRef?.startsWith(CUT_TRANSFER))
        throw new ConflictError('A row of a transfer keeps its cut: deactivate the transfer instead', 'cut_transfer_pair');
      return db.transaction(async () => {
        if (cutId) await assertCutOf(cutId, op.labelId);
        return settlements.setCut(operationId, cutId);
      });
    },

    /**
     * The snapshot a payout recorded (D-053). A viewer of some labels (D-171): an operation of one of its labels, else
     * 404 as an unknown snapshot.
     */
    async operationSnapshot(operationId: string, viewer: Viewer = ALL_VIEWER): Promise<unknown> {
      if (viewer.kind !== 'all') {
        const op = await settlements.getOperation(operationId); // an unknown id: 404
        if (!viewerHolds(viewer, op.labelId)) throw new NotFoundError('Payout snapshot', operationId);
      }
      return settlements.getSnapshot(operationId);
    },
  };
  return api;
}
