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

/**
 * The label view (D-168): the id of an own label. The answer is restricted to the label's book (its units, the
 * pseudonyms and owners visible under it, the operations and advertising under it); without it: «Все» (every label).
 */
export const labelQuery = z.object({
  label: z.string().optional().describe('Id of an own label: the answer restricted to that label (D-168); 404 unknown, 400 label_not_own'),
});
export const labelPeriodQuery = periodQuery.extend(labelQuery.shape);
export type LabelQuery = z.infer<typeof labelQuery>;

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

/** Identifiers and/or the free note of a track; send what changes (a null/empty note clears it). */
export const updateTrackBody = z
  .object({
    isrc: z.string().nullable().optional(),
    upc: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .refine(
    (b) => b.isrc !== undefined || b.upc !== undefined || b.note !== undefined,
    'isrc, upc or note is required',
  )
  .refine((b) => (b.isrc === undefined) === (b.upc === undefined), 'isrc and upc are sent together');

export const documentKind = z.enum([
  'contract',
  'appendix',
  'buyout',
  'advance_basis',
  'adjustment_basis',
  'payment_proof',
  'return_proof',
  'other',
  'assumption',
]);

export const createDocumentBody = z.object({
  kind: documentKind,
  title: z.string().min(1),
  fileRef: z.string().nullish(),
  ownerId: z.string().nullish(),
  requiresApproval: z.boolean(),
  uploadDeadline: date.nullish(),
  labelId: z
    .string()
    .min(1)
    .nullish()
    .describe('The own label of the document (D-169); none = any label. 404 unknown, 400 label_not_own'),
});
/** `PATCH /documents/:id`: sets or clears (null = any label) the own label of a document (D-169). */
export const setDocumentLabelBody = z.object({
  labelId: z.string().min(1).nullable().describe('Id of an own label; null = any label'),
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
  operationType: z.string().min(1).optional(),
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
  labelId: z.string().nullish().describe('The own label the operation belongs to (D-168): required, 400 label_required without it'),
});

export const createPayoutBody = z.object({
  labelId: z.string().optional().describe('The own label the payout is made under (D-168): pays the payable of its book; 400 label_required without it'),
  comment: z.string().optional(),
});
/** `PATCH /settlements/operations/:id` (D-168): the label of an existing operation. */
export const setOperationLabelBody = z.object({ labelId: z.string().min(1) });
export const proofBody = z.object({ fileRef: z.string().min(1), title: z.string().optional() });
export const deactivateBody = z.object({ reason: z.string().min(1), transferFailed: z.boolean().optional() });
export const deferredBody = z.object({ deferred: z.boolean() });
export const returnBody = z.object({ fileRef: z.string().min(1), date, comment: z.string().min(1) });
export const mergeOwnersBody = z.object({
  fromId: z.string(),
  intoId: z.string(),
  reason: z.string().min(1),
});

export const queueQuery = z.object({
  account: z.string().optional(),
  month: month.optional(),
  ownerId: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  ...periodQuery.shape,
  ...labelQuery.shape,
});

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  isrc: z.string().optional(),
  artistId: z.string().optional(),
  ownerId: z.string().optional(),
  /** Paging of `/splits` and `/participations` (N18). */
  offset: z.coerce.number().int().min(0).optional(),
  /** `/splits` only: `unconfirmed` = the document is missing or not approved. */
  status: z.enum(['unconfirmed']).optional(),
});

/** `GET /documents` (N12): all filters optional; `q` is a case-insensitive substring of the title. */
export const documentsQuery = z.object({
  ownerId: z.string().optional(),
  status: z.enum(['not_attached', 'not_approved', 'approved']).optional(),
  kind: documentKind.optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  ...labelQuery.shape,
});

const flag = z.enum(['true', 'false']);

/** `GET /settlements/operations` (N14): filters; `from` / `to` are inclusive operation dates. */
export const operationsQuery = z.object({
  ownerId: z.string().optional(),
  artistId: z.string().optional(),
  meaning: z.enum(['payout', 'recoupable_payout', 'deduction', 'credit', 'return']).optional(),
  direction: z.enum(['in', 'out']).optional(),
  needsProof: flag.optional().describe('true: payouts (out) that are active and have no payment proof'),
  active: flag.optional(),
  from: date.optional(),
  to: date.optional(),
  ...labelQuery.shape,
});

/** `GET /owners`, `GET /artists`: the list, restricted to the owners / pseudonyms visible under a label (D-168). */
export const ownersQuery = labelQuery;
export const artistsQuery = labelQuery;

