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
  kind: z.enum(['label', 'person']),
  ipi: z.string().nullable(),
  status: z.enum(['confirmed', 'waiting_documents']),
  origin: z.string(),
  aliases: z.array(z.string()),
  createdAt: timestamp,
});
export type Owner = z.infer<typeof ownerSchema>;

export const trackSchema = z.object({
  id: z.string(),
  isrc: z.string().nullable(),
  upc: z.string().nullable(),
  title: z.string(),
  note: z.string().nullable(),
});
export type Track = z.infer<typeof trackSchema>;

export const artistSchema = z.object({
  id: z.string(),
  pseudonym: z.string(),
  ownerId: z.string().nullable(),
  status: z.enum(['confirmed', 'unconfirmed', 'no_owner']),
  origin: z.string(),
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
export const artistRefSchema = z.object({ id: z.string(), pseudonym: z.string() });
export type ArtistRef = z.infer<typeof artistRefSchema>;
const artistRefs = z.array(artistRefSchema).describe('The pseudonyms of the registry on the ISRC (split rows, participations, registry links), by pseudonym');

export const documentSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  fileRef: z.string().nullable(),
  ownerId: z.string().nullable(),
  requiresApproval: z.boolean(),
  status: z.enum(['not_attached', 'not_approved', 'approved']),
  approvedAt: timestamp.nullable(),
  uploadDeadline: date.nullable(),
  migration: z.boolean(),
  createdAt: timestamp,
  labelId: z
    .string()
    .nullable()
    .describe('The own label of the document (D-169); null = any label. A contract opens the label of its document'),
});
export type DocumentView = z.infer<typeof documentSchema>;

export const contractSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  documentId: z.string(),
  artistIds: z.array(z.string()),
});

/** `POST /contracts`: the created contract with its owner. */
export const createdContractSchema = contractSchema.extend({ ownerId: z.string() });

/** `details` of 409 `possible_duplicate` (`POST /owners`, `POST /artists`): the similar live records. */
export const possibleDuplicateDetailsSchema = z.object({
  similar: z.array(z.object({ id: z.string(), name: z.string(), matchedBy: z.array(z.string()) })),
});

export const publishingTermsSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  percent: z.string(),
  validFrom: date,
  validTo: date.nullable(),
  documentId: z.string().nullable(),
  operationType: z.string().nullable(),
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
  isrc: z.string(),
  validFrom: date,
  validTo: date.nullable().describe('Exclusive; null = open-ended'),
  documentId: z.string().nullable(),
  origin: z.string(),
  note: z.string().nullable(),
  shares: z.array(z.object({ artistId: z.string(), percent: z.string(), documentId: z.string().nullable() })),
  ourShare: z.string().describe('100 minus the sum of the shares; never stored'),
});

export const participationSchema = z.object({
  id: z.string(),
  isrc: z.string(),
  artistId: z.string(),
  percent: z.string(),
  base: z.enum(['net', 'bucket']),
  fundedFrom: z.enum(['top', 'artist_pool', 'artist_share', 'label_share']),
  fromArtistId: z.string().nullable(),
  validFrom: date,
  validTo: date.nullable().describe('Exclusive; null = open-ended'),
  documentId: z.string().nullable(),
  origin: z.string(),
  note: z.string().nullable(),
});
export const participationListSchema = z.object({
  total: z.number().int(),
  items: z.array(
    participationSchema.extend({
      documentStatus: z.string().describe('not_attached | not_approved | approved | missing'),
      pseudonym: z.string(),
      ownerId: z.string().nullable(),
      fromPseudonym: z.string().nullable(),
    }),
  ),
});
export type ParticipationListItem = z.infer<typeof participationListSchema>['items'][number];

// ---- labels ----

export const labelRuleSchema = z.object({
  id: z.string(),
  labelId: z.string(),
  percent: z.string(),
  recipientArtistId: z.string(),
  validFrom: date,
  validTo: date.nullable().describe('Exclusive; null = open-ended'),
  documentId: z.string().nullable(),
  note: z.string().nullable(),
});
export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['own', 'sublabel']),
  ownLabelId: z.string().nullable(),
  aliases: z.array(z.string()),
  rules: z.array(labelRuleSchema),
  accounts: z.array(z.string()).describe('The Believe accounts registered under the own label (D-168); empty for a sublabel'),
});
export const labelListItemSchema = labelSchema.extend({
  rules: z.array(
    labelRuleSchema.extend({
      recipientPseudonym: z.string(),
      documentStatus: z.string().describe('not_attached | not_approved | approved | missing'),
    }),
  ),
});
export type LabelListItem = z.infer<typeof labelListItemSchema>;

