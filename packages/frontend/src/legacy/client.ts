import type { z } from 'zod';
import type * as S from '@erp/shared/api-schemas';

// Small typed API client. Request bodies are typed by the zod schemas shared with the server.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(`/api/v1${url}`, init);
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message: string; code: string; details?: unknown };
  };
  if (!res.ok)
    throw new ApiError(
      json.error?.message ?? res.statusText,
      res.status,
      json.error?.code ?? 'error',
      json.error?.details,
    );
  return json as T;
}

const qs = (q: Record<string, string | undefined>) => {
  const p = Object.entries(q).filter(([, v]) => v);
  return p.length ? '?' + new URLSearchParams(p as [string, string][]).toString() : '';
};

/** Money comes as exact decimal strings. */
export type Money = string;

// Response types are inferred from the schemas of the contract (also used by the server's OpenAPI and its tests).
export type {
  Balance,
  LabelListItem,
  ParticipationListItem,
  DocumentView,
  Operation,
  Owner,
  OwnerDetail,
  ReconciliationRow,
  Signals,
  Track,
} from '@erp/shared/api-responses';
import type {
  Balance,
  LabelListItem,
  ParticipationListItem,
  DocumentView,
  Operation,
  Owner,
  OwnerDetail,
  ReconciliationRow,
  Signals,
  Track,
} from '@erp/shared/api-responses';

export interface Artist {
  id: string;
  pseudonym: string;
  ownerId: string | null;
  status: string;
  tracks?: Track[];
}
export interface SplitView {
  id: string;
  isrc: string;
  validFrom: string;
  validTo: string | null;
  documentId: string | null;
  documentStatus: string;
  ourShare: string;
  origin: string;
  shares: { artistId: string; percent: string; pseudonym: string; ownerId: string | null }[];
}
/** A Believe file (registry record) or a B17 statement: the fields only one of them has are optional. */
export interface SourceFile {
  id: string;
  fileName: string;
  sha256: string;
  status: string;
  reportingMonth?: string;
  periods?: string[];
  /** Believe: when the file was uploaded. */
  createdAt?: string;
  /** B17: when the statement was generated. */
  generatedAt?: string;
  generatedAtSource?: string;
  /** Null while a Believe file is loading or failed. */
  lineCount: number | null;
  netTotal?: Money | null;
  totalPayable?: Money;
  warnings?: string[];
}
/** A Believe report file in force, as the lines page names it. */
export interface BelieveFileRef {
  id: string;
  account: string;
  reportingMonth: string;
  fileName: string;
}
/** One line of a Believe report file: equal keys of the file are already summed; counts and money are exact text. */
export interface SourceLine {
  fileId: string;
  account: string;
  reportingMonth: string;
  salesMonth: string;
  platform: string;
  country: string;
  isrc: string;
  upc: string;
  currency: string;
  subscriptionType: string;
  salesType: string;
  releaseType: string;
  quantity: string;
  gross: Money;
  net: Money;
  /** How many lines of the report were summed into this one. */
  mergedLines: string;
  artistName: string;
  trackTitle: string;
}
export interface SourceLinesPage {
  files: BelieveFileRef[];
  items: SourceLine[];
  total: { keys: string; quantity: string; gross: Money; net: Money; mergedLines: string };
  limit: number;
  offset: number;
  sort: string;
  dir: 'asc' | 'desc';
}
export interface SourceFacets {
  files: BelieveFileRef[];
  platforms: string[];
  countries: string[];
  subscriptionTypes: string[];
  salesTypes: string[];
  releaseTypes: string[];
}
export type SourceLinesQuery = Record<string, string | undefined>;