/** `GET /search` (N10): `kinds` is a comma list of owners, artists, tracks, documents, labels. */
export const searchQuery = z.object({
  q: z.string().trim().min(1),
  kinds: z.string().optional(),
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
  ...labelQuery.shape,
});
export type SourceLinesQuery = z.infer<typeof sourceLinesQuery>;

export const sourceFacetsQuery = z.object({ fileId: z.string().optional(), ...labelQuery.shape });

/** `GET /sources/files`: under a label (`label=`) the files and statements loaded under it (D-169). */
export const sourceFilesQuery = labelQuery;

/**
 * `POST /sources/believe`, `POST /publishing/b17`: the own label the file is loaded under (D-169). Optional here so that
 * a missing label is the facade's 400 `label_required`, not a `validation_error`; checked before the body is received.
 */
export const uploadLabelQuery = z.object({
  label: z
    .string()
    .optional()
    .describe('Id of the own label the file is loaded under (D-169); 400 label_required without it, 404 unknown, 400 label_not_own'),
});

export const mapWriterBody = z.object({ ownerId: z.string().nullish(), createNew: z.boolean().optional() });

// ---- labels (D-125, D-129) ----

export const createLabelBody = z.object({
  name: z.string().min(1),
  kind: z.enum(['own', 'sublabel']),
  ownLabelId: z.string().nullish(),
});
export const addAliasBody = z.object({ alias: z.string().min(1) });
/** `POST /labels/:id/accounts` (D-168): a Believe account of an own label. */
export const addAccountBody = z.object({ account: z.string().min(1) });
export const createLabelRuleBody = z.object({
  percent,
  recipientArtistId: z.string().min(1),
  validFrom: date,
  validTo: date.nullish(),
  documentId: z.string().nullish(),
  note: z.string().nullish(),
});
export const closeValidToBody = z.object({ validTo: date });

// ---- participations (D-126, D-129) ----

export const participationBase = z.enum(['net', 'bucket']);
export const fundedFrom = z.enum(['top', 'artist_pool', 'artist_share', 'label_share']);
export const createParticipationBody = z.object({
  isrc: z.string().min(1),
  artistId: z.string().min(1),
  percent,
  base: participationBase,
  fundedFrom,
  fromArtistId: z.string().nullish(),
  validFrom: date,
  validTo: date.nullish(),
  documentId: z.string().nullish(),
  note: z.string().nullish(),
});

// ---- audit (D-140) ----

export const auditQuery = z.object({
  entityId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  label: z
    .string()
    .optional()
    .describe('Id of an own label: only the writes recorded under it (D-169; writes without a label only without it); 404 unknown, 400 label_not_own'),
});
export type AuditQuery = z.infer<typeof auditQuery>;

// ---- money aggregates (D-142) ----

/** `GET /owners/payables`: the period only shapes `waitingBreakdown`; the totals are all-time like the balance. */
export const payablesQuery = labelPeriodQuery.extend({
  ids: z
    .string()
    .optional()
    .describe('Comma-separated owner ids (at most 200): only these owners, from a calculation of the units of their reach (D-163)'),
});

/** `GET /artists/balances` (P11, D-167): the money of a list of pseudonyms from one calculation of their union reach. */
export const artistBalancesQuery = labelPeriodQuery.extend({
  ids: z
    .string()
    .optional()
    .describe('Comma-separated artist ids (at most 200): only these pseudonyms, from a calculation of the units of their reach (D-167); without it every pseudonym from the full calculation'),
});

/** `GET /tracks/summary`: only the units of one Believe account and/or one report month. */
export const trackSummaryQuery = z.object({
  account: z.string().optional(),
  month: month.optional(),
  isrcs: z
    .string()
    .optional()
    .describe('Comma-separated ISRCs (at most 500): only these tracks, from a calculation of their units alone (D-162)'),
  ...labelQuery.shape,
});
export const trackCatalogQuery = labelQuery;

export const releasesQuery = z.object({ q: z.string().optional(), ...labelQuery.shape });
export const releaseQuery = labelQuery;

// ---- advertising expenses (D-155, D-156) ----

export const adScope = z.enum(['any', 'publishing', 'isrc']);
const recoveryPercent = z.string().regex(/^\d+(\.\d{1,2})?$/, 'expected 0..100 with up to 2 decimals');

