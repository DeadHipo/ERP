import { z } from 'zod';
import { SPLIT_IMPORT_ACTIONS, SPLIT_IMPORT_ISSUE_CODES, type SplitImportIssueCode } from './split-import';
import { LABEL_SOURCES, OPERATION_KINDS } from './operation-kinds';
import { OPERATION_IMPORT_ACTIONS, OPERATION_IMPORT_ISSUE_CODES, type OperationImportIssueCode } from './operation-import';
import { START_IMPORT_ACTIONS, START_IMPORT_ISSUE_CODES } from './start-import';

// Response bodies of the JSON API (the contract of /api/v1). Shared by the server (OpenAPI, contract tests) and the
// React client (types). Money and percents are exact decimal strings; dates are YYYY-MM-DD, months YYYY-MM.
// This file must only depend on zod (and the plain lists of this package) so the browser bundle can import it.

const money = z.string().describe('Exact decimal string');

/** What a paged answer adds (D-177): absent on the whole list of a session. */
const pageFields = {
  total: z.number().int().optional().describe('Rows of the whole list, before limit and offset (D-177)'),
  limit: z.number().int().optional().describe('The size of this page (D-177)'),
  offset: z.number().int().optional().describe('The rows skipped before this page (D-177)'),
};
/** A list that is a bare array unless paged: the whole list of a session, or the page (D-177). */
export const listOrPage = <T extends z.ZodType>(item: T) =>
  z.union([
    z.array(item),
    z.object({ total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(item) }),
  ]);
const date = z.string().describe('YYYY-MM-DD');
const month = z.string().describe('YYYY-MM');
const timestamp = z.string().describe('ISO 8601 timestamp');

/** What the fields mean, one text per name (D-178): the same field says the same thing in every answer. */
const D = {
  ownerId: 'Id of the owner (the party who is paid)',
  ownerName: 'Name of the owner',
  artistId: 'Id of the pseudonym (artist)',
  pseudonym: 'The artist name in the registry',
  isrc: 'The ISRC of the recording: splits and money are per ISRC',
  upc: 'The UPC of the release',
  documentId: 'The document that confirms this record; null = none',
  documentStatus: 'not_attached | not_approved | approved | missing: only approved confirms money',
  ruleId: 'Id of the split, participation or label rule',
  reportingMonth: 'The month of the report: splits are chosen by it',
  salesMonth: 'The month of the sales inside the report',
  account: 'The Believe account of the file',
  fileId: 'Id of the Believe file',
  labelName: 'The label by name',
  labelId: 'Id of the own label',
  ourLabelId: 'Id of the own label the Believe label string leads to',
  ourLabelName: 'Name of the own label the Believe label string leads to',
  validFrom: 'First day in force (always the first day of a month)',
  validTo: 'First day no longer in force (exclusive); null = open-ended',
  net: 'Net income, USD',
  gross: 'Gross income, USD',
  quantity: 'Streams or sales of the line',
  platform: 'The store of the line',
  country: 'The country of the line',
  currency: 'The currency of the report',
  subscriptionType: 'The subscription type of the report line',
  salesType: 'The sales type of the report line',
  releaseType: 'The release type of the report line',
  artistName: 'The artist text of the report',
  trackTitle: 'The track title of the report',
  reportId: 'The report id of Believe',
  earned: 'Confirmed income (category B): allocated, with approved documents',
  waiting: 'Money that waits (category C): allocated but not confirmed, not in payable',
  recouped: 'Income kept to repay advances and deductions',
  unrecouped: 'What advances and deductions still have to recoup',
  recoupedFromMaster: 'Part of the master income of this pseudonym consumed by recoupment',
  adsCharged: 'Advertising charged, taken off payable at once (D-157)',
  paid: 'Counted payouts (with a payment proof, or migrated)',
  returns: 'Counted returns of payouts, added back to payable',
  credits: 'Counted credits, added to payable',
  buyouts: 'Counted buyouts: neither paid nor in payable',
  writtenOff: 'Counted publishing write-offs, taken off payable',
  adjustments: '−Σ counted adjustments, added to payable with their sign',
  forgiven: 'The effective forgiveness of advances: reduces what is unrecouped, not payable',
  payable: 'What can be paid today: start + earned − recouped − paid − adsCharged + returns + credits + adjustments − writtenOff; may be negative',
  payableShown: 'What is paid (D-181): Σ of the positive positions of the pseudonyms and of the owner\'s own; max(payable, 0) for an owner with one pseudonym',
  payableNegative: 'Some position is negative: a pseudonym\'s or the owner\'s own (computed by the backend)',
  A_received: 'A: the money received, net of the reports or payable of the statements',
  B_notOurs: 'B: confirmed money of owners',
  C_waiting: 'C: money that waits',
  ourShare: 'The share of the label that is ours',
  labelShare: 'What stays with the label on the unit',
  ours: 'The label share that is ours',
  lineCount: 'Lines of the file',
  netTotal: 'Net of the file',
  grossTotal: 'Gross of the file',
  totalPayable: 'Total Payable of the statement',
  trackCount: 'Tracks of the release',
  hasSplit: 'The ISRC has a split',
  hasParticipations: 'The ISRC has participations',
  catalogLabelName: 'Name of the label of the open label-history interval; not the book',
  bookLabelName: 'Name of the book',
  recipientPseudonym: 'The pseudonym of the sublabel that receives it',
  fromPseudonym: 'The pseudonym funding an artist_share',
  sublabelName: 'The sublabel of the Believe label string',
  writerNorm: 'The writer name as compared',
  displayName: 'The writer name as written',
  resolution: 'How the writer is linked: mapped, unmapped, ambiguous, external',
  recoveredFromArtists: 'The part charged to the pseudonyms',
  borneBySublabels: 'The unrecovered part borne by sublabels',
  borneByUs: 'The unrecovered part borne by the label',
  noSplit: 'Expenses of ISRCs without a split at the month',
  recoveryPercent: 'The part of the expense charged to the pseudonyms',
  unrecovered: 'The part not charged to the pseudonyms',
  paidAlready: 'What the owner was already paid',
  belowThreshold: 'The row is below the payout threshold',
  blockedByOtherLabel: 'A payout of another label blocks this one',
  operationId: 'Id of the operation',
  amountCents: 'Integer cents, USD',
  masterCents: 'The master part, integer cents',
  publishingCents: 'The publishing part, integer cents',
  firstMonth: 'The first report month',
  lastMonth: 'The last report month',
  bookLabelId: 'The book: the own label the file was loaded under',
  periodFrom: 'First month of the period; null = from the start',
  periodTo: 'Last month of the period; null = to the end',
  basis: 'report: months of the reports (default); sales: months of the sales',
  scopeKind: 'any, master, publishing, master_publishing, isrcs: which income may recoup it',
  A: 'A: the money received',
  B: 'B: confirmed money of owners',
  C: 'C: money that waits',
  adId: 'Id of the advertising expense',
  allowed: 'The payout can be made now',
  answeredBy: 'Who answered',
  approvedAt: 'When the document was approved',
  approvedBy: 'Who approved the document',
  area: 'master, publishing or all',
  assumptionBasis: 'Why it waits as an assumption: document, or the council rules q11, r1; null = not an assumption',
  bookBMatches: 'bookB equals reconciliationB',
  catalogNumber: 'The catalog number of the release',
  channel: 'The payment channel',
  confirmed: 'The owner has an approved contract or label decision',
  counted: 'The operation counts in the money',
  decision: 'pay: pay the amount; pay_task: pay after the task named in why',
  defaultLabelOperations: 'Operations under the default label of the history',
  discrepancy: 'A − B − C − ours: must be 0',
  externalRef: 'The id in the outer system; a repeat import is skipped by it',
  fromId: 'The id merged away',
  intoId: 'The id that survived',
  fundedFrom: 'The bucket the participation is funded from',
  generatedAtSource: 'The generation time as written in the statement',
  inactive: 'Deactivated rows',
  incomeBookLabelName: 'Name of the book of the ISRC income',
  isrcsInUnits: 'Distinct ISRCs of the UPC in the units',
  label: 'The label by name',
  layer: 'The name of the layer',
  mergedLines: 'How many lines of the report were summed',
  meaning: 'The alias of the kind before D-173',
  migration: 'Carried over from the old system',
  missing: 'The part the bucket could not fund: it is not money',
  operator: 'The login of the operator',
  origin: 'How the record appeared (a loader, the operator)',
  ourShareNoSplit: 'The label share of the units without a split: it waits in C no_split',
  participationId: 'Id of the participation',
  payableExact: 'payable before it was floored to cents',
  percent: 'The percent applied',
  period: 'The period it is about',
  reason: 'Why, as entered',
  recipientArtistId: 'The pseudonym of the sublabel that receives it',
  relabelledOperations: 'Operations the operator relabelled',
  releaseTitle: 'The release title of the report',
  releasedReason: 'Why the hold was released',
  reportTitle: 'The title in the report',
  role: 'holder: the rights-holder; songwriter: an author',
  rowKind: 'pseudonym: one nick; owner: the publishing of the owner; total: the owner in the book, with payable and the gate',
  shareOfPayout: 'The part of this payout',
  source: 'Where the record came from',
  splitId: 'Id of the split',
  start: 'The opening balance (D-174)',
  statementId: 'Id of the B17 statement',
  stores: 'Stores of the release',
  territories: 'Territories of the release',
  trackId: 'Id of the track',
  units: 'Units of calculation (ISRC, UPC, report month, sales month)',
  withoutIsrc: 'The part of lines without an ISRC',
  advances: 'Counted advances inside the start',
  operations: 'Counted operations inside the start',
  participations: 'Participations that name this artist',
  rows: 'All rows',
} as const;

// ---- category C reasons ----

/**
 * Why money waits (category C), one list for the reconciliation, the balance and the pages (D-127). Master:
 * split_unconfirmed, rule_unconfirmed, assumption, artist_without_owner, owner_unconfirmed, label_unmapped,
 * unknown_pair, no_isrc; publishing: writer_unmapped, publishing_terms_unconfirmed (owner_unconfirmed too).
 */
export const C_REASONS = [
  'split_unconfirmed',
  'rule_unconfirmed',
  'assumption',
  'artist_without_owner',
  'owner_unconfirmed',
  'label_unmapped',
  'no_split',
  'unknown_pair',
  'no_isrc',
  'publishing_terms_unconfirmed',
  'writer_unmapped',
] as const;
export const cReasonSchema = z.enum(C_REASONS);
export type CReason = z.infer<typeof cReasonSchema>;
const cBreakdown = z.partialRecord(cReasonSchema, money).describe('Category C by reason');

// ---- errors ----

export const errorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    statusCode: z.number().int(),
    details: z.unknown().optional(),
    /** The id of the request (also the header `X-Request-Id`); always present on a 500 (D-170). */
    requestId: z.string().optional(),
  }),
});

// ---- module 1: owners, artists, tracks, documents, contracts ----

export const ownerSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['label', 'person']).describe('person, or a label: a sublabel, a company, a buyer'),
  ipi: z.string().nullable().describe('The IPI number of a writer'),
  status: z.enum(['confirmed', 'waiting_documents']).describe('confirmed: has an approved contract; waiting_documents: its money waits'),
  origin: z.string().describe('How the record appeared (a loader, the operator)'),
  aliases: z.array(z.string()).describe('Other names of the owner, used to link writers'),
  createdAt: timestamp,
});
export type Owner = z.infer<typeof ownerSchema>;

export const trackSchema = z.object({
  id: z.string(),
  isrc: z.string().nullable().describe(D.isrc),
  upc: z.string().nullable().describe(D.upc),
  title: z.string(),
  note: z.string().nullable(),
});
export type Track = z.infer<typeof trackSchema>;

export const artistSchema = z.object({
  id: z.string(),
  pseudonym: z.string().describe(D.pseudonym),
  ownerId: z.string().nullable().describe(D.ownerId),
  status: z.enum(['confirmed', 'unconfirmed', 'no_owner']).describe('The state of the owner of the pseudonym: confirmed, unconfirmed, or no owner at all'),
  origin: z.string().describe('How the record appeared (a loader, the operator)'),
});
export type Artist = z.infer<typeof artistSchema>;

/**
 * The artist list resolves merges, so it has no `origin`. A row of P11 (D-167): the owner, the ids merged into it, the
 * distinct tracks it is on, its open split rows and participations, the contracts naming it, the open rows without a
 * document. No money (`GET /artists/balances`).
 */
export const artistListItemSchema = artistSchema.omit({ origin: true }).extend({
  owner: z.object({ id: z.string(), name: z.string(), status: z.enum(['confirmed', 'waiting_documents']) }).nullable(),
  previousIds: z.number().int().describe('How many other ids the pseudonym had (merged into it)'),
  tracks: z.number().int().describe('Distinct tracks the pseudonym is on: registry links, split rows and participations, by every id'),
  splitRows: z.number().int().describe('Split rows of the pseudonym not closed by today'),
  participations: z.number().int().describe('Participations of the pseudonym not closed by today'),
  contracts: z.number().int().describe('Contracts of its owner that name the pseudonym'),
  undocumented: z.number().int().describe('Open split rows and participations without a document (their money waits)'),
});
export type ArtistListItem = z.infer<typeof artistListItemSchema>;

/**
 * A pseudonym of the registry named by a catalog row (D-166): the surviving id (merges resolved) and its pseudonym.
 * The pseudonyms of an ISRC are those of its split rows and participations (any period) and its registry links.
 */
export const artistRefSchema = z.object({ id: z.string(), pseudonym: z.string().describe(D.pseudonym) });
export type ArtistRef = z.infer<typeof artistRefSchema>;
const artistRefs = z.array(artistRefSchema).describe('The pseudonyms of the registry on the ISRC (split rows, participations, registry links), by pseudonym');

export const documentSchema = z.object({
  id: z.string(),
  kind: z.string().describe('contract, appendix, assumption (a council decision, never approved), label_decision, buyout and others'),
  title: z.string(),
  fileRef: z.string().nullable().describe('The attached file; null = not attached'),
  ownerId: z.string().nullable().describe(D.ownerId),
  requiresApproval: z.boolean().describe('A manager has to approve it'),
  status: z.enum(['not_attached', 'not_approved', 'approved']).describe('Only approved confirms money'),
  approvedAt: timestamp.nullable().describe(D.approvedAt),
  uploadDeadline: date.nullable().describe('Shown only: nothing happens when it passes'),
  migration: z.boolean().describe('Carried over from the old system'),
  createdAt: timestamp,
  labelId: z
    .string()
    .nullable()
    .describe('The own label of the document (D-169); null = any label. A contract opens the label of its document'),
});
export type DocumentView = z.infer<typeof documentSchema>;