export const splitListItemSchema = splitSchema.extend({
  documentStatus: z.string().describe('not_attached | not_approved | approved | missing'),
  shares: z.array(
    z.object({
      artistId: z.string(),
      percent: z.string(),
      documentId: z.string().nullable(),
      pseudonym: z.string(),
      ownerId: z.string().nullable(),
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
  isrc: z.string(),
  pseudonym: z.string(),
  artistId: z.string().nullable().describe('The existing pseudonym (by artist_id or the one exact name); null = new or unresolved'),
  percent: z.string(),
  from: z.string(),
  fromFloored: date.nullable(),
  to: z.string().nullable(),
  toFloored: date.nullable(),
  owner: z.string().nullable(),
  documentId: z.string().nullable(),
  group: z.string().describe('The key of its group: ISRC|floored from'),
  issues: z.array(importIssue),
});
/** One group = one split: what the apply does with it. */
export const splitImportGroupSchema = z.object({
  key: z.string(),
  isrc: z.string(),
  from: date,
  to: date.nullable(),
  action: z.enum(SPLIT_IMPORT_ACTIONS),
  ourShare: z.string(),
  documentId: z.string().nullable().describe('The document of the split (all rows name the same one), else null'),
  before: z
    .array(z.object({ artistId: z.string(), pseudonym: z.string(), percent: z.string(), documentId: z.string().nullable() }))
    .nullable()
    .describe('The rows in force at `from` that a change replaces'),
});
export const splitImportSchema = z.object({
  labelId: z.string(),
  fileName: z.string(),
  sha256: z.string(),
  dryRun: z.boolean(),
  applied: z.boolean(),
  totals: z.object({
    rows: z.number().int(),
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
  merges: z.array(z.object({ fromId: z.string(), intoId: z.string(), reason: z.string(), at: timestamp })),
  owner: ownerSchema.nullable(),
  tracks: z.array(trackSchema),
  contracts: z.array(contractSchema).describe('The contracts of the owner that name the pseudonym'),
  splits: z.array(splitListItemSchema).describe('Every split with a row of the pseudonym (any period, every id)'),
  participations: z.array(participationListSchema.shape.items.element),
  labelRules: z.array(labelListItemSchema.shape.rules.element.extend({ labelName: z.string() })).describe('Sublabel rules whose recipient is the pseudonym'),
  documents: z.array(documentSchema).describe('The documents the splits, rows, participations, contracts and rules above cite'),
});
export type ArtistDetail = z.infer<typeof artistDetailSchema>;

// ---- sources (Believe) and publishing (B17) ----

export const sourceFileSchema = z.object({
  id: z.string(),
  source: z.string(),
  account: z.string(),
  reportingMonth: month,
  reportId: z.string().nullable(),
  fileName: z.string(),
  sha256: z.string(),
  status: z.enum(['loading', 'loaded', 'failed', 'superseded']),
  lineCount: z.number().int().nullable(),
  netTotal: money.nullable(),
  grossTotal: money.nullable(),
  uploadedBy: z.string().describe('The operator (X-Operator) who uploaded the file, or the loading script'),
  labelId: z.string().nullable().describe('The own label the file was loaded under (D-169); null = loaded before the labels'),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const statementSchema = z.object({
  id: z.string(),
  source: z.string(),
  periods: z.array(z.string()),
  fileName: z.string(),
  sha256: z.string(),
  generatedAt: timestamp,
  generatedAtSource: z.string(),
  uploadedAt: timestamp,
  status: z
    .enum(['loaded', 'superseded', 'failed'])
    .describe('loaded = counted; superseded = replaced by a corrected file of the same quarters, its lines kept (D-173)'),
  lineCount: z.number().int(),
  totalPayable: money,
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
  account: z.string(),
  reportingMonth: month,
  fileName: z.string(),
});

export const sourceLineSchema = z.object({
  fileId: z.string(),
  account: z.string(),
  reportingMonth: month,
  salesMonth: month,
  platform: z.string(),
  country: z.string(),
  isrc: z.string(),
  upc: z.string(),
  currency: z.string(),
  subscriptionType: z.string(),
  salesType: z.string(),
  releaseType: z.string(),
  quantity: z.string(),
  gross: money,
  net: money,
  mergedLines: z.string().describe('How many lines of the report were summed into this one'),
  artistName: z.string(),
  trackTitle: z.string(),
});

export const sourceLinesPageSchema = z.object({
  files: z.array(fileRefSchema),
  items: z.array(sourceLineSchema),
  total: z.object({
    keys: z.string(),
    quantity: z.string(),
    gross: money,
    net: money,
    mergedLines: z.string(),
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
  writerNorm: z.string(),
  displayName: z.string(),
  ownerId: z.string().nullable(),
  resolution: z.string(),
  role: z.enum(['holder', 'songwriter']),
});

export const resolveWritersSchema = z.object({
  matched: z.number().int(),
  created: z.number().int(),
  ambiguous: z.number().int(),
  external: z.number().int(),
});

export const b17UploadSchema = z.object({ statement: statementSchema, writers: resolveWritersSchema });

// ---- reports ----

export const reconciliationRowSchema = z.object({
  source: z.enum(['believe', 'b17']),
  account: z.string().describe('Believe account of the files; "b17" for publishing'),
  month,
  A_received: money,
  B_notOurs: money,
  C_waiting: money,
  C_breakdown: cBreakdown,
  ourShare: money.describe('Σ of the label shares that are ours (the layer state)'),
  ourShareByLabel: z.record(z.string(), money).describe('ourShare per our label of record (name)'),
  ourShareNoSplit: money.describe('The label share of the units without a split: in C `no_split` since D-175 (before: part of ourShare)'),
  discrepancy: money,
  fileTotal: money.nullable(),
  fileDiscrepancy: money.nullable(),
  byLabel: z
    .record(z.string(), z.object({ A_received: money, B_notOurs: money, C_waiting: money, ourShare: money, ourShareNoSplit: money }))
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
    withoutIsrc: money,
    count: z.number().int(),
    pairs: z.array(
      z.object({
        isrc: z.string(),
        upc: z.string(),
        net: money,
        months: z.array(z.string()),
        reportTitle: z.string(),
      }),
    ),
  }),
  isrcsWithoutSplit: z.object({
    count: z.number().int(),
    items: z.array(z.object({ isrc: z.string(), net: money })),
  }),
  ambiguousWriters: z.array(z.object({ writerNorm: z.string(), displayName: z.string() })),
  unfunded: z
    .array(
      z.object({
        isrc: z.string(),
        upc: z.string(),
        month,
        salesMonth: month.describe('The sales month of the unit (a shortfall is per unit)'),
        ruleId: z.string(),
        artistId: z.string().describe('The participation recipient (the rule id is a participation id)'),
        pseudonym: z.string(),
        fundedFrom: z.string().nullable().describe('The bucket the participation is funded from'),
        missing: money,
        why: z.enum(['bucket_short', 'no_source_row', 'top_above_100']),
      }),
    )
    .describe('Carves larger than their bucket: the missing part is not money (10 §3)'),
  labelUnmapped: z.array(z.object({ labelName: z.string(), net: money })),
  sublabelWithoutRule: z
    .array(z.object({ label: z.string(), month, net: money }))
    .describe('Units of a sublabel with no rule in force at the report month (the imprint has no deal yet)'),
  ruleRecipientIsRow: z
    .array(z.object({ isrc: z.string(), artistId: z.string(), pseudonym: z.string(), month }))
    .describe('The sublabel rule recipient also has a split row on the same unit: the double-pay shape'),
  twoRowsOneOwner: z
    .array(z.object({ isrc: z.string(), ownerId: z.string(), month, pseudonyms: z.array(z.string()) }))
    .describe('Two split rows of one ISRC-month belong to pseudonyms of the same owner (information only)'),
  tracksWithNote: z.array(
    z.object({
      trackId: z.string(),
      isrc: z.string().nullable(),
      upc: z.string().nullable(),
      title: z.string(),
      note: z.string(),
    }),
  ),
  participantsWithoutOwner: z.array(
    z.object({
      participationId: z.string(),
      isrc: z.string(),
      artistId: z.string(),
      pseudonym: z.string(),
      fundedFrom: z.string(),
      amount: money,
    }),
  ),
  assumptions: z.array(
    z.object({
      documentId: z.string().nullable(),
      basis: z.enum(['document', 'q11', 'r1']),
      amount: money,
      isrcs: z.array(z.string()),
    }),
  ),
  operationsWithoutLabel: z
    .array(
      z.object({
        operationId: z.string(),
        ownerId: z.string().nullable(),
        ownerName: z.string().nullable(),
        artistId: z.string().nullable(),
        pseudonym: z.string().nullable(),
        meaning: z.enum(['payout', 'recoupable_payout', 'deduction', 'credit', 'return']),
        date,
        amountCents: z.number().int(),
      }),
    )
    .describe('Active operations without a label (D-168): the history before the split; the operator sets the label on P21'),
  labelOutsideAccount: z
    .array(
      z.object({
        account: z.string(),
        month,
        labelName: z.string().describe('The label string of the units'),
        ourLabelName: z.string().describe('The own label the string leads to'),
        accountLabelName: z.string().describe('The own label the file of the units was loaded under: their book (D-169)'),
        net: money,
        units: z.number().int(),
      }),
    )
    .describe(
      'Units whose label string leads to another own label than the one their file was loaded under, the book (D-168, D-169); the money stays in the book of the file',
    ),
  filesWithoutLabel: z
    .array(
      z.object({
        fileId: z.string(),
        account: z.string(),
        reportingMonth: month,
        fileName: z.string(),
      }),
    )
    .describe("Loaded Believe files without a label (D-169): their units sit in the book '?'; empty under a label"),
  statementsWithoutLabel: z
    .array(
      z.object({
        statementId: z.string(),
        periods: z.array(z.string()),
        fileName: z.string(),
      }),
    )
    .describe("Loaded B17 statements without a label (D-169): their lines sit in the book '?'; empty under a label"),
  adsWithoutLabel: z
    .array(z.object({ adId: z.string(), isrc: z.string().nullable(), month, amount: money }))
    .describe("Active advertising records without a payer (D-169): they charge the book '?'; the operator sets the label (PATCH /ads/:id); empty under a label"),
  adOutsideBook: z
    .array(
      z.object({
        adId: z.string(),
        isrc: z.string(),
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
        isrc: z.string(),
        account: z.string(),
        bookLabelId: z.string().describe('The label the file of the units was loaded under: their book'),
        catalogLabelId: z.string().nullable().describe('The label of the history at the month of the units; null = no interval holds it'),
        firstMonth: month,
        lastMonth: month,
        units: z.number().int(),
        net: money,
      }),
    )
    .describe('Units of an ISRC with a label history whose book is not the catalog label of their month (D-172, information: a tail on the old account); the money stays in the book'),
  tracksWithoutLabel: z
    .array(z.object({ isrc: z.string(), lastMonth: month, bookLabelId: z.string().nullable(), net: money }))
    .describe('ISRCs of the units without a label-history interval at their last reporting month (D-172); the operator sets it on P6'),
  releasesIncomplete: z
    .array(z.object({ upc: z.string(), labelId: z.string(), title: z.string(), trackCount: z.number().int(), isrcsInUnits: z.number().int() }))
    .describe('Releases of the registry of a label whose trackCount is larger than the distinct ISRCs of the UPC in the units of its book (D-172, information; all loaded files, the period is not applied)'),
  releasesUnknown: z
    .array(z.object({ upc: z.string(), bookLabelId: z.string(), releaseTitle: z.string(), net: money }))
    .describe('UPCs of the units of a book whose label has a release registry without that UPC (D-172, information: import a fresh export)'),
  operationsDefaultLabel: z
    .array(
      z.object({
        operationId: z.string(),
        kind: z.enum(OPERATION_KINDS),
        labelId: z.string().nullable(),
        ownerId: z.string().nullable(),
        ownerName: z.string().nullable(),
        artistId: z.string().nullable(),
        pseudonym: z.string().nullable(),
        date,
        amountCents: z.number().int(),
      }),
    )
    .describe('Active operations whose label is the default of the history (D-168: a mixed owner or no units → 0to8; label source `default`, D-173): the product owner revisits them, the operator relabels with a reason'),
  forgivenessReduced: z
    .array(
      z.object({
        operationId: z.string().describe('The advance'),
        ownerId: z.string(),
        ownerName: z.string().nullable(),
        artistId: z.string(),
        pseudonym: z.string().nullable(),
        labelId: z.string().nullable(),
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
    label: z.string(),
  }),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  artistId: z.string().nullable(),
  pseudonym: z.string().nullable(),
  documentId: z.string().nullable(),
  documentStatus: z.enum(['approved', 'not_approved', 'not_attached', 'missing']).nullable(),
  ruleId: z.string().nullable(),
  amount: money,
  isrcCount: z.number().int(),
  months: z.object({ from: month, to: month }),
  isrcs: z.array(z.object({ isrc: z.string(), amount: money })).describe('Top 20 by |amount|'),
  assumptionBasis: z.enum(['document', 'q11', 'r1']).nullable(),
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
  reconciliation: z.array(reconciliationRowSchema.extend({ negativeRemainders: z.number().int() })),
  totals: z
    .object({
      all: kpiSumsSchema,
      bySource: z.object({ believe: kpiSumsSchema, b17: kpiSumsSchema }),
      byAccount: z.array(kpiSumsSchema.extend({ source: z.enum(['believe', 'b17']), account: z.string() })),
      byLabel: z.record(z.string(), kpiSumsSchema).describe("The same sums per book (by name, '?' = without a label): the label a file or statement was loaded under, D-168, D-169"),
    })
    .describe('The KPI cards of P1 over the reconciliation rows of the period: all, per source, per source × account, per label (D-160, D-168)'),
  queue: z.array(
    z.object({ reason: cReasonSchema, amount: money, groups: z.number().int(), isrcs: z.number().int() }),
  ),
  signals: z.array(z.object({ name: z.string(), count: z.number().int() })),
  files: z.object({ believe: z.number().int(), b17: z.number().int() }),
});
export type Overview = z.infer<typeof overviewSchema>;

/** Whether the payout button works for the owner now, and why not (17 N19); the client shows it, never recomputes it. */
export const payoutGateSchema = z.object({
  allowed: z.boolean(),
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
  earned: money,
  recouped: money,
  adsCharged: money,
  paid: money,
  returns: money,
  credits: money,
  buyouts: money,
  writtenOff: money,
  adjustments: money,
  payable: money,
});
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
  earned: money,
  waiting: money,
  recouped: money.describe('By the label of the income consumed: a position under a label is recouped from that label only'),
  adsCharged: money,
  paid: money,
  returns: money,
  credits: money,
  ...kindBookFields,
  payable: money,
  payableShown: money,
  payableNegative: z.boolean(),
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
  kind: z.enum(OPENING_BALANCE_KINDS),
  cutoffMonth: month.describe('The last report month inside the start'),
  syncedAt: timestamp.describe('The boundary of the movements: operations of the book dated up to its day are inside the start'),
  masterCents: z.number().int(),
  publishingCents: z.number().int(),
  missing: z.boolean().describe('The cabinet gave no amount: not a zero, the payout is closed'),
  basis: z.string(),
  documentId: z.string().nullable(),
  operationRef: z.string().nullable().describe('An advance before the cut kept alive after it (reopened)'),
  comment: z.string(),
  createdAt: timestamp,
  active: z.boolean(),
  deactivatedReason: z.string().nullable(),
});
export type OpeningBalance = z.infer<typeof openingBalanceSchema>;

/** A row of the start list: the row with its pseudonym and owner. */
export const openingBalanceRowSchema = openingBalanceSchema.extend({
  pseudonym: z.string(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
});

/** `GET /settlements/start`: the opening balances of a book with their sums. */
export const startListSchema = z.object({
  label: labelRef.nullable().describe('The book asked for; null = every book'),
  rows: z.array(openingBalanceRowSchema),
  totals: z.object({
    rows: z.number().int(),
    starts: z.number().int().describe('Active start rows'),
    adjustments: z.number().int().describe('Active adjustment rows'),
    missing: z.number().int().describe('Active start rows without an amount'),
    inactive: z.number().int(),
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
      labelId: z.string().nullable(),
      cutoffMonth: month,
      syncedDay: date.describe('The day of syncedAt (UTC): operations of the book dated up to it are inside the start'),
      syncedAt: timestamp,
    }),
  ),
  rows: z.array(openingBalanceSchema.extend({ pseudonym: z.string() })),
  insideStart: z
    .object({
      earned: money,
      waiting: money,
      paid: money,
      advances: money,
      adsCharged: money,
      operations: z.number().int(),
    })
    .describe('What the start replaced: the inputs the cut removed (reference only, never in payable)'),
});

// ---- the admission (D-176): the payee, the holds, the answers ----

export const PAYEE_CHANNELS = ['tipalti', 'easystaff', 'other'] as const;
export const HOLD_KINDS = ['decision', 'artist_request', 'question', 'dispute'] as const;
export const ANSWER_DECISIONS = ['pay', 'pay_task'] as const;

export const payeeSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  channel: z.enum(PAYEE_CHANNELS),
  payeeRef: z.string().nullable().describe('The reference in the cash register (a Tipalti payee id, an EasyStaff e-mail); null = by the payment history'),
  status: z.enum(['confirmed', 'proposed']),
  basis: z.string(),
  validFrom: date,
  source: z.string().nullable(),
  createdAt: timestamp,
  active: z.boolean(),
  deactivatedReason: z.string().nullable(),
});
export type Payee = z.infer<typeof payeeSchema>;

export const holdSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  labelId: z.string().nullable().describe('The book the hold acts in; null = every book'),
  kind: z.enum(HOLD_KINDS),
  blocks: z.boolean().describe('Closes the payout (a hold, a dispute that blocks the row) or informs only'),
  reason: z.string(),
  releaseWhen: z.string().nullable().describe('The condition of the release'),
  amountCents: z.number().int().nullable(),
  period: z.string().nullable(),
  reviewOn: date.nullable(),
  since: date,
  source: z.string().nullable(),
  status: z.enum(['active', 'released']),
  releasedAt: timestamp.nullable(),
  releasedReason: z.string().nullable(),
  createdAt: timestamp,
});
export type Hold = z.infer<typeof holdSchema>;

export const payoutAnswerSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  labelId: z.string().nullable(),
  dueCents: z.number().int().describe('The answer holds for exactly this payable amount'),
  decision: z.enum(ANSWER_DECISIONS),
  why: z.string(),
  about: z.string().describe('The question answered (an irregular history, the first payout, the contract)'),
  answeredBy: z.string(),
  source: z.string().nullable(),
  createdAt: timestamp,
  active: z.boolean(),
  deactivatedReason: z.string().nullable(),
});
export type PayoutAnswer = z.infer<typeof payoutAnswerSchema>;

