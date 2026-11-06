import { z } from 'zod';
import * as S from '@erp/shared/api-schemas';
import * as R from '@erp/shared/api-responses';
import { getOperator } from '../lib/operator';
import { getWorkOrg, loginPath, orgHeader } from '../lib/session';

// The one typed client (R6). Every request body type comes from `@erp/shared/api-schemas`, every response is parsed
// with its zod schema from `@erp/shared/api-responses`; there is no hand-written response type in `src/api/`
// (`tests/no-dto.test.ts` checks it). A parse failure is an `ApiError` with the code `contract_mismatch`.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
    /** The id of the request of a 500 (`X-Request-Id`, D-170): the toast names it. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Query parameters; only strings, numbers and booleans are sent (the shared query schemas coerce numbers). */
export type QueryParams = Record<string, unknown>;

const BASE = '/api/v1';

function queryString(query?: QueryParams): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === '' || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Set by the app: shown when a write answered with `X-Audit: failed` (the trace of the action was not recorded). */
let onAuditFailed: (() => void) | undefined;
export function setAuditFailedHandler(fn: () => void): void {
  onAuditFailed = fn;
}

let leaving = false;
/** «Выйти»: the browser goes to the login page; a 401 of a request still in flight does not redirect it again. */
export function leaveToLogin(): void {
  leaving = true;
  window.location.assign('/login');
}

/** A 401 `unauthenticated` (no session, or it ended): the login page, then back here (D-170). */
function toLogin(): void {
  if (typeof window === 'undefined' || leaving || window.location.pathname === '/login') return;
  window.location.assign(loginPath(`${window.location.pathname}${window.location.search}`));
}

/**
 * Every call of the app goes through here: fetch (with the session cookie), the operator header on writes, `X-Org` of a
 * system administrator working in an organization (or `org` of the call), error mapping, schema parse. `anonymous` =
 * a public write (the login and the logout, D-170): no operator yet.
 */