export const contractSchema = z.object({
  id: z.string(),
  number: z.string().nullable().describe('The number of the contract (often none)'),
  documentId: z.string().describe('The document of the contract: approved, it confirms the owner'),
  artistIds: z.array(z.string()).describe('The pseudonyms the contract names'),
});

/** `POST /contracts`: the created contract with its owner. */
export const createdContractSchema = contractSchema.extend({ ownerId: z.string().describe(D.ownerId) });

/** `details` of 409 `possible_duplicate` (`POST /owners`, `POST /artists`): the similar live records. */
export const possibleDuplicateDetailsSchema = z.object({
  similar: z.array(z.object({ id: z.string(), name: z.string(), matchedBy: z.array(z.string()) })),
});

export const publishingTermsSchema = z.object({
  id: z.string(),
  ownerId: z.string().describe(D.ownerId),
  percent: z.string().describe('The author percent'),
  validFrom: date.describe(D.validFrom),
  validTo: date.nullable().describe(D.validTo),
  documentId: z.string().nullable().describe(D.documentId),
  operationType: z.string().nullable().describe('The B17 operation type the terms apply to; null = every type'),
  createdAt: timestamp,
});

export const ownerDetailSchema = z.object({
  owner: ownerSchema,
  artists: z.array(artistSchema.extend({ tracks: z.array(trackSchema) })),
  documents: z.array(documentSchema),
  contracts: z.array(contractSchema),
  publishingTerms: z.array(publishingTermsSchema),
});
export type OwnerDetail = z.infer<typeof ownerDetailSchema>;

// ---- splits ----

export const splitSchema = z.object({
  id: z.string(),
  isrc: z.string().describe(D.isrc),
  validFrom: date.describe(D.validFrom),
  validTo: date.nullable().describe('Exclusive; null = open-ended'),
  documentId: z.string().nullable().describe(D.documentId),
  origin: z.string().describe(D.origin),
  note: z.string().nullable(),
  shares: z.array(z.object({ artistId: z.string().describe(D.artistId), percent: z.string().describe('The share of net'), documentId: z.string().nullable().describe(D.documentId) })).describe('The artist rows; a row without an approved document waits'),
  ourShare: z.string().describe('100 minus the sum of the shares: the percent of the label; never stored'),
});

export const participationSchema = z.object({
  id: z.string(),
  isrc: z.string().describe(D.isrc),
  artistId: z.string().describe(D.artistId),
  percent: z.string().describe('The percent of the base'),
  base: z.enum(['net', 'bucket']).describe('net: of the net of the unit; bucket: of the bucket it is funded from'),
  fundedFrom: z.enum(['top', 'artist_pool', 'artist_share', 'label_share']).describe('Where the money comes from: off the top, the artist rows, one artist, or the label share').describe(D.fundedFrom),
  fromArtistId: z.string().nullable().describe('The pseudonym funding an artist_share'),
  validFrom: date.describe(D.validFrom),
  validTo: date.nullable().describe('Exclusive; null = open-ended'),
  documentId: z.string().nullable().describe(D.documentId),
  origin: z.string().describe(D.origin),
  note: z.string().nullable(),
});
export const participationListSchema = z.object({
  total: z.number().int(),
  items: z.array(
    participationSchema.extend({
      documentStatus: z.string().describe('not_attached | not_approved | approved | missing'),
      pseudonym: z.string().describe(D.pseudonym),
      ownerId: z.string().nullable().describe(D.ownerId),
      fromPseudonym: z.string().nullable().describe(D.fromPseudonym),
    }),
  ),
});
export type ParticipationListItem = z.infer<typeof participationListSchema>['items'][number];

// ---- labels ----

export const labelRuleSchema = z.object({
  id: z.string(),
  labelId: z.string().describe(D.labelId),
  percent: z.string().describe('The percent of the label share'),
  recipientArtistId: z.string().describe('The pseudonym of the sublabel that receives it'),
  validFrom: date.describe(D.validFrom),
  validTo: date.nullable().describe('Exclusive; null = open-ended'),
  documentId: z.string().nullable().describe(D.documentId),
  note: z.string().nullable(),
});
export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['own', 'sublabel']).describe('own: ours, it has a book; sublabel: an imprint under an own label'),
  ownLabelId: z.string().nullable().describe('The own label of a sublabel'),
  aliases: z.array(z.string()).describe('Believe label strings that lead to this label'),
  rules: z.array(labelRuleSchema).describe('Sublabel rules: the share of a sublabel by period'),
  accounts: z.array(z.string()).describe('The Believe accounts registered under the own label (D-168); empty for a sublabel'),
});
export const labelListItemSchema = labelSchema.extend({
  rules: z.array(
    labelRuleSchema.extend({
      recipientPseudonym: z.string().describe(D.recipientPseudonym),
      documentStatus: z.string().describe('not_attached | not_approved | approved | missing'),
    }),
  ),
});
export type LabelListItem = z.infer<typeof labelListItemSchema>;

export const splitListItemSchema = splitSchema.extend({
  documentStatus: z.string().describe('not_attached | not_approved | approved | missing'),
  shares: z.array(
    z.object({
      artistId: z.string().describe(D.artistId),
      percent: z.string().describe('The share of net'),
      documentId: z.string().nullable().describe(D.documentId),
      pseudonym: z.string().describe(D.pseudonym),
      ownerId: z.string().nullable().describe(D.ownerId),
    }),
  ),
});
export type SplitListItem = z.infer<typeof splitListItemSchema>;

export const splitListSchema = z.object({ total: z.number().int(), items: z.array(splitListItemSchema) });

// ---- the split import (D-172, P28) ----

const importIssue = z.object({
  code: z.enum(SPLIT_IMPORT_ISSUE_CODES as [SplitImportIssueCode, ...SplitImportIssueCode[]]),
  severity: z.enum(['error', 'warning', 'info']),
  details: z.record(z.string(), z.unknown()).optional(),
});
/** One data row of the import file as read (the floored dates shown, M52) with its classes. */
export const splitImportRowSchema = z.object({
  line: z.number().int().describe('Line of the file (the header is line 1)'),
  isrc: z.string().describe(D.isrc),
  pseudonym: z.string().describe(D.pseudonym),
  artistId: z.string().nullable().describe('The existing pseudonym (by artist_id or the one exact name); null = new or unresolved'),
  percent: z.string().describe(D.percent),
  from: z.string(),
  fromFloored: date.nullable(),
  to: z.string().nullable(),
  toFloored: date.nullable(),
  owner: z.string().nullable(),
  documentId: z.string().nullable().describe(D.documentId),
  group: z.string().describe('The key of its group: ISRC|floored from'),
  issues: z.array(importIssue),
});
/** One group = one split: what the apply does with it. */
export const splitImportGroupSchema = z.object({
  key: z.string(),
  isrc: z.string().describe(D.isrc),
  from: date,
  to: date.nullable(),
  action: z.enum(SPLIT_IMPORT_ACTIONS),
  ourShare: z.string().describe(D.ourShare),
  documentId: z.string().nullable().describe('The document of the split (all rows name the same one), else null'),
  before: z
    .array(z.object({ artistId: z.string().describe(D.artistId), pseudonym: z.string().describe(D.pseudonym), percent: z.string().describe(D.percent), documentId: z.string().nullable().describe(D.documentId) }))
    .nullable()
    .describe('The rows in force at `from` that a change replaces'),
});
export const splitImportSchema = z.object({
  labelId: z.string().describe(D.labelId),
  fileName: z.string(),
  sha256: z.string(),
  dryRun: z.boolean(),
  applied: z.boolean(),
  totals: z.object({
    rows: z.number().int().describe(D.rows),
    groups: z.number().int(),
    create: z.number().int(),
    change: z.number().int(),
    unchanged: z.number().int(),
    errors: z.number().int(),
    warnings: z.number().int(),
    artistsNew: z.number().int(),
    ownersNew: z.number().int(),
  }),
  rows: z.array(splitImportRowSchema),
  groups: z.array(splitImportGroupSchema),
  result: z
    .object({ splitIds: z.array(z.string()), artistIds: z.array(z.string()), ownerIds: z.array(z.string()) })
    .nullable()
    .describe('The created records of an apply; null in a preview'),
});

/** `GET /artists/:id` (P12, D-165): the card of a pseudonym; a merged id answers for the surviving one. */
export const artistDetailSchema = z.object({
  artist: artistSchema,
  merged: z.boolean().describe('The requested id was merged into `artist` (the survivor)'),
  previousIds: z.array(z.string()).describe('Every other id the pseudonym had (merged into it)'),
  merges: z.array(z.object({ fromId: z.string().describe(D.fromId), intoId: z.string().describe(D.intoId), reason: z.string().describe(D.reason), at: timestamp })),
  owner: ownerSchema.nullable(),
  tracks: z.array(trackSchema),
  contracts: z.array(contractSchema).describe('The contracts of the owner that name the pseudonym'),
  splits: z.array(splitListItemSchema).describe('Every split with a row of the pseudonym (any period, every id)'),
  participations: z.array(participationListSchema.shape.items.element),
  labelRules: z.array(labelListItemSchema.shape.rules.element.extend({ labelName: z.string().describe(D.labelName) })).describe('Sublabel rules whose recipient is the pseudonym'),
  documents: z.array(documentSchema).describe('The documents the splits, rows, participations, contracts and rules above cite'),
});
export type ArtistDetail = z.infer<typeof artistDetailSchema>;

// ---- sources (Believe) and publishing (B17) ----

export const sourceFileSchema = z.object({
  id: z.string(),
  source: z.string().describe(D.source),
  account: z.string().describe(D.account),
  reportingMonth: month.describe(D.reportingMonth),
  reportId: z.string().nullable().describe(D.reportId),
  fileName: z.string(),
  sha256: z.string(),
  status: z.enum(['loading', 'loaded', 'failed', 'superseded']),
  lineCount: z.number().int().nullable().describe(D.lineCount),
  netTotal: money.nullable().describe(D.netTotal),
  grossTotal: money.nullable().describe(D.grossTotal),
  uploadedBy: z.string().describe('The operator (X-Operator) who uploaded the file, or the loading script'),
  labelId: z.string().nullable().describe('The own label the file was loaded under (D-169); null = loaded before the labels'),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const statementSchema = z.object({
  id: z.string(),
  source: z.string().describe(D.source),
  periods: z.array(z.string()),
  fileName: z.string(),
  sha256: z.string(),
  generatedAt: timestamp,
  generatedAtSource: z.string().describe(D.generatedAtSource),
  uploadedAt: timestamp,
  status: z
    .enum(['loaded', 'superseded', 'failed'])
    .describe('loaded = counted; superseded = replaced by a corrected file of the same quarters, its lines kept (D-173)'),
  lineCount: z.number().int().describe(D.lineCount),
  totalPayable: money.describe(D.totalPayable),
  warnings: z.array(z.string()),
  labelId: z.string().nullable().describe('The own label the statement was loaded under (D-169); null = loaded before the labels'),
  replacedBy: z.string().nullable().describe('The statement that replaced this one (D-173); null = not replaced'),
});

export const sourceFilesSchema = z.object({
  believe: z.array(sourceFileSchema),
  b17: z.array(statementSchema),
});

const fileRefSchema = z.object({
  id: z.string(),
  account: z.string().describe(D.account),
  reportingMonth: month.describe(D.reportingMonth),
  fileName: z.string(),
});

export const sourceLineSchema = z.object({
  fileId: z.string().describe(D.fileId),
  account: z.string().describe(D.account),
  reportingMonth: month.describe(D.reportingMonth),
  salesMonth: month.describe(D.salesMonth),
  platform: z.string().describe(D.platform),
  country: z.string().describe(D.country),
  isrc: z.string().describe(D.isrc),
  upc: z.string().describe(D.upc),
  currency: z.string().describe(D.currency),
  subscriptionType: z.string().describe(D.subscriptionType),
  salesType: z.string().describe(D.salesType),
  releaseType: z.string().describe(D.releaseType),
  quantity: z.string().describe(D.quantity),
  gross: money.describe(D.gross),
  net: money.describe(D.net),
  mergedLines: z.string().describe('How many lines of the report were summed into this one'),
  artistName: z.string().describe(D.artistName),
  trackTitle: z.string().describe(D.trackTitle),
});

export const sourceLinesPageSchema = z.object({
  files: z.array(fileRefSchema),
  items: z.array(sourceLineSchema),
  total: z.object({
    keys: z.string(),
    quantity: z.string().describe(D.quantity),
    gross: money.describe(D.gross),
    net: money.describe(D.net),
    mergedLines: z.string().describe(D.mergedLines),
  }),
  limit: z.number().int(),
  offset: z.number().int(),
  sort: z.string(),
  dir: z.enum(['asc', 'desc']),
});

export const sourceFacetsSchema = z.object({
  files: z.array(fileRefSchema),
  platforms: z.array(z.string()),
  countries: z.array(z.string()),
  subscriptionTypes: z.array(z.string()),
  salesTypes: z.array(z.string()),
  releaseTypes: z.array(z.string()),
});

export const publishingWriterSchema = z.object({
  writerNorm: z.string().describe(D.writerNorm),
  displayName: z.string().describe(D.displayName),
  ownerId: z.string().nullable().describe(D.ownerId),
  resolution: z.string().describe(D.resolution),
  role: z.enum(['holder', 'songwriter']).describe(D.role),
});

export const resolveWritersSchema = z.object({
  matched: z.number().int(),
  created: z.number().int(),
  ambiguous: z.number().int(),
  external: z.number().int(),
});

/** Publishing v2 (D-182): the report summaries as they are, no owner, no share. */
export const pubV2FileSchema = z.object({
  id: z.string(),
  labelId: z.string().describe(D.labelId),
  fileName: z.string(),
  sha256: z.string(),
  source: z.enum(['b17']).describe('The report the file comes from'),
  format: z.string().describe('Which layout was read: periods, blocks or flat'),
  periods: z.array(z.string()).describe('The quarters of the file, like 2026-Q2'),
  status: z.enum(['loaded', 'superseded']).describe('loaded = counted; superseded = replaced by a later file'),
  replacedBy: z.string().nullable().describe('Id of the file that replaced this one; null = none'),
  rowCount: z.number().int().describe('Rows read from the summary: one per songwriter, song and quarter'),
  payable: money.describe('Sum of the rows read, USD'),
  declaredPayable: money.nullable().describe('The total the file names itself, USD; null = it names none'),
  difference: money.nullable().describe('payable minus declaredPayable, USD: a check of the reading; null = no declared total'),
  uploadedAt: timestamp,
});

export const pubV2RemovedSchema = z.object({ id: z.string() });

export const pubV2SongwriterSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).describe('Every spelling of the name seen in the reports'),
  songs: z.number().int().describe('Songs with accruals in the loaded files'),
  periods: z.array(z.string()).describe('Quarters with accruals, like 2026-Q2'),
  payable: money.describe('Sum payable by the reports over the loaded files, USD: what came in, not what is owed'),
});

