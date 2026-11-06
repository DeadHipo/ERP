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
  /** Request headers the operation reads (`X-Operator` on every write, D-140). */
  headers?: { name: string; required: boolean; description: string }[];
  /** Error codes worth knowing, as `status code: meaning`. */
  errors?: string[];
}

const list = <T extends z.ZodType>(item: T) => z.array(item);

const OPERATOR_HEADER = {
  name: 'X-Operator',
  required: true,
  description:
    'Name of the operator, URI-encoded (1-200 characters); a write without it is refused: 400 operator_required',
};

const operations: ApiOperation[] = [
  {
    method: 'get',
    path: '/health',
    tag: 'system',
    summary: 'Liveness check',
    response: z.object({ ok: z.boolean() }),
  },

  {
    method: 'get',
    path: '/search',
    tag: 'system',
    summary:
      'Global search: owners (name, aliases), pseudonyms, tracks, documents, labels; at most 10 per kind (17 N10)',
    query: S.searchQuery,
    response: R.searchResultSchema,
    errors: ['400 validation_error: q is empty or kinds has an unknown kind'],
  },

  // ---- owners ----
  {
    method: 'get',
    path: '/owners',
    tag: 'owners',
    summary: 'Owners (merged ones are hidden); under a label (`label=`) those visible under it (D-168)',
    query: S.ownersQuery,
    response: list(R.ownerSchema),
    errors: ['404 not_found: label', '400 label_not_own: the label is a sublabel'],
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
    path: '/owners/payables',
    tag: 'owners',
    summary: 'Payables of every owner from one calculation: the balance fields, the payout gate, counts (17 N4), or for a list of owner ids (their reach only, D-163); under a label the book of that label of the owners visible under it (D-168)',
    query: S.payablesQuery,
    response: R.payablesSchema,
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
    summary: 'Owner balance: earned, recouped, paid, payable, with the book of every label; under a label (`label=`) the book of that label alone (D-168)',
    query: S.labelPeriodQuery,
    response: R.balanceSchema,
  },
  {
    method: 'post',
    path: '/owners/:id/payouts',
    tag: 'owners',
    summary: 'Payout button: pays the payable of the label\'s book (labelId), with a snapshot (D-168)',
    body: S.createPayoutBody,
    status: 201,
    response: R.operationSchema,
    errors: [
      '400 label_required: no labelId',
      '422 payout_blocked: a previous payout has no payment proof yet',
      '422 no_contract_for_label: the owner has an approved contract, but none with this label (D-169)',
    ],
  },

  // ---- artists ----
  {
    method: 'get',
    path: '/artists',
    tag: 'artists',
    summary:
      'Artists (merged ones are folded into the survivor), each with its owner, the ids merged into it, its tracks, open split rows and participations, contracts and open rows without a document (P11, D-167); no money; under a label those visible under it (D-168)',
    query: S.artistsQuery,
    response: list(R.artistListItemSchema),
  },
  {
    method: 'get',
    path: '/artists/balances',
    tag: 'artists',
    summary:
      'The money of a list of pseudonyms (the visible rows of P11, D-167): one calculation over the union of their reaches, then the artist row of each; ids (at most 200) filters the answer, without it every pseudonym from the full calculation',
    query: S.artistBalancesQuery,
    response: R.artistBalancesSchema,
    errors: ['400 validation_error: more than 200 ids'],
  },
  {
    method: 'get',
    path: '/artists/duplicates',
    tag: 'artists',
    summary:
      'Groups of artists with the same normalised pseudonym, with usage and ISRCs without a split (17 N11)',
    response: R.duplicatesSchema,
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
  {
    method: 'get',
    path: '/artists/:id',
    tag: 'artists',
    summary:
      'The card of a pseudonym (P12, D-165): owner, the ids merged into it, tracks, contracts, split rows and participations by every id, sublabel rules where it is the recipient, the documents they cite; a merged id answers for the survivor',
    response: R.artistDetailSchema,
  },
  {
    method: 'get',
    path: '/artists/:id/balance',
    tag: 'artists',
    summary:
      'The money of one pseudonym from the units of its reach (D-165): the artist row of the owner balance (earned, waiting by reason, recouped, unrecouped, tracks), its advertising, payouts and positions; the period shapes the per-period fields as in the owner balance; under a label its book (D-168)',
    query: S.labelPeriodQuery,
    response: R.artistBalanceSchema,
  },
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
    summary: 'Set the ISRC and UPC of a track and/or its free note (null or empty clears the note)',
    body: S.updateTrackBody,
    response: R.trackSchema,
  },
  {
    method: 'get',
    path: '/tracks/summary',
    tag: 'tracks',
    summary:
      'Every track with B, C, ours and net from one calculation, optionally for one account and report month, or for a list of ISRCs (17 N5, D-162)',
    query: S.trackSummaryQuery,
    response: R.trackSummarySchema,
  },
  {
    method: 'get',
    path: '/tracks/catalog',
    tag: 'tracks',
    summary: 'Every ISRC that earns or is registered, with UPCs, names, split and participation flags; no money, no calculation (D-162); under a label the ISRCs of its units (D-168)',
    query: S.trackCatalogQuery,
    response: R.trackCatalogSchema,
  },
  {
    method: 'get',
    path: '/tracks/:isrc/money',
    tag: 'tracks',
    summary: 'Whose money of one ISRC by month: allocations with labels, the state after every layer (17 N6)',
    response: R.trackMoneySchema,
  },
  {
    method: 'get',
    path: '/tracks/:isrc/breakdown/:month',
    tag: 'tracks',
    summary: 'Platform and country rows of one report month of an ISRC, loaded files only (17 N7)',
    response: R.trackBreakdownSchema,
  },
  {
    method: 'get',
    path: '/releases',
    tag: 'releases',
    summary:
      'Releases (UPC) with track count and net of the loaded files; q filters UPC, title, artist (17 N8)',
    query: S.releasesQuery,
    response: R.releasesSchema,
  },
  {
    method: 'get',
    path: '/releases/:upc',
    tag: 'releases',
    summary: 'One release: tracks and report months with B, C and ours (17 N9); under a label its units and tracks (D-168)',
    query: S.releaseQuery,
    response: R.releaseSchema,
  },
  {
    method: 'get',
    path: '/documents/:id/uses',
    tag: 'documents',
    summary: 'Where a document is used and the category C money that waits for it (17 N13)',
    response: R.documentUsesSchema,
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
    summary:
      'Documents, filtered by owner, status, kind and a title substring (17 N12); under a label (`label=`) those of the label and those without a label (D-169)',
    query: S.documentsQuery,
    response: list(R.documentSchema),
    errors: ['400 label_not_own', '404 not_found: label'],
  },
  {
    method: 'post',
    path: '/documents',
    tag: 'documents',
    summary: 'Create a document, optionally under an own label (D-169: a contract opens the label of its document; none = any label)',
    body: S.createDocumentBody,
    status: 201,
    response: R.documentSchema,
    errors: ['400 label_not_own', '404 not_found: label'],
  },
  {
    method: 'patch',
    path: '/documents/:id',
    tag: 'documents',
    summary: 'Set or clear (null = any label) the own label of a document (D-169)',
    body: S.setDocumentLabelBody,
    response: R.documentSchema,
    errors: ['400 label_not_own', '404 not_found: label or document'],
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
    response: R.createdContractSchema,
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

  // ---- participations ----
  {
    method: 'get',
    path: '/participations',
    tag: 'splits',
    summary: 'Participations (top, pool, artist share, label share) with pseudonyms and document status',
    query: S.listQuery,
    response: R.participationListSchema,
  },
  {
    method: 'post',
    path: '/participations',
    tag: 'splits',
    summary: 'Create a participation; its start is floored to the month start',
    body: S.createParticipationBody,
    status: 201,
    response: R.participationSchema,
    errors: ['400 validation_error: invalid base/funded_from combination or period'],
  },
  {
    method: 'post',
    path: '/participations/:id/close',
    tag: 'splits',
    summary: 'End a participation at a date (exclusive)',
    body: S.closeValidToBody,
    response: R.participationSchema,
  },

  // ---- labels ----
  {
    method: 'get',
    path: '/labels',
    tag: 'labels',
    summary: 'Labels with aliases and rules (recipient pseudonym and document status included)',
    response: list(R.labelListItemSchema),
  },
  {
    method: 'post',
    path: '/labels',
    tag: 'labels',
    summary: 'Create an own label or a sublabel of an own label',
    body: S.createLabelBody,
    status: 201,
    response: R.labelSchema,
    errors: ['409 label_name_taken: a label with this name exists in the organization'],
  },
  {
    method: 'post',
    path: '/labels/:id/accounts',
    tag: 'labels',
    summary: 'Register a Believe account under an own label (D-168): the units of the account that lead to another own label are the signal labelOutsideAccount',
    body: S.addAccountBody,
    status: 201,
    response: R.labelSchema,
    errors: ['409 account_taken: the account already belongs to a label', '422 account_for_sublabel'],
  },
  {
    method: 'post',
    path: '/labels/:id/accounts/:account/remove',
    tag: 'labels',
    summary: 'Remove a Believe account from an own label (D-169), only while no file of the account is loaded or being loaded',
    response: R.labelSchema,
    errors: [
      '404 not_found: the label is unknown or the account is not registered under it',
      '409 account_has_files: the account has files loaded or being loaded (details { account, files })',
    ],
  },
  {
    method: 'post',
    path: '/labels/:id/aliases',
    tag: 'labels',
    summary: 'Register a Believe label string as an alias of the label',
    body: S.addAliasBody,
    status: 201,
    response: R.labelSchema,
    errors: ['409 alias_taken: the string already belongs to a label'],
  },
  {
    method: 'post',
    path: '/labels/:id/rules',
    tag: 'labels',
    summary: 'Set a sublabel rule: percent of the label share goes to the recipient pseudonym',
    body: S.createLabelRuleBody,
    status: 201,
    response: R.labelRuleSchema,
    errors: ['409 rule_overlap', '422 rule_for_own_label'],
  },
  {
    method: 'post',
    path: '/labels/rules/:id/close',
    tag: 'labels',
    summary: 'End a sublabel rule at a date (exclusive)',
    body: S.closeValidToBody,
    response: R.labelRuleSchema,
  },

  // ---- sources and publishing ----
  {
    method: 'get',
    path: '/sources/files',
    tag: 'sources',
    summary: 'Believe files and B17 statements, each with its label; under a label (`label=`) those loaded under it (D-169)',
    query: S.sourceFilesQuery,
    response: R.sourceFilesSchema,
    errors: ['404 not_found: label', '400 label_not_own: the label is a sublabel'],
  },
  {
    method: 'get',
    path: '/sources/lines',
    tag: 'sources',
    summary: 'Lines of the Believe reports with filters, sorting and totals; under a label (`label=`) over its files only (D-169)',
    query: S.sourceLinesQuery,
    response: R.sourceLinesPageSchema,
    errors: ['404 not_found: label', '400 label_not_own: the label is a sublabel'],
  },
  {
    method: 'get',
    path: '/sources/lines/facets',
    tag: 'sources',
    summary: 'Values for the filters of the lines page; under a label (`label=`) over its files only (D-169)',
    query: S.sourceFacetsQuery,
    response: R.sourceFacetsSchema,
    errors: ['404 not_found: label', '400 label_not_own: the label is a sublabel'],
  },
  {
    method: 'post',
    path: '/sources/believe',
    tag: 'sources',
    summary:
      'Upload a Believe report (csv or zip, streamed) under an own label (D-169): the account of the file name must be registered under that label. The label is checked before the body is received',
    query: S.uploadLabelQuery,
    upload: true,
    status: 201,
    response: R.sourceFileSchema,
    errors: [
      '400 label_required: no label=',
      '404 not_found: label',
      '400 label_not_own: the label is a sublabel (details { labelId })',
      '400 validation_error: the file name is not <reportId>_<account>_<from>_<to>.csv[.zip]',
      '422 account_unregistered: the account of the file is registered under no label (details { account })',
      '422 account_of_other_label: the account belongs to another own label (details { account, labelId, labelName })',
      '409 duplicate_period: a file for this account and month is already loaded (details { existingFileId })',
      '409 duplicate_file: the same file (sha256) is already loaded (details { existingFileId })',
    ],
  },
  {
    method: 'post',
    path: '/publishing/b17',
    tag: 'publishing',
    summary:
      'Upload a B17 statement (xlsx) under an own label (D-169); writers are resolved to owners. The label is checked before the body is received',
    query: S.uploadLabelQuery,
    upload: true,
    status: 201,
    response: R.b17UploadSchema,
    errors: [
      '400 label_required: no label=',
      '404 not_found: label',
      '400 label_not_own: the label is a sublabel (details { labelId })',
      '400 validation_error: not an .xlsx statement',
      '409 duplicate_period: a statement for this quarter is already loaded (details { existingStatementId })',
      '409 duplicate_file: the same file (sha256) is already loaded',
    ],
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
    response: R.ownerSchema,
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
    summary: 'Set the author percent of an owner from a date, for all operation types or one (operationType)',
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
    summary: 'Money without a recipient, ISRCs without a split, ambiguous writers, operations without a label, label strings outside their account, ads without a label or outside their book (D-169); under a label (`label=`) the units of that label (D-168)',
    query: S.listQuery.extend(S.labelPeriodQuery.shape),
    response: R.signalsSchema,
  },
  {
    method: 'get',
    path: '/overview',
    tag: 'reports',
    summary: 'Overview in one calculation: reconciliation, its totals (all, per source, per account), C queue summary, signal counts, file counts',
    query: S.periodQuery,
    response: R.overviewSchema,
  },
  {
    method: 'get',
    path: '/queue/:reason',
    tag: 'reports',
    summary: 'One reason of the waiting money (category C) grouped by what to fix',
    query: S.queueQuery,
    response: R.queuePageSchema,
    errors: ['400 validation_error: unknown reason'],
  },

  // ---- settlements ----
  {
    method: 'get',
    path: '/settlements/operations',
    tag: 'settlements',
    summary: 'Operations with the owner name, pseudonym and label name, filtered (17 N14); under a label (`label=`) those of it (D-168)',
    query: S.operationsQuery,
    response: list(R.operationSchema),
  },
  {
    method: 'post',
    path: '/settlements/operations',
    tag: 'settlements',
    summary: 'Record an adjustment, credit or recoupable payout under a label (labelId, D-168)',
    body: S.createOperationBody,
    status: 201,
    response: R.operationSchema,
    errors: [
      '400 label_required: no labelId',
      '400 label_not_own',
      '404 not_found: label',
      '422 no_contract_for_label: an advance under a label the owner has no approved contract with (D-169)',
    ],
  },
  {
    method: 'patch',
    path: '/settlements/operations/:id',
    tag: 'settlements',
    summary: 'Set the label of an existing operation (the history before the split, D-168)',
    body: S.setOperationLabelBody,
    response: R.operationSchema,
    errors: ['400 label_not_own', '404 not_found'],
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
    response: R.payoutSnapshotSchema,
  },

  {
    method: 'get',
    path: '/audit',
    tag: 'system',
    summary:
      'The trail of writes that touched an entity (newest first); without entityId the latest writes; `label=` only the writes recorded under that label (D-169)',
    query: S.auditQuery,
    response: R.auditListSchema,
    errors: ['400 label_not_own', '404 not_found: label'],
  },

  {
    method: 'get',
    path: '/ads',
    tag: 'ads',
    summary: 'Advertising expenses with who bears them (split of the month, recovered and unrecovered parts), newest first; under a label (`label=`) those it pays (the record label, D-169)',
    query: S.adsQuery,
    response: R.adListSchema,
  },
  {
    method: 'post',
    path: '/ads',
    tag: 'ads',
    summary: 'Record a batch of advertising expenses (every arrival is a new record; a known external ref is skipped)',
    body: S.createAdsBody,
    status: 201,
    response: R.adsCreatedSchema,
    errors: ['404 not_found: an artistId or the label', '400 validation_error: item N', '400 label_required: item N (the payer, D-169)', '400 label_not_own'],
  },
  {
    method: 'get',
    path: '/ads/summary',
    tag: 'ads',
    summary: 'Advertising per month and payer: total, returned from artists, borne by sublabels, borne by us; under a label (`label=`) the records it pays (D-169)',
    query: S.adsSummaryQuery,
    response: R.adSummarySchema,
  },
  {
    method: 'get',
    path: '/ads/:id',
    tag: 'ads',
    summary: 'One advertising expense with who bears it (allocation null when it is deactivated)',
    response: R.adViewSchema,
    errors: ['404 not_found'],
  },
  {
    method: 'patch',
    path: '/ads/:id',
    tag: 'ads',
    summary: 'Change the recovery percent, the scope (at any time, D-155) and/or the payer label (D-169) of an expense',
    body: S.updateAdBody,
    response: R.adExpenseSchema,
    errors: ['404 not_found: the expense or the label', '400 label_not_own'],
  },
  {
    method: 'post',
    path: '/ads/:id/deactivate',
    tag: 'ads',
    summary: 'Deactivate an expense (it takes part in nothing)',
    body: S.deactivateAdBody,
    response: R.adExpenseSchema,
  },
];

/** Every write (post, patch) declares the `X-Operator` header (D-140). */
export const API_OPERATIONS: ApiOperation[] = operations.map((o) =>
  o.method === 'get' ? o : { ...o, headers: [OPERATOR_HEADER, ...(o.headers ?? [])] },
);

export const operationKey = (o: Pick<ApiOperation, 'method' | 'path'>) =>
  `${o.method.toUpperCase()} ${o.path}`;