const ownerName = { ownerName: z.string().nullable() };

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

export const contractThresholdSchema = z.object({ id: z.string(), ownerId: z.string(), payoutThresholdCents: z.number().int().nullable() });

export const balanceSchema = z.object({
  owner: ownerSchema,
  confirmed: z.boolean(),
  payout: payoutGateSchema,
  admission: admissionOfOwnerSchema.optional().describe('The admission of the owner (D-176); absent in older snapshots'),
  label: labelRef.nullable().describe('The label the balance is restricted to (D-168); null = the whole owner'),
  period: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    basis: z.enum(['report', 'sales']),
    received: money,
    notOurs: money,
    waiting: money,
    waitingBreakdown: cBreakdown,
    otherParticipants: money,
    ourShare: money,
    earnedMaster: money,
    earnedPublishing: money,
    paid: money,
    advancesPaid: money,
    recouped: money,
  }),
  total: z.object({
    earned: money,
    waiting: money,
    recouped: money,
    adsCharged: money.describe('Advertising charged to the owner, taken off payable at once (D-157)'),
    paid: money,
    returns: money,
    credits: money,
    ...kindBookFields,
    payable: money.describe('start + earned − recouped − paid − adsCharged + returns + credits + adjustments − writtenOff (D-173, D-174)'),
    payableShown: money,
    payableNegative: z.boolean().describe('payable < 0 (computed by the backend)'),
  }),
  byLabel: z
    .record(z.string(), labelBookSchema)
    .describe(
      "The book of every label (by name, '?' = without a label): master money goes by the label its file was loaded under (D-169); Σ over the books = total, field by field (D-168); under a label view the one book",
    ),
  artists: z.array(
    z.object({
      artistId: z.string(),
      pseudonym: z.string(),
      earned: money,
      waiting: money,
      recouped: money,
      unrecouped: money,
      start: money.optional().describe('The opening balance of the pseudonym (D-174)'),
      tracks: z.array(z.object({ isrc: z.string(), net: money, amount: money, waiting: money })),
      byLabel: z.record(
        z.string(),
        z.object({
          labelId: z.string().nullable(),
          earned: money,
          waiting: money,
          recouped: money,
          unrecouped: money,
          recoupedFromMaster: money,
          forgiven: money.optional().describe('The effective forgiveness of the positions this pseudonym holds (D-173)'),
          start: money.optional().describe('The opening balance of the pseudonym in the book (D-174)'),
        }),
      ),
    }),
  ),
  start: startViewSchema.nullable().optional().describe('The opening balances of the owner\'s pseudonyms and the cut they make (D-174); null without any, absent in older snapshots'),
  publishing: z.array(
    z.object({
      period: z.string(),
      workTitle: z.string(),
      payable: money,
      percent: money,
      amount: money,
      category: z.string(),
      reason: z.string().nullable(),
    }),
  ),
  positions: z.array(
    z.object({
      operationId: z.string(),
      artistId: z.string(),
      amount: money,
      recouped: money,
      forgiven: money.optional().describe('The effective forgiveness (D-173): amount = recouped + forgiven + remaining'),
      forgivenRecorded: money
        .optional()
        .describe('The counted forgivenesses as recorded (D-173): above `forgiven` when income before the date came later (signal forgivenessReduced)'),
      remaining: money,
      scope: z.object({ kind: z.string() }),
      date,
      labelId: z.string().nullable().describe('The label of the operation (D-168); null = recouped from any income'),
    }),
  ),
  ads: z
    .array(
      z.object({
        adId: z.string(),
        isrc: z.string().nullable(),
        month,
        artistId: z.string(),
        role: z.enum(['artist', 'sublabel']),
        amount: money,
        labelId: z.string().nullable().describe("The label of record of the expense (D-168); null = none"),
      }),
    )
    .describe('Advertising charged to the owner (D-157): taken off payable at once, newest month first'),
  pendingOperations: z.array(z.object({ operationId: z.string(), why: z.string() })),
  blockingPayouts: z.array(z.string()),
});
export type Balance = z.infer<typeof balanceSchema>;