export const pubV2SongwriterDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).describe('Every spelling of the name seen in the reports'),
  periods: z
    .array(
      z.object({
        period: z.string().describe('The quarter, like 2026-Q2'),
        gross: money.nullable().describe('Gross by the report, USD; null = the report does not name it'),
        withholding: money.nullable().describe('Withholding by the report, USD; null = the report does not name it'),
        payable: money.describe('Payable by the report, USD'),
      }),
    )
    .describe('The accruals of the songwriter per quarter'),
  songs: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        payable: money.describe('Payable by the reports over all quarters, USD'),
        periods: z
          .array(z.object({ period: z.string().describe('The quarter, like 2026-Q2'), payable: money.describe('Payable by the report, USD') }))
          .describe('The song per quarter'),
      }),
    )
    .describe('The songs of the songwriter, largest first'),
});

/** The links of publishing v2 to owners (D-183): the decision of the operator and a recommendation that decides nothing. */
export const pubV2LinkSchema = z.object({
  songwriterId: z.string().describe('Id of the songwriter of publishing v2'),
  name: z.string(),
  payable: money.describe('Sum payable by the reports over the loaded files, USD: what came in, not what is owed'),
  link: z
    .object({
      ownerId: z.string().describe(D.ownerId),
      ownerName: z.string().describe(D.ownerName),
      source: z.enum(['recommended', 'manual']).describe('recommended = the operator confirmed the suggestion; manual = chose the owner'),
      decidedBy: z.string().describe('The operator who decided'),
      decidedAt: timestamp,
      terms: z
        .array(
          z.object({
            id: z.string().describe('Id of the term'),
            percent: z.string().describe('The author percent, 0..100'),
            validFrom: date,
            validTo: date.nullable().describe('YYYY-MM-DD, exclusive; null = open-ended'),
            documentId: z.string().nullable().describe(D.documentId),
          }),
        )
        .describe('The terms of the owner, oldest first; a term is never edited'),
    })
    .nullable()
    .describe('The confirmed link; null = none yet'),
  recommendation: z
    .object({
      ownerId: z.string().describe(D.ownerId),
      ownerName: z.string().describe(D.ownerName),
      reason: z
        .enum(['songs', 'old_map', 'exact_name', 'same_words'])
        .describe('songs = the owner behind most of its songs (title → track → split → pseudonym); old_map = the writer map of the old module; exact_name = one person-owner with this name or alias; same_words = one with the same words in another order'),
      hasTerms: z.boolean().describe('The suggested owner has a publishing term'),
    })
    .nullable()
    .describe('A suggestion only; null = none'),
  songs: z.number().int().describe('Songs of the songwriter in the reports'),
  songCandidates: z
    .array(
      z.object({
        ownerId: z.string().describe(D.ownerId),
        ownerName: z.string().describe(D.ownerName),
        songs: z.number().int().describe('Songs of the songwriter whose tracks have a pseudonym of this owner in the split'),
        hasTerms: z.boolean().describe('The owner has a publishing term'),
      }),
    )
    .describe('At most three owners behind the songs, the most songs first; a suggestion only'),
});

export const pubV2TermSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  percent: z.string(),
  validFrom: date,
  validTo: date.nullable(),
  documentId: z.string().nullable(),
  isrc: z.string().nullable().describe('D-192: the track of the term; null = the owner\'s own percent'),
  basis: z.string().nullable(),
  decidedBy: z.string(),
  createdAt: timestamp,
});

/** D-192: what decides the percent of a song today. */
export const pubV2SongTermsSchema = z
  .object({
    state: z
      .enum(['owner', 'isrc', 'conflict'])
      .describe('owner = the owner\'s own percent; isrc = a term of its ISRCs; conflict = its ISRCs disagree, the money waits'),
    percent: z.string().nullable().describe('The percent in force today; null = none (conflict, or no term)'),
    ownerPercent: z.string().nullable().describe('The owner\'s own percent today'),
  })
  .describe('The term of the song today (D-192)');

export const pubV2TermCancelSchema = z.object({ id: z.string(), reopened: z.string().nullable() });

export const pubV2LinkResultSchema = z.object({
  songwriterId: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  source: z.enum(['recommended', 'manual']),
  decidedBy: z.string(),
  decidedAt: timestamp,
});

/** The links of the songs of publishing v2 to recordings (D-184). */
export const pubV2SongSchema = z.object({
  songId: z.string().describe('Id of the song of publishing v2'),
  title: z.string(),
  songwriterId: z.string().describe('Id of the songwriter of publishing v2'),
  songwriter: z.string().describe('The name of the songwriter in the reports'),
  ownerId: z.string().nullable().describe('The confirmed owner of the songwriter; null = no link yet'),
  ownerName: z.string().nullable().describe('Name of that owner'),
  payable: money.describe('Sum payable by the reports over the loaded files, USD: what came in, not what is owed'),
  isrcs: z.array(z.string()).describe('The ISRCs the operator confirmed for the song'),
  candidates: z.number().int().describe('Tracks of the catalog with this title'),
  ownerCandidates: z.number().int().describe('Of them, tracks whose open split has a pseudonym of the linked owner'),
  terms: pubV2SongTermsSchema,
});

export const pubV2SongCandidatesSchema = z.object({
  songId: z.string().describe('Id of the song of publishing v2'),
  title: z.string(),
  ownerId: z.string().nullable().describe('The owner of the songwriter; null = no link yet'),
  ownerName: z.string().nullable().describe('Name of that owner'),
  terms: pubV2SongTermsSchema,
  isrcTerms: z
    .array(
      z.object({
        id: z.string(),
        isrc: z.string().describe(D.isrc),
        percent: z.string().describe('The percent of the owner on the songs of this track'),
        validFrom: date,
        validTo: date.nullable(),
        documentId: z.string().nullable().describe('The document of the term; without an approved one the money waits'),
        basis: z.string().nullable().describe('What the term rests on (the contract, the share sold)'),
        decidedBy: z.string().describe('Who set the term'),
      }),
    )
    .describe('D-192: the live terms of the owner on the confirmed ISRCs of the song, by ISRC and date'),
  candidates: z
    .array(
      z.object({
        isrc: z.string().describe(D.isrc),
        title: z.string(),
        artists: z.array(z.string()).describe('The pseudonyms of the open split of the track'),
        reason: z.enum(['owner', 'title']).describe('owner = a pseudonym of the linked owner is in the split; title = only the title matches'),
        coAuthors: z
          .array(z.string())
          .describe('Other songwriters whose songs the operator already linked to this ISRC (co-authorship, D-191)'),
      }),
    )
    .describe('Tracks of the catalog with this title: the linked owner first, then those of a co-author; a suggestion only'),
  isrcs: z
    .array(
      z.object({
        isrc: z.string().describe(D.isrc),
        title: z.string(),
        source: z.enum(['recommended', 'manual']).describe('recommended = taken from the candidates; manual = entered by the operator'),
      }),
    )
    .describe('The ISRCs the operator confirmed'),
});

export const pubV2SongIsrcsResultSchema = z.object({ songId: z.string(), isrcs: z.array(z.string()) });

export const b17UploadSchema = z.object({ statement: statementSchema, writers: resolveWritersSchema });

// ---- reports ----

export const reconciliationRowSchema = z.object({
  source: z.enum(['believe', 'b17']).describe(D.source),
  account: z.string().describe('Believe account of the files; "b17" for publishing'),
  month,
  A_received: money.describe(D.A_received),
  B_notOurs: money.describe(D.B_notOurs),
  C_waiting: money.describe(D.C_waiting),
  C_breakdown: cBreakdown,
  ourShare: money.describe('Σ of the label shares that are ours (the layer state)'),
  ourShareByLabel: z.record(z.string(), money).describe('ourShare per our label of record (name)'),
  ourShareNoSplit: money.describe('The label share of the units without a split: in C `no_split` since D-175 (before: part of ourShare)'),
  discrepancy: money.describe('A − B − C − ours: must be 0'),
  fileTotal: money.nullable().describe('The total of the files of the row; null = unknown'),
  fileDiscrepancy: money.nullable().describe('A_received − fileTotal; null without a file total'),
  byLabel: z
    .record(z.string(), z.object({ A_received: money.describe(D.A_received), B_notOurs: money.describe(D.B_notOurs), C_waiting: money.describe(D.C_waiting), ourShare: money.describe(D.ourShare), ourShareNoSplit: money.describe(D.ourShareNoSplit) }))
    .describe(
      "The row per book (by name, '?' = without a label): a Believe row is the book of the label its files were loaded under, one key (D-169); Σ over the books = the row (D-168)",
    ),
});
export type ReconciliationRow = z.infer<typeof reconciliationRowSchema>;

export const signalsSchema = z.object({
  counts: z
    .record(z.string(), z.number().int())
    .describe('Full length of every list (the lists are cut to `limit`)'),
  unallocated: z.object({
    total: money,
    withoutIsrc: money.describe(D.withoutIsrc),
    count: z.number().int(),
    pairs: z.array(
      z.object({
        isrc: z.string().describe(D.isrc),
        upc: z.string().describe(D.upc),
        net: money.describe(D.net),
        months: z.array(z.string()),
        reportTitle: z.string().describe(D.reportTitle),
      }),
    ),
  }),
  isrcsWithoutSplit: z.object({
    count: z.number().int(),
    items: z.array(z.object({ isrc: z.string().describe(D.isrc), net: money.describe(D.net) })),
  }),
  ambiguousWriters: z.array(z.object({ writerNorm: z.string().describe(D.writerNorm), displayName: z.string().describe(D.displayName) })),
  unfunded: z
    .array(
      z.object({
        isrc: z.string().describe(D.isrc),
        upc: z.string().describe(D.upc),
        month,
        salesMonth: month.describe('The sales month of the unit (a shortfall is per unit)'),
        ruleId: z.string().describe(D.ruleId),
        artistId: z.string().describe('The participation recipient (the rule id is a participation id)'),
        pseudonym: z.string().describe(D.pseudonym),
        fundedFrom: z.string().nullable().describe('The bucket the participation is funded from'),
        missing: money.describe(D.missing),
        why: z.enum(['bucket_short', 'no_source_row', 'top_above_100']).describe('Why the carve is short'),
      }),
    )
    .describe('Carves larger than their bucket: the missing part is not money (10 §3)'),
  labelUnmapped: z.array(z.object({ labelName: z.string().describe(D.labelName), net: money.describe(D.net) })),
  sublabelWithoutRule: z
    .array(z.object({ label: z.string().describe(D.label), month, net: money.describe(D.net) }))
    .describe('Units of a sublabel with no rule in force at the report month (the imprint has no deal yet)'),
  ruleRecipientIsRow: z
    .array(z.object({ isrc: z.string().describe(D.isrc), artistId: z.string().describe(D.artistId), pseudonym: z.string().describe(D.pseudonym), month }))
    .describe('The sublabel rule recipient also has a split row on the same unit: the double-pay shape'),
  twoRowsOneOwner: z
    .array(z.object({ isrc: z.string().describe(D.isrc), ownerId: z.string().describe(D.ownerId), month, pseudonyms: z.array(z.string()) }))
    .describe('Two split rows of one ISRC-month belong to pseudonyms of the same owner (information only)'),
  tracksWithNote: z.array(
    z.object({
      trackId: z.string().describe(D.trackId),
      isrc: z.string().nullable().describe(D.isrc),
      upc: z.string().nullable().describe(D.upc),
      title: z.string(),
      note: z.string(),
    }),
  ),
  participantsWithoutOwner: z.array(
    z.object({
      participationId: z.string().describe(D.participationId),
      isrc: z.string().describe(D.isrc),
      artistId: z.string().describe(D.artistId),
      pseudonym: z.string().describe(D.pseudonym),
      fundedFrom: z.string().describe(D.fundedFrom),
      amount: money,
    }),
  ),
  assumptions: z.array(
    z.object({
      documentId: z.string().nullable().describe(D.documentId),
      basis: z.enum(['document', 'q11', 'r1']).describe('Why it is an assumption: document, or the council rules q11, r1'),
      amount: money,
      isrcs: z.array(z.string()),
    }),
  ),
  operationsWithoutLabel: z
    .array(
      z.object({
        operationId: z.string().describe(D.operationId),
        ownerId: z.string().nullable().describe(D.ownerId),
        ownerName: z.string().nullable().describe(D.ownerName),
        artistId: z.string().nullable().describe(D.artistId),
        pseudonym: z.string().nullable().describe(D.pseudonym),
        meaning: z.enum(['payout', 'recoupable_payout', 'deduction', 'credit', 'return']).describe(D.meaning),
        date,
        amountCents: z.number().int().describe(D.amountCents),
      }),
    )
    .describe('Active operations without a label (D-168): the history before the split; the operator sets the label on P21'),
  labelOutsideAccount: z
    .array(
      z.object({
        account: z.string().describe(D.account),
        month,
        labelName: z.string().describe('The label string of the units'),
        ourLabelName: z.string().describe('The own label the string leads to'),
        accountLabelName: z.string().describe('The own label the file of the units was loaded under: their book (D-169)'),
        net: money.describe(D.net),
        units: z.number().int().describe(D.units),
      }),
    )
    .describe(
      'Units whose label string leads to another own label than the one their file was loaded under, the book (D-168, D-169); the money stays in the book of the file',
    ),
  filesWithoutLabel: z
    .array(
      z.object({
        fileId: z.string().describe(D.fileId),
        account: z.string().describe(D.account),
        reportingMonth: month.describe(D.reportingMonth),
        fileName: z.string(),
      }),
    )
    .describe("Loaded Believe files without a label (D-169): their units sit in the book '?'; empty under a label"),
  statementsWithoutLabel: z
    .array(
      z.object({
        statementId: z.string().describe(D.statementId),
        periods: z.array(z.string()),
        fileName: z.string(),
      }),
    )
    .describe("Loaded B17 statements without a label (D-169): their lines sit in the book '?'; empty under a label"),
  adsWithoutLabel: z
    .array(z.object({ adId: z.string().describe(D.adId), isrc: z.string().nullable().describe(D.isrc), month, amount: money }))
    .describe("Active advertising records without a payer (D-169): they charge the book '?'; the operator sets the label (PATCH /ads/:id); empty under a label"),
  adOutsideBook: z
    .array(
      z.object({
        adId: z.string().describe(D.adId),
        isrc: z.string().describe(D.isrc),
        month,
        amount: money,
        payerLabelName: z.string().describe('The label of the record: the book it charges'),
        bookLabelName: z.string().describe('The book of the ISRC income at the month of the expense'),
      }),
    )
    .describe('Advertising records whose payer is not the book of the ISRC income at their month (D-169, information); under a label those it pays or whose income book it is'),
  catalogOutsideAccount: z
    .array(
      z.object({
        isrc: z.string().describe(D.isrc),
        account: z.string().describe(D.account),
        bookLabelId: z.string().describe('The label the file of the units was loaded under: their book'),
        catalogLabelId: z.string().nullable().describe('The label of the history at the month of the units; null = no interval holds it'),
        firstMonth: month.describe(D.firstMonth),
        lastMonth: month.describe(D.lastMonth),
        units: z.number().int().describe(D.units),
        net: money.describe(D.net),
      }),
    )
    .describe('Units of an ISRC with a label history whose book is not the catalog label of their month (D-172, information: a tail on the old account); the money stays in the book'),
  tracksWithoutLabel: z
    .array(z.object({ isrc: z.string().describe(D.isrc), lastMonth: month.describe(D.lastMonth), bookLabelId: z.string().nullable().describe(D.bookLabelId), net: money.describe(D.net) }))
    .describe('ISRCs of the units without a label-history interval at their last reporting month (D-172); the operator sets it on P6'),
  releasesIncomplete: z
    .array(
      z.object({
        upc: z.string().describe(D.upc),
        labelId: z.string().describe(D.labelId),
        title: z.string().describe('The release title of the registry'),
        trackCount: z.number().int().describe(D.trackCount),
        isrcsInUnits: z.number().int().describe(D.isrcsInUnits),
      }),
    )
    .describe('Releases of the registry of a label whose UPC is in its reports with a number of distinct ISRCs other than the track count (D-196, information; all loaded files; a release absent from the reports is not listed)'),
  releasesUnknown: z
    .array(
      z.object({
        upc: z.string().describe(D.upc),
        bookLabelId: z.string().describe(D.bookLabelId),
        releaseTitle: z.string().describe(D.releaseTitle),
        artistName: z.string().describe('The artist string of the report'),
        isrcs: z.array(z.string()).describe('The ISRCs of the UPC in the reports of the label'),
        lastMonth: month.describe('The last reporting month of the UPC in the reports of the label'),
      }),
    )
    .describe('UPCs of the reports of a label whose release registry does not list them (D-196, information, no money: import a fresh export); the latest first'),
  releasesWithoutDate: z
    .array(z.object({ upc: z.string().describe(D.upc), labelId: z.string().describe(D.labelId), releaseTitle: z.string().describe(D.releaseTitle) }))
    .describe('Releases of the registry without a release date (D-196, information)'),
  operationsDefaultLabel: z
    .array(
      z.object({
        operationId: z.string().describe(D.operationId),
        kind: z.enum(OPERATION_KINDS).describe('The stored kind of the operation'),
        labelId: z.string().nullable().describe(D.labelId),
        ownerId: z.string().nullable().describe(D.ownerId),
        ownerName: z.string().nullable().describe(D.ownerName),
        artistId: z.string().nullable().describe(D.artistId),
        pseudonym: z.string().nullable().describe(D.pseudonym),
        date,
        amountCents: z.number().int().describe(D.amountCents),
      }),
    )
    .describe('Active operations whose label is the default of the history (D-168: a mixed owner or no units → 0to8; label source `default`, D-173): the product owner revisits them, the operator relabels with a reason'),
  forgivenessReduced: z
    .array(
      z.object({
        operationId: z.string().describe('The advance'),
        ownerId: z.string().describe(D.ownerId),
        ownerName: z.string().nullable().describe(D.ownerName),
        artistId: z.string().describe(D.artistId),
        pseudonym: z.string().nullable().describe(D.pseudonym),
        labelId: z.string().nullable().describe(D.labelId),
        recorded: money.describe('Σ counted forgivenesses of the advance'),
        effective: money.describe('What the recoup could forgive: income before the date came after the forgiveness'),
      }),
    )
    .describe('Advances whose recorded forgiveness is above the effective one (D-173 К2): the income before the date recouped it first'),
  operationsRelabelled: z
    .number()
    .int()
    .describe('The number of operations the operator relabelled (PATCH /settlements/operations/:id in the audit, D-173); under a label those now in it or moved out of it'),
});
export type Signals = z.infer<typeof signalsSchema>;

