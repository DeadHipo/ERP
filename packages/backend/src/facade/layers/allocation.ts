import { monthStart, type IsoDate } from '../../shared/dates';
import { sumOf } from './exact';
import type { Allocation, LayerContext, MasterUnit, UnitState } from './types';

/** The report date of a unit: rules are chosen by the first day of the reporting month (D-025). */
export const reportDate = (u: MasterUnit): IsoDate => monthStart(u.reportingMonth);

/** The state before any layer: the whole net is the label share, nothing is allocated. */
export function initialState(unit: MasterUnit): UnitState {
  return {
    unit,
    ourLabelId: null,
    ourLabelName: null,
    rule: null,
    status: 'allocated',
    scaledNet: unit.net,
    rows: [],
    labelShare: unit.net,
    labelShareCategory: 'ours',
    shortfalls: [],
    stopped: false,
  };
}

/** A new allocation to a pseudonym: a merged id is resolved to the surviving artist and its owner. */
export function allocation(
  ctx: LayerContext,
  f: Pick<Allocation, 'artistId' | 'layer' | 'kind' | 'ruleId' | 'documentId' | 'percent' | 'amount'>,
): Allocation {
  const a = ctx.artistIndex.get(f.artistId);
  return {
    ...f,
    artistId: a?.id ?? f.artistId,
    ownerId: a?.ownerId ?? null,
    category: 'B',
    reason: null,
    assumption: null,
  };
}

/** The resolved (surviving) id of a pseudonym. */
export const canonical = (ctx: LayerContext, id: string): string => ctx.artistIndex.get(id)?.id ?? id;

/** Σ allocations + label share: equals the unit net after every layer (the exactness invariant). */
export const stateTotal = (s: UnitState) => sumOf(s.rows.map((r) => r.amount)).add(s.labelShare);