/** `GET /artists/:id/balance` (P12, D-165): the money of one pseudonym, the artist row of its owner's balance with its parts. */
export const artistBalanceSchema = z.object({
  artist: artistSchema,
  owner: ownerSchema.nullable(),
  artistId: z.string(),
  pseudonym: z.string(),
  ownerId: z.string().nullable(),
  label: labelRef.nullable().describe('The label the money is restricted to (D-168); null = every book'),
  period: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    basis: z.enum(['report', 'sales']),
    received: money.describe('Σ net of the units where the pseudonym has an allocation'),
    earned: money,
    waiting: money,
    waitingBreakdown: cBreakdown,
  }),
  total: z.object({
    earned: money,
    waiting: money,
    recouped: money,
    unrecouped: money,
    recoupedFromMaster: money.describe('Part of this pseudonym\'s master income consumed by recoupment'),
    adsCharged: money.describe('Advertising charged to this pseudonym, taken off the owner\'s payable at once (D-157)'),
    paid: money.describe('Payouts tied to this pseudonym (the button pays the owner: those carry no pseudonym)'),
    start: money.optional().describe('The opening balance of the pseudonym (D-174)'),
  }),
  byLabel: z
    .record(
      z.string(),
      z.object({
        labelId: z.string().nullable(),
        earned: money,
        waiting: money,
        recouped: money,
        unrecouped: money,
        recoupedFromMaster: money,
        adsCharged: money,
        paid: money,
        start: money.optional(),
      }),
    )
    .describe("The book of every label of the pseudonym (by name, '?' = without a label): Σ books = total (D-168)"),
  tracks: z.array(z.object({ isrc: z.string(), net: money, amount: money, waiting: money })),
  positions: balanceSchema.shape.positions,
  ads: balanceSchema.shape.ads,
  pendingOperations: balanceSchema.shape.pendingOperations,
});
export type ArtistBalance = z.infer<typeof artistBalanceSchema>;

