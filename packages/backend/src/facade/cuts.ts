import type { CutView, OperationView } from '../modules/settlements';
import { Decimal, ZERO } from '../shared/money';
import { calculate, type Calculation } from './calculation';
import { ownerBalance, ownerIndex, startsByOwner } from './balance';
import { cutCalculationBy, cutOperationsBy, type CutBounds } from './as-of';
import { randomUUID } from 'node:crypto';
import { ValidationError } from '../shared/errors';
import type { FacadeContext } from './context';
import { ALL_VIEWER, type Viewer } from './viewer';
import { CUT_TRANSFER, type payoutsApi } from './payouts';

// The cuts (D-198): the state of a label's book at a moment, cumulative. A cut is a view of the very balance (the one
// calculation cut by the bounds, `as-of.ts`) plus the operations attributed to it (`operations.cut_id`); nothing is
// stored but the cut itself, and `calculate()` and the layers never see it. The state is per position (D-181: a
// pseudonym's or the owner's own), never netted over the owner.

/** A position is settled at the cut when |balance| < 1 cent. */
const CENT = new Decimal('0.01');

export interface CutPosition {
  ownerId: string;
  ownerName: string;
  /** null = the owner's own position (publishing and operations without a pseudonym). */
  artistId: string | null;
  pseudonym: string | null;
  balance: Decimal;
}

type Ctx = Pick<FacadeContext, 'db' | 'owners' | 'settlements' | 'modules' | 'opDocIds' | 'labelContext'>;
type Op = OperationView;

/** One read for every cut: one full calculation, every operation, the starts, the cuts and the owners. */
async function readWorld(ctx: Ctx, calc?: Calculation) {
  const { db, owners, settlements, modules, opDocIds } = ctx;
  const read = await db.snapshot(async () => ({
    ownerList: await owners.listOwners(),
    ops: await settlements.listOperations({}),
    startRows: await settlements.listOpeningBalances({ active: true }),
    cuts: await settlements.listCuts({}),
  }));
  return { ...read, calc: calc ?? (await calculate(modules, await opDocIds())) };
}
type World = Awaited<ReturnType<typeof readWorld>>;

/** The inputs of every balance at a cut (or now, without a cut): the calculation and the operations cut by its bounds. */
function inputsAt(w: World, cut: CutView | null) {
  const dates = new Map(w.cuts.map((c) => [c.id, c.cutDate]));
  const bounds: CutBounds | null = cut
    ? { masterTo: cut.masterTo, publishingTo: cut.publishingTo, adsTo: cut.adsTo, date: cut.cutDate, cutDateOf: (id) => dates.get(id) }
    : null;
  const calc = bounds ? cutCalculationBy(w.calc, bounds) : w.calc;
  const opsOf = new Map<string, Op[]>();
  for (const o of bounds ? cutOperationsBy(w.ops, bounds) : w.ops) if (o.ownerId) (opsOf.get(o.ownerId) ?? opsOf.set(o.ownerId, []).get(o.ownerId))?.push(o);
  return { calc, index: ownerIndex(calc), startsOf: startsByOwner(calc, w.startRows), opsOf };
}

/** One owner's book of a label from those inputs: its positions (every pseudonym with the book, and the owner's own) and the book. */
function ownerBookAt(inputs: ReturnType<typeof inputsAt>, owner: { id: string; name: string }, labelId: string) {
  const { calc, index, startsOf, opsOf } = inputs;
  const b = ownerBalance(calc, owner.id, opsOf.get(owner.id) ?? [], {}, { ...(index.get(owner.id) ?? { units: [], publishing: [] }), starts: startsOf.get(owner.id) ?? [] }, { labelId });
  const positions: CutPosition[] = [];
  for (const a of b.artists) {
    const book = Object.values(a.byLabel).find((x) => x.labelId === labelId);
    if (book) positions.push({ ownerId: owner.id, ownerName: owner.name, artistId: a.artistId, pseudonym: a.pseudonym, balance: book.position });
  }
  const book = Object.values(b.byLabel).find((x) => x.labelId === labelId);
  if (book) positions.push({ ownerId: owner.id, ownerName: owner.name, artistId: null, pseudonym: null, balance: book.ownerPosition });
  return { positions, book };
}