export const api = {
  owners: () => call<Owner[]>('GET', '/owners'),
  createOwner: (b: z.input<typeof S.createOwnerBody>) => call<Owner>('POST', '/owners', b),
  owner: (id: string) => call<OwnerDetail>('GET', `/owners/${id}`),
  balance: (id: string, q: z.input<typeof S.periodQuery>) =>
    call<Balance>('GET', `/owners/${id}/balance${qs(q)}`),
  payout: (id: string) => call<Operation>('POST', `/owners/${id}/payouts`, {}),
  artists: () => call<Artist[]>('GET', '/artists'),
  createArtist: (b: z.input<typeof S.createArtistBody>) => call<Artist>('POST', '/artists', b),
  createTrack: (b: z.input<typeof S.createTrackBody>) => call<Track>('POST', '/tracks', b),
  documents: (ownerId?: string) => call<DocumentView[]>('GET', `/documents${qs({ ownerId })}`),
  createDocument: (b: z.input<typeof S.createDocumentBody>) => call<DocumentView>('POST', '/documents', b),
  attachFile: (id: string, fileRef: string) =>
    call<DocumentView>('POST', `/documents/${id}/attach`, { fileRef }),
  approve: (id: string) => call<DocumentView>('POST', `/documents/${id}/approve`, { by: 'manager' }),
  createContract: (b: z.input<typeof S.createContractBody>) => call<unknown>('POST', '/contracts', b),
  splits: (q: { isrc?: string; limit?: string }) =>
    call<{ total: number; items: SplitView[] }>('GET', `/splits${qs(q)}`),
  createSplit: (b: z.input<typeof S.createSplitBody>) => call<SplitView>('POST', '/splits', b),
  changeSplit: (b: z.input<typeof S.changeSplitBody>) => call<SplitView>('POST', '/splits/change', b),
  labels: () => call<LabelListItem[]>('GET', '/labels'),
  createLabel: (b: z.input<typeof S.createLabelBody>) => call<unknown>('POST', '/labels', b),
  addAlias: (id: string, alias: string) => call<unknown>('POST', `/labels/${id}/aliases`, { alias }),
  createLabelRule: (id: string, b: z.input<typeof S.createLabelRuleBody>) =>
    call<unknown>('POST', `/labels/${id}/rules`, b),
  closeLabelRule: (id: string, validTo: string) =>
    call<unknown>('POST', `/labels/rules/${id}/close`, { validTo }),
  participations: (q: { isrc?: string }) =>
    call<{ total: number; items: ParticipationListItem[] }>('GET', `/participations${qs(q)}`),
  createParticipation: (b: z.input<typeof S.createParticipationBody>) =>
    call<unknown>('POST', '/participations', b),
  closeParticipation: (id: string, validTo: string) =>
    call<unknown>('POST', `/participations/${id}/close`, { validTo }),
  setPublishingTerms: (b: z.input<typeof S.publishingTermsBody>) => call<unknown>('POST', '/publishing/terms', b),
  setTrackNote: (id: string, note: string | null) => call<Track>('PATCH', `/tracks/${id}`, { note }),
  files: () => call<{ believe: SourceFile[]; b17: SourceFile[] }>('GET', '/sources/files'),
  upload: (kind: 'believe' | 'b17', file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return call<unknown>('POST', kind === 'believe' ? '/sources/believe' : '/publishing/b17', fd);
  },
  sourceLines: (q: SourceLinesQuery) => call<SourceLinesPage>('GET', `/sources/lines${qs(q)}`),
  sourceFacets: (fileIds: string[]) =>
    call<SourceFacets>('GET', `/sources/lines/facets${qs({ fileId: fileIds.join(',') })}`),
  reconciliation: (q: z.input<typeof S.periodQuery>) =>
    call<ReconciliationRow[]>('GET', `/reconciliation${qs(q)}`),
  signals: () => call<Signals>('GET', '/signals?limit=20'),
  operations: (ownerId?: string) => call<Operation[]>('GET', `/settlements/operations${qs({ ownerId })}`),
  createOperation: (b: z.input<typeof S.createOperationBody>) =>
    call<Operation>('POST', '/settlements/operations', b),
  proof: (id: string, fileRef: string) =>
    call<Operation>('POST', `/settlements/operations/${id}/proof`, { fileRef }),
};
