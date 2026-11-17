import type { CReason } from '@erp/shared/api-responses';
import type { Decimal } from '../../shared/money';
import type { IsoDate } from '../../shared/dates';
import type { LabelOfRecord } from '../../modules/labels';
import type { ParticipationAtDate, SplitAtDate } from '../../modules/splits';

// The pure master layers (docs/agents/10_target_model.md §3): every layer is a function (state, context) -> state
// with no storage access. The context is a plain object built by calculate() from one snapshot of the modules, or
// by hand in the layer tests.

export type { CReason };
export type Category = 'B' | 'C';

/** One unit of calculation: ISRC + UPC + report month + sales month + label string of one Believe account. */
export interface MasterUnit {
  account: string;
  isrc: string;
  upc: string;
  reportingMonth: string;
  salesMonth: string;
  labelName: string;
  net: Decimal;
}

/** Where an allocation comes from: a split row or a participation of a kind (no sublabel rule since D-232). */
export type AllocationKind = 'row' | 'top' | 'artist_pool' | 'artist_share' | 'label_share';

/** Why an allocation is an assumption (C `assumption`): its document (Q11 and R1 of the sublabel rule left with D-232). */
export type AssumptionBasis = 'document';

export interface Allocation {
  /** The recipient pseudonym (merged ids resolved to the surviving artist). */
  artistId: string;
  ownerId: string | null;
  layer: 'split' | 'top' | 'carve';
  kind: AllocationKind;
  /** Split id for a row, participation id for top and carves. */
  ruleId: string;
  /** The document in force for this allocation (a row: its own, else the split's). */
  documentId: string | null;
  percent: Decimal;
  amount: Decimal;
  category: Category;
  reason: CReason | null;
  assumption: AssumptionBasis | null;
}

export type UnitStatus = 'allocated' | 'no_split' | 'unknown_pair' | 'no_isrc';

/** What the label share of a unit is: ours, or C for a reason (unmapped label string, the perimeter, no split: D-175). */
export type LabelShareCategory = 'ours' | 'label_unmapped' | 'no_isrc' | 'unknown_pair' | 'no_split';

/** A carve larger than its bucket takes the bucket; the rest is reported, never created as money (10 §3). */
export interface Shortfall {
  isrc: string;
  upc: string;
  month: string;
  /** The sales month of the unit (the shortfall is per unit: one ISRC-month has one per sales month). */
  salesMonth: string;
  ruleId: string;
  missing: Decimal;
  why: 'bucket_short' | 'no_source_row' | 'top_above_100';
}

export interface UnitState {
  unit: MasterUnit;
  /** The own label whose share this is; null for an unmapped label string. */
  ourLabelId: string | null;
  ourLabelName: string | null;
  status: UnitStatus;
  /** net minus the off-the-top allocations. */
  scaledNet: Decimal;
  rows: Allocation[];
  labelShare: Decimal;
  labelShareCategory: LabelShareCategory;
  shortfalls: Shortfall[];
  /** Set by the perimeter: nothing else runs. */
  stopped: boolean;
}

export interface ArtistInfo {
  id: string;
  pseudonym: string;
  ownerId: string | null;
}

export type DocumentStatusOf = (
  id: string | null | undefined,
) => 'approved' | 'not_approved' | 'not_attached' | 'missing';

/** Everything a layer may know, as plain functions and maps (one snapshot of the modules). */
export interface LayerContext {
  labelOf(labelString: string): LabelOfRecord | undefined;
  labelName(labelId: string): string | undefined;
  /** `isrc|upc` pairs of module 1. */
  knownPairs: Set<string>;
  splitAt(isrc: string, date: IsoDate): SplitAtDate | undefined;
  participationsAt(isrc: string, date: IsoDate): ParticipationAtDate[];
  artistIndex: Map<string, ArtistInfo>;
  documentStatus: DocumentStatusOf;
  documentKind(id: string | null | undefined): string | undefined;
  confirmedOwners: Set<string>;
}

export type Layer = (s: UnitState, ctx: LayerContext) => UnitState;
export interface NamedLayer {
  name: string;
  run: Layer;
}