/** Every position of the cut's book at the cut (the owners visible under its label), the settled ones too. */
async function positionsAt(ctx: Ctx, w: World, cut: CutView): Promise<CutPosition[]> {
  const lc = await ctx.labelContext(cut.labelId);
  const inputs = inputsAt(w, cut);
  const out = w.ownerList.filter((o) => lc?.visible.ownerIds.has(o.id)).flatMap((o) => ownerBookAt(inputs, o, cut.labelId).positions);
  return out.sort((x, y) => x.ownerName.localeCompare(y.ownerName) || (x.pseudonym ?? '').localeCompare(y.pseudonym ?? ''));
}

type Book = { earned: Decimal; paid: Decimal; adsCharged: Decimal; payable: Decimal };
const FIELDS = ['earned', 'paid', 'adsCharged', 'payable'] as const;
/** The movement of a book between two states (a missing book is zero): earned, paid, ads, the rest of payable, payable. */
function movement(from: Book | undefined, to: Book | undefined) {
  const d = Object.fromEntries(FIELDS.map((k) => [k, (to?.[k] ?? ZERO).minus(from?.[k] ?? ZERO)])) as Record<(typeof FIELDS)[number], Decimal>;
  // the rest: what moved payable besides the income, the payouts and the ads (recoup, adjustments, credits, starts …)
  return { ...d, other: d.payable.minus(d.earned).plus(d.paid).plus(d.adsCharged) };
}

/** Nothing of the owner in the book: every position and every field at zero (the view always names its label's book). */
const emptyBook = (x: { positions: CutPosition[]; book: Book | undefined }) =>
  x.positions.every((p) => p.balance.isZero()) && FIELDS.every((k) => (x.book?.[k] ?? ZERO).isZero());

const unsettledIn = (positions: CutPosition[]) => positions.filter((p) => p.balance.abs().gte(CENT));

/**
 * The signal «незакрытые на срезе» (D-200): every cut (of a label, or of every label) with a position not at zero.
 * Nothing is calculated when there is no cut; `calc` = a full calculation with the operations' documents the caller
 * already has (the overview). The cost is cuts × visible owners × one balance.
 */
export async function unsettledCuts(ctx: Ctx, labelId?: string, calc?: Calculation) {
  const cuts = await ctx.settlements.listCuts(labelId === undefined ? {} : { labelId });
  if (cuts.length === 0) return [];
  const w = await readWorld(ctx, calc);
  const out = [];
  for (const cut of cuts) {
    const unsettled = unsettledIn(await positionsAt(ctx, w, cut)).length;
    if (unsettled > 0) out.push({ cutId: cut.id, labelId: cut.labelId, name: cut.name, cutDate: cut.cutDate, unsettled });
  }
  return out;
}

