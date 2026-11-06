import { z } from 'zod';
import { DOCUMENT_KINDS } from './document-kinds';
import { LABEL_SOURCES, OPERATION_KINDS } from './operation-kinds';

// Request schemas of the JSON API. Shared by the Express routes (validation) and the React client (typed calls).
// This file must only depend on zod (and the plain lists of this package) so the browser bundle can import it.

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const percent = z.string().regex(/^\d+(\.\d+)?$/, 'expected a decimal percent');
const usd = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'expected USD with up to 2 decimals');

export const periodQuery = z.object({
  from: month.optional().describe('First month of the period, YYYY-MM'),
  to: month.optional().describe('Last month of the period, YYYY-MM'),
  basis: z.enum(['report', 'sales']).optional().describe('report: months of the reports (default); sales: months of the sales'),
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
/**
 * The paging of the long lists (D-177). Without both the answer of a session is the whole list as before; with one of
 * them, and always for the read token, it is a page with `total`, `limit`, `offset`.
 */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().describe('Rows of the page, 1-500 (default 50 when paged)'),
  offset: z.coerce.number().int().min(0).optional().describe('Rows to skip from the start of the list (default 0)'),
});
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

/** The kinds of a document (`document-kinds.ts`, D-172: + `label_decision`). */
export const documentKind = z.enum(DOCUMENT_KINDS);

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
  /** D-176: the payout threshold of the contract in cents; empty = the organization's default. */
  payoutThresholdCents: z.number().int().min(0).nullish(),
});

export const shareSpec = z
  .object({
    artistId: z.string().optional().describe('Only this pseudonym (id)'),
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
  kind: z
    .enum(['payout', 'advance', 'deduction', 'credit', 'return', 'forgiveness', 'buyout', 'writeoff', 'adjustment'])
    .optional()
    .describe(
      'The kind (D-173); without it the kind is derived from direction, sign, scope and ref as before; buyout, writeoff and adjustment only explicitly. A payout only migrated (else 422 use_payout_button), a return and a forgiveness only by their actions (400 use_return_action / use_forgive_action); 400 kind_direction, kind_sign, owner_required, artist_required, scope_required, scope_forbidden, writeoff_area, document_kind; 422 writeoff_exceeds',
    ),
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
  area: z
    .enum(['master', 'publishing'])
    .optional()
    .describe('The area of the book (D-173): master by default; a write-off is always publishing (400 writeoff_area otherwise)'),
});

export const createPayoutBody = z.object({
  labelId: z.string().optional().describe('The own label the payout is made under (D-168): pays the payable of its book; 400 label_required without it'),
  comment: z.string().optional(),
  area: z
    .enum(['master', 'publishing', 'all'])
    .optional()
    .describe('The area paid (D-173): master by default; pays min(payable of the area, payable of the book) floored to cents; all = the whole book'),
});
/** `PATCH /settlements/operations/:id` (D-168): the label of an existing operation; the reason is required (D-173). */
export const setOperationLabelBody = z.object({
  labelId: z.string().min(1),
  reason: z.string().optional().describe('Why the label changes (D-173): required, 400 reason_required without it; kept in the audit summary'),
});
export const proofBody = z.object({ fileRef: z.string().min(1), title: z.string().optional() });
export const deactivateBody = z.object({ reason: z.string().min(1), transferFailed: z.boolean().optional() });
export const deferredBody = z.object({ deferred: z.boolean() });
export const returnBody = z.object({ fileRef: z.string().min(1), date, comment: z.string().min(1) });
/**
 * `POST /settlements/operations/:id/forgive` (D-173): the forgiveness of an advance from a date. The amount is at most
 * the unrecouped part (422 forgiveness_exceeds), the date not before the advance (422 forgiveness_before_advance).
 */
export const forgiveBody = z.object({
  amount: usd.describe('Positive USD, at most the unrecouped part of the advance'),
  date,
  documentId: z.string().min(1).describe('The basis: adjustment_basis, contract, other or label_decision of the owner'),
  comment: z.string().min(1),
});
export const mergeOwnersBody = z.object({
  fromId: z.string(),
  intoId: z.string(),
  reason: z.string().min(1),
});

