import type { CReason, Signals } from '@erp/shared/api-responses';
import type * as Dialogs from './dialogs';

/** The name of an exported dialog component of `./dialogs.tsx`: a typo does not compile. */
export type DialogName = keyof typeof Dialogs;

/**
 * What the operator can do about a queue reason or a signal list (16 sections 2.6 and 2.7, 17 section 6).
 * `action` is the main dialog component; `also` lists the other dialogs of the same row; `information: true` marks a
 * reason or list that has no action by design (the `note` says why). `tests/actions-table.test.ts` checks that every
 * reason and every list has an entry and that each named dialog exists.
 */
export type ActionEntry =
  | { action: DialogName; also?: readonly DialogName[]; information?: false }
  | { information: true; note: string };

export const REASON_ACTIONS: Record<CReason, ActionEntry> = {
  owner_unconfirmed: { action: 'CreateContractDialog', also: ['MergeOwnerDialog'] },
  split_unconfirmed: { action: 'ConfirmSplitDialog' },
  // Groups of the q11 / r1 bases are read-only in the queue (decisions still open); the rest are replaced by a document.
  assumption: { action: 'ReplaceDocumentDialog' },
  artist_without_owner: { action: 'AssignOwnerDialog' },
  label_unmapped: { action: 'LabelAliasDialog', also: ['SublabelRuleDialog'] },
  // An unapproved document is approved; a rule without a document is recreated with one.
  rule_unconfirmed: { action: 'ApproveDocumentDialog', also: ['ReplaceDocumentDialog'] },
  unknown_pair: { action: 'RegisterTrackDialog' },
  // D-175: the label share of an ISRC without a split waits until a split is entered (100 % label included)
  no_split: { action: 'CreateSplitDialog' },
  no_isrc: { information: true, note: 'a report line without an ISRC cannot be fixed on any screen; it is a defect of the source file' },
  writer_unmapped: { action: 'MapWriterDialog' },
  publishing_terms_unconfirmed: { action: 'PublishingTermsDialog' },
};

export type SignalName = Exclude<keyof Signals, 'counts'>;

export const SIGNAL_ACTIONS: Record<SignalName, ActionEntry> = {
  unallocated: { action: 'RegisterTrackDialog' },
  isrcsWithoutSplit: { action: 'CreateSplitDialog' },
  ambiguousWriters: { action: 'MapWriterDialog' },
  unfunded: { action: 'RecreateParticipationDialog' },
  labelUnmapped: { action: 'LabelAliasDialog', also: ['SublabelRuleDialog'] },
  sublabelWithoutRule: { action: 'SetRuleDialog' },
  ruleRecipientIsRow: { action: 'CloseRuleDialog' },
  twoRowsOneOwner: { information: true, note: 'two split rows of one owner on a unit: shown for the head, no action' },
  tracksWithNote: { action: 'NoteDialog' },
  participantsWithoutOwner: { action: 'AssignOwnerDialog' },
  assumptions: { action: 'ReplaceDocumentDialog' },
  operationsWithoutLabel: { action: 'SetOperationLabelDialog' },
  labelOutsideAccount: { information: true, note: 'units of an account that lead to another own label (D-168): the known history, nothing to fix' },
  filesWithoutLabel: { information: true, note: 'loaded Believe files without a label (D-169): marked by the script assign-label-books, nothing to fix here' },
  statementsWithoutLabel: { information: true, note: 'loaded B17 statements without a label (D-169): marked by the script assign-label-books, nothing to fix here' },
  adsWithoutLabel: { action: 'EditAdByIdDialog' },
  adOutsideBook: { action: 'EditAdByIdDialog' },
  catalogOutsideAccount: { information: true, note: 'units whose book is not the catalog label of their month (D-172): a tail on the old account, nothing to fix' },
  tracksWithoutLabel: { action: 'TrackLabelsDialog' },
  releasesIncomplete: { information: true, note: 'D-196: a registry release in the reports with another number of ISRCs than # of track: information, check the release in Believe' },
  releasesUnknown: { information: true, note: 'D-196: UPCs of the reports missing from the release registry of their label: import a fresh Believe export on P7' },
  releasesWithoutDate: { information: true, note: 'D-196: a registry release without a release date: import a fresh Believe export on P7' },
  cutsUnsettled: { information: true, note: 'D-200: a cut with a position not at zero: bring it to zero on the page of the cut (a payout attributed to the cut, an adjustment, a transfer)' },
  operationsDefaultLabel: { action: 'SetOperationLabelDialog' },
  forgivenessReduced: { information: true, note: 'advances whose recorded forgiveness is above the effective one (D-173): income before the date came later; the recoup clamps it, nothing to fix (a link to the advances of the owner)' },
  operationsRelabelled: { information: true, note: 'the number of operations relabelled by the operator (D-173): a counter, nothing to fix' },
};