export const adExpenseInput = z.object({
  isrc: z.string().nullish().describe('The track the expense is bound to (its split and label of record)'),
  month,
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'expected a positive USD amount with up to 2 decimals'),
  recoveryPercent: recoveryPercent.optional().describe('0..100, default 100: the share returned from the artists'),
  scope: adScope.optional().describe('any (default) | publishing | isrc: where the recovered part is recouped from'),
  artistId: z.string().nullish().describe('An expense already allocated to one pseudonym (no split)'),
  externalRef: z.string().nullish().describe('A post link or a source row; a known one is skipped'),
  source: z.string().optional(),
  comment: z.string().optional(),
  labelId: z.string().nullish().describe('The payer, required (D-169): the own label whose book the expense charges; 400 label_required without it, 400 label_not_own for a sublabel'),
});
export const createAdsBody = z.object({ items: z.array(adExpenseInput).min(1).max(20000) });
export const updateAdBody = z
  .object({
    recoveryPercent: recoveryPercent.optional(),
    scope: adScope.optional(),
    labelId: z.string().min(1).optional().describe('The payer (D-169): an own label'),
  })
  .refine((b) => b.recoveryPercent !== undefined || b.scope !== undefined || b.labelId !== undefined, 'recoveryPercent, scope or labelId');
export const deactivateAdBody = z.object({ reason: z.string().min(1) });
export const adsQuery = z.object({
  isrc: z.string().optional(),
  artistId: z.string().optional(),
  ownerId: z.string().optional(),
  from: month.optional(),
  to: month.optional(),
  status: z.enum(['allocated', 'pre_allocated', 'no_split', 'no_artist']).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  ...labelQuery.shape,
});
export const adsSummaryQuery = z.object({ from: month.optional(), to: month.optional(), ...labelQuery.shape });

// ---- the login and the organizations (stage 2, D-170) ----

/**
 * `POST /auth/login`: the login is compared in lower case; `orgId` chooses the organization of a user with several
 * memberships (D-171: without it `409 org_choice_required`).
 */
export const loginBody = z.object({
  login: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(200),
  orgId: z.string().min(1).max(64).optional(),
});
/** `POST /orgs`: the name is unique without regard to case (409 org_name_taken); the id comes from the server. */
export const createOrgBody = z.object({ name: z.string().trim().min(1).max(200) });
/** `POST /auth/password` (D-171): the user's own password; the other sessions are revoked. */
export const changeOwnPasswordBody = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(1).max(200),
});
/** The role of a member of an organization (D-171). */
export const memberRole = z.enum(['org_admin', 'label_manager']);
/**
 * `POST /orgs/:id/users` (D-171): a new user as a member of that organization with a role; a `label_manager` needs at
 * least one own label, an `org_admin` none (409 login_taken, 400 label_not_own, 404 not_found for a label).
 */
export const createMemberUserBody = z.object({
  login: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,64}$/),
  password: z.string().min(1).max(200),
  role: memberRole,
  labelIds: z.array(z.string().min(1)).default([]),
});
const loginOf = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,64}$/);
/**
 * `POST /orgs/:id/members` (D-171): an existing user (by login) becomes a member (404 not_found for an unknown login,
 * 409 already_member, 400 validation_error for a system administrator).
 */
export const addMemberBody = z.object({
  login: loginOf,
  role: memberRole,
  labelIds: z.array(z.string().min(1)).default([]),
});
/**
 * `PATCH /users/:id`, `PATCH /orgs/:id/users/:userId` (D-171): the role, the labels of a manager (replaced as a whole)
 * and `active` (the membership; false suspends it and ends its sessions in this organization). 409 last_org_admin.
 */
export const updateMemberBody = z
  .object({
    role: memberRole.optional(),
    labelIds: z.array(z.string().min(1)).optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => b.role !== undefined || b.labelIds !== undefined || b.active !== undefined, {
    message: 'Nothing to change: role, labelIds or active',
  });
/** `POST /users/:id/password`, `POST /system/users/:id/password` (D-171): a new password; every session ends. */
export const setPasswordBody = z.object({ password: z.string().min(1).max(200) });
/** `PATCH /system/users/:id` (D-171): disable (every session ends) or enable a user everywhere. */
export const updateSystemUserBody = z.object({ disabled: z.boolean() });
/**
 * `POST /support` (D-171): the organization administrator grants a system administrator (by login) support access until
 * `expiresAt` (at most 7 days ahead; default 24 h); `write` allows writes (never approve, pay or admin).
 */
export const grantSupportBody = z.object({
  login: loginOf,
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  write: z.boolean().default(false),
});