export const queueQuery = z.object({
  account: z.string().optional().describe('The Believe account'),
  month: month.optional().describe('One report month, YYYY-MM'),
  ownerId: z.string().optional().describe('Only this owner (id)'),
  q: z.string().optional().describe('Text to find: a case-insensitive part of the name or title'),
  limit: z.coerce.number().int().min(1).max(500).default(50).describe('Rows of the page'),
  offset: z.coerce.number().int().min(0).default(0).describe('Rows to skip from the start of the list'),
  ...periodQuery.shape,
  ...labelQuery.shape,
});

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional().describe('Rows of the page'),
  isrc: z.string().optional().describe('Only this ISRC'),
  artistId: z.string().optional().describe('Only this pseudonym (id)'),
  ownerId: z.string().optional().describe('Only this owner (id)'),
  /** Paging of `/splits` and `/participations` (N18). */
  offset: z.coerce.number().int().min(0).optional().describe('Rows to skip from the start of the list'),
  /** `/splits` only: `unconfirmed` = the document is missing or not approved. */
  status: z.enum(['unconfirmed']).optional().describe('unconfirmed: the document is missing or not approved'),
});

/** `GET /documents` (N12): all filters optional; `q` is a case-insensitive substring of the title. */
export const documentsQuery = z.object({
  ownerId: z.string().optional().describe('Only this owner (id)'),
  status: z.enum(['not_attached', 'not_approved', 'approved']).optional().describe('Only documents in this state'),
  kind: documentKind.optional().describe('Only documents of this kind'),
  q: z.string().optional().describe('Text to find: a case-insensitive part of the name or title'),
  ...pageQuery.shape,
  ...labelQuery.shape,
});

const flag = z.enum(['true', 'false']);

/** `GET /settlements/operations` (N14): filters; `from` / `to` are inclusive operation dates. */
export const operationsQuery = z.object({
  ownerId: z.string().optional().describe('Only this owner (id)'),
  artistId: z.string().optional().describe('Only this pseudonym (id)'),
  meaning: z
    .enum(['payout', 'recoupable_payout', 'deduction', 'credit', 'return'])
    .optional()
    .describe('The alias of `kind` (D-173): `recoupable_payout` = `advance`; `kind` wins when both are given'),
  kind: z.enum(OPERATION_KINDS).optional().describe('The stored kind (D-173)'),
  labelSource: z
    .enum([...LABEL_SOURCES, 'none'])
    .optional()
    .describe('Who set the label (D-173): one, default (the history put under 0to8 by default, D-168), operator, payout; none = not marked'),
  direction: z.enum(['in', 'out']).optional().describe('in or out'),
  needsProof: flag.optional().describe('true: payouts (out) that are active and have no payment proof'),
  active: flag.optional().describe('true: only active rows; false: only deactivated'),
  from: date.optional().describe('First day or month of the period'),
  to: date.optional().describe('Last day or month of the period'),
  ...pageQuery.shape,
  ...labelQuery.shape,
});

/** `GET /owners`, `GET /artists`: the list, restricted to the owners / pseudonyms visible under a label (D-168). */
export const ownersQuery = labelQuery.extend(pageQuery.shape);
export const artistsQuery = labelQuery.extend(pageQuery.shape);

/** `GET /search` (N10): `kinds` is a comma list of owners, artists, tracks, documents, labels. */
export const searchQuery = z.object({
  q: z.string().trim().min(1).describe('Text to find: part of a name, alias, pseudonym, title, ISRC or UPC'),
  kinds: z.string().optional().describe('Comma-separated: owners, artists, tracks, documents, labels; without it every kind'),
});