export function cutsApi(ctx: FacadeContext, writes: Pick<ReturnType<typeof payoutsApi>, 'createOperation'>) {
  const { db, owners, settlements, assertOwnLabel, scopeOf } = ctx;

  return {
    async listCuts(labelId?: string) {
      if (labelId !== undefined) await assertOwnLabel(labelId);
      return settlements.listCuts(labelId === undefined ? {} : { labelId });
    },
    getCut: (id: string) => settlements.getCut(id),
    async createCut(input: { labelId: string; name: string; cutDate: string; masterTo?: string; publishingTo?: string; adsTo?: string; comment?: string }, operator: string) {
      await assertOwnLabel(input.labelId);
      return settlements.createCut({ ...input, createdBy: operator });
    },
    updateCut: (id: string, patch: { name?: string; cutDate?: string; masterTo?: string; publishingTo?: string; adsTo?: string; comment?: string }) =>
      settlements.updateCut(id, patch),
    deleteCut: (id: string) => settlements.deleteCut(id),

    /**
     * The transfer of a position's balance at the cut to after it (D-199): two adjustments of the cut's label with one
     * basis document and one `cut-transfer:` reference, in one transaction, both dated the day after the cut (so the
     * second is inside every later cut, as the first is). The first is attributed to the cut and takes `amount` off the
     * position there (a positive adjustment lowers payable, D-173); the second gives it back after the cut.
     * Deactivating one deactivates both.
     */
    async transferAtCut(cutId: string, input: { ownerId: string; artistId?: string | null; amount: string; documentId: string; comment?: string }) {
      const cut = await settlements.getCut(cutId);
      const amount = new Decimal(input.amount);
      if (amount.isZero()) throw new ValidationError('Nothing to transfer: the amount is zero', undefined, 'transfer_zero');
      const date = new Date(Date.parse(`${cut.cutDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const externalRef = `${CUT_TRANSFER}${randomUUID()}`;
      const comment = input.comment?.trim() || `Перенос на срезе «${cut.name}»`;
      const row = (amt: Decimal, atCut: boolean) =>
        writes.createOperation({
          kind: 'adjustment',
          direction: 'in',
          amount: amt.toFixed(2),
          ownerId: input.ownerId,
          artistId: input.artistId ?? null,
          documentId: input.documentId,
          date,
          comment,
          labelId: cut.labelId,
          externalRef,
          cutId: atCut ? cut.id : null,
        });
      return db.transaction(async () => ({ atCut: await row(amount, true), after: await row(amount.neg(), false) }));
    },

    /** The signal of the cuts (D-200), as a method of its own. */
    unsettledCuts: (labelId?: string) => unsettledCuts(ctx, labelId),

    /**
     * The cuts of one owner (D-200), the page «Срезы» of the owner: per label with cuts (one, or every label the owner
     * has a book in), per cut by date its positions at the cut, the operations attributed to it, and the movement of
     * the book since the previous cut (the difference of the two states: earned, paid, ads, the rest, payable); last,
     * «after the last cut» = now less the last cut. One calculation.
     */
    async ownerCuts(ownerIdIn: string, labelId?: string, viewer: Viewer = ALL_VIEWER) {
      if (labelId !== undefined) await assertOwnLabel(labelId);
      const ownerId = await owners.resolveOwnerId(ownerIdIn);
      if (viewer.kind !== 'all') await scopeOf(viewer).assertOwnerVisible(ownerId); // another label's owner: 404
      const owner = await owners.getOwner(ownerId);
      const cuts = await settlements.listCuts(labelId === undefined ? {} : { labelId });
      const w = cuts.length === 0 ? null : await readWorld(ctx);
      const labels = [...new Set(cuts.map((c) => c.labelId))];
      const now = w ? inputsAt(w, null) : null;
      const pick = (p: CutPosition) => ({ artistId: p.artistId, pseudonym: p.pseudonym, balance: p.balance });
      const out = [];
      for (const L of labels) {
        if (!w || !now) break;
        const nowBook = ownerBookAt(now, owner, L);
        const states = cuts.filter((c) => c.labelId === L).map((cut) => ({ cut, ...ownerBookAt(inputsAt(w, cut), owner, L) }));
        if ([nowBook, ...states].every(emptyBook)) continue; // the owner has nothing in this book
        let prev: Book | undefined;
        const sections = states.map(({ cut, positions, book }) => {
          const section = {
            cut,
            positions: positions.map(pick),
            unsettled: unsettledIn(positions).length,
            operations: w.ops.filter((o) => o.cutId === cut.id && o.ownerId === ownerId),
            movement: movement(prev, book),
          };
          prev = book;
          return section;
        });
        out.push({ labelId: L, cuts: sections, after: { positions: nowBook.positions.map(pick), movement: movement(prev, nowBook.book) } });
      }
      return { ownerId, calculatedAt: new Date().toISOString(), labels: out };
    },

    /** The state of a cut: its positions (`all` = the settled ones too) and their sum. */
    async cutState(id: string, opts: { all?: boolean } = {}) {
      const cut = await settlements.getCut(id);
      const positions = await positionsAt(ctx, await readWorld(ctx), cut);
      const open = unsettledIn(positions);
      return {
        cut,
        calculatedAt: new Date().toISOString(),
        total: positions.reduce((s, p) => s.plus(p.balance), ZERO),
        unsettled: open.length,
        items: opts.all ? positions : open,
      };
    },
  };
}
