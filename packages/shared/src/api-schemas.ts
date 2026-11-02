import { z } from 'zod';

// Request schemas of the JSON API. Shared by the Express routes (validation) and the React client (typed calls).
// This file must only depend on zod so the browser bundle can import it.

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const percent = z.string().regex(/^\d+(\.\d+)?$/, 'expected a decimal percent');
const usd = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'expected USD with up to 2 decimals');

export const periodQuery = z.object({
  from: month.optional(),
  to: month.optional(),
  basis: z.enum(['report', 'sales']).optional(),
});
export type PeriodQuery = z.infer<typeof periodQuery>;

export const createOwnerBody = z.object({
  name: z.string().min(1),
  kind: z.enum(['label', 'person']),
  ipi: z.string().nullish(),
  aliases: z.array(z.string()).optional(),
  /** Create even if records with the same name exist (operator chose "add new"). */
  force: z.boolean().optional(),
});

export const createArtistBody = z.object({
  pseudonym: z.string().min(1),
  ownerId: z.string().nullish(),
  force: z.boolean().optional(),
});

export const assignOwnerBody = z.object({ ownerId: z.string() });

export const createTrackBody = z.object({
  title: z.string().min(1),
  isrc: z.string().nullish(),
  upc: z.string().nullish(),
  artistIds: z.array(z.string()).optional(),
});

export const updateTrackBody = z.object({ isrc: z.string().nullable(), upc: z.string().nullable() });

export const documentKind = z.enum([
  'contract',
  'appendix',
  'buyout',
  'advance_basis',
  'adjustment_basis',
  'payment_proof',
  'return_proof',
  'other',
]);

export const createDocumentBody = z.object({
  kind: documentKind,
  title: z.string().min(1),
  fileRef: z.string().nullish(),
  ownerId: z.string().nullish(),
  requiresApproval: z.boolean(),
  uploadDeadline: date.nullish(),
});

export const attachFileBody = z.object({ fileRef: z.string().min(1) });
export const approveBody = z.object({ by: z.string().min(1).default('manager') });

export const createContractBody = z.object({
  ownerId: z.string(),
  documentId: z.string(),
  number: z.string().nullish(),
  artistIds: z.array(z.string()),
});

export const shareSpec = z
  .object({
    artistId: z.string().optional(),
    newArtistPseudonym: z.string().optional(),
    percent,
    documentId: z.string().nullish(),
  })
  .refine((s) => !!s.artistId || !!s.newArtistPseudonym, 'artistId or newArtistPseudonym is required');

export const createSplitBody = z.object({
  isrc: z.string().min(1),
  validFrom: date,
  validTo: date.nullish(),
  shares: z.array(shareSpec),
  documentId: z.string().nullish(),
  note: z.string().nullish(),
});

export const changeSplitBody = z.object({
  isrc: z.string().min(1),
  from: date,
  shares: z.array(shareSpec),
  documentId: z.string().min(1),
  note: z.string().nullish(),
});

export const buyoutBody = z.object({
  isrcs: z.array(z.string()).min(1),
  sellerArtistId: z.string(),
  effectiveFrom: date,
  documentId: z.string(),
});

export const confirmSplitBody = z.object({ documentId: z.string().min(1) });

export const publishingTermsBody = z.object({
  ownerId: z.string(),
  percent,
  validFrom: date,
  documentId: z.string().nullish(),
});

export const scopeSchema = z.object({
  kind: z.enum(['any', 'master', 'publishing', 'master_publishing', 'isrcs']),
  isrcs: z.array(z.string()).optional(),
  excludeIsrcs: z.array(z.string()).optional(),
});

export const createOperationBody = z.object({
  direction: z.enum(['in', 'out']),
  amount: usd,
  artistId: z.string().nullish(),
  ownerId: z.string().nullish(),
  date,
  period: z.string().nullish(),
  scope: scopeSchema.nullish(),
  documentId: z.string().nullish(),
  paymentProofId: z.string().nullish(),
  operationRef: z.string().nullish(),
  comment: z.string().min(1),
});

export const createPayoutBody = z.object({ comment: z.string().optional() });
export const proofBody = z.object({ fileRef: z.string().min(1), title: z.string().optional() });
export const deactivateBody = z.object({ reason: z.string().min(1), transferFailed: z.boolean().optional() });
export const deferredBody = z.object({ deferred: z.boolean() });
export const returnBody = z.object({ fileRef: z.string().min(1), date, comment: z.string().min(1) });
export const mergeOwnersBody = z.object({
  fromId: z.string(),
  intoId: z.string(),
  reason: z.string().min(1),
});

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  isrc: z.string().optional(),
  artistId: z.string().optional(),
  ownerId: z.string().optional(),
});

/** Lines of the Believe report files (the `lines` view). `fileId` is a comma-separated list of file ids. */
export const sourceLinesQuery = z.object({
  fileId: z.string().optional(),
  isrc: z.string().optional(),
  upc: z.string().optional(),
  platform: z.string().optional(),
  country: z.string().optional(),
  /** '(none)' asks for the empty subscription type. */
  subscriptionType: z.string().optional(),
  salesType: z.string().optional(),
  releaseType: z.string().optional(),
  salesFrom: month.optional(),
  salesTo: month.optional(),
  sort: z.enum(['net', 'gross', 'quantity', 'reportingMonth', 'salesMonth', 'isrc']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type SourceLinesQuery = z.infer<typeof sourceLinesQuery>;

export const sourceFacetsQuery = z.object({ fileId: z.string().optional() });

export const mapWriterBody = z.object({ ownerId: z.string().nullish(), createNew: z.boolean().optional() });
