import type { CReason } from './api-responses';

/** One label per category C reason (D-127, D-129). Typed by the enum: a new reason does not compile without a label. */
export const REASON_LABELS: Record<CReason, string> = {
  split_unconfirmed: 'split row without an approved document',
  rule_unconfirmed: 'top, carve or sublabel rule without an approved document',
  assumption: 'assumption (a decision not yet backed by an approved document)',
  artist_without_owner: 'artist without an owner',
  owner_unconfirmed: 'owner not confirmed',
  label_unmapped: 'Believe label string not mapped to a label',
  no_split: 'ISRC without a split: the label share waits (D-175)',
  unknown_pair: 'ISRC/UPC pair not in the catalogue',
  no_isrc: 'line without ISRC',
  publishing_terms_unconfirmed: 'publishing terms without an approved document',
  writer_unmapped: 'writer not linked to an owner',
};
