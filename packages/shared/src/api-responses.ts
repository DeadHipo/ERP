import { z } from 'zod';

// Response bodies of the JSON API (the contract of /api/v1). Shared by the server (OpenAPI, contract tests) and the
// React client (types). Money and percents are exact decimal strings; dates are YYYY-MM-DD, months YYYY-MM.
// This file must only depend on zod so the browser bundle can import it.

const money = z.string().describe('Exact decimal string');
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

/** The artist list resolves merges, so it has no `origin`. */
export const artistListItemSchema = artistSchema.omit({ origin: true });

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
});
export type DocumentView = z.infer<typeof documentSchema>;

export const contractSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  documentId: z.string(),
  artistIds: z.array(z.string()),
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
  uploadedBy: z.string(),
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
  status: z.string(),
  lineCount: z.number().int(),
  totalPayable: money,
  warnings: z.array(z.string()),
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
  ourShareNoSplit: money,
  discrepancy: money,
  fileTotal: money.nullable(),
  fileDiscrepancy: money.nullable(),
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
        ruleId: z.string(),
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

export const overviewSchema = z.object({
  calculatedAt: timestamp,
  reconciliation: z.array(reconciliationRowSchema.extend({ negativeRemainders: z.number().int() })),
  queue: z.array(
    z.object({ reason: cReasonSchema, amount: money, groups: z.number().int(), isrcs: z.number().int() }),
  ),
  signals: z.array(z.object({ name: z.string(), count: z.number().int() })),
  files: z.object({ believe: z.number().int(), b17: z.number().int() }),
});

/** Whether the payout button works for the owner now, and why not (17 N19); the client shows it, never recomputes it. */
export const payoutGateSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum(['owner_not_confirmed', 'payout_blocked', 'nothing_to_pay', 'below_threshold']).nullable(),
  amountCents: z
    .number()
    .int()
    .describe('Payable floored to whole cents, 0 when negative: what the button pays'),
});
export type PayoutGate = z.infer<typeof payoutGateSchema>;

export const balanceSchema = z.object({
  owner: ownerSchema,
  confirmed: z.boolean(),
  payout: payoutGateSchema,
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
    paid: money,
    returns: money,
    credits: money,
    payable: money,
    payableShown: money,
  }),
  byLabel: z
    .record(z.string(), z.object({ earned: money, waiting: money }))
    .describe(
      "All-time master earned (B) and waiting (C) per label of record ('?' = unmapped); recouped and paid are one total (D-130)",
    ),
  artists: z.array(
    z.object({
      artistId: z.string(),
      pseudonym: z.string(),
      earned: money,
      waiting: money,
      recouped: money,
      unrecouped: money,
      tracks: z.array(z.object({ isrc: z.string(), net: money, amount: money, waiting: money })),
    }),
  ),
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
      remaining: money,
      scope: z.object({ kind: z.string() }),
      date,
    }),
  ),
  pendingOperations: z.array(z.object({ operationId: z.string(), why: z.string() })),
  blockingPayouts: z.array(z.string()),
});
export type Balance = z.infer<typeof balanceSchema>;

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
const labelShareCategory = z.enum(['ours', 'label_unmapped', 'no_isrc', 'unknown_pair']);

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
  meaning: z.enum(['payout', 'recoupable_payout', 'deduction', 'credit', 'return']),
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
  payable: money,
  payableShown: money,
  payout: payoutGateSchema,
  blockingPayouts: z.number().int(),
  pendingOperations: z.number().int(),
  lastPayoutDate: date.nullable().describe('Date of the newest active payout (any kind of proof)'),
});
export const payablesSchema = z.object({ calculatedAt: timestamp, items: z.array(payableItemSchema) });
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
  artistName: z.string(),
  ...moneySums,
  months: z.object({ from: month.nullable(), to: month.nullable(), count: z.number().int() }),
  hasSplit: z.boolean(),
  hasParticipations: z.boolean(),
});
export const trackSummarySchema = z.object({
  calculatedAt: timestamp,
  items: z.array(trackSummaryItemSchema),
});
export type TrackSummaryItem = z.infer<typeof trackSummaryItemSchema>;

const documentStatusOfAllocation = z.enum(['approved', 'not_approved', 'not_attached', 'missing']);

export const trackMoneyMonthSchema = z.object({
  account: z.string(),
  upc: z.string(),
  reportingMonth: month,
  salesMonth: month,
  labelName: z.string(),
  ourLabelName: z.string().nullable(),
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
  artistName: z.string(),
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

export const releasesSchema = z.object({
  items: z.array(
    z.object({
      upc: z.string(),
      title: z.string(),
      artistName: z.string(),
      trackCount: z.number().int(),
      net: money.describe('Net of the loaded Believe files, all months'),
    }),
  ),
});
export const releaseSchema = z.object({
  upc: z.string(),
  title: z.string(),
  artistName: z.string(),
  tracks: z.array(z.object({ isrc: z.string(), title: z.string(), ...moneySums })),
  months: z.array(z.object({ reportingMonth: month, ...moneySums })),
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
  amountCents: z.number().int(),
  payableExact: money,
  total: balanceSchema.shape.total,
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
