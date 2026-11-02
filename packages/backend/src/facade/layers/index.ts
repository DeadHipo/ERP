import { initialState } from './allocation';
import { labelOfRecord } from './label-of-record';
import { perimeter } from './perimeter';
import { offTheTop } from './off-the-top';
import { split } from './split';
import { carve } from './carve';
import { categorise } from './categorise';
import {
  writerParts,
  type NamedPublishingLayer,
  type PublishingContext,
  type PublishingLine,
  type PublishingPart,
  type PublishingState,
} from './writer-parts';
import { authorShare } from './author-share';
import { publishingCategorise } from './publishing-categorise';
import type { LayerContext, MasterUnit, NamedLayer, UnitState } from './types';

export * from './types';
export { initialState, stateTotal } from './allocation';
export type {
  NamedPublishingLayer,
  PublishingContext,
  PublishingLine,
  PublishingPart,
  PublishingState,
  PublishingTerm,
  PublishingWriter,
} from './writer-parts';
export { DEFAULT_AUTHOR_PERCENT } from './writer-parts';

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

/** The publishing layers in their fixed order (10 §4): writer parts → author share → categorise. */
export const PUBLISHING_LAYERS: readonly NamedPublishingLayer[] = [
  { name: 'writer-parts', run: writerParts },
  { name: 'author-share', run: authorShare },
  { name: 'publishing-categorise', run: publishingCategorise },
];

/** Runs the publishing layers over one aggregated B17 line: a pure fold, no storage access. */
export function allocateLine(
  line: PublishingLine,
  ctx: PublishingContext,
  layers: readonly NamedPublishingLayer[] = PUBLISHING_LAYERS,
): { parts: PublishingPart[]; states: { layer: string; state: PublishingState }[] } {
  let state: PublishingState = { line, parts: [] };
  const states: { layer: string; state: PublishingState }[] = [];
  for (const l of layers) {
    state = l.run(state, ctx);
    states.push({ layer: l.name, state });
  }
  return { parts: state.parts, states };
}
