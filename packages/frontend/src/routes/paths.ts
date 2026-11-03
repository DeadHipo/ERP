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
  participations: 'participations',
  labels: 'labels',
  label: 'labels/:id',
  publishing: 'publishing',
  documents: 'documents',
  document: 'documents/:id',
  sources: 'sources',
  sourceLines: 'sources/lines',
  operations: 'operations',
  ads: 'ads',
  devStates: 'dev/states',
} as const;

/** Every route as an absolute pattern; the overview is the index route `/`. */
export const ROUTES: readonly string[] = ['/', ...Object.values(ROUTE_PATHS).map((p) => `/${p}`)];
