import { z } from 'zod';

// Response bodies of the JSON API (the contract of /api/v1). Shared by the server (OpenAPI, contract tests) and the
// React client (types). Money and percents are exact decimal strings; dates are YYYY-MM-DD, months YYYY-MM.
// This file must only depend on zod so the browser bundle can import it.

const money = z.string().describe('Exact decimal string');
const date = z.string().describe('YYYY-MM-DD');
const month = z.string().describe('YYYY-MM');
const timestamp = z.string().describe('ISO 8601 timestamp');

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
  shares: z.array(z.object({ artistId: z.string(), percent: z.string() })),
  ourShare: z.string().describe('100 minus the sum of the shares; never stored'),
});

export const splitListItemSchema = splitSchema.extend({
  documentStatus: z.string().describe('not_attached | not_approved | approved | missing'),
  shares: z.array(
    z.object({
      artistId: z.string(),
      percent: z.string(),
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
  storedPath: z.string(),
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
  month,
  A_received: money,
  B_notOurs: money,
  C_waiting: money,
  C_breakdown: z.record(z.string(), money),
  ourShare: money,
  ourShareNoSplit: money,
  discrepancy: money,
  fileTotal: money.nullable(),
  fileDiscrepancy: money.nullable(),
});
export type ReconciliationRow = z.infer<typeof reconciliationRowSchema>;

export const signalsSchema = z.object({
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
});
export type Signals = z.infer<typeof signalsSchema>;

export const balanceSchema = z.object({
  owner: ownerSchema,
  confirmed: z.boolean(),
  period: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    basis: z.enum(['report', 'sales']),
    received: money,
    notOurs: money,
    waiting: money,
    waitingBreakdown: z.record(z.string(), money),
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
});
export type Operation = z.infer<typeof operationSchema>;
