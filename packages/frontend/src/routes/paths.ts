/**
 * The one list of route patterns (relative to the shell, as `<Route path>` wants them). The route files build their
 * `<Route>` elements from it, so the list cannot drift from the router; `src/api/coverage.ts` and the guard tests read it too.
 * Parameters are only keys and enum values (R3, `tests/routes-no-names.test.ts`).
 */
export const ROUTE_PATHS = {
  queue: 'queue',
  queueReason: 'queue/:reason',
  signals: 'signals',
  signalsName: 'signals/:name',
  questions: 'questions',
  tracks: 'tracks',
  track: 'tracks/:isrc',
  releases: 'releases',
  release: 'releases/:upc',
  artists: 'artists',
  artistDuplicates: 'artists/duplicates',
  artist: 'artists/:id',
  owners: 'owners',
  owner: 'owners/:id',
  splits: 'splits',
  /** P28 (D-172): entered from P15 only, no sidebar item (О11). */
  splitImport: 'splits/import',
  participations: 'participations',
  labels: 'labels',
  label: 'labels/:id',
  publishing: 'publishing',
  /** P32 (D-182): the songwriters and files of the report summaries, no owner link. */
  publishingV2: 'publishing-v2',
  /** P33 (D-182): one songwriter. */
  publishingV2Songwriter: 'publishing-v2/:id',
  documents: 'documents',
  document: 'documents/:id',
  sources: 'sources',
  sourceLines: 'sources/lines',
  operations: 'operations',
  /** P29 (D-173): entered from P20 only, no sidebar item (as P28). */
  operationImport: 'operations/import',
  /** P34, P35 (D-198): the cuts of a book, one cut with its positions. */
  cuts: 'operations/cuts',
  cut: 'operations/cuts/:id',
  ads: 'ads',
  ad: 'ads/:id',
  devStates: 'dev/states',
  /** P23, outside the shell (D-170). */
  login: 'login',
  /** P24, P25: the system administrator's pages (D-170). */
  systemOrgs: 'system/orgs',
  systemOrg: 'system/orgs/:id',
  /** P27: every user, for the system administrator (D-171). */
  systemUsers: 'system/users',
  /** P26: the users and the support grants of the organization, for its administrator (D-171). */
  users: 'users',
  /** P31: how to connect Claude over MCP (D-179); reads nothing of the API. */
  claude: 'claude',
} as const;

/** Every route as an absolute pattern; the overview is the index route `/`. */
export const ROUTES: readonly string[] = ['/', ...Object.values(ROUTE_PATHS).map((p) => `/${p}`)];