/** Lines of the Believe report files (the `lines` view). `fileId` is a comma-separated list of file ids. */
export const sourceLinesQuery = z.object({
  fileId: z.string().optional().describe('Only these Believe files: comma-separated ids'),
  isrc: z.string().optional().describe('Only this ISRC'),
  upc: z.string().optional().describe('Only this UPC'),
  platform: z.string().optional().describe('Only this store'),
  country: z.string().optional().describe('Only this country'),
  /** '(none)' asks for the empty subscription type. */
  subscriptionType: z.string().optional().describe('Only this subscription type'),
  salesType: z.string().optional().describe('Only this sales type'),
  releaseType: z.string().optional().describe('Only this release type'),
  salesFrom: month.optional().describe('First sales month, YYYY-MM'),
  salesTo: month.optional().describe('Last sales month, YYYY-MM'),
  sort: z.enum(['net', 'gross', 'quantity', 'reportingMonth', 'salesMonth', 'isrc']).optional().describe('The column to sort by'),
  dir: z.enum(['asc', 'desc']).optional().describe('The direction of the sort'),
  limit: z.coerce.number().int().min(1).max(1000).optional().describe('Rows of the page'),
  offset: z.coerce.number().int().min(0).optional().describe('Rows to skip from the start of the list'),
  ...labelQuery.shape,
});
export type SourceLinesQuery = z.infer<typeof sourceLinesQuery>;

export const sourceFacetsQuery = z.object({ fileId: z.string().optional().describe('Only these Believe files: comma-separated ids'), ...labelQuery.shape });

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

/**
 * `POST /splits/import` (D-172): the own label of the import and the mode; `dryRun=1` (default) is the preview, `0` the
 * apply. The label is optional here so that a missing one is the facade's 400 `label_required`.
 */
export const splitImportQuery = z.object({
  ...uploadLabelQuery.shape,
  dryRun: z.enum(['0', '1']).default('1').describe('1 = preview (nothing is written, no audit row), 0 = apply (all or nothing)'),
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
  entityId: z.string().optional().describe('Only the writes that touched this record (id)'),
  limit: z.coerce.number().int().min(1).max(500).optional().describe('Rows of the page'),
  label: z
    .string()
    .optional()
    .describe('Id of an own label: only the writes recorded under it (D-169; writes without a label only without it); 404 unknown, 400 label_not_own'),
});
export type AuditQuery = z.infer<typeof auditQuery>;

// ---- money aggregates (D-142) ----

/** `GET /owners/payables`: the period only shapes `waitingBreakdown`; the totals are all-time like the balance. */
export const payablesQuery = labelPeriodQuery.extend({
  ...pageQuery.shape,
  ids: z
    .string()
    .optional()
    .describe('Comma-separated owner ids (at most 200): only these owners, from a calculation of the units of their reach (D-163)'),
});

/** `GET /artists/balances` (P11, D-167): the money of a list of pseudonyms from one calculation of their union reach. */
export const artistBalancesQuery = labelPeriodQuery.extend({
  ...pageQuery.shape,
  ids: z
    .string()
    .optional()
    .describe('Comma-separated artist ids (at most 200): only these pseudonyms, from a calculation of the units of their reach (D-167); without it every pseudonym from the full calculation'),
});

/** `GET /tracks/summary`: only the units of one Believe account and/or one report month. */
export const trackSummaryQuery = z.object({
  ...pageQuery.shape,
  account: z.string().optional().describe('The Believe account'),
  month: month.optional().describe('One report month, YYYY-MM'),
  isrcs: z
    .string()
    .optional()
    .describe('Comma-separated ISRCs (at most 500): only these tracks, from a calculation of their units alone (D-162)'),
  ...labelQuery.shape,
});
export const trackCatalogQuery = labelQuery.extend({
  ...pageQuery.shape,
  catalog: z
    .enum(['all', 'current'])
    .optional()
    .describe('D-172: `current` = only the ISRCs whose open label-history interval is the label (or any, without a label); default the files of the label too'),
});