// ---- the C queue and the overview (D-141) ----

export const queueGroupSchema = z.object({
  key: z.object({
    kind: z.enum([
      'owner',
      'split',
      'participation',
      'labelRule',
      'artist',
      'labelString',
      'pair',
      'writer',
      'ownerTerms',
    ]),
    id: z.string(),
    label: z.string().describe(D.label),
  }),
  ownerId: z.string().nullable().describe(D.ownerId),
  ownerName: z.string().nullable().describe(D.ownerName),
  artistId: z.string().nullable().describe(D.artistId),
  pseudonym: z.string().nullable().describe(D.pseudonym),
  documentId: z.string().nullable().describe(D.documentId),
  documentStatus: z.enum(['approved', 'not_approved', 'not_attached', 'missing']).nullable().describe(D.documentStatus),
  ruleId: z.string().nullable().describe(D.ruleId),
  amount: money.describe('The money of the group that waits'),
  isrcCount: z.number().int().describe('ISRCs of the group'),
  months: z.object({ from: month, to: month }).describe('The report months it spans'),
  isrcs: z.array(z.object({ isrc: z.string().describe(D.isrc), amount: money })).describe('Top 20 by |amount|'),
  assumptionBasis: z.enum(['document', 'q11', 'r1']).nullable().describe(D.assumptionBasis),
});
export type QueueGroup = z.infer<typeof queueGroupSchema>;

export const queuePageSchema = z.object({
  calculatedAt: timestamp,
  total: z.number().int().describe('Number of groups of the reason'),
  amount: money.describe('Σ of all groups of the reason (not only the page)'),
  items: z.array(queueGroupSchema),
});

/** The six sums of one KPI card set of P1 (D-160): the reconciliation fields over a set of rows. */
export const kpiSumsSchema = z.object({
  received: money.describe('Σ A_received'),
  notOurs: money.describe('Σ B_notOurs'),
  waiting: money.describe('Σ C_waiting'),
  ourShare: money.describe('Σ ourShare'),
  ourShareNoSplit: money.describe('Σ ourShareNoSplit'),
  discrepancy: money.describe('Σ discrepancy: 0 when A = B + C + ours holds on every row'),
});
export type KpiSums = z.infer<typeof kpiSumsSchema>;

export const overviewSchema = z.object({
  calculatedAt: timestamp,
  reconciliation: z.array(reconciliationRowSchema.extend({ negativeRemainders: z.number().int().describe('Units whose label share came out negative (a check; Believe rows only)') })),
  totals: z
    .object({
      all: kpiSumsSchema,
      bySource: z.object({ believe: kpiSumsSchema, b17: kpiSumsSchema }),
      byAccount: z.array(kpiSumsSchema.extend({ source: z.enum(['believe', 'b17']).describe(D.source), account: z.string().describe(D.account) })),
      byLabel: z.record(z.string(), kpiSumsSchema).describe("The same sums per book (by name, '?' = without a label): the label a file or statement was loaded under, D-168, D-169"),
    })
    .describe('The KPI cards of P1 over the reconciliation rows of the period: all, per source, per source × account, per label (D-160, D-168)'),
  queue: z.array(
    z.object({ reason: cReasonSchema.describe('The C reason'), amount: money.describe('The money that waits for it'), groups: z.number().int().describe('Things to fix (see the queue)'), isrcs: z.number().int().describe('ISRCs touched') }),
  ).describe('Category C by reason, largest work first'),
  signals: z.array(z.object({ name: z.string().describe('The signal, a key of GET /signals'), count: z.number().int() })).describe('The problems found, by name'),
  files: z.object({ believe: z.number().int(), b17: z.number().int() }).describe('Loaded files'),
});
export type Overview = z.infer<typeof overviewSchema>;

/** Whether the payout button works for the owner now, and why not (17 N19); the client shows it, never recomputes it. */
export const payoutGateSchema = z.object({
  allowed: z.boolean().describe('The payout button can pay now'),
  reason: z
    .enum(['owner_not_confirmed', 'no_contract_for_label', 'start_missing', 'nothing_to_pay', 'below_threshold', 'hold', 'payout_blocked', 'no_payee', 'needs_answer'])
    .nullable()
    .describe(
      'In the order of the checks (D-176, the owner\'s module 17): owner_not_confirmed: no approved contract at all; no_contract_for_label: none whose document has the label of the view or no label (D-169); start_missing: a start row of a pseudonym without an amount (D-174); nothing_to_pay; below_threshold (the contract\'s threshold, else the default); hold: an active hold that blocks; payout_blocked: a payout without a proof; no_payee: no active payee (once the organization entered its first payee); needs_answer: the first payout of the owner without an answer «pay» for this amount',
    ),
  amountCents: z
    .number()
    .int()
    .describe('Payable floored to whole cents, 0 when negative: what the button pays'),
});
export type PayoutGate = z.infer<typeof payoutGateSchema>;

/**
 * The money of one area of a book (D-173 К10): earned and recouped by the stream of the income, advertising master, the
 * operations by their `area` (the history master, a write-off publishing); Σ of the two areas = the book.
 */
export const areaBookSchema = z.object({
  start: money.optional().describe('The opening balance of the area (D-174): the start rows and the adjustments, master or publishing cents'),
  earned: money.describe(D.earned),
  recouped: money.describe(D.recouped),
  adsCharged: money.describe(D.adsCharged),
  paid: money.describe(D.paid),
  returns: money.describe(D.returns),
  credits: money.describe(D.credits),
  buyouts: money.describe(D.buyouts),
  writtenOff: money.describe(D.writtenOff),
  adjustments: money.describe(D.adjustments),
  payable: money.describe(D.payable),
  payableShown: money.optional().describe('What the area pays (D-181): Σ of the positive positions of the pseudonyms in it and of the owner\'s own; absent in older snapshots'),
  ownerPosition: money.optional().describe('The position of the owner without a pseudonym in the area (D-181)'),
});
/** The position fields of D-181: optional, so that a payout snapshot recorded before it still passes. */
const positionBookFields = {
  ownerPosition: money.optional().describe('The position of the owner without a pseudonym (D-181): its publishing and its operations without a pseudonym, less what was shared to the pseudonyms'),
};
/** The book fields of D-173: optional, so that a payout snapshot recorded before it still passes (FIX-6). */
const kindBookFields = {
  buyouts: money.optional().describe('Counted buyouts (D-173): neither paid nor in payable'),
  forgiven: money.optional().describe('The effective forgiveness of the advances (D-173): reduces what is unrecouped, not payable'),
  writtenOff: money.optional().describe('Counted publishing write-offs (D-173): taken off payable'),
  adjustments: money.optional().describe('−Σ counted adjustments (D-173): added to payable with their sign'),
  start: money.optional().describe('The opening balance (D-174): Σ of the active start rows and adjustments of the owner\'s pseudonyms in the book; in payable'),
  startMissing: z.boolean().optional().describe('A start row without an amount (D-174): the payout of the book is closed (start_missing)'),
  byArea: z
    .object({ master: areaBookSchema, publishing: areaBookSchema })
    .optional()
    .describe('The two areas (D-173): Σ = the book, field by field'),
};

/** The book of one label of an owner (D-168): every money field of `total`, partitioned by label. */
export const labelBookSchema = z.object({
  labelId: z.string().nullable().describe('null = without a label (an unmapped label string, publishing, an operation or a charge without a label)'),
  earned: money.describe(D.earned),
  waiting: money.describe(D.waiting),
  recouped: money.describe('By the label of the income consumed: a position under a label is recouped from that label only'),
  adsCharged: money.describe(D.adsCharged),
  paid: money.describe(D.paid),
  returns: money.describe(D.returns),
  credits: money.describe(D.credits),
  ...kindBookFields,
  ...positionBookFields,
  payable: money.describe(D.payable),
  payableShown: money.describe(D.payableShown),
  payableNegative: z.boolean().describe(D.payableNegative),
});
export type LabelBook = z.infer<typeof labelBookSchema>;

const labelRef = z.object({ id: z.string(), name: z.string() });

// ---- the opening balances (D-174): the start of a pseudonym in a book at the cut of 15.10.2026 ----

export const OPENING_BALANCE_KINDS = ['start', 'adjustment'] as const;

/** One row of `settlements.opening_balances`: the start of a pseudonym in a book, or an approved adjustment of it. */
export const openingBalanceSchema = z.object({
  id: z.string(),
  labelId: z.string().describe('The book the start acts in (an own label)'),
  artistId: z.string().describe('The pseudonym (the cabinet\'s position is per nick)'),
  kind: z.enum(OPENING_BALANCE_KINDS).describe('start: the cabinet position; adjustment: an approved correction of it'),
  cutoffMonth: month.describe('The last report month inside the start'),
  syncedAt: timestamp.describe('The boundary of the movements: operations of the book dated up to its day are inside the start'),
  masterCents: z.number().int().describe(D.masterCents),
  publishingCents: z.number().int().describe(D.publishingCents),
  missing: z.boolean().describe('The cabinet gave no amount: not a zero, the payout is closed'),
  basis: z.string().describe('What the row is based on'),
  documentId: z.string().nullable().describe(D.documentId),
  operationRef: z.string().nullable().describe('An advance before the cut kept alive after it (reopened)'),
  comment: z.string(),
  createdAt: timestamp,
  active: z.boolean(),
  deactivatedReason: z.string().nullable(),
});
export type OpeningBalance = z.infer<typeof openingBalanceSchema>;

/** A row of the start list: the row with its pseudonym and owner. */
export const openingBalanceRowSchema = openingBalanceSchema.extend({
  pseudonym: z.string().describe(D.pseudonym),
  ownerId: z.string().nullable().describe(D.ownerId),
  ownerName: z.string().nullable().describe(D.ownerName),
});

/** `GET /settlements/start`: the opening balances of a book with their sums. */
export const startListSchema = z.object({
  label: labelRef.nullable().describe('The book asked for; null = every book'),
  rows: z.array(openingBalanceRowSchema),
  totals: z.object({
    rows: z.number().int().describe(D.rows),
    starts: z.number().int().describe('Active start rows'),
    adjustments: z.number().int().describe('Active adjustment rows'),
    missing: z.number().int().describe('Active start rows without an amount'),
    inactive: z.number().int().describe(D.inactive),
    master: money.describe('Σ master of the active rows'),
    publishing: money.describe('Σ publishing of the active rows'),
    total: money,
    cutoffMonths: z.array(month),
  }),
  ...pageFields,
});
export type StartList = z.infer<typeof startListSchema>;