/** `GET /artists/balances` (P11, D-167): the totals of `GET /artists/:id/balance` for a list of pseudonyms, from one calculation. */
export const artistBalanceItemSchema = z.object({
  artistId: z.string(),
  pseudonym: z.string(),
  ownerId: z.string().nullable(),
  earned: money,
  waiting: money,
  recouped: money,
  unrecouped: money,
  adsCharged: money,
  paid: money,
  remaining: money.describe('earned − recouped − adsCharged − paid: what this pseudonym left for its owner\'s payable (the payout is the owner\'s)'),
});
export const artistBalancesSchema = z.object({ calculatedAt: timestamp, items: z.array(artistBalanceItemSchema), ...pageFields });
export type ArtistBalanceItem = z.infer<typeof artistBalanceItemSchema>;

// ---- track explanation (the state after every master layer, D-127) ----

export const allocationSchema = z.object({
  artistId: z.string(),
  ownerId: z.string().nullable(),
  layer: z.enum(['split', 'top', 'carve', 'sublabel']),
  kind: z.enum(['row', 'top', 'artist_pool', 'artist_share', 'label_share', 'sublabel']),
  ruleId: z.string().describe('split id (row), participation id (top, carve), label rule id (sublabel)'),
  documentId: z.string().nullable(),
  percent: money,
  amount: money,
  category: z.enum(['B', 'C']),
  reason: cReasonSchema.nullable(),
  assumption: z.enum(['document', 'q11', 'r1']).nullable(),
});

const shortfallSchema = z.object({
  isrc: z.string(),
  upc: z.string(),
  month,
  ruleId: z.string(),
  missing: money,
  why: z.string(),
});
const unitStatus = z.enum(['allocated', 'no_split', 'unknown_pair', 'no_isrc']);
const labelShareCategory = z.enum(['ours', 'label_unmapped', 'no_isrc', 'unknown_pair', 'no_split']);

