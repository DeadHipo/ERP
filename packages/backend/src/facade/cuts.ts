import type { CutView } from '../modules/settlements';
import { Decimal, ZERO } from '../shared/money';
import { calculate } from './calculation';
import { ownerBalance, ownerIndex, startsByOwner } from './balance';
import { cutCalculationBy, cutOperationsBy, type CutBounds } from './as-of';
import type { FacadeContext } from './context';

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

export function cutsApi(ctx: FacadeContext) {
  const { db, owners, settlements, modules, opDocIds, assertOwnLabel, labelContext } = ctx;

  const boundsOf = (cut: CutView, all: CutView[]): CutBounds => {
    const dates = new Map(all.map((c) => [c.id, c.cutDate]));
    return { masterTo: cut.masterTo, publishingTo: cut.publishingTo, adsTo: cut.adsTo, date: cut.cutDate, cutDateOf: (id) => dates.get(id) };
  };

  /** Every position of the cut's book at the cut, the settled ones too. */
  async function positionsAt(cut: CutView): Promise<CutPosition[]> {
    const lc = await labelContext(cut.labelId);
    const { list, ops, startRows, cuts } = await db.snapshot(async () => ({
      list: (await owners.listOwners()).filter((o) => lc?.visible.ownerIds.has(o.id)),
      ops: await settlements.listOperations({}),
      startRows: await settlements.listOpeningBalances({ active: true }),
      cuts: await settlements.listCuts({ labelId: cut.labelId }),
    }));
    const bounds = boundsOf(cut, cuts);
    const calc = cutCalculationBy(await calculate(modules, await opDocIds()), bounds);
    const index = ownerIndex(calc);
    const startsOf = startsByOwner(calc, startRows);
    const opsOf = new Map<string, typeof ops>();
    for (const o of cutOperationsBy(ops, bounds)) if (o.ownerId) (opsOf.get(o.ownerId) ?? opsOf.set(o.ownerId, []).get(o.ownerId))?.push(o);
    const out: CutPosition[] = [];
    for (const o of list) {
      const b = ownerBalance(calc, o.id, opsOf.get(o.id) ?? [], {}, { ...(index.get(o.id) ?? { units: [], publishing: [] }), starts: startsOf.get(o.id) ?? [] }, { labelId: cut.labelId });
      for (const a of b.artists) {
        const book = Object.values(a.byLabel).find((x) => x.labelId === cut.labelId);
        if (book) out.push({ ownerId: o.id, ownerName: o.name, artistId: a.artistId, pseudonym: a.pseudonym, balance: book.position });
      }
      const own = Object.values(b.byLabel).find((x) => x.labelId === cut.labelId);
      if (own) out.push({ ownerId: o.id, ownerName: o.name, artistId: null, pseudonym: null, balance: own.ownerPosition });
    }
    return out.sort((x, y) => x.ownerName.localeCompare(y.ownerName) || (x.pseudonym ?? '').localeCompare(y.pseudonym ?? ''));
  }

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

    /** The state of a cut: its positions (`all` = the settled ones too) and their sum. */
    async cutState(id: string, opts: { all?: boolean } = {}) {
      const cut = await settlements.getCut(id);
      const positions = await positionsAt(cut);
      const open = positions.filter((p) => p.balance.abs().gte(CENT));
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