export async function call<Schema extends z.ZodType>(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { query?: QueryParams; body?: unknown; schema: Schema; anonymous?: boolean; org?: string },
): Promise<z.output<Schema>> {
  const headers: Record<string, string> = {};
  if (method !== 'GET' && !options.anonymous) {
    const operator = getOperator();
    if (!operator) throw new ApiError('Укажите оператора', 0, 'operator_required');
    headers['X-Operator'] = encodeURIComponent(operator);
  }
  // `org`: a system administrator reading another organization than the one worked in (P25: its own labels)
  const org = options.org ?? orgHeader();
  if (org) headers['X-Org'] = org;
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (options.body instanceof FormData) init.body = options.body;
  else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${url}${queryString(options.query)}`, init);
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : String(e), 0, 'network_error');
  }
  const json: unknown = await res.json().catch(() => undefined);
  // D-150: the write happened but its audit record failed; the operator must know the trace is missing.
  if (res.ok && method !== 'GET' && res.headers.get('X-Audit') === 'failed') onAuditFailed?.();
  if (!res.ok) {
    const parsed = R.errorBody.safeParse(json);
    if (parsed.success) {
      const { code, message, details, requestId } = parsed.data.error;
      if (res.status === 401 && code === 'unauthenticated') toLogin();
      throw new ApiError(message, res.status, code, details, requestId ?? res.headers.get('X-Request-Id') ?? undefined);
    }
    throw new ApiError(res.statusText || 'Request failed', res.status, 'http_error');
  }
  const parsed = options.schema.safeParse(json);
  if (!parsed.success) throw new ApiError('Response does not match the contract', 0, 'contract_mismatch', parsed.error.issues);
  return parsed.data;
}

/**
 * A file download (D-173: the payroll csv): the same session, `X-Org` and error mapping as `call()`, the body kept as a
 * Blob, the file name from `Content-Disposition` (its `filename*` first) or `fallback`.
 */
export async function download(url: string, query: QueryParams, fallback: string): Promise<{ blob: Blob; fileName: string }> {
  const headers: Record<string, string> = {};
  const org = orgHeader();
  if (org) headers['X-Org'] = org;
  let res: Response;
  try {
    res = await fetch(`${BASE}${url}${queryString(query)}`, { method: 'GET', headers, credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : String(e), 0, 'network_error');
  }
  if (!res.ok) {
    const parsed = R.errorBody.safeParse(await res.json().catch(() => undefined));
    if (parsed.success) {
      const { code, message, details, requestId } = parsed.data.error;
      if (res.status === 401 && code === 'unauthenticated') toLogin();
      throw new ApiError(message, res.status, code, details, requestId ?? res.headers.get('X-Request-Id') ?? undefined);
    }
    throw new ApiError(res.statusText || 'Request failed', res.status, 'http_error');
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  return { blob: await res.blob(), fileName: star ? decodeURIComponent(star) : (plain ?? fallback) };
}

const id = encodeURIComponent;
const list = <T extends z.ZodType>(item: T) => z.array(item);

// ---- one function per operation of packages/backend/src/api/operations.ts, named by topic ----

/** The minimal login (D-170): the session cookie `erp_session` is set and cleared by the server. */
export const auth = {
  login: (body: z.input<typeof S.loginBody>) => call('POST', '/auth/login', { body, schema: R.meSchema, anonymous: true }),
  logout: () => call('POST', '/auth/logout', { schema: R.okSchema, anonymous: true }),
  /**
   * The organization a system administrator chose (this tab, `erp.org`) goes along before `me` says who asks: under a
   * live support grant the answer is the role `support` there (D-171); a member is never asked for it.
   */
  me: () => call('GET', '/auth/me', { schema: R.meSchema, org: getWorkOrg() || undefined }),
  /** The user's own password (D-171); the other sessions of the user end. */
  changePassword: (body: z.input<typeof S.changeOwnPasswordBody>) =>
    call('POST', '/auth/password', { body, schema: R.okSchema }),
};

/** The organizations, for the system administrator only (P24, P25; no money). */
export const orgs = {
  list: () => call('GET', '/orgs', { schema: list(R.orgSummarySchema) }),
  create: (body: z.input<typeof S.createOrgBody>) => call('POST', '/orgs', { body, schema: R.orgSchema }),
  get: (orgId: string) => call('GET', `/orgs/${id(orgId)}`, { schema: R.orgSummarySchema }),
  users: (orgId: string) => call('GET', `/orgs/${id(orgId)}/users`, { schema: list(R.memberSchema) }),
  createUser: (orgId: string, body: z.input<typeof S.createMemberUserBody>) =>
    call('POST', `/orgs/${id(orgId)}/users`, { body, schema: R.memberSchema }),
  /** An existing user (by login) becomes a member (D-171). */
  addMember: (orgId: string, body: z.input<typeof S.addMemberBody>) =>
    call('POST', `/orgs/${id(orgId)}/members`, { body, schema: R.memberSchema }),
  updateMember: (orgId: string, userId: string, body: z.input<typeof S.updateMemberBody>) =>
    call('PATCH', `/orgs/${id(orgId)}/users/${id(userId)}`, { body, schema: R.memberSchema }),
  /** «Работать в организации» under a live support grant (D-171): the session as `support` there. */
  enterSupport: (orgId: string) => call('POST', `/orgs/${id(orgId)}/support/enter`, { schema: R.meSchema }),
};

/** Every user, for the system administrator (P27, D-171). */
export const systemUsers = {
  list: () => call('GET', '/system/users', { schema: list(R.systemUserSchema) }),
  update: (userId: string, body: z.input<typeof S.updateSystemUserBody>) =>
    call('PATCH', `/system/users/${id(userId)}`, { body, schema: R.systemUserSchema }),
  setPassword: (userId: string, body: z.input<typeof S.setPasswordBody>) =>
    call('POST', `/system/users/${id(userId)}/password`, { body, schema: R.okSchema }),
};

/** The members of the organization of the session, for its administrator (P26, D-171). */
export const users = {
  list: () => call('GET', '/users', { schema: list(R.memberSchema) }),
  create: (body: z.input<typeof S.createMemberUserBody>) => call('POST', '/users', { body, schema: R.memberSchema }),
  update: (userId: string, body: z.input<typeof S.updateMemberBody>) =>
    call('PATCH', `/users/${id(userId)}`, { body, schema: R.memberSchema }),
  setPassword: (userId: string, body: z.input<typeof S.setPasswordBody>) =>
    call('POST', `/users/${id(userId)}/password`, { body, schema: R.okSchema }),
};

/** The support grants of the organization of the session, for its administrator (P26 «Поддержка», D-171). */
export const support = {
  list: () => call('GET', '/support', { schema: list(R.supportGrantSchema) }),
  grant: (body: z.input<typeof S.grantSupportBody>) => call('POST', '/support', { body, schema: R.supportGrantSchema }),
  revoke: (grantId: string) => call('POST', `/support/${id(grantId)}/revoke`, { schema: R.supportGrantSchema }),
};

export const owners = {
  /** Under a label (D-168): the owners visible under it. */
  list: (query: z.input<typeof S.ownersQuery> = {}) => call('GET', '/owners', { query, schema: list(R.ownerSchema) }),
  create: (body: z.input<typeof S.createOwnerBody>) =>
    call('POST', '/owners', { body, schema: R.ownerSchema }),
  merge: (body: z.input<typeof S.mergeOwnersBody>) =>
    call('POST', '/owners/merge', { body, schema: R.ownerSchema }),
  get: (ownerId: string) => call('GET', `/owners/${id(ownerId)}`, { schema: R.ownerDetailSchema }),
  /** Under a label (`label`, D-168): the book of that label alone. */
  balance: (ownerId: string, query: z.input<typeof S.balanceQuery> = {}) =>
    call('GET', `/owners/${id(ownerId)}/balance`, { query, schema: R.balanceSchema }),
  /** One sheet of the payroll of a label as csv (D-173 §1.4): the file is saved by the page. */
  payrollCsv: (query: Omit<z.input<typeof S.payrollQuery>, 'format'>) =>
    download('/owners/payroll', { ...query, format: 'csv' }, 'payroll.csv'),
  payout: (ownerId: string, body: z.input<typeof S.createPayoutBody> = {}) =>
    call('POST', `/owners/${id(ownerId)}/payouts`, { body, schema: R.operationSchema }),
};

export const artists = {
  /** Under a label (D-168): the pseudonyms visible under it. */
  list: (query: z.input<typeof S.artistsQuery> = {}) => call('GET', '/artists', { query, schema: list(R.artistListItemSchema) }),
  create: (body: z.input<typeof S.createArtistBody>) =>
    call('POST', '/artists', { body, schema: R.artistSchema }),
  /** The card of a pseudonym (P12, D-165); a merged id answers for the survivor. */
  get: (artistId: string) => call('GET', `/artists/${id(artistId)}`, { schema: R.artistDetailSchema }),
  /** The money of a pseudonym from the units of its reach (P12, D-165). */
  balance: (artistId: string, query: z.input<typeof S.labelPeriodQuery> = {}) =>
    call('GET', `/artists/${id(artistId)}/balance`, { query, schema: R.artistBalanceSchema }),
  assignOwner: (artistId: string, body: z.input<typeof S.assignOwnerBody>) =>
    call('POST', `/artists/${id(artistId)}/owner`, { body, schema: R.artistSchema }),
  /** The money of a list of pseudonyms (the visible rows of P11, D-167), or of every pseudonym without `ids`. */
  balances: (query: z.input<typeof S.artistBalancesQuery> = {}) =>
    call('GET', '/artists/balances', { query, schema: R.artistBalancesSchema }),
};

export const tracks = {
  list: () => call('GET', '/tracks', { schema: list(R.trackSchema) }),
  create: (body: z.input<typeof S.createTrackBody>) =>
    call('POST', '/tracks', { body, schema: R.trackSchema }),
  update: (trackId: string, body: z.input<typeof S.updateTrackBody>) =>
    call('PATCH', `/tracks/${id(trackId)}`, { body, schema: R.trackSchema }),
  explain: (isrc: string) => call('GET', `/tracks/${id(isrc)}/explain`, { schema: R.explainSchema }),
  /** The label history of an ISRC (D-172): navigation, not money. */
  labels: (isrc: string) => call('GET', `/tracks/${id(isrc)}/labels`, { schema: R.trackLabelsSchema }),
  /** An operator interval of the label history; the same `from` as an operator interval replaces it. Answers the history. */
  setLabel: (isrc: string, body: z.input<typeof S.setTrackLabelBody>) =>
    call('POST', `/tracks/${id(isrc)}/label`, { body, schema: R.trackLabelsSchema }),
};

/** The release registry of a label (D-172): the Believe release export, no money. */
export const releases = {
  importFile: (file: File, labelId: string) =>
    call('POST', '/releases/import', { query: uploadQuery(labelId), body: fileForm(file), schema: R.releaseImportSchema }),
  registry: (query: z.input<typeof S.releaseRegistryQuery> = {}) =>
    call('GET', '/releases/registry', { query, schema: R.releaseRegistrySchema }),
};

export const documents = {
  /** Under a label (`label=`, D-169): the documents of that label and those without one. */
  list: (query: z.input<typeof S.documentsQuery> = {}) =>
    call('GET', '/documents', { query, schema: list(R.documentSchema) }),
  /** `labelId` absent or null = the document opens any label (D-169). */
  create: (body: z.input<typeof S.createDocumentBody>) =>
    call('POST', '/documents', { body, schema: R.documentSchema }),
  /** Sets or clears (null = any label) the own label of a document (D-169). */
  setLabel: (documentId: string, body: z.input<typeof S.setDocumentLabelBody>) =>
    call('PATCH', `/documents/${id(documentId)}`, { body, schema: R.documentSchema }),
  attach: (documentId: string, body: z.input<typeof S.attachFileBody>) =>
    call('POST', `/documents/${id(documentId)}/attach`, { body, schema: R.documentSchema }),
  approve: (documentId: string, body: z.input<typeof S.approveBody>) =>
    call('POST', `/documents/${id(documentId)}/approve`, { body, schema: R.documentSchema }),
  /** What the document confirms and the C money that waits for it (N13). */
  uses: (documentId: string) => call('GET', `/documents/${id(documentId)}/uses`, { schema: R.documentUsesSchema }),
  createContract: (body: z.input<typeof S.createContractBody>) =>
    call('POST', '/contracts', { body, schema: R.createdContractSchema }),
};

export const splits = {
  list: (query: z.input<typeof S.listQuery> = {}) =>
    call('GET', '/splits', { query, schema: R.splitListSchema }),
  create: (body: z.input<typeof S.createSplitBody>) =>
    call('POST', '/splits', { body, schema: R.splitSchema }),
  change: (body: z.input<typeof S.changeSplitBody>) =>
    call('POST', '/splits/change', { body, schema: R.splitSchema }),
  buyout: (body: z.input<typeof S.buyoutBody>) =>
    call('POST', '/splits/buyout', { body, schema: list(R.splitSchema) }),
  confirm: (splitId: string, body: z.input<typeof S.confirmSplitBody>) =>
    call('POST', `/splits/${id(splitId)}/confirm`, { body, schema: R.splitSchema }),
  /** The split import (D-172, P28): `dryRun` true = the preview (nothing written), false = the apply (all or nothing). */
  importFile: (file: File, labelId: string, dryRun: boolean) =>
    call('POST', '/splits/import', {
      query: { label: labelId, dryRun: dryRun ? '1' : '0' } satisfies z.input<typeof S.splitImportQuery>,
      body: fileForm(file),
      schema: R.splitImportSchema,
    }),
  /** «Принять как допущение» (D-172): one `assumption` document for the splits of the group without a document. */
  assume: (body: z.input<typeof S.assumeSplitsBody>) => call('POST', '/splits/assume', { body, schema: R.assumeResultSchema }),
};

export const participations = {
  list: (query: z.input<typeof S.listQuery> = {}) =>
    call('GET', '/participations', { query, schema: R.participationListSchema }),
  create: (body: z.input<typeof S.createParticipationBody>) =>
    call('POST', '/participations', { body, schema: R.participationSchema }),
  close: (participationId: string, body: z.input<typeof S.closeValidToBody>) =>
    call('POST', `/participations/${id(participationId)}/close`, { body, schema: R.participationSchema }),
};

export const labels = {
  list: () => call('GET', '/labels', { schema: list(R.labelListItemSchema) }),
  /** The labels of a given organization, for the system administrator (P25: the labels of a new label manager). */
  listOf: (orgId: string) => call('GET', '/labels', { schema: list(R.labelListItemSchema), org: orgId }),
  create: (body: z.input<typeof S.createLabelBody>) =>
    call('POST', '/labels', { body, schema: R.labelSchema }),
  addAlias: (labelId: string, body: z.input<typeof S.addAliasBody>) =>
    call('POST', `/labels/${id(labelId)}/aliases`, { body, schema: R.labelSchema }),
  /** A Believe account of an own label (D-168). */
  addAccount: (labelId: string, body: z.input<typeof S.addAccountBody>) =>
    call('POST', `/labels/${id(labelId)}/accounts`, { body, schema: R.labelSchema }),
  /** Removes an account from an own label while no file of it is loaded (D-169; 409 `account_has_files`). */
  removeAccount: (labelId: string, account: string) =>
    call('POST', `/labels/${id(labelId)}/accounts/${id(account)}/remove`, { schema: R.labelSchema }),
  setRule: (labelId: string, body: z.input<typeof S.createLabelRuleBody>) =>
    call('POST', `/labels/${id(labelId)}/rules`, { body, schema: R.labelRuleSchema }),
  closeRule: (ruleId: string, body: z.input<typeof S.closeValidToBody>) =>
    call('POST', `/labels/rules/${id(ruleId)}/close`, { body, schema: R.labelRuleSchema }),
};

export const sources = {
  /** Under a label (`label`, D-169): the files and statements loaded under it. */
  files: (query: z.input<typeof S.sourceFilesQuery> = {}) => call('GET', '/sources/files', { query, schema: R.sourceFilesSchema }),
  lines: (query: z.input<typeof S.sourceLinesQuery> = {}) =>
    call('GET', '/sources/lines', { query, schema: R.sourceLinesPageSchema }),
  facets: (query: z.input<typeof S.sourceFacetsQuery> = {}) =>
    call('GET', '/sources/lines/facets', { query, schema: R.sourceFacetsSchema }),
  /** Loaded under an own label (D-169): the account of the file name must be registered under it. */
  uploadBelieve: (file: File, labelId: string) =>
    call('POST', '/sources/believe', { query: uploadQuery(labelId), body: fileForm(file), schema: R.sourceFileSchema }),
};

export const publishing = {
  /** Loaded under an own label (D-169). */
  uploadB17: (file: File, labelId: string) =>
    call('POST', '/publishing/b17', { query: uploadQuery(labelId), body: fileForm(file), schema: R.b17UploadSchema }),
  writers: () => call('GET', '/publishing/writers', { schema: list(R.publishingWriterSchema) }),
  mapWriter: (norm: string, body: z.input<typeof S.mapWriterBody>) =>
    call('POST', `/publishing/writers/${id(norm)}/map`, { body, schema: R.ownerSchema }),
  resolveWriters: () => call('POST', '/publishing/writers/resolve', { schema: R.resolveWritersSchema }),
  /** A corrected file of the same quarters for a loaded statement, under the same own label (D-173). */
  replaceStatement: (statementId: string, file: File, labelId: string) =>
    call('POST', `/publishing/statements/${id(statementId)}/replace`, {
      query: uploadQuery(labelId),
      body: fileForm(file),
      schema: R.b17ReplaceSchema,
    }),
  setTerms: (body: z.input<typeof S.publishingTermsBody>) =>
    call('POST', '/publishing/terms', { body, schema: R.publishingTermsSchema }),
};

export const reports = {
  reconciliation: (query: z.input<typeof S.periodQuery> = {}) =>
    call('GET', '/reconciliation', { query, schema: list(R.reconciliationRowSchema) }),
  /** Signals: every list cut to `limit`, `counts` has the full length of each (N18). */
  signals: (query: z.input<typeof S.listQuery> & z.input<typeof S.labelPeriodQuery> = {}) =>
    call('GET', '/signals', { query, schema: R.signalsSchema }),
  /** P1 in one calculation: reconciliation rows, the C queue summary, signal counts, file counts (N1). */
  overview: (query: z.input<typeof S.periodQuery> = {}) =>
    call('GET', '/overview', { query, schema: R.overviewSchema }),
  /** One reason of the C queue grouped by what unblocks it, largest first, paged (N3). */
  queue: (reason: z.output<typeof R.cReasonSchema>, query: z.input<typeof S.queueQuery> = {}) =>
    call('GET', `/queue/${id(reason)}`, { query, schema: R.queuePageSchema }),
  /** The onboarding checklist of one own label (D-172; no calculation). */
  onboarding: (query: z.input<typeof S.onboardingQuery>) => call('GET', '/onboarding', { query, schema: R.onboardingSchema }),
  /** The onboarding checklist of the organization, its administrator's (D-172). */
  orgOnboarding: () => call('GET', '/onboarding/organization', { schema: R.orgOnboardingSchema }),
};

/** The operations list and the payout snapshot are in `api/money.ts` (with their filters and schemas). */
export const settlements = {
  create: (body: z.input<typeof S.createOperationBody>) =>
    call('POST', '/settlements/operations', { body, schema: R.operationSchema }),
  /** The label of an existing operation (the history before the split, D-168). */
  setLabel: (operationId: string, body: z.input<typeof S.setOperationLabelBody>) =>
    call('PATCH', `/settlements/operations/${id(operationId)}`, { body, schema: R.operationSchema }),
  proof: (operationId: string, body: z.input<typeof S.proofBody>) =>
    call('POST', `/settlements/operations/${id(operationId)}/proof`, { body, schema: R.operationSchema }),
  deferred: (operationId: string, body: z.input<typeof S.deferredBody>) =>
    call('POST', `/settlements/operations/${id(operationId)}/deferred`, { body, schema: R.operationSchema }),
  deactivate: (operationId: string, body: z.input<typeof S.deactivateBody>) =>
    call('POST', `/settlements/operations/${id(operationId)}/deactivate`, { body, schema: R.operationSchema }),
  returnPayout: (operationId: string, body: z.input<typeof S.returnBody>) =>
    call('POST', `/settlements/operations/${id(operationId)}/return`, { body, schema: R.operationSchema }),
  /** The forgiveness of an advance from a date (D-173): at most its unrecouped part. */
  forgive: (operationId: string, body: z.input<typeof S.forgiveBody>) =>
    call('POST', `/settlements/operations/${id(operationId)}/forgive`, { body, schema: R.operationSchema }),
  /** The operation import (D-173, P29): `dryRun` true = the preview (nothing written), false = the apply (all or nothing). */
  importFile: (file: File, labelId: string, dryRun: boolean, documentId?: string) =>
    call('POST', '/settlements/operations/import', {
      query: { label: labelId, dryRun: dryRun ? '1' : '0', ...(documentId ? { documentId } : {}) } satisfies z.input<typeof S.operationImportQuery>,
      body: fileForm(file),
      schema: R.operationImportSchema,
    }),
  /** The opening balances of a book (D-174, P30): the rows with their pseudonyms and sums; `active` false lists the deactivated too. */
  startList: (query: z.input<typeof S.startListQuery> = {}) => call('GET', '/settlements/start', { query, schema: R.startListSchema }),
  /** The import of the opening balances (D-174, P30): `dryRun` true = the preview (nothing written), false = the apply (all or nothing). */
  importStart: (file: File, q: { labelId: string; cutoff: string; syncedAt: string; basis?: string }, dryRun: boolean) =>
    call('POST', '/settlements/start/import', {
      query: { label: q.labelId, cutoff: q.cutoff, syncedAt: q.syncedAt, dryRun: dryRun ? '1' : '0', ...(q.basis ? { basis: q.basis } : {}) } satisfies z.input<typeof S.startImportQuery>,
      body: fileForm(file),
      schema: R.startImportSchema,
    }),
  deactivateStart: (rowId: string, body: z.input<typeof S.deactivateStartBody>) =>
    call('POST', `/settlements/start/${id(rowId)}/deactivate`, { body, schema: R.openingBalanceSchema }),
};

/** `GET /search`. Optional `kinds` restricts the result to one or more kinds (EntityPicker). */
/** Advertising expenses (D-155, D-156): records with their allocation, the summary, batch create, percent/scope, deactivate. */
export const ads = {
  list: (query: z.input<typeof S.adsQuery> = {}) => call('GET', '/ads', { query, schema: R.adListSchema }),
  get: (adId: string) => call('GET', `/ads/${id(adId)}`, { schema: R.adViewSchema }),
  summary: (query: z.input<typeof S.adsSummaryQuery> = {}) => call('GET', '/ads/summary', { query, schema: R.adSummarySchema }),
  create: (body: z.input<typeof S.createAdsBody>) => call('POST', '/ads', { body, schema: R.adsCreatedSchema }),
  update: (adId: string, body: z.input<typeof S.updateAdBody>) =>
    call('PATCH', `/ads/${id(adId)}`, { body, schema: R.adExpenseSchema }),
  deactivate: (adId: string, body: z.input<typeof S.deactivateAdBody>) =>
    call('POST', `/ads/${id(adId)}/deactivate`, { body, schema: R.adExpenseSchema }),
};

export const search = {
  query: (q: string, kinds?: readonly (typeof R.SEARCH_KINDS)[number][]) =>
    call('GET', '/search', { query: { q, kinds: kinds?.join(',') }, schema: R.searchResultSchema }),
};

function uploadQuery(labelId: string): z.input<typeof S.uploadLabelQuery> {
  return { label: labelId };
}

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file, file.name);
  return form;
}