/** The start block of a balance (D-174): the cuts per book, the rows of the owner\'s pseudonyms, what the cut removed. */
export const startViewSchema = z.object({
  cuts: z.array(
    z.object({
      labelId: z.string().nullable().describe(D.labelId),
      cutoffMonth: month,
      syncedDay: date.describe('The day of syncedAt (UTC): operations of the book dated up to it are inside the start'),
      syncedAt: timestamp,
    }),
  ),
  rows: z.array(openingBalanceSchema.extend({ pseudonym: z.string().describe(D.pseudonym) })),
  insideStart: z
    .object({
      earned: money.describe(D.earned),
      waiting: money.describe(D.waiting),
      paid: money.describe(D.paid),
      advances: money.describe(D.advances),
      adsCharged: money.describe(D.adsCharged),
      operations: z.number().int().describe(D.operations),
    })
    .describe('What the start replaced: the inputs the cut removed (reference only, never in payable)'),
});

// ---- the admission (D-176): the payee, the holds, the answers ----

export const PAYEE_CHANNELS = ['tipalti', 'easystaff', 'other'] as const;
export const HOLD_KINDS = ['decision', 'artist_request', 'question', 'dispute'] as const;
export const ANSWER_DECISIONS = ['pay', 'pay_task'] as const;

export const payeeSchema = z.object({
  id: z.string(),
  ownerId: z.string().describe(D.ownerId),
  channel: z.enum(PAYEE_CHANNELS).describe(D.channel),
  payeeRef: z.string().nullable().describe('The reference in the cash register (a Tipalti payee id, an EasyStaff e-mail); null = by the payment history'),
  status: z.enum(['confirmed', 'proposed']),
  basis: z.string().describe('What the row is based on'),
  validFrom: date.describe(D.validFrom),
  source: z.string().nullable().describe(D.source),
  createdAt: timestamp,
  active: z.boolean(),
  deactivatedReason: z.string().nullable(),
});
export type Payee = z.infer<typeof payeeSchema>;

export const holdSchema = z.object({
  id: z.string(),
  ownerId: z.string().describe(D.ownerId),
  labelId: z.string().nullable().describe('The book the hold acts in; null = every book'),
  kind: z.enum(HOLD_KINDS).describe('decision, artist_request, question or dispute: what holds the payout'),
  blocks: z.boolean().describe('Closes the payout (a hold, a dispute that blocks the row) or informs only'),
  reason: z.string().describe(D.reason),
  releaseWhen: z.string().nullable().describe('The condition of the release'),
  amountCents: z.number().int().nullable().describe(D.amountCents),
  period: z.string().nullable().describe(D.period),
  reviewOn: date.nullable(),
  since: date,
  source: z.string().nullable().describe(D.source),
  status: z.enum(['active', 'released']),
  releasedAt: timestamp.nullable(),
  releasedReason: z.string().nullable().describe(D.releasedReason),
  createdAt: timestamp,
});
export type Hold = z.infer<typeof holdSchema>;

export const payoutAnswerSchema = z.object({
  id: z.string(),
  ownerId: z.string().describe(D.ownerId),
  labelId: z.string().nullable().describe(D.labelId),
  dueCents: z.number().int().describe('The answer holds for exactly this payable amount'),
  decision: z.enum(ANSWER_DECISIONS).describe(D.decision),
  why: z.string().describe('Why the answer was given'),
  about: z.string().describe('The question answered (an irregular history, the first payout, the contract)'),
  answeredBy: z.string().describe(D.answeredBy),
  source: z.string().nullable().describe(D.source),
  createdAt: timestamp,
  active: z.boolean(),
  deactivatedReason: z.string().nullable(),
});
export type PayoutAnswer = z.infer<typeof payoutAnswerSchema>;

const ownerName = { ownerName: z.string().nullable().describe(D.ownerName) };

/** `GET /settlements/admission`: the rows of a book, of one owner, or of every owner. */
export const admissionListSchema = z.object({
  active: z.boolean().describe('The organization uses the admission: at least one payee row exists (D-176)'),
  payees: z.array(payeeSchema.extend(ownerName)),
  holds: z.array(holdSchema.extend(ownerName)),
  answers: z.array(payoutAnswerSchema.extend(ownerName)),
});
export type AdmissionList = z.infer<typeof admissionListSchema>;

/** The admission of the owner in a balance (D-176): what the gate read. */
export const admissionOfOwnerSchema = z.object({
  active: z.boolean(),
  thresholdCents: z.number().int().nullable().describe('The threshold of the contract under the label; null = the default'),
  hadPayout: z.boolean().describe('The owner had a payout in the book: the first payout needs an answer'),
  payee: payeeSchema.nullable(),
  holds: z.array(holdSchema),
  answers: z.array(payoutAnswerSchema),
});

export const contractThresholdSchema = z.object({ id: z.string(), ownerId: z.string().describe(D.ownerId), payoutThresholdCents: z.number().int().nullable() });

export const balanceSchema = z.object({
  owner: ownerSchema,
  confirmed: z.boolean().describe('The owner has an approved contract (or label decision)'),
  payout: payoutGateSchema.describe('Can the payout button pay now, how much, and why not'),
  admission: admissionOfOwnerSchema.optional().describe('The admission of the owner (D-176); absent in older snapshots'),
  label: labelRef.nullable().describe('The label the balance is restricted to (D-168); null = the whole owner'),
  period: z
    .object({
      from: z.string().nullable().describe(D.periodFrom),
      to: z.string().nullable().describe(D.periodTo),
      basis: z.enum(['report', 'sales']).describe(D.basis),
      received: money.describe('A of the period: the whole net of every unit where the owner has an allocation, the parts of others included, and the payable of its publishing lines'),
      notOurs: money.describe('B of the period: the confirmed income of this owner, earnedMaster + earnedPublishing'),
      waiting: money.describe('C of the period: the money of this owner that waits'),
      waitingBreakdown: cBreakdown,
      otherParticipants: money.describe('What other owners were allocated on the same units'),
      ourShare: money.describe('The share of the label on the same units and publishing lines'),
      earnedMaster: money.describe('Confirmed income of the period from master (Believe)'),
      earnedPublishing: money.describe('Confirmed income of the period from publishing (B17)'),
      paid: money.describe('Counted payouts dated in the period'),
      advancesPaid: money.describe('Counted advances dated in the period'),
      recouped: money.describe('The part of the income of the period kept to repay advances and deductions'),
    })
    .describe('The money of the requested period; it does not decide what can be paid (see total)'),
  total: z.object({
    earned: money.describe('Confirmed income of all time after the start (category B)'),
    waiting: money.describe('All the money of the owner that waits (category C): it is not in payable'),
    recouped: money.describe('All income kept to repay advances and deductions'),
    adsCharged: money.describe('Advertising charged to the owner, taken off payable at once (D-157)'),
    paid: money.describe(D.paid),
    returns: money.describe(D.returns),
    credits: money.describe(D.credits),
    ...kindBookFields,
    ...positionBookFields,
    payable: money.describe('start + earned − recouped − paid − adsCharged + returns + credits + adjustments − writtenOff (D-173, D-174): the net of every position, kept as is when negative'),
    payableShown: money.describe(D.payableShown),
    payableNegative: z.boolean().describe(D.payableNegative),
  }).describe('All-time sums of the owner: the period does not limit them, `asOf` cuts them'),
  byLabel: z
    .record(z.string(), labelBookSchema)
    .describe(
      "The book of every label (by name, '?' = without a label): master money goes by the label its file was loaded under (D-169); Σ over the books = total, field by field (D-168); under a label view the one book",
    ),
  artists: z.array(
    z.object({
      artistId: z.string().describe(D.artistId),
      pseudonym: z.string().describe(D.pseudonym),
      earned: money.describe('Confirmed income of the pseudonym in the period'),
      waiting: money.describe('Money of the pseudonym that waits in the period'),
      recouped: money.describe(D.recouped),
      unrecouped: money.describe(D.unrecouped),
      start: money.optional().describe('The opening balance of the pseudonym (D-174)'),
      position: money.optional().describe('The position of the pseudonym over its books (D-181): what the label owes it, negative when it owes the label; the owner is paid Σ of the positive ones, a negative one never offsets a positive one; absent in older snapshots'),
      positionNegative: z.boolean().optional().describe('position < 0 (computed by the backend)'),
      tracks: z.array(z.object({ isrc: z.string().describe(D.isrc), net: money.describe(D.net), amount: money, waiting: money.describe(D.waiting) })),
      byLabel: z.record(
        z.string(),
        z.object({
          labelId: z.string().nullable().describe(D.labelId),
          earned: money.describe(D.earned),
          waiting: money.describe(D.waiting),
          recouped: money.describe(D.recouped),
          unrecouped: money.describe(D.unrecouped),
          recoupedFromMaster: money.describe(D.recoupedFromMaster),
          forgiven: money.optional().describe('The effective forgiveness of the positions this pseudonym holds (D-173)'),
          start: money.optional().describe('The opening balance of the pseudonym in the book (D-174)'),
          position: money.optional().describe('The position of the pseudonym in the book (D-181)'),
          positionByArea: z
            .object({ master: money.describe('The position of the pseudonym in the master area of the book (D-181)'), publishing: money.describe('The position of the pseudonym in the publishing area of the book (D-181)') })
            .optional()
            .describe('The position by area (D-181): Σ = position'),
        }),
      ),
    }),
  ).describe('The pseudonyms of the owner'),
  start: startViewSchema.nullable().optional().describe('The opening balances of the owner\'s pseudonyms and the cut they make (D-174); null without any, absent in older snapshots'),
  publishing: z.array(
    z.object({
      period: z.string().describe('The quarter of the statement'),
      workTitle: z.string().describe('The work in the B17 statement'),
      payable: money.describe('Total Payable of the line'),
      percent: money.describe('The author percent of the owner'),
      amount: money.describe('The author part of the owner: payable × percent'),
      category: z.string().describe('B = confirmed, C = waits'),
      reason: z.string().nullable().describe('The C reason; null in B'),
    }),
  ).describe('The publishing lines of the owner in the period'),
  positions: z.array(
    z.object({
      operationId: z.string().describe(D.operationId),
      artistId: z.string().describe(D.artistId),
      amount: money.describe('The advance or deduction to recoup'),
      recouped: money.describe('Already recouped from income'),
      forgiven: money.optional().describe('The effective forgiveness (D-173): amount = recouped + forgiven + remaining'),
      forgivenRecorded: money
        .optional()
        .describe('The counted forgivenesses as recorded (D-173): above `forgiven` when income before the date came later (signal forgivenessReduced)'),
      remaining: money.describe('What income still has to recoup'),
      scope: z.object({ kind: z.string().describe(D.scopeKind) }).describe('Which income may recoup it'),
      date,
      labelId: z.string().nullable().describe('The label of the operation (D-168); null = recouped from any income'),
    }),
  ).describe('Advances and deductions of the owner: what is recouped from income'),
  ads: z
    .array(
      z.object({
        adId: z.string().describe(D.adId),
        isrc: z.string().nullable().describe(D.isrc),
        month,
        artistId: z.string().describe(D.artistId),
        role: z.enum(['artist', 'sublabel']).describe('artist: the recovered part of a pseudonym; sublabel: the unrecovered part borne by a sublabel').describe(D.role),
        amount: money.describe('The charge'),
        labelId: z.string().nullable().describe("The label of record of the expense (D-168); null = none"),
      }),
    )
    .describe('Advertising charged to the owner (D-157): taken off payable at once, newest month first'),
  pendingOperations: z
    .array(z.object({ operationId: z.string().describe(D.operationId), why: z.string().describe('Why it does not count: no payment proof yet, basis document not approved, no approved document') }))
    .describe('Active operations that do not count yet: not in the money above'),
  blockingPayouts: z.array(z.string()).describe('Ids of payouts without an approved proof or deferred: they block a new payout'),
});
export type Balance = z.infer<typeof balanceSchema>;

/** `GET /artists/:id/balance` (P12, D-165): the money of one pseudonym, the artist row of its owner's balance with its parts. */
export const artistBalanceSchema = z.object({
  artist: artistSchema,
  owner: ownerSchema.nullable(),
  artistId: z.string().describe(D.artistId),
  pseudonym: z.string().describe(D.pseudonym),
  ownerId: z.string().nullable().describe(D.ownerId),
  label: labelRef.nullable().describe('The label the money is restricted to (D-168); null = every book'),
  period: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    basis: z.enum(['report', 'sales']).describe(D.basis),
    received: money.describe('Σ net of the units where the pseudonym has an allocation'),
    earned: money.describe(D.earned),
    waiting: money.describe(D.waiting),
    waitingBreakdown: cBreakdown,
  }),
  total: z.object({
    earned: money.describe(D.earned),
    waiting: money.describe(D.waiting),
    recouped: money.describe(D.recouped),
    unrecouped: money.describe(D.unrecouped),
    recoupedFromMaster: money.describe('Part of this pseudonym\'s master income consumed by recoupment'),
    adsCharged: money.describe('Advertising charged to this pseudonym, taken off the owner\'s payable at once (D-157)'),
    paid: money.describe('Payouts tied to this pseudonym (the button pays the owner: those carry no pseudonym)'),
    start: money.optional().describe('The opening balance of the pseudonym (D-174)'),
    position: money.optional().describe('The position of the pseudonym (D-181): what the label owes it over its books'),
  }),
  byLabel: z
    .record(
      z.string(),
      z.object({
        labelId: z.string().nullable().describe(D.labelId),
        earned: money.describe(D.earned),
        waiting: money.describe(D.waiting),
        recouped: money.describe(D.recouped),
        unrecouped: money.describe(D.unrecouped),
        recoupedFromMaster: money.describe(D.recoupedFromMaster),
        adsCharged: money.describe(D.adsCharged),
        paid: money.describe(D.paid),
        start: money.optional().describe(D.start),
        position: money.optional().describe('The position of the pseudonym in the book (D-181)'),
      }),
    )
    .describe("The book of every label of the pseudonym (by name, '?' = without a label): Σ books = total (D-168)"),
  tracks: z.array(z.object({ isrc: z.string().describe(D.isrc), net: money.describe(D.net), amount: money, waiting: money.describe(D.waiting) })),
  positions: balanceSchema.shape.positions,
  ads: balanceSchema.shape.ads,
  pendingOperations: balanceSchema.shape.pendingOperations,
});
export type ArtistBalance = z.infer<typeof artistBalanceSchema>;

/** `GET /artists/balances` (P11, D-167): the totals of `GET /artists/:id/balance` for a list of pseudonyms, from one calculation. */
export const artistBalanceItemSchema = z.object({
  artistId: z.string().describe(D.artistId),
  pseudonym: z.string().describe(D.pseudonym),
  ownerId: z.string().nullable().describe(D.ownerId),
  earned: money.describe(D.earned),
  waiting: money.describe(D.waiting),
  recouped: money.describe(D.recouped),
  unrecouped: money.describe(D.unrecouped),
  adsCharged: money.describe(D.adsCharged),
  paid: money.describe(D.paid),
  remaining: money.describe('earned − recouped − adsCharged − paid: what this pseudonym left for its owner\'s payable (the payout is the owner\'s)'),
});
export const artistBalancesSchema = z.object({ calculatedAt: timestamp, items: z.array(artistBalanceItemSchema), ...pageFields });
export type ArtistBalanceItem = z.infer<typeof artistBalanceItemSchema>;

