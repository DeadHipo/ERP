import { z } from 'zod';
import * as S from '@erp/shared/api-schemas';
import * as R from '@erp/shared/api-responses';

// The API contract as data: one entry per route of /api/v1. The OpenAPI document is built from it, and the tests
// check that it matches the routes Express really has and that real responses fit the response schemas.

export type HttpMethod = 'get' | 'post' | 'patch';

export interface ApiOperation {
  method: HttpMethod;
  /** Express style (`/owners/:id`). */
  path: string;
  tag: string;
  summary: string;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Multipart upload with a single `file` part. */
  upload?: boolean;
  /** Success status (default 200). */
  status?: 200 | 201;
  response: z.ZodType;
  /** Error codes worth knowing, as `status code: meaning`. */
  errors?: string[];
}

/** Bodies whose shape is computed by the facade and not described field by field yet. */
const free = (what: string) => z.looseObject({}).describe(`${what} (free-form, see docs/09_фасад.md)`);

const list = <T extends z.ZodType>(item: T) => z.array(item);

export const API_OPERATIONS: ApiOperation[] = [
  {
    method: 'get',
    path: '/health',
    tag: 'system',
    summary: 'Liveness check',
    response: z.object({ ok: z.boolean() }),
  },

  // ---- owners ----
  {
    method: 'get',
    path: '/owners',
    tag: 'owners',
    summary: 'Owners (merged ones are hidden)',
    response: list(R.ownerSchema),
  },
  {
    method: 'post',
    path: '/owners',
    tag: 'owners',
    summary: 'Create an owner',
    body: S.createOwnerBody,
    status: 201,
    response: R.ownerSchema,
    errors: ['409 possible_duplicate: records with the same name exist; repeat with force=true'],
  },
  {
    method: 'post',
    path: '/owners/merge',
    tag: 'owners',
    summary: 'Merge an unconfirmed owner into the confirmed one',
    body: S.mergeOwnersBody,
    response: R.ownerSchema,
  },
  {
    method: 'get',
    path: '/owners/:id',
    tag: 'owners',
    summary: 'Owner with artists, tracks, documents, contracts and publishing terms',
    response: R.ownerDetailSchema,
  },
  {
    method: 'get',
    path: '/owners/:id/balance',
    tag: 'owners',
    summary: 'Owner balance: earned, recouped, paid, payable',
    query: S.periodQuery,
    response: R.balanceSchema,
  },
  {
    method: 'post',
    path: '/owners/:id/payouts',
    tag: 'owners',
    summary: 'Payout button: pays the whole payable amount, with a snapshot',
    body: S.createPayoutBody,
    status: 201,
    response: R.operationSchema,
    errors: ['422 payout_blocked: a previous payout has no payment proof yet'],
  },

  // ---- artists ----
  {
    method: 'get',
    path: '/artists',
    tag: 'artists',
    summary: 'Artists (merged ones are folded into the survivor)',
    response: list(R.artistListItemSchema),
  },
  {
    method: 'post',
    path: '/artists',
    tag: 'artists',
    summary: 'Create an artist',
    body: S.createArtistBody,
    status: 201,
    response: R.artistSchema,
    errors: ['409 possible_duplicate: artists with this pseudonym exist; repeat with force=true'],
  },
  { method: 'get', path: '/artists/:id', tag: 'artists', summary: 'One artist', response: R.artistSchema },
  {
    method: 'post',
    path: '/artists/:id/owner',
    tag: 'artists',
    summary: 'Assign an owner to an artist',
    body: S.assignOwnerBody,
    response: R.artistSchema,
  },

  // ---- tracks ----
  { method: 'get', path: '/tracks', tag: 'tracks', summary: 'Tracks', response: list(R.trackSchema) },
  {
    method: 'post',
    path: '/tracks',
    tag: 'tracks',
    summary: 'Create a track',
    body: S.createTrackBody,
    status: 201,
    response: R.trackSchema,
  },
  {
    method: 'patch',
    path: '/tracks/:id',
    tag: 'tracks',
    summary: 'Set the ISRC and UPC of a track',
    body: S.updateTrackBody,
    response: R.trackSchema,
  },
  {
    method: 'get',
    path: '/tracks/:isrc/explain',
    tag: 'tracks',
    summary: 'Explain the money of one ISRC: lines, split, participations, the state after every layer',
    response: R.explainSchema,
  },

  // ---- documents and contracts ----
  {
    method: 'get',
    path: '/documents',
    tag: 'documents',
    summary: 'Documents, optionally of one owner',
    query: S.listQuery,
    response: list(R.documentSchema),
  },
  {
    method: 'post',
    path: '/documents',
    tag: 'documents',
    summary: 'Create a document',
    body: S.createDocumentBody,
    status: 201,
    response: R.documentSchema,
  },
  {
    method: 'post',
    path: '/documents/:id/attach',
    tag: 'documents',
    summary: 'Attach the file of a document',
    body: S.attachFileBody,
    response: R.documentSchema,
  },
  {
    method: 'post',
    path: '/documents/:id/approve',
    tag: 'documents',
    summary: 'Approve a document',
    body: S.approveBody,
    response: R.documentSchema,
  },
  {
    method: 'post',
    path: '/contracts',
    tag: 'documents',
    summary: 'Create a contract of an owner for artists',
    body: S.createContractBody,
    status: 201,
    response: free('Contract'),
  },

  // ---- splits ----
  {
    method: 'get',
    path: '/splits',
    tag: 'splits',
    summary: 'Splits with artist names and document status',
    query: S.listQuery,
    response: R.splitListSchema,
  },
  {
    method: 'post',
    path: '/splits',
    tag: 'splits',
    summary: 'Create a split for a period',
    body: S.createSplitBody,
    status: 201,
    response: R.splitSchema,
  },
  {
    method: 'post',
    path: '/splits/change',
    tag: 'splits',
    summary: 'Change a split from a date (the previous one is closed)',
    body: S.changeSplitBody,
    status: 201,
    response: R.splitSchema,
  },
  {
    method: 'post',
    path: '/splits/buyout',
    tag: 'splits',
    summary: 'Buyout: the seller share becomes zero on the listed ISRCs',
    body: S.buyoutBody,
    status: 201,
    response: list(R.splitSchema),
  },
  {
    method: 'post',
    path: '/splits/:id/confirm',
    tag: 'splits',
    summary: 'Confirm a split with a document',
    body: S.confirmSplitBody,
    response: R.splitSchema,
  },

  // ---- sources and publishing ----
  {
    method: 'get',
    path: '/sources/files',
    tag: 'sources',
    summary: 'Believe files and B17 statements',
    response: R.sourceFilesSchema,
  },
  {
    method: 'get',
    path: '/sources/lines',
    tag: 'sources',
    summary: 'Lines of the Believe reports with filters, sorting and totals',
    query: S.sourceLinesQuery,
    response: R.sourceLinesPageSchema,
  },
  {
    method: 'get',
    path: '/sources/lines/facets',
    tag: 'sources',
    summary: 'Values for the filters of the lines page',
    query: S.sourceFacetsQuery,
    response: R.sourceFacetsSchema,
  },
  {
    method: 'post',
    path: '/sources/believe',
    tag: 'sources',
    summary: 'Upload a Believe report (csv or zip, streamed)',
    upload: true,
    status: 201,
    response: free('Loaded file'),
    errors: ['409 duplicate_period: a file for this account and month is already loaded'],
  },
  {
    method: 'post',
    path: '/publishing/b17',
    tag: 'publishing',
    summary: 'Upload a B17 statement (xlsx); writers are resolved to owners',
    upload: true,
    status: 201,
    response: R.b17UploadSchema,
    errors: ['409 duplicate_period: a statement for this quarter is already loaded'],
  },
  {
    method: 'get',
    path: '/publishing/writers',
    tag: 'publishing',
    summary: 'Writers found in the statements',
    response: list(R.publishingWriterSchema),
  },
  {
    method: 'post',
    path: '/publishing/writers/:norm/map',
    tag: 'publishing',
    summary: 'Link a writer to an owner (or create one)',
    body: S.mapWriterBody,
    response: free('Mapping result'),
  },
  {
    method: 'post',
    path: '/publishing/writers/resolve',
    tag: 'publishing',
    summary: 'Retry matching of the writers without an owner',
    response: R.resolveWritersSchema,
  },
  {
    method: 'post',
    path: '/publishing/terms',
    tag: 'publishing',
    summary: 'Set the author percent of an owner from a date',
    body: S.publishingTermsBody,
    status: 201,
    response: R.publishingTermsSchema,
  },

  // ---- reports ----
  {
    method: 'get',
    path: '/reconciliation',
    tag: 'reports',
    summary: 'Completeness check per source and month',
    query: S.periodQuery,
    response: list(R.reconciliationRowSchema),
  },
  {
    method: 'get',
    path: '/signals',
    tag: 'reports',
    summary: 'Money without a recipient, ISRCs without a split, ambiguous writers',
    query: S.listQuery,
    response: R.signalsSchema,
  },

  // ---- settlements ----
  {
    method: 'get',
    path: '/settlements/operations',
    tag: 'settlements',
    summary: 'Operations, optionally of one owner',
    query: S.listQuery,
    response: list(R.operationSchema),
  },
  {
    method: 'post',
    path: '/settlements/operations',
    tag: 'settlements',
    summary: 'Record an adjustment, credit or recoupable payout',
    body: S.createOperationBody,
    status: 201,
    response: R.operationSchema,
  },
  {
    method: 'post',
    path: '/settlements/operations/:id/proof',
    tag: 'settlements',
    summary: 'Attach the payment proof: the payout then counts',
    body: S.proofBody,
    response: R.operationSchema,
  },
  {
    method: 'post',
    path: '/settlements/operations/:id/deferred',
    tag: 'settlements',
    summary: 'Mark a payout as deferred at the payment service',
    body: S.deferredBody,
    response: R.operationSchema,
  },
  {
    method: 'post',
    path: '/settlements/operations/:id/deactivate',
    tag: 'settlements',
    summary: 'Soft rollback of an operation',
    body: S.deactivateBody,
    response: R.operationSchema,
    errors: ['409 payout_paid | payout_sent | has_returns'],
  },
  {
    method: 'post',
    path: '/settlements/operations/:id/return',
    tag: 'settlements',
    summary: 'Return of a payout that did not arrive',
    body: S.returnBody,
    status: 201,
    response: R.operationSchema,
  },
  {
    method: 'get',
    path: '/settlements/operations/:id/snapshot',
    tag: 'settlements',
    summary: 'Snapshot stored with a payout (per-artist breakdown, file hashes)',
    response: free('Payout snapshot'),
  },
];

export const operationKey = (o: Pick<ApiOperation, 'method' | 'path'>) =>
  `${o.method.toUpperCase()} ${o.path}`;
