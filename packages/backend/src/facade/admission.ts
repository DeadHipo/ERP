import { ValidationError } from '../shared/errors';
import { decimalToCents, parseUsd } from '../shared/money';
import type { AnswerDecision, HoldKind, HoldView, OperationView, PayeeChannel, PayeeView, PayoutAnswerView, SettlementsService } from '../modules/settlements';
import type { Admission } from './payout-gate';
import type { FacadeContext } from './context';
import { ALL_VIEWER, assertViewerHolds, type Viewer } from './viewer';

// The admission to the payout (D-176, the owner's module 17): the payee and the channel of an owner, the holds (a
// decision, an artist's request, a question, a disputed history item), the answers «pay» to the check of the first
// payout, the threshold of the contract. The gate (`payout-gate.ts`) reads them beside the balance; nothing here moves
// money. The checks «no payee» and «needs an answer» act once the organization has entered its first payee row.

/** What the gate of one owner reads, besides the balance: the rows of the owner and the contract threshold. */
export interface AdmissionRows {
  payee: PayeeView | null;
  holds: HoldView[];
  answers: PayoutAnswerView[];
}

/** The admission rows of every owner, read once for the lists (payables, payroll). */
export interface AdmissionIndex {
  active: boolean;
  byOwner: Map<string, AdmissionRows>;
  /** Owner → the threshold of its contract under the label (null = the default), by the payroll's contract choice. */
  thresholdOf: (ownerId: string) => number | null;
}

/** The threshold of the contract the payroll shows: its own label before «any label», then the newest approval. */
export function contractThresholds(
  contracts: { ownerId: string; labelId: string | null; approvedAt: string | null; documentId: string; payoutThresholdCents: number | null }[],
  labelId: string | undefined,
): Map<string, number | null> {
  const chosen = new Map<string, (typeof contracts)[number]>();
  const rank = (c: (typeof contracts)[number]) => (labelId !== undefined && c.labelId === labelId ? 0 : 1);
  for (const c of contracts) {
    if (labelId !== undefined && c.labelId !== null && c.labelId !== labelId) continue;
    const prev = chosen.get(c.ownerId);
    const newer =
      !prev ||
      rank(c) < rank(prev) ||
      (rank(c) === rank(prev) && ((c.approvedAt ?? '') > (prev.approvedAt ?? '') || ((c.approvedAt ?? '') === (prev.approvedAt ?? '') && c.documentId < prev.documentId)));
    if (newer) chosen.set(c.ownerId, c);
  }
  return new Map([...chosen].map(([owner, c]) => [owner, c.payoutThresholdCents]));
}

/** The gate's input from the rows of an owner (D-176): holds and answers of the book (or of every book). */
export function admissionOf(
  rows: AdmissionRows | undefined,
  o: { active: boolean; thresholdCents: number | null; labelId: string | undefined; operations: Pick<OperationView, 'kind' | 'active' | 'labelId'>[] },
): Admission {
  const inBook = (labelId: string | null) => labelId === null || o.labelId === undefined || labelId === o.labelId;
  return {
    active: o.active,
    thresholdCents: o.thresholdCents,
    hasPayee: rows?.payee !== null && rows?.payee !== undefined,
    held: (rows?.holds ?? []).some((h) => h.status === 'active' && h.blocks && inBook(h.labelId)),
    hadPayout: o.operations.some((op) => op.kind === 'payout' && op.active && (o.labelId === undefined || op.labelId === o.labelId)),
    answeredCents: (rows?.answers ?? []).filter((a) => a.active && inBook(a.labelId)).map((a) => a.dueCents),
  };
}

/** Reads the admission rows of every owner in one go (inside the caller's snapshot). */
export async function admissionIndex(
  settlements: Pick<SettlementsService, 'listPayees' | 'listHolds' | 'listAnswers'>,
  thresholds: Map<string, number | null>,
): Promise<AdmissionIndex> {
  const [payees, holds, answers] = await Promise.all([settlements.listPayees({}), settlements.listHolds({ status: 'active' }), settlements.listAnswers({ active: true })]);
  const byOwner = new Map<string, AdmissionRows>();
  const of = (owner: string) => {
    let r = byOwner.get(owner);
    if (!r) byOwner.set(owner, (r = { payee: null, holds: [], answers: [] }));
    return r;
  };
  for (const p of payees) if (p.active) of(p.ownerId).payee = p;
  for (const h of holds) of(h.ownerId).holds.push(h);
  for (const a of answers) of(a.ownerId).answers.push(a);
  return { active: payees.length > 0, byOwner, thresholdOf: (ownerId) => thresholds.get(ownerId) ?? null };
}

