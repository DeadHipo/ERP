import { initialState } from './allocation';
import { labelOfRecord } from './label-of-record';
import { perimeter } from './perimeter';
import { offTheTop } from './off-the-top';
import { split } from './split';
import { carve } from './carve';
import { categorise } from './categorise';
import type { LayerContext, MasterUnit, NamedLayer, UnitState } from './types';

export * from './types';
export { initialState, stateTotal } from './allocation';

/**
 * The master layers in their fixed order (10 §3): label of record → perimeter → off the top → split → carves (pool,
 * artist share, label share, sublabel) → categorise. The only place the order is written.
 */
export const MASTER_LAYERS: readonly NamedLayer[] = [
  { name: 'label-of-record', run: labelOfRecord },
  { name: 'perimeter', run: perimeter },
  { name: 'off-the-top', run: offTheTop },
  { name: 'split', run: split },
  { name: 'carve', run: carve },
  { name: 'categorise', run: categorise },
];

export interface UnitAllocation {
  state: UnitState;
  /** The state after every layer that ran (the perimeter ends the chain for C units). */
  states: { layer: string; state: UnitState }[];
}

/** Runs the layers over one unit: a pure fold, no storage access. */
export function allocateUnit(
  unit: MasterUnit,
  ctx: LayerContext,
  layers: readonly NamedLayer[] = MASTER_LAYERS,
): UnitAllocation {
  let state = initialState(unit);
  const states: UnitAllocation['states'] = [];
  for (const l of layers) {
    state = l.run(state, ctx);
    states.push({ layer: l.name, state });
    if (state.stopped) break;
  }
  return { state, states };
}