// ---- track explanation (the state after every master layer, D-127) ----

export const allocationSchema = z.object({
  artistId: z.string().describe(D.artistId),
  ownerId: z.string().nullable().describe(D.ownerId),
  layer: z.enum(['split', 'top', 'carve', 'sublabel']).describe('The layer that made the allocation').describe(D.layer),
  kind: z.enum(['row', 'top', 'artist_pool', 'artist_share', 'label_share', 'sublabel']).describe('row: a split row; top: off the top of net; artist_pool, artist_share, label_share: carved from that bucket; sublabel: by a sublabel rule'),
  ruleId: z.string().describe('split id (row), participation id (top, carve), label rule id (sublabel)'),
  documentId: z.string().nullable().describe(D.documentId),
  percent: money.describe('The percent applied'),
  amount: money.describe('The money allocated'),
  category: z.enum(['B', 'C']).describe('B = confirmed, C = waits'),
  reason: cReasonSchema.nullable().describe('The C reason; null in B'),
  assumption: z.enum(['document', 'q11', 'r1']).nullable().describe('Why it waits as an assumption: document, or the council rules q11, r1; null = not an assumption'),
});

const shortfallSchema = z.object({
  isrc: z.string().describe(D.isrc),
  upc: z.string().describe(D.upc),
  month,
  ruleId: z.string().describe(D.ruleId),
  missing: money.describe('The part the bucket could not fund: it is not money'),
  why: z.string().describe('bucket_short, no_source_row or top_above_100'),
});
const unitStatus = z
  .enum(['allocated', 'no_split', 'unknown_pair', 'no_isrc'])
  .describe('allocated: a split is in force; no_split: none at the report date; unknown_pair: the ISRC/UPC pair is not in the catalogue; no_isrc: a line without ISRC');
const labelShareCategory = z
  .enum(['ours', 'label_unmapped', 'no_isrc', 'unknown_pair', 'no_split'])
  .describe('ours: the label share belongs to the label; otherwise the C reason it waits for');

export const layerStateSchema = z.object({
  layer: z.string().describe(D.layer),
  status: unitStatus,
  ourLabelId: z.string().nullable().describe(D.ourLabelId),
  ourLabelName: z.string().nullable().describe(D.ourLabelName),
  rule: z
    .object({
      id: z.string(),
      percent: money.describe(D.percent),
      recipientArtistId: z.string().describe(D.recipientArtistId),
      documentId: z.string().nullable().describe(D.documentId),
    })
    .nullable(),
  scaledNet: money.describe('Net minus the off-the-top allocations'),
  labelShare: money.describe(D.labelShare),
  labelShareCategory,
  allocations: z.array(allocationSchema),
  shortfalls: z.array(shortfallSchema),
});

export const explainSchema = z.object({
  isrc: z.string().describe(D.isrc),
  splits: z.array(splitSchema),
  participations: z.array(z.looseObject({ id: z.string(), artistId: z.string().describe(D.artistId), fundedFrom: z.string().describe(D.fundedFrom) })),
  units: z.array(
    z.object({
      account: z.string().describe(D.account),
      isrc: z.string().describe(D.isrc),
      upc: z.string().describe(D.upc),
      reportingMonth: month.describe(D.reportingMonth),
      salesMonth: month.describe(D.salesMonth),
      labelName: z.string().describe(D.labelName),
      net: money.describe(D.net),
      status: unitStatus,
      ourLabelId: z.string().nullable().describe(D.ourLabelId),
      ourLabelName: z.string().nullable().describe(D.ourLabelName),
      labelShare: money.describe(D.labelShare),
      labelShareCategory,
      ours: money.describe(D.ours),
      allocations: z.array(allocationSchema),
      shortfalls: z.array(shortfallSchema),
      layers: z.array(layerStateSchema).describe('The state after every layer that ran, in order'),
    }),
  ),
  breakdown: z.unknown(),
});
export type TrackExplanation = z.infer<typeof explainSchema>;

// ---- settlements ----

export const operationSchema = z.object({
  id: z.string(),
  direction: z.enum(['in', 'out']).describe('out: money left us; in: a deduction or an addition to the balance. Branch on kind, not on this'),
  amountCents: z.number().int().describe('Integer cents, USD'),
  ownerId: z.string().nullable().describe(D.ownerId),
  artistId: z.string().nullable().describe(D.artistId),
  date,
  period: z.string().nullable().describe('The period the operation is for'),
  scope: z
    .object({
      kind: z.string().describe(D.scopeKind),
      isrcs: z.array(z.string()).optional().describe('kind isrcs: only these ISRCs'),
      excludeIsrcs: z.array(z.string()).optional().describe('Income of these ISRCs does not recoup it'),
    })
    .nullable()
    .describe('Which income recoups an advance or a deduction; null on other kinds'),
  documentId: z.string().nullable().describe(D.documentId),
  paymentProofId: z.string().nullable().describe('The payment proof: a payout counts only with it'),
  operationRef: z.string().nullable().describe('The operation this one refers to (a return, a forgiveness)'),
  deferred: z.boolean().describe('A deferred payout: it blocks new payouts of the owner'),
  migration: z.boolean().describe('Carried over from the old system: counts without documents, never blocks'),
  comment: z.string(),
  externalRef: z.string().nullable().describe('The id in the outer system; a repeat import is skipped by it'),
  createdAt: timestamp,
  active: z.boolean(),
  deactivatedReason: z.string().nullable(),
  meaning: z
    .enum(['payout', 'recoupable_payout', 'deduction', 'credit', 'return'])
    .describe('The alias of `kind` before D-173 (`recoupable_payout` = `advance`)'),
  labelId: z.string().nullable().describe('The own label of the operation (D-168); null = without a label'),
  kind: z.enum(OPERATION_KINDS).describe('The stored kind of the operation (D-173)'),
  labelSource: z
    .enum(LABEL_SOURCES)
    .nullable()
    .describe('Who set the label (D-173): one, default, operator, payout; null = not marked yet'),
  channel: z.string().nullable().describe('The payment channel, free text (D-173)'),
  area: z.enum(['master', 'publishing']).describe('The area of the book (D-173); the history is master').describe(D.area),
  allocation: z.record(z.string(), z.number().int()).nullable().optional().describe('A payout of the button (D-181): what it took from which position, cents by pseudonym id (\'\' = the owner\'s own); null for the history and every other kind'),
  fromLabelId: z
    .string()
    .nullable()
    .optional()
    .describe('Present on PATCH /settlements/operations/:id: the label before the change (D-173)'),
  labelName: z.string().nullable().optional().describe('Present on GET /settlements/operations; null without a label'),
  ownerName: z
    .string()
    .nullable()
    .optional()
    .describe('Present on GET /settlements/operations (N14); null when the operation has no owner'),
  pseudonym: z
    .string()
    .nullable()
    .optional()
    .describe('Present on GET /settlements/operations (N14); null when the operation has no artist'),
});
export type Operation = z.infer<typeof operationSchema>;

// ---- audit (D-140) ----

export const auditActionSchema = z.object({
  id: z.string(),
  at: timestamp,
  operator: z.string().describe(D.operator),
  method: z.string(),
  route: z.string().describe('Route template, e.g. /documents/:id/approve'),
  entityIds: z.array(z.string()),
  summary: z
    .record(z.string(), z.unknown())
    .describe('Ids, amounts and dates of the write; never names or free text'),
  labelId: z
    .string()
    .nullable()
    .describe('The own label of the write (D-169): ?label=, the body, the items or the response of a listed route; null = none'),
});
export const auditListSchema = z.object({ items: z.array(auditActionSchema) });
export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditList = z.infer<typeof auditListSchema>;

// ---- money aggregates for the screens (D-142, 17 N4..N15) ----

/** One owner of the payables list: the very fields of `GET /owners/:id/balance`, from one calculation (N4). */
export const payableItemSchema = z.object({
  ownerId: z.string().describe(D.ownerId),
  name: z.string(),
  kind: z.enum(['label', 'person']),
  status: z.enum(['confirmed', 'waiting_documents']),
  confirmed: z.boolean().describe(D.confirmed),
  earned: money.describe(D.earned),
  waiting: money.describe(D.waiting),
  waitingBreakdown: cBreakdown.describe('Category C of the requested period by reason'),
  recouped: money.describe(D.recouped),
  paid: money.describe(D.paid),
  returns: money.describe(D.returns),
  credits: money.describe(D.credits),
  buyouts: kindBookFields.buyouts,
  forgiven: kindBookFields.forgiven,
  writtenOff: kindBookFields.writtenOff,
  adjustments: kindBookFields.adjustments,
  start: kindBookFields.start,
  startMissing: kindBookFields.startMissing,
  payable: money.describe(D.payable),
  payableShown: money.describe(D.payableShown),
  payableNegative: z.boolean().describe('payable < 0 (computed by the backend)'),
  payout: payoutGateSchema,
  blockingPayouts: z.number().int().describe('Payouts without an approved proof or deferred: they block a new payout'),
  pendingOperations: z.number().int().describe('Active operations that do not count yet'),
  lastPayoutDate: date.nullable().describe('Date of the newest active payout (any kind of proof)'),
});
export const payablesSchema = z.object({ calculatedAt: timestamp, items: z.array(payableItemSchema), ...pageFields });
export type PayableItem = z.infer<typeof payableItemSchema>;

/** Money of a set of units: net received, B (owners), C (waiting) with reasons, ours. */
const moneySums = {
  net: money.describe('A: net received'),
  B: money.describe('Confirmed money of owners'),
  C: money.describe('Money that waits'),
  ours: money.describe('The share of the label'),
  cByReason: cBreakdown,
};

export const trackSummaryItemSchema = z.object({
  isrc: z.string().describe(D.isrc),
  upcs: z.array(z.string()),
  title: z.string(),
  artistName: z.string().describe('The artist string of the report pair (text, may name no pseudonym)'),
  artists: artistRefs,
  ...moneySums,
  months: z.object({ from: month.nullable(), to: month.nullable(), count: z.number().int() }).describe('The report months with income'),
  hasSplit: z.boolean().describe('The ISRC has a split'),
  hasParticipations: z.boolean().describe('The ISRC has participations'),
});
export const trackSummarySchema = z.object({
  calculatedAt: timestamp,
  items: z.array(trackSummaryItemSchema),
  ...pageFields,
});

/** The tracks without money (D-162): the ISRC set of `trackSummary()`, no calculation. */
export const trackCatalogItemSchema = z.object({
  isrc: z.string().describe(D.isrc),
  upcs: z.array(z.string()),
  title: z.string(),
  artistName: z.string().describe('The artist string of the report pair (text, may name no pseudonym)'),
  artists: artistRefs,
  hasSplit: z.boolean().describe(D.hasSplit),
  hasParticipations: z.boolean().describe(D.hasParticipations),
  registered: z.boolean().describe('Registered in module 1 (a track row); false for an ISRC known from the reports only'),
  catalogLabelId: z.string().nullable().describe('The label of the open label-history interval (D-172); not the book'),
  catalogLabelName: z.string().nullable().describe(D.catalogLabelName),
  catalogFrom: date.nullable().describe('Start of the open interval'),
});
export const trackCatalogSchema = z.object({ items: z.array(trackCatalogItemSchema), ...pageFields });
export type TrackCatalogItem = z.infer<typeof trackCatalogItemSchema>;
export type TrackSummaryItem = z.infer<typeof trackSummaryItemSchema>;

const documentStatusOfAllocation = z.enum(['approved', 'not_approved', 'not_attached', 'missing']).describe(D.documentStatus);

export const trackMoneyMonthSchema = z.object({
  account: z.string().describe(D.account),
  upc: z.string().describe(D.upc),
  reportingMonth: month.describe(D.reportingMonth),
  salesMonth: month.describe(D.salesMonth),
  labelName: z.string().describe(D.labelName),
  ourLabelName: z.string().nullable().describe('The own label the label string leads to: decides the sublabel rule and «ours»'),
  bookLabelId: z.string().nullable().describe("The book of the unit: the label its file was loaded under (D-169); null = '?'"),
  bookLabelName: z.string().nullable().describe(D.bookLabelName),
  sublabelName: z.string().nullable().describe(D.sublabelName),
  rule: z.string().nullable().describe('Id of the sublabel rule in force at the report month'),
  net: money.describe(D.net),
  labelShare: money.describe(D.labelShare),
  labelShareCategory,
  ours: money.describe(D.ours),
  status: unitStatus,
  allocations: z.array(
    allocationSchema.extend({
      pseudonym: z.string().describe(D.pseudonym),
      ownerName: z.string().nullable().describe(D.ownerName),
      documentStatus: documentStatusOfAllocation,
    }),
  ),
  shortfalls: z.array(shortfallSchema),
  layers: z.array(layerStateSchema).describe('The state after every layer that ran, in order'),
});
export const trackMoneySchema = z.object({
  isrc: z.string().describe(D.isrc),
  tracks: z.array(trackSchema),
  title: z.string(),
  artistName: z.string().describe('The artist string of the report pair (text, may name no pseudonym)'),
  artists: artistRefs,
  splits: z.array(splitListItemSchema),
  participations: participationListSchema.shape.items,
  totals: z.object(moneySums),
  months: z.array(trackMoneyMonthSchema),
});
export type TrackMoney = z.infer<typeof trackMoneySchema>;

export const breakdownRowSchema = z.object({
  reportingMonth: month.describe(D.reportingMonth),
  salesMonth: month.describe(D.salesMonth),
  platform: z.string().describe(D.platform),
  country: z.string().describe(D.country),
  subscriptionType: z.string().describe(D.subscriptionType),
  salesType: z.string().describe(D.salesType),
  upc: z.string().describe(D.upc),
  net: money.describe(D.net),
  quantity: z.number().int().describe(D.quantity),
});
export const trackBreakdownSchema = z.object({
  isrc: z.string().describe(D.isrc),
  month,
  rows: z.array(breakdownRowSchema),
});

/** One row of the release registry of a label (D-172): the Believe release export, no money. */
const releaseRegistryRowSchema = z.object({
  labelId: z.string().describe(D.labelId),
  labelName: z.string().describe(D.labelName),
  upc: z.string().describe(D.upc),
  releaseTitle: z.string().describe('The release title of the export'),
  version: z.string().nullable().describe('The version of the release in the export (Slowed, Remix, …)'),
  artistString: z.string().nullable().describe('The artist text of the export (not matched against the pseudonyms)'),
  labelString: z.string().nullable().describe('The label text of the export'),
  releasedAt: z.string().nullable().describe('The release time of the export, YYYY-MM-DDTHH:MM:SS, no zone (D-195)'),
  releaseDate: date.nullable().describe('The day of releasedAt'),
  trackCount: z.number().int().nullable().describe(D.trackCount),
  catalogNumber: z.string().nullable().describe(D.catalogNumber),
  territories: z.number().int().nullable().describe(D.territories),
  stores: z.number().int().nullable().describe(D.stores),
  createdAt: timestamp.describe('When the UPC first entered the registry'),
  updatedAt: timestamp.describe('The last change of the row'),
});