export function admissionApi(ctx: FacadeContext) {
  const { db, owners, settlements, assertOwnLabel, labelContext } = ctx;

  async function labelOf(labelId: string | null | undefined): Promise<string | null> {
    if (labelId === undefined || labelId === null) return null;
    return (await assertOwnLabel(labelId)).id;
  }

  return {
    /** The payee, the holds and the answers of the owners of a book (`label`), or of one owner, or of every owner. */
    async listAdmission(input: { ownerId?: string | undefined; labelId?: string | undefined; active?: boolean | undefined } = {}, viewer: Viewer = ALL_VIEWER) {
      if (viewer.kind !== 'all') {
        if (!input.labelId) throw new ValidationError('Choose the label: ?label=', undefined, 'label_required');
        assertViewerHolds(viewer, input.labelId);
      }
      const active = input.active ?? true;
      const lc = await labelContext(input.labelId);
      const ownerId = input.ownerId ? await owners.resolveOwnerId(input.ownerId) : undefined;
      const [payees, holds, answers, names] = await db.snapshot(async () =>
        Promise.all([
          settlements.listPayees({ ...(ownerId ? { ownerId } : {}), ...(active ? { active: true } : {}) }),
          settlements.listHolds({ ...(ownerId ? { ownerId } : {}), ...(active ? { status: 'active' as const } : {}) }),
          settlements.listAnswers({ ...(ownerId ? { ownerId } : {}), ...(active ? { active: true } : {}) }),
          owners.listOwners(),
        ]),
      );
      const visible = (id: string) => (lc ? lc.visible.ownerIds.has(id) : true);
      const nameOf = new Map(names.map((o) => [o.id, o.name]));
      const name = <T extends { ownerId: string }>(r: T) => ({ ...r, ownerName: nameOf.get(r.ownerId) ?? null });
      return {
        active: (await settlements.listPayees({})).length > 0,
        payees: payees.filter((p) => visible(p.ownerId)).map(name),
        holds: holds.filter((h) => visible(h.ownerId) && (!lc || h.labelId === null || h.labelId === lc.book.id)).map(name),
        answers: answers.filter((a) => visible(a.ownerId) && (!lc || a.labelId === null || a.labelId === lc.book.id)).map(name),
      };
    },

    /** Sets the payee of an owner (the channel and its reference); the previous active one is replaced. */
    async setPayee(input: { ownerId: string; channel: PayeeChannel; payeeRef?: string | null; status?: 'confirmed' | 'proposed'; basis: string; validFrom: string; source?: string | null }) {
      const ownerId = await owners.resolveOwnerId(input.ownerId);
      await owners.getOwner(ownerId);
      return settlements.setPayee({ ...input, ownerId });
    },
    async deactivatePayee(id: string, reason: string) {
      return settlements.deactivatePayee(id, reason);
    },

    /** A hold on the payouts of an owner, in a book (`labelId`) or in every book. */
    async createHold(input: { ownerId: string; labelId?: string | null; kind: HoldKind; blocks?: boolean; reason: string; releaseWhen?: string | null; amount?: string | null; period?: string | null; reviewOn?: string | null; since?: string; source?: string | null }) {
      const ownerId = await owners.resolveOwnerId(input.ownerId);
      await owners.getOwner(ownerId);
      const labelId = await labelOf(input.labelId);
      const amountCents = input.amount ? decimalToCents(parseUsd(input.amount)) : null;
      return settlements.createHold({ ...input, ownerId, labelId, amountCents, since: input.since ?? new Date().toISOString().slice(0, 10) });
    },
    async releaseHold(id: string, reason: string) {
      return settlements.releaseHold(id, reason);
    },

    /** An answer «pay» to the check of a payout of an owner: valid for exactly the amount `due`. */
    async createAnswer(input: { ownerId: string; labelId?: string | null; due: string; decision: AnswerDecision; why: string; about: string; answeredBy: string; source?: string | null }) {
      const ownerId = await owners.resolveOwnerId(input.ownerId);
      await owners.getOwner(ownerId);
      const labelId = await labelOf(input.labelId);
      const dueCents = decimalToCents(parseUsd(input.due));
      return settlements.createAnswer({ ...input, ownerId, labelId, dueCents });
    },
    async deactivateAnswer(id: string, reason: string) {
      return settlements.deactivateAnswer(id, reason);
    },

    /** The payout threshold of a contract (D-176): cents, or null = the organization's default. */
    async setContractThreshold(id: string, payoutThresholdCents: number | null) {
      return owners.setContractThreshold(id, payoutThresholdCents);
    },
  };
}