export const layerStateSchema = z.object({
  layer: z.string(),
  status: unitStatus,
  ourLabelId: z.string().nullable(),
  ourLabelName: z.string().nullable(),
  rule: z
    .object({
      id: z.string(),
      percent: money,
      recipientArtistId: z.string(),
      documentId: z.string().nullable(),
    })
    .nullable(),
  scaledNet: money,
  labelShare: money,
  labelShareCategory,
  allocations: z.array(allocationSchema),
  shortfalls: z.array(shortfallSchema),
});

export const explainSchema = z.object({
  isrc: z.string(),
  splits: z.array(splitSchema),
  participations: z.array(z.looseObject({ id: z.string(), artistId: z.string(), fundedFrom: z.string() })),
  units: z.array(
    z.object({
      account: z.string(),
      isrc: z.string(),
      upc: z.string(),
      reportingMonth: month,
      salesMonth: month,
      labelName: z.string(),
      net: money,
      status: unitStatus,
      ourLabelId: z.string().nullable(),
      ourLabelName: z.string().nullable(),
      labelShare: money,
      labelShareCategory,
      ours: money,
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
  direction: z.enum(['in', 'out']),
  amountCents: z.number().int(),
  ownerId: z.string().nullable(),
  artistId: z.string().nullable(),
  date,
  period: z.string().nullable(),
  scope: z
    .object({
      kind: z.string(),
      isrcs: z.array(z.string()).optional(),
      excludeIsrcs: z.array(z.string()).optional(),
    })
    .nullable(),
  documentId: z.string().nullable(),
  paymentProofId: z.string().nullable(),
  operationRef: z.string().nullable(),
  deferred: z.boolean(),
  migration: z.boolean(),
  comment: z.string(),
  externalRef: z.string().nullable(),
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
  area: z.enum(['master', 'publishing']).describe('The area of the book (D-173); the history is master'),
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
  operator: z.string(),
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
  ownerId: z.string(),
  name: z.string(),
  kind: z.enum(['label', 'person']),
  status: z.enum(['confirmed', 'waiting_documents']),
  confirmed: z.boolean(),
  earned: money,
  waiting: money,
  waitingBreakdown: cBreakdown.describe('Category C of the requested period by reason'),
  recouped: money,
  paid: money,
  returns: money,
  credits: money,
  buyouts: kindBookFields.buyouts,
  forgiven: kindBookFields.forgiven,
  writtenOff: kindBookFields.writtenOff,
  adjustments: kindBookFields.adjustments,
  start: kindBookFields.start,
  startMissing: kindBookFields.startMissing,
  payable: money,
  payableShown: money,
  payableNegative: z.boolean().describe('payable < 0 (computed by the backend)'),
  payout: payoutGateSchema,
  blockingPayouts: z.number().int(),
  pendingOperations: z.number().int(),
  lastPayoutDate: date.nullable().describe('Date of the newest active payout (any kind of proof)'),
});
export const payablesSchema = z.object({ calculatedAt: timestamp, items: z.array(payableItemSchema), ...pageFields });
export type PayableItem = z.infer<typeof payableItemSchema>;

/** Money of a set of units: net received, B (owners), C (waiting) with reasons, ours. */
const moneySums = {
  net: money,
  B: money,
  C: money,
  ours: money,
  cByReason: cBreakdown,
};

export const trackSummaryItemSchema = z.object({
  isrc: z.string(),
  upcs: z.array(z.string()),
  title: z.string(),
  artistName: z.string().describe('The artist string of the report pair (text, may name no pseudonym)'),
  artists: artistRefs,
  ...moneySums,
  months: z.object({ from: month.nullable(), to: month.nullable(), count: z.number().int() }),
  hasSplit: z.boolean(),
  hasParticipations: z.boolean(),
});
export const trackSummarySchema = z.object({
  calculatedAt: timestamp,
  items: z.array(trackSummaryItemSchema),
  ...pageFields,
});

/** The tracks without money (D-162): the ISRC set of `trackSummary()`, no calculation. */
export const trackCatalogItemSchema = z.object({
  isrc: z.string(),
  upcs: z.array(z.string()),
  title: z.string(),
  artistName: z.string().describe('The artist string of the report pair (text, may name no pseudonym)'),
  artists: artistRefs,
  hasSplit: z.boolean(),
  hasParticipations: z.boolean(),
  registered: z.boolean().describe('Registered in module 1 (a track row); false for an ISRC known from the reports only'),
  catalogLabelId: z.string().nullable().describe('The label of the open label-history interval (D-172); not the book'),
  catalogLabelName: z.string().nullable(),
  catalogFrom: date.nullable().describe('Start of the open interval'),
});
export const trackCatalogSchema = z.object({ items: z.array(trackCatalogItemSchema), ...pageFields });
export type TrackCatalogItem = z.infer<typeof trackCatalogItemSchema>;
export type TrackSummaryItem = z.infer<typeof trackSummaryItemSchema>;

const documentStatusOfAllocation = z.enum(['approved', 'not_approved', 'not_attached', 'missing']);

export const trackMoneyMonthSchema = z.object({
  account: z.string(),
  upc: z.string(),
  reportingMonth: month,
  salesMonth: month,
  labelName: z.string(),
  ourLabelName: z.string().nullable().describe('The own label the label string leads to: decides the sublabel rule and «ours»'),
  bookLabelId: z.string().nullable().describe("The book of the unit: the label its file was loaded under (D-169); null = '?'"),
  bookLabelName: z.string().nullable(),
  sublabelName: z.string().nullable(),
  rule: z.string().nullable().describe('Id of the sublabel rule in force at the report month'),
  net: money,
  labelShare: money,
  labelShareCategory,
  ours: money,
  status: unitStatus,
  allocations: z.array(
    allocationSchema.extend({
      pseudonym: z.string(),
      ownerName: z.string().nullable(),
      documentStatus: documentStatusOfAllocation,
    }),
  ),
  shortfalls: z.array(shortfallSchema),
  layers: z.array(layerStateSchema).describe('The state after every layer that ran, in order'),
});
export const trackMoneySchema = z.object({
  isrc: z.string(),
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
  reportingMonth: month,
  salesMonth: month,
  platform: z.string(),
  country: z.string(),
  subscriptionType: z.string(),
  salesType: z.string(),
  upc: z.string(),
  net: money,
  quantity: z.number().int(),
});
export const trackBreakdownSchema = z.object({
  isrc: z.string(),
  month,
  rows: z.array(breakdownRowSchema),
});

/** One row of the release registry of a label (D-172): the Believe release export, no money. */
const releaseRegistryRowSchema = z.object({
  labelId: z.string(),
  labelName: z.string(),
  upc: z.string(),
  title: z.string(),
  version: z.string().nullable(),
  artistString: z.string().nullable().describe('The artist text of the export (not matched against the pseudonyms)'),
  labelString: z.string().nullable().describe('The label text of the export'),
  releaseDate: date.nullable(),
  trackCount: z.number().int().nullable(),
  catalogNumber: z.string().nullable(),
  territories: z.number().int().nullable(),
  stores: z.number().int().nullable(),
  importedAt: timestamp,
});

export const releasesSchema = z.object({
  items: z.array(
    z.object({
      upc: z.string(),
      title: z.string(),
      artistName: z.string().describe('The artist string of the first report pair of the UPC (text)'),
      artists: z.array(artistRefSchema).describe('The pseudonyms of the registry over the tracks of the UPC, by pseudonym'),
      trackCount: z.number().int(),
      net: money.describe('Net of the loaded Believe files, all months'),
      registered: z.boolean().describe('The UPC is in the release registry (D-172): of the label under a label, of any label under «Все»'),
      registry: releaseRegistryRowSchema
        .nullable()
        .describe('The registry row (D-172): of the label under a label, the last imported one under «Все»; null = not registered'),
    }),
  ),
  ...pageFields,
});
export const releaseSchema = z.object({
  upc: z.string(),
  title: z.string(),
  artistName: z.string().describe('The artist string of the first report pair of the UPC (text)'),
  artists: z.array(artistRefSchema).describe('The pseudonyms of the registry over the tracks of the release, by pseudonym'),
  tracks: z.array(z.object({ isrc: z.string(), title: z.string(), artists: artistRefs, ...moneySums })),
  months: z.array(z.object({ reportingMonth: month, ...moneySums })),
  registry: z
    .array(releaseRegistryRowSchema)
    .describe('The release registry rows of the UPC (D-172): under a label its row only, under «Все» the row of every label; [] = not registered'),
});

export const documentUsesSchema = z.object({
  document: documentSchema,
  splits: z.array(splitListItemSchema),
  rowsOnly: z
    .array(z.object({ splitId: z.string(), isrc: z.string(), artistId: z.string() }))
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
  ownerId: z.string(),
  labelId: z.string().optional().describe('The label the payout was made under (D-168); absent in snapshots before it'),
  labelName: z.string().optional(),
  amountCents: z.number().int(),
  area: z.enum(['master', 'publishing', 'all']).optional().describe('The area paid (D-173); absent in snapshots before it'),
  payableExact: money,
  total: balanceSchema.shape.total.extend({ adsCharged: money.optional() }),
  payoutByArtist: z.array(z.object({ key: z.string(), label: z.string(), net: money, shareOfPayout: money })),
  perArtist: z.array(
    z.object({
      artistId: z.string(),
      pseudonym: z.string(),
      earned: money,
      recouped: money,
      unrecouped: money,
      waiting: money,
      tracks: z.array(z.object({ isrc: z.string(), net: money, amount: money, waiting: money })),
    }),
  ),
  publishing: balanceSchema.shape.publishing,
  positions: balanceSchema.shape.positions,
  ads: balanceSchema.shape.ads.optional().describe('Advertising charged at the payout (absent in snapshots before D-156)'),
  files: z.object({
    believe: z.array(
      z.object({ id: z.string(), sha256: z.string(), reportingMonth: month, fileName: z.string() }),
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
      pseudonym: z.string(),
      ownerId: z.string().nullable(),
      status: artistSchema.shape.status,
    }),
  ),
  tracks: z.array(z.object({ isrc: z.string().nullable(), upc: z.string().nullable(), title: z.string() })),
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
          pseudonym: z.string(),
          ownerId: z.string().nullable(),
          ownerName: z.string().nullable(),
          status: artistSchema.shape.status,
          splitRows: z.number().int().describe('Split shares that name this artist'),
          participations: z.number().int(),
        }),
      ),
      candidateIsrcs: z
        .array(
          z.object({
            isrc: z.string(),
            upc: z.string(),
            trackTitle: z.string(),
            net: money,
          }),
        )
        .describe('ISRCs without any split whose Believe artist name equals the pseudonym'),
    }),
  ),
});
export type DuplicateGroups = z.infer<typeof duplicatesSchema>;