export const releasesSchema = z.object({
  items: z.array(
    z.object({
      upc: z.string().describe(D.upc),
      title: z.string(),
      artistName: z.string().describe('The artist string of the first report pair of the UPC (text)'),
      artists: z.array(artistRefSchema).describe('The pseudonyms of the registry over the tracks of the UPC, by pseudonym'),
      trackCount: z.number().int().describe(D.trackCount),
      net: money.describe('Net of the loaded Believe files, all months'),
      registered: z.boolean().describe('The UPC is in the release registry (D-172): of the label under a label, of any label under «Все»'),
      registry: releaseRegistryRowSchema
        .nullable()
        .describe('The registry row (D-172): of the label under a label, the last updated one under «Все»; null = not registered'),
    }),
  ),
  ...pageFields,
});
export const releaseSchema = z.object({
  upc: z.string().describe(D.upc),
  title: z.string(),
  artistName: z.string().describe('The artist string of the first report pair of the UPC (text)'),
  artists: z.array(artistRefSchema).describe('The pseudonyms of the registry over the tracks of the release, by pseudonym'),
  tracks: z.array(z.object({ isrc: z.string().describe(D.isrc), title: z.string(), artists: artistRefs, ...moneySums })),
  months: z.array(z.object({ reportingMonth: month.describe(D.reportingMonth), ...moneySums })),
  registry: z
    .array(releaseRegistryRowSchema)
    .describe('The release registry rows of the UPC (D-172): under a label its row only, under «Все» the row of every label; [] = not registered'),
});

export const documentUsesSchema = z.object({
  document: documentSchema,
  splits: z.array(splitListItemSchema),
  rowsOnly: z
    .array(z.object({ splitId: z.string().describe(D.splitId), isrc: z.string().describe(D.isrc), artistId: z.string().describe(D.artistId) }))
    .describe('Split rows confirmed by this document alone (the split itself has another or none)'),
  participations: participationListSchema.shape.items,
  labelRules: labelListItemSchema.shape.rules,
  contracts: z.array(contractSchema),
  operations: z.array(operationSchema),
  waiting: z
    .object({ amount: money, cByReason: cBreakdown })
    .describe(
      'Category C that waits for this document: allocations that cite it, plus owner_unconfirmed money of the owners its contracts confirm',
    ),
});

// ---- the payout snapshot (N15): what createPayout stores, with the Decimal fields as text ----

export const payoutSnapshotSchema = z.object({
  computedAt: timestamp,
  ownerId: z.string().describe(D.ownerId),
  labelId: z.string().optional().describe('The label the payout was made under (D-168); absent in snapshots before it'),
  labelName: z.string().optional().describe(D.labelName),
  amountCents: z.number().int().describe(D.amountCents),
  area: z.enum(['master', 'publishing', 'all']).optional().describe('The area paid (D-173); absent in snapshots before it').describe(D.area),
  payableExact: money.describe(D.payableExact),
  total: balanceSchema.shape.total.extend({ adsCharged: money.optional().describe(D.adsCharged) }),
  payoutByArtist: z.array(z.object({ key: z.string(), label: z.string().describe(D.label), net: money.describe(D.net), shareOfPayout: money.describe(D.shareOfPayout) })),
  allocation: z.record(z.string(), z.number().int()).optional().describe('What the payout took from which position (D-181): cents by pseudonym id, \'\' = the owner\'s own; absent in older snapshots'),
  perArtist: z.array(
    z.object({
      artistId: z.string().describe(D.artistId),
      pseudonym: z.string().describe(D.pseudonym),
      earned: money.describe(D.earned),
      recouped: money.describe(D.recouped),
      unrecouped: money.describe(D.unrecouped),
      waiting: money.describe(D.waiting),
      tracks: z.array(z.object({ isrc: z.string().describe(D.isrc), net: money.describe(D.net), amount: money, waiting: money.describe(D.waiting) })),
    }),
  ),
  publishing: balanceSchema.shape.publishing,
  positions: balanceSchema.shape.positions,
  ads: balanceSchema.shape.ads.optional().describe('Advertising charged at the payout (absent in snapshots before D-156)'),
  files: z.object({
    believe: z.array(
      z.object({ id: z.string(), sha256: z.string(), reportingMonth: month.describe(D.reportingMonth), fileName: z.string() }),
    ),
    b17: z.array(
      z.object({
        id: z.string(),
        sha256: z.string(),
        periods: z.array(z.string()),
        fileName: z.string(),
      }),
    ),
  }),
});
export type PayoutSnapshot = z.infer<typeof payoutSnapshotSchema>;

// ---- search and duplicate pseudonyms (D-143, 17 N10, N11) ----

export const SEARCH_KINDS = ['owners', 'artists', 'tracks', 'documents', 'labels'] as const;

export const searchResultSchema = z.object({
  owners: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: ownerSchema.shape.status,
      kind: ownerSchema.shape.kind,
    }),
  ),
  artists: z.array(
    z.object({
      id: z.string(),
      pseudonym: z.string().describe(D.pseudonym),
      ownerId: z.string().nullable().describe(D.ownerId),
      status: artistSchema.shape.status,
    }),
  ),
  tracks: z.array(z.object({ isrc: z.string().nullable().describe(D.isrc), upc: z.string().nullable().describe(D.upc), title: z.string() })),
  documents: z.array(
    z.object({ id: z.string(), title: z.string(), kind: z.string(), status: documentSchema.shape.status }),
  ),
  labels: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['own', 'sublabel']) })),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const duplicatesSchema = z.object({
  groups: z.array(
    z.object({
      normalized: z
        .string()
        .describe('The pseudonym as compared: NFKC, lower case, punctuation and spaces collapsed'),
      artists: z.array(
        z.object({
          id: z.string(),
          pseudonym: z.string().describe(D.pseudonym),
          ownerId: z.string().nullable().describe(D.ownerId),
          ownerName: z.string().nullable().describe(D.ownerName),
          status: artistSchema.shape.status,
          splitRows: z.number().int().describe('Split shares that name this artist'),
          participations: z.number().int().describe(D.participations),
        }),
      ),
      candidateIsrcs: z
        .array(
          z.object({
            isrc: z.string().describe(D.isrc),
            upc: z.string().describe(D.upc),
            trackTitle: z.string().describe(D.trackTitle),
            net: money.describe(D.net),
          }),
        )
        .describe('ISRCs without any split whose Believe artist name equals the pseudonym'),
    }),
  ),
});
export type DuplicateGroups = z.infer<typeof duplicatesSchema>;

// ---- advertising expenses (D-155, D-156) ----

const adPartSchema = z.object({
  artistId: z.string().describe(D.artistId),
  pseudonym: z.string().describe(D.pseudonym),
  ownerId: z.string().nullable().describe(D.ownerId),
  weight: money.describe('split percent of the artist (100 for an allocated expense)'),
  amount: money,
  recovered: money.describe('part × recovery percent: the debt on the artist'),
});

export const adExpenseSchema = z.object({
  id: z.string(),
  isrc: z.string().nullable().describe(D.isrc),
  month,
  amountCents: z.number().int().describe(D.amountCents),
  recoveryPercent: money.describe(D.recoveryPercent),
  scope: z.enum(['any', 'publishing', 'isrc']).describe('Recorded for reference: it decides nothing about money (D-157)'),
  artistId: z.string().nullable().describe(D.artistId),
  externalRef: z.string().nullable().describe(D.externalRef),
  source: z.string().describe(D.source),
  migration: z.boolean().describe(D.migration),
  comment: z.string(),
  createdAt: timestamp,
  active: z.boolean(),
  deactivatedReason: z.string().nullable(),
  labelId: z.string().nullable().describe('The payer (D-169): the own label whose book the expense charges; required, null only for a migrated record not yet labelled'),
});
export type AdExpense = z.infer<typeof adExpenseSchema>;

export const adViewSchema = adExpenseSchema.extend({
  allocation: z
    .object({
      isrc: z.string().nullable().describe(D.isrc),
      month,
      amount: money,
      recoveryPercent: money.describe(D.recoveryPercent),
      scope: z.enum(['any', 'publishing', 'isrc']).describe('Recorded for reference: it decides nothing about money (D-157)'),
      status: z.enum(['allocated', 'pre_allocated', 'no_split', 'no_artist']),
      ourLabelId: z.string().nullable().describe("The payer (D-169): the record's label, the book the expense charges"),
      ourLabelName: z.string().nullable().describe(D.ourLabelName),
      incomeBookLabelId: z.string().nullable().describe('The book of the ISRC income at the month of the expense (information, D-169)'),
      incomeBookLabelName: z.string().nullable().describe(D.incomeBookLabelName),
      sublabelName: z.string().nullable().describe('The sublabel of the ISRC label string at the month: its rule bears the unrecovered part'),
      parts: z.array(adPartSchema),
      unrecovered: money.describe(D.unrecovered),
      borneBy: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('sublabel'), artistId: z.string().describe(D.artistId), ownerId: z.string().nullable().describe(D.ownerId), amount: money }),
        z.object({ kind: z.literal('ours'), amount: money }),
      ]),
    })
    .nullable()
    .describe('What the calculation decides for the record (null when it is deactivated)'),
});
export type AdView = z.infer<typeof adViewSchema>;

export const adListSchema = z.object({ count: z.number().int(), items: z.array(adViewSchema) });
export const adsCreatedSchema = z.object({
  created: z.array(adExpenseSchema),
  skipped: z.array(z.string()).describe('External refs already known: not recorded again'),
});
export const adSummarySchema = z.object({
  rows: z.array(
    z.object({
      month,
      label: z.string().describe("the payer by name (D-169; '?' for a record without a label)"),
      count: z.number().int(),
      amount: money,
      recoveredFromArtists: money.describe(D.recoveredFromArtists),
      borneBySublabels: money.describe(D.borneBySublabels),
      borneByUs: money.describe(D.borneByUs),
      noSplit: money.describe(D.noSplit),
    }),
  ),
  totals: z
    .object({
      count: z.number().int(),
      amount: money,
      recoveredFromArtists: money.describe(D.recoveredFromArtists),
      borneBySublabels: money.describe(D.borneBySublabels),
      borneByUs: money.describe(D.borneByUs),
      noSplit: money.describe(D.noSplit),
    })
    .describe('The sums of the rows of the period'),
});
export type AdSummary = z.infer<typeof adSummarySchema>;

// ---- the login and the organizations (stage 2, D-170) ----

const memberRole = z.enum(['org_admin', 'label_manager']);

/**
 * `GET /auth/me`, `POST /auth/login`: the session; with `AUTH_MODE=off` no user, the default organization and the role
 * `local`. D-171: the role in the session's organization (`system` for a system administrator), the labels the user
 * may choose (an `org_admin` and `local`: every own label, `allLabels`), the user's active memberships; `support` the
 * live grant a system administrator works under (role `support`, the organization of `X-Org` or of the enter).
 */
export const meSchema = z.object({
  authMode: z.enum(['on', 'off']),
  user: z.object({ id: z.string(), login: z.string(), isSystemAdmin: z.boolean() }).nullable(),
  org: z.object({ id: z.string(), name: z.string() }).nullable(),
  role: z.enum(['org_admin', 'label_manager', 'support', 'system', 'local']).nullable().describe(D.role),
  labels: z.array(z.object({ id: z.string(), name: z.string() })),
  allLabels: z.boolean(),
  memberships: z.array(z.object({ orgId: z.string(), orgName: z.string(), role: memberRole })),
  support: z.object({ orgId: z.string(), expiresAt: timestamp, write: z.boolean() }).nullable(),
  abilities: z
    .array(z.string())
    .describe('The keys `METHOD /path` of the operations the session may call, without the data (D-171): the UI closes the others'),
  publishingSource: z
    .enum(['v1', 'v2'])
    .default('v1')
    .describe('The source of the money of publishing (D-189): v2 = /publishing-v2 takes the links and terms, the old /publishing refuses writes (D-194)'),
});
export type Me = z.infer<typeof meSchema>;
export const orgSchema = z.object({ id: z.string(), name: z.string(), createdAt: timestamp, createdBy: z.string() });
export type Org = z.infer<typeof orgSchema>;
export const orgSummarySchema = orgSchema.extend({
  counts: z.object({
    labels: z.number().int(),
    files: z.number().int().describe('Loaded Believe files'),
    statements: z.number().int(),
    owners: z.number().int(),
    users: z.number().int(),
  }),
  support: z
    .object({ expiresAt: timestamp, write: z.boolean() })
    .nullable()
    .describe("The live support grant of this organization to the asking system administrator (D-171); null without one"),
});
export type OrgSummary = z.infer<typeof orgSummarySchema>;
/** A member of an organization (D-171): never a password hash; `active` = the membership, `disabled` = the user. */
export const memberSchema = z.object({
  id: z.string(),
  login: z.string(),
  role: memberRole,
  labelIds: z.array(z.string()),
  active: z.boolean(),
  disabled: z.boolean(),
  createdAt: timestamp,
  createdBy: z.string(),
});
export type Member = z.infer<typeof memberSchema>;
export const okSchema = z.object({ ok: z.literal(true) });
/** A user as the system administrator sees it (D-171): never a password hash; the memberships with their state. */
export const systemUserSchema = z.object({
  id: z.string(),
  login: z.string(),
  isSystemAdmin: z.boolean(),
  disabled: z.boolean(),
  memberships: z.array(z.object({ orgId: z.string(), orgName: z.string(), role: memberRole, active: z.boolean() })),
});
export type SystemUser = z.infer<typeof systemUserSchema>;
/** A support grant of an organization (D-171): `active` = not revoked and not expired. */
export const supportGrantSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  login: z.string(),
  write: z.boolean(),
  grantedBy: z.string(),
  grantedAt: timestamp,
  expiresAt: timestamp,
  revokedAt: timestamp.nullable(),
  revokedBy: z.string().nullable(),
  active: z.boolean(),
});
export type SupportGrant = z.infer<typeof supportGrantSchema>;

// ---- the label history of an ISRC (D-172) ----

/** `GET /tracks/:isrc/labels`, `POST /tracks/:isrc/label`: the intervals by `validFrom` (no author: it is in the audit). */
export const trackLabelSchema = z.object({
  id: z.string(),
  labelId: z.string().describe(D.labelId),
  labelName: z.string().describe(D.labelName),
  validFrom: date.describe(D.validFrom),
  validTo: date.nullable().describe('Exclusive; null = open'),
  source: z.enum(['files', 'operator', 'import']).describe('files = derived from the loaded files; operator = a correction').describe(D.source),
  note: z.string().nullable(),
  createdAt: timestamp,
});
export const trackLabelsSchema = z.array(trackLabelSchema);
export type TrackLabel = z.infer<typeof trackLabelSchema>;