export const releasesQuery = z.object({ q: z.string().optional().describe('Text to find in the title, the artist or the UPC'), ...pageQuery.shape, ...labelQuery.shape });
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
  isrc: z.string().optional().describe('Only this ISRC'),
  artistId: z.string().optional().describe('Only this pseudonym (id)'),
  ownerId: z.string().optional().describe('Only this owner (id)'),
  from: month.optional().describe('First day or month of the period'),
  to: month.optional().describe('Last day or month of the period'),
  status: z.enum(['allocated', 'pre_allocated', 'no_split', 'no_artist']).optional().describe('Only expenses in this state of the allocation'),
  includeInactive: z.enum(['true', 'false']).optional().describe('true: deactivated records too'),
  limit: z.coerce.number().int().min(1).max(5000).optional().describe('Rows of the page'),
  offset: z.coerce.number().int().min(0).optional().describe('Rows to skip from the start of the list'),
  ...labelQuery.shape,
});
export const adsSummaryQuery = z.object({ from: month.optional().describe('First month, YYYY-MM'), to: month.optional().describe('Last month, YYYY-MM'), ...labelQuery.shape });

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

// ---- the label history of an ISRC (D-172) ----

/** `POST /tracks/:isrc/label` (D-172): an operator interval `[from, to)` floored to the month start (M52); the same `from` as an operator interval replaces it. */
export const setTrackLabelBody = z.object({
  labelId: z.string().min(1),
  from: date,
  to: date.nullish(),
  note: z.string().max(500).nullish(),
});

// ---- the assumption (D-172) ----

/**
 * `POST /splits/assume` (D-172): one `assumption` document under the own label `labelId` for the splits of a group
 * without a document; the group is exactly one of `isrcs` (every version of each ISRC) or `splitIds`. The reason is the
 * document title («Допущение: …», at most 200 characters), never copied to the audit.
 */
export const assumeSplitsBody = z
  .object({
    /** Required: missing = `400 label_required` (the facade's answer, as for an operation). */
    labelId: z.string().optional(),
    isrcs: z.array(z.string().min(1)).max(5000).optional(),
    splitIds: z.array(z.string().min(1)).max(5000).optional(),
    reason: z.string().trim().min(3).max(2000),
  })
  .refine((b) => (b.isrcs === undefined) !== (b.splitIds === undefined), 'Exactly one of isrcs or splitIds');

// ---- the release registry (D-172) ----

/** `GET /releases/registry`: under a label its rows (`label=`), under «Все» every label's; `q` filters UPC, title, version, artist, catalog number. */
export const releaseRegistryQuery = z.object({ q: z.string().optional().describe('Text to find in the title, the artist or the UPC'), ...labelQuery.shape });

// ---- the onboarding checklist (D-172) ----

/** `GET /onboarding`: the label is required (under «Все» = `400 label_required`). */
export const onboardingQuery = labelQuery;

// ---- the operation import (D-173 §1.5) ----

/** `POST /settlements/operations/import`: the label (checked before the body), the preview flag, a default basis document. */
export const operationImportQuery = z.object({
  ...uploadLabelQuery.shape,
  dryRun: z.enum(['0', '1']).default('1').describe('1 = preview (nothing is written, no audit row), 0 = apply (all or nothing)'),
  documentId: z
    .string()
    .optional()
    .describe('The basis document of the rows without a `document` cell whose kind takes one (advance, deduction, credit, buyout, writeoff, adjustment)'),
});

// ---- the admission (D-176) ----