// ---- advertising expenses (D-155, D-156) ----

const adPartSchema = z.object({
  artistId: z.string(),
  pseudonym: z.string(),
  ownerId: z.string().nullable(),
  weight: money.describe('split percent of the artist (100 for an allocated expense)'),
  amount: money,
  recovered: money.describe('part × recovery percent: the debt on the artist'),
});

export const adExpenseSchema = z.object({
  id: z.string(),
  isrc: z.string().nullable(),
  month,
  amountCents: z.number().int(),
  recoveryPercent: money,
  scope: z.enum(['any', 'publishing', 'isrc']),
  artistId: z.string().nullable(),
  externalRef: z.string().nullable(),
  source: z.string(),
  migration: z.boolean(),
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
      isrc: z.string().nullable(),
      month,
      amount: money,
      recoveryPercent: money,
      scope: z.enum(['any', 'publishing', 'isrc']),
      status: z.enum(['allocated', 'pre_allocated', 'no_split', 'no_artist']),
      ourLabelId: z.string().nullable().describe("The payer (D-169): the record's label, the book the expense charges"),
      ourLabelName: z.string().nullable(),
      incomeBookLabelId: z.string().nullable().describe('The book of the ISRC income at the month of the expense (information, D-169)'),
      incomeBookLabelName: z.string().nullable(),
      sublabelName: z.string().nullable().describe('The sublabel of the ISRC label string at the month: its rule bears the unrecovered part'),
      parts: z.array(adPartSchema),
      unrecovered: money,
      borneBy: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('sublabel'), artistId: z.string(), ownerId: z.string().nullable(), amount: money }),
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
      recoveredFromArtists: money,
      borneBySublabels: money,
      borneByUs: money,
      noSplit: money,
    }),
  ),
  totals: z
    .object({
      count: z.number().int(),
      amount: money,
      recoveredFromArtists: money,
      borneBySublabels: money,
      borneByUs: money,
      noSplit: money,
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
  role: z.enum(['org_admin', 'label_manager', 'support', 'system', 'local']).nullable(),
  labels: z.array(z.object({ id: z.string(), name: z.string() })),
  allLabels: z.boolean(),
  memberships: z.array(z.object({ orgId: z.string(), orgName: z.string(), role: memberRole })),
  support: z.object({ orgId: z.string(), expiresAt: timestamp, write: z.boolean() }).nullable(),
  abilities: z
    .array(z.string())
    .describe('The keys `METHOD /path` of the operations the session may call, without the data (D-171): the UI closes the others'),
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
  labelId: z.string(),
  labelName: z.string(),
  validFrom: date,
  validTo: date.nullable().describe('Exclusive; null = open'),
  source: z.enum(['files', 'operator', 'import']).describe('files = derived from the loaded files; operator = a correction'),
  note: z.string().nullable(),
  createdAt: timestamp,
});
export const trackLabelsSchema = z.array(trackLabelSchema);
export type TrackLabel = z.infer<typeof trackLabelSchema>;

