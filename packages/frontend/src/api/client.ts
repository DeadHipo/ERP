import { z } from 'zod';
import * as S from '@erp/shared/api-schemas';
import * as R from '@erp/shared/api-responses';
import { getOperator } from '../lib/operator';

// The one typed client (R6). Every request body type comes from `@erp/shared/api-schemas`, every response is parsed
// with its zod schema from `@erp/shared/api-responses`; there is no hand-written response type in `src/api/`
// (`tests/no-dto.test.ts` checks it). A parse failure is an `ApiError` with the code `contract_mismatch`.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
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

/** Every call of the app goes through here: fetch, the operator header on writes, error mapping, schema parse. */
export async function call<Schema extends z.ZodType>(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { query?: QueryParams; body?: unknown; schema: Schema },
): Promise<z.output<Schema>> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const operator = getOperator();
    if (!operator) throw new ApiError('Укажите оператора', 0, 'operator_required');
    headers['X-Operator'] = encodeURIComponent(operator);
  }
  const init: RequestInit = { method, headers };
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
      const { code, message, details } = parsed.data.error;
      throw new ApiError(message, res.status, code, details);
    }
    throw new ApiError(res.statusText || 'Request failed', res.status, 'http_error');
  }
  const parsed = options.schema.safeParse(json);
  if (!parsed.success) throw new ApiError('Response does not match the contract', 0, 'contract_mismatch', parsed.error.issues);
  return parsed.data;
}

const id = encodeURIComponent;
const list = <T extends z.ZodType>(item: T) => z.array(item);

// ---- one function per operation of packages/backend/src/api/operations.ts, named by topic ----

export const owners = {
  /** Under a label (D-168): the owners visible under it. */
  list: (query: z.input<typeof S.ownersQuery> = {}) => call('GET', '/owners', { query, schema: list(R.ownerSchema) }),
  create: (body: z.input<typeof S.createOwnerBody>) =>
    call('POST', '/owners', { body, schema: R.ownerSchema }),
  merge: (body: z.input<typeof S.mergeOwnersBody>) =>
    call('POST', '/owners/merge', { body, schema: R.ownerSchema }),
  get: (ownerId: string) => call('GET', `/owners/${id(ownerId)}`, { schema: R.ownerDetailSchema }),
  /** Under a label (`label`, D-168): the book of that label alone. */
  balance: (ownerId: string, query: z.input<typeof S.labelPeriodQuery> = {}) =>
    call('GET', `/owners/${id(ownerId)}/balance`, { query, schema: R.balanceSchema }),
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
};

export const documents = {
  list: (query: z.input<typeof S.listQuery> = {}) =>
    call('GET', '/documents', { query, schema: list(R.documentSchema) }),
  create: (body: z.input<typeof S.createDocumentBody>) =>
    call('POST', '/documents', { body, schema: R.documentSchema }),
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