export const admissionQuery = z.object({
  ownerId: z.string().optional().describe('Only this owner (id)'),
  label: z.string().optional().describe('Id of an own label: the owners of the book and the holds / answers of it (or of every book); a manager must name one'),
  active: z.enum(['true', 'false']).optional().describe('true (default): only the active rows; false: every row'),
});
export const setPayeeBody = z.object({
  ownerId: z.string(),
  channel: z.enum(['tipalti', 'easystaff', 'other']),
  payeeRef: z.string().trim().max(200).nullish(),
  status: z.enum(['confirmed', 'proposed']).optional(),
  basis: z.string().trim().min(1).max(2000),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  source: z.string().max(200).nullish(),
});
export const createHoldBody = z.object({
  ownerId: z.string(),
  labelId: z.string().nullish().describe('The book the hold acts in; empty = every book'),
  kind: z.enum(['decision', 'artist_request', 'question', 'dispute']),
  blocks: z.boolean().optional().describe('Default: true, a dispute false'),
  reason: z.string().trim().min(1).max(4000),
  releaseWhen: z.string().trim().max(2000).nullish(),
  amount: usd.nullish(),
  period: z.string().trim().max(100).nullish(),
  reviewOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullish(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').optional(),
  source: z.string().max(200).nullish(),
});
export const createAnswerBody = z.object({
  ownerId: z.string(),
  labelId: z.string().nullish(),
  due: usd.describe('The payable amount the answer holds for'),
  decision: z.enum(['pay', 'pay_task']),
  why: z.string().trim().min(1).max(4000),
  about: z.string().trim().max(2000).default(''),
  answeredBy: z.string().trim().min(1).max(200),
  source: z.string().max(200).nullish(),
});
export const reasonBody = z.object({ reason: z.string().trim().min(1).max(2000) });
export const contractThresholdBody = z.object({ payoutThresholdCents: z.number().int().min(0).nullable() });

// ---- the opening balances (D-174): the start of 15.10.2026 ----

/** `GET /settlements/start`: the rows of one book (`label=`), or every book without it; `active=false` lists the inactive too. */
export const startListQuery = z.object({
  ...pageQuery.shape,
  label: z.string().optional().describe('Id of an own label: the book; without it every book'),
  active: z.enum(['true', 'false']).optional().describe('true (default): only the active rows; false: every row, the deactivated included'),
});

/** `POST /settlements/start/import`: the book, the cut month and the synchronisation moment (checked before the body), the preview flag, a default basis. */
export const startImportQuery = z.object({
  ...uploadLabelQuery.shape,
  cutoff: month.describe('The last report month inside the start (YYYY-MM)'),
  syncedAt: z
    .string()
    .min(10)
    .describe('The boundary of the movements, ISO 8601 with a zone (operations of the book dated up to its UTC day are inside the start)'),
  dryRun: z.enum(['0', '1']).default('1').describe('1 = preview (nothing is written, no audit row), 0 = apply (all or nothing)'),
  basis: z.string().trim().max(2000).optional().describe('The basis of the rows without a `basis` cell (the snapshot file and its sha256, the decision)'),
});

/** `POST /settlements/start/:id/deactivate`: the soft rollback of a row. */
export const deactivateStartBody = z.object({ reason: z.string().trim().min(1).max(2000) });

// ---- the payroll stage: asOf, the area, the payroll export (D-173) ----

const asOfShape = {
  asOf: month
    .optional()
    .describe('YYYY-MM (D-173): the balance as of the end of that month: units and statements of report months ≤ asOf, operations and positions dated ≤ its last day, advertising of months ≤ asOf; document statuses are those of now'),
};
const readArea = z
  .enum(['master', 'publishing', 'all'])
  .optional()
  .describe('The area of the payout gate (D-173): without it all (the book); master / publishing: the gate pays min(payable of the area, payable of the book); the money fields stay the book');

/** `GET /owners/:id/balance` (D-173): the label period query with `asOf` and the area of the gate. */
export const balanceQuery = labelPeriodQuery.extend({ ...asOfShape, area: readArea });
/** `GET /owners/payables` (D-173): with `asOf` and the area of the gate (the money fields of a row stay the book, FIX-7). */
export const payablesAsOfQuery = payablesQuery.extend({ ...asOfShape, area: readArea });

export const PAYROLL_SHEETS = ['payroll', 'waiting', 'buyouts', 'control'] as const;
/** `GET /owners/payroll` (D-173 §1.4): the payroll of one label; json or csv (one sheet). */
export const payrollQuery = z.object({
  ...pageQuery.shape,
  label: z.string().optional().describe('Id of an own label (required: 400 label_required; the payroll is the book of a label)'),
  ...asOfShape,
  area: z.enum(['master', 'publishing', 'all']).default('master').describe('The area of the payroll: master by default (the button), publishing, all'),
  format: z.enum(['json', 'csv']).default('json').describe('json: every sheet; csv: one sheet (UTF-8 with BOM, `;`, every field quoted, decimal point)'),
  sheet: z.enum(PAYROLL_SHEETS).default('payroll').describe('The sheet of the csv'),
});
export type PayrollQuery = z.infer<typeof payrollQuery>;