// ---- the assumption (D-172) ----

/** `POST /splits/assume`: the created `assumption` document, the splits it was set on and the splits left as they were. */
export const assumeResultSchema = z.object({
  documentId: z.string(),
  assigned: z.array(z.string()).describe('The split ids that got the assumption document'),
  skipped: z.array(
    z.object({
      splitId: z.string(),
      code: z.enum(['has_document', 'empty_period']).describe('has_document: the split, or every row, already has a document (approved or not)'),
    }),
  ),
});
export type AssumeResult = z.infer<typeof assumeResultSchema>;

// ---- the release registry (D-172) ----

/** `POST /releases/import`: the counts of the import (all or nothing; `unchanged` rows are not rewritten). */
export const releaseImportSchema = z.object({
  labelId: z.string(),
  fileName: z.string(),
  sha256: z.string(),
  rows: z.number().int().describe('Releases in the file'),
  inserted: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
});
export type ReleaseImport = z.infer<typeof releaseImportSchema>;

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
            account: z.string(),
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
  labelId: z.string(),
  fileName: z.string(),
  sha256: z.string(),
  dryRun: z.boolean(),
  applied: z.boolean(),
  totals: z.object({
    rows: z.number().int(),
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
  artistId: z.string().nullable(),
  ownerId: z.string().nullable(),
  kind: z.string().describe('start or adjustment as read (start when empty)'),
  master: money.nullable(),
  publishing: money.nullable(),
  missing: z.boolean(),
  documentId: z.string().nullable(),
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
  labelId: z.string(),
  cutoffMonth: month,
  syncedAt: timestamp,
  fileName: z.string(),
  sha256: z.string(),
  dryRun: z.boolean(),
  applied: z.boolean(),
  totals: z.object({
    rows: z.number().int(),
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
  earned: money,
  recouped: money.describe('pseudonym row: recoupedFromMaster (taken from its master income by any position); owner row: publishingRecouped; total: the area'),
  unrecouped: money.describe('What the positions held by the pseudonym still wait for'),
  adsCharged: money,
  paid: money,
  returns: money,
  credits: money,
  buyouts: money,
  forgiven: money,
  writtenOff: money,
  adjustments: money,
};
export const payrollRowSchema = z.object({
  rowKind: z.enum(['pseudonym', 'owner', 'total']),
  labelName: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  artistId: z.string().nullable(),
  pseudonym: z.string().nullable(),
  contract: z
    .object({
      number: z.string().nullable().describe('The number of the contract record (often none)'),
      documentId: z.string(),
      title: z.string(),
      documentKind: z.string().describe('contract or label_decision (a decision of the label, without a contract)'),
      labelId: z.string().nullable().describe('The label of the document; null = any label'),
      approvedAt: z.string().nullable(),
      approvedBy: z.string().nullable(),
    })
    .nullable()
    .describe('The approved contract of the owner under the label (its label first, then «any label»; the newest approval)'),
  byDecision: z.boolean().describe('Confirmed only by a label decision, without a contract (D-172)'),
  ...payrollMoney,
  payable: money.nullable().describe('total row only'),
  payableShown: money.nullable(),
  gate: z
    .object({
      allowed: z.boolean(),
      reason: payoutGateSchema.shape.reason,
      amountCents: z.number().int().nullable().describe('null when blocked by a payout of another label (its amount is not shown)'),
      blockedByOtherLabel: z.boolean(),
    })
    .nullable()
    .describe('total row only: the payout gate of the area'),
  belowThreshold: z.boolean(),
});
export type PayrollRow = z.infer<typeof payrollRowSchema>;

export const payrollSchema = z.object({
  calculatedAt: timestamp,
  label: z.object({ id: z.string(), name: z.string() }),
  asOf: month.nullable(),
  area: z.enum(['master', 'publishing', 'all']),
  rows: z.array(payrollRowSchema),
  waiting: z.array(
    z.object({ ownerId: z.string(), ownerName: z.string(), reason: cReasonSchema, amount: money, paidAlready: money }),
  ),
  buyouts: z.array(
    z.object({
      operationId: z.string(),
      ownerId: z.string(),
      ownerName: z.string(),
      date,
      amount: money,
      documentId: z.string().nullable(),
      counted: z.boolean(),
    }),
  ),
  control: z.array(
    z.object({ source: z.enum(['believe', 'b17']), account: z.string(), month, A: money, B: money, C: money, ours: money, discrepancy: money }),
  ),
  totals: z.object({
    payable: money,
    payableShown: money,
    bookB: money.describe('Σ earned of the total rows'),
    reconciliationB: money.describe('Σ B of the control rows of the area (believe: master, b17: publishing)'),
    bookBMatches: z.boolean(),
    relabelledOperations: z.number().int(),
    defaultLabelOperations: z.number().int(),
  }),
  ...pageFields,
});
export type Payroll = z.infer<typeof payrollSchema>;