// ---- the assumption (D-172) ----

/** `POST /splits/assume`: the created `assumption` document, the splits it was set on and the splits left as they were. */
export const assumeResultSchema = z.object({
  documentId: z.string().describe(D.documentId),
  assigned: z.array(z.string()).describe('The split ids that got the assumption document'),
  skipped: z.array(
    z.object({
      splitId: z.string().describe(D.splitId),
      code: z.enum(['has_document', 'empty_period']).describe('has_document: the split, or every row, already has a document (approved or not)'),
    }),
  ),
});
export type AssumeResult = z.infer<typeof assumeResultSchema>;

// ---- the release registry (D-172) ----

const releaseFieldsSchema = z.object({
  releaseTitle: z.string().describe('The release title'),
  version: z.string().nullable().describe('The version of the release'),
  artistString: z.string().nullable().describe('The artist text'),
  labelString: z.string().nullable().describe('The label text'),
  releasedAt: z.string().nullable().describe('YYYY-MM-DDTHH:MM:SS, no zone'),
  trackCount: z.number().int().nullable().describe(D.trackCount),
  catalogNumber: z.string().nullable().describe(D.catalogNumber),
  territories: z.number().int().nullable().describe(D.territories),
  stores: z.number().int().nullable().describe(D.stores),
});
export const RELEASE_ROW_CODES = ['upc_invalid', 'track_count_invalid', 'date_invalid', 'duplicate_upc'] as const;

/** `POST /releases/preview` (D-195): the export against the registry of the label; nothing is written. */
export const releasePreviewSchema = z.object({
  labelId: z.string().describe(D.labelId),
  source: z.enum(['believe']).describe('The reader of the file'),
  fileName: z.string().describe('The name of the uploaded file'),
  totals: z.object({
    rows: z.number().int().describe('Lines of the file (without the header)'),
    create: z.number().int().describe('New UPCs'),
    update: z.number().int().describe('UPCs whose fields differ'),
    unchanged: z.number().int().describe('UPCs equal to the registry (not listed)'),
    error: z.number().int().describe('Lines that cannot be applied'),
    duplicate: z.number().int().describe('Repeated lines equal to the first (ignored)'),
    missing: z.number().int().describe('UPCs of the registry not in the file (they stay)'),
  }),
  items: z.array(
    z.object({
      line: z.number().int().describe('The line of the file (the header is 1)'),
      upc: z.string().nullable().describe('The UPC, null when unreadable'),
      action: z.enum(['create', 'update', 'error', 'duplicate']).describe('What the apply would do'),
      release: releaseFieldsSchema.nullable().describe('The fields of the file'),
      before: releaseFieldsSchema.nullable().describe('The registry row (update only): send it back with the apply'),
      changes: z
        .array(
          z.object({
            field: z.string().describe('The field that differs'),
            before: z.string().nullable().describe('The registry value'),
            after: z.string().nullable().describe('The file value'),
          }),
        )
        .describe('The fields that differ (update)'),
      codes: z.array(z.enum(RELEASE_ROW_CODES)).describe('Why the line is an error'),
    }),
  ),
  missing: z
    .array(z.object({ upc: z.string().describe(D.upc), releaseTitle: z.string().describe('The release title in the registry') }))
    .describe('The registry rows the file does not list: they stay'),
});
export type ReleasePreview = z.infer<typeof releasePreviewSchema>;

/** `POST /releases/preview/apply` (D-195): what was written. */
export const releaseApplySchema = z.object({
  labelId: z.string().describe(D.labelId),
  created: z.number().int().describe('Rows created'),
  updated: z.number().int().describe('Rows rewritten'),
  upcs: z.array(z.string()).describe('The UPCs written'),
});
export type ReleaseApply = z.infer<typeof releaseApplySchema>;

/** `GET /releases/registry`: the registry rows with the distinct ISRCs of the UPC in the loaded files of the row's label. */
export const releaseRegistrySchema = z.object({
  items: z.array(
    releaseRegistryRowSchema.extend({
      isrcsInUnits: z.number().int().describe('Distinct ISRCs of the UPC in the units of the loaded files of the label'),
    }),
  ),
});
export type ReleaseRegistry = z.infer<typeof releaseRegistrySchema>;

// ---- the onboarding checklists (D-172) ----

export const ONBOARDING_KEYS = ['label', 'accounts', 'files', 'unmapped', 'catalog', 'splits', 'owners', 'documents', 'publishing'] as const;
export const ORG_ONBOARDING_KEYS = ['org', 'labels', 'users', 'accounts'] as const;
export const onboardingStateSchema = z
  .enum(['done', 'todo', 'info'])
  .describe('Decided by the backend: done, todo (something is left or nothing is loaded yet), info (shown, never blocking: publishing)');

const onboardingStepBase = {
  state: onboardingStateSchema,
  count: z.number().int().describe('The headline number: what is left to do, or for label/accounts/files/publishing what is there'),
  counts: z.record(z.string(), z.number().int()).describe('Every counter of the step by name'),
  link: z.string().describe('The client page that fixes or shows the step (a frontend route with its query)'),
};

/** `GET /onboarding?label=`: the checklist of one own label (no calculation). */
export const onboardingSchema = z.object({
  label: z.object({ id: z.string(), name: z.string() }),
  steps: z.array(
    z.object({
      key: z.enum(ONBOARDING_KEYS),
      ...onboardingStepBase,
      months: z
        .array(
          z.object({
            account: z.string().describe(D.account),
            first: month.nullable(),
            last: month.nullable(),
            gaps: z.array(month).describe('Months between first and last without a loaded file'),
          }),
        )
        .optional()
        .describe('files: per account of the label'),
      values: z.array(z.string()).optional().describe('unmapped: the label strings without an alias (at most 100)'),
    }),
  ),
});
export type Onboarding = z.infer<typeof onboardingSchema>;

/** `GET /onboarding/organization`: the checklist of the organization (its administrator's). */
export const orgOnboardingSchema = z.object({
  org: z.object({ id: z.string() }),
  steps: z.array(z.object({ key: z.enum(ORG_ONBOARDING_KEYS), ...onboardingStepBase })),
});
export type OrgOnboarding = z.infer<typeof orgOnboardingSchema>;

/** The replacement of a B17 statement (D-173): the old statement now `superseded`, the new one `loaded`, the writers. */
export const b17ReplaceSchema = z.object({
  superseded: statementSchema,
  statement: statementSchema,
  writers: resolveWritersSchema,
});

// ---- the operation import (D-173 §1.5, P29) ----

const operationImportIssue = z.object({
  code: z.enum(OPERATION_IMPORT_ISSUE_CODES as [OperationImportIssueCode, ...OperationImportIssueCode[]]),
  severity: z.enum(['error', 'warning', 'info']),
  details: z.record(z.string(), z.unknown()).optional(),
});
/** One data row of the operation file as read, resolved and classified. */
export const operationImportRowSchema = z.object({
  line: z.number().int().describe('Line of the file (the header is line 1)'),
  kind: z.string().describe('The kind as written in the file'),
  owner: z.string().nullable().describe('The owner cell as written'),
  pseudonym: z.string().nullable().describe('The pseudonym cell as written'),
  ownerId: z.string().nullable().describe('The resolved owner (by id or the one exact name, or the owner of the pseudonym)'),
  artistId: z.string().nullable().describe('The resolved pseudonym (the surviving id)'),
  amount: z.string().describe('The amount as written, or the parsed decimal'),
  date: z.string(),
  externalId: z.string().nullable(),
  documentId: z.string().nullable().describe('The resolved basis document (the cell or the documentId of the request)'),
  action: z.enum(OPERATION_IMPORT_ACTIONS),
  issues: z.array(operationImportIssue),
});
export const operationImportSchema = z.object({
  labelId: z.string().describe(D.labelId),
  fileName: z.string(),
  sha256: z.string(),
  dryRun: z.boolean(),
  applied: z.boolean(),
  totals: z.object({
    rows: z.number().int().describe(D.rows),
    create: z.number().int(),
    unchanged: z.number().int(),
    errors: z.number().int().describe('Error issues (a row may carry several)'),
    warnings: z.number().int(),
    byKind: z.record(z.string(), money).describe('The sum of the rows to create, per kind'),
  }),
  rows: z.array(operationImportRowSchema),
  result: z
    .object({ operationIds: z.array(z.string()), proofIds: z.array(z.string()) })
    .nullable()
    .describe('The created operations and payment proofs of an apply; null in a preview'),
});
export type OperationImport = z.infer<typeof operationImportSchema>;

// ---- the import of the opening balances (D-174) ----

export const startImportRowSchema = z.object({
  line: z.number().int().describe('Line of the file (the header is line 1)'),
  pseudonym: z.string().describe('The pseudonym cell as written'),
  artistId: z.string().nullable().describe(D.artistId),
  ownerId: z.string().nullable().describe(D.ownerId),
  kind: z.string().describe('start or adjustment as read (start when empty)'),
  master: money.nullable(),
  publishing: money.nullable(),
  missing: z.boolean().describe(D.missing),
  documentId: z.string().nullable().describe(D.documentId),
  operationRef: z.string().nullable(),
  action: z.enum(START_IMPORT_ACTIONS),
  issues: z.array(
    z.object({
      code: z.enum(START_IMPORT_ISSUE_CODES),
      severity: z.enum(['error', 'warning', 'info']),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

export const startImportSchema = z.object({
  labelId: z.string().describe(D.labelId),
  cutoffMonth: month,
  syncedAt: timestamp,
  fileName: z.string(),
  sha256: z.string(),
  dryRun: z.boolean(),
  applied: z.boolean(),
  totals: z.object({
    rows: z.number().int().describe(D.rows),
    create: z.number().int(),
    unchanged: z.number().int(),
    errors: z.number().int(),
    warnings: z.number().int(),
    starts: z.number().int().describe('Start rows to create'),
    adjustments: z.number().int().describe('Adjustment rows to create'),
    missing: z.number().int().describe('Start rows without an amount to create'),
    master: money.describe('Σ master of the rows to create'),
    publishing: money.describe('Σ publishing of the rows to create'),
  }),
  rows: z.array(startImportRowSchema),
  result: z.object({ ids: z.array(z.string()) }).nullable().describe('The created rows of an apply; null in a preview'),
});
export type StartImport = z.infer<typeof startImportSchema>;

// ---- the payroll export (D-173 §1.4) ----

const payrollMoney = {
  start: money.describe('The opening balance (D-174): on the pseudonym rows, the area\'s part of their start rows'),
  earned: money.describe(D.earned),
  recouped: money.describe('pseudonym row: recoupedFromMaster (taken from its master income by any position); owner row: publishingRecouped; total: the area'),
  unrecouped: money.describe('What the positions held by the pseudonym still wait for'),
  adsCharged: money.describe(D.adsCharged),
  paid: money.describe(D.paid),
  returns: money.describe(D.returns),
  credits: money.describe(D.credits),
  buyouts: money.describe(D.buyouts),
  forgiven: money.describe(D.forgiven),
  writtenOff: money.describe(D.writtenOff),
  adjustments: money.describe(D.adjustments),
};
export const payrollRowSchema = z.object({
  rowKind: z.enum(['pseudonym', 'owner', 'total']).describe(D.rowKind),
  labelName: z.string().describe(D.labelName),
  ownerId: z.string().describe(D.ownerId),
  ownerName: z.string().describe(D.ownerName),
  artistId: z.string().nullable().describe(D.artistId),
  pseudonym: z.string().nullable().describe(D.pseudonym),
  contract: z
    .object({
      number: z.string().nullable().describe('The number of the contract record (often none)'),
      documentId: z.string().describe(D.documentId),
      title: z.string(),
      documentKind: z.string().describe('contract or label_decision (a decision of the label, without a contract)'),
      labelId: z.string().nullable().describe('The label of the document; null = any label'),
      approvedAt: z.string().nullable().describe(D.approvedAt),
      approvedBy: z.string().nullable().describe(D.approvedBy),
    })
    .nullable()
    .describe('The approved contract of the owner under the label (its label first, then «any label»; the newest approval)'),
  byDecision: z.boolean().describe('Confirmed only by a label decision, without a contract (D-172)'),
  ...payrollMoney,
  payable: money.nullable().describe('total row only'),
  payableShown: money.nullable().describe(D.payableShown),
  gate: z
    .object({
      allowed: z.boolean().describe(D.allowed),
      reason: payoutGateSchema.shape.reason,
      amountCents: z.number().int().nullable().describe('null when blocked by a payout of another label (its amount is not shown)'),
      blockedByOtherLabel: z.boolean().describe(D.blockedByOtherLabel),
    })
    .nullable()
    .describe('total row only: the payout gate of the area'),
  belowThreshold: z.boolean().describe(D.belowThreshold),
});
export type PayrollRow = z.infer<typeof payrollRowSchema>;

export const payrollSchema = z.object({
  calculatedAt: timestamp,
  label: z.object({ id: z.string(), name: z.string() }),
  asOf: month.nullable(),
  area: z.enum(['master', 'publishing', 'all']).describe(D.area),
  rows: z.array(payrollRowSchema),
  waiting: z.array(
    z.object({ ownerId: z.string().describe(D.ownerId), ownerName: z.string().describe(D.ownerName), reason: cReasonSchema.describe('The C reason'), amount: money, paidAlready: money.describe(D.paidAlready) }),
  ),
  buyouts: z.array(
    z.object({
      operationId: z.string().describe(D.operationId),
      ownerId: z.string().describe(D.ownerId),
      ownerName: z.string().describe(D.ownerName),
      date,
      amount: money,
      documentId: z.string().nullable().describe(D.documentId),
      counted: z.boolean().describe(D.counted),
    }),
  ),
  control: z.array(
    z.object({ source: z.enum(['believe', 'b17']).describe(D.source), account: z.string().describe(D.account), month, A: money.describe(D.A), B: money.describe(D.B), C: money.describe(D.C), ours: money.describe(D.ours), discrepancy: money.describe(D.discrepancy) }),
  ),
  totals: z.object({
    payable: money.describe(D.payable),
    payableShown: money.describe(D.payableShown),
    bookB: money.describe('Σ earned of the total rows'),
    reconciliationB: money.describe('Σ B of the control rows of the area (believe: master, b17: publishing)'),
    bookBMatches: z.boolean().describe(D.bookBMatches),
    relabelledOperations: z.number().int().describe(D.relabelledOperations),
    defaultLabelOperations: z.number().int().describe(D.defaultLabelOperations),
  }),
  ...pageFields,
});
export type Payroll = z.infer<typeof payrollSchema>;
