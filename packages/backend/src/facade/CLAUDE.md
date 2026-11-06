# facade: notes for agents

- The only place that composes modules (D-009, D-060). Modules never import it; routes call only `Facade` methods.
- `index.ts` opens the 5 PostgreSQL modules (owners, labels, splits, settlements, publishing) on `config.db` (`src/shared/pg-db.ts`; the sources service is passed in
  by the caller, `src/connect-sources.ts`)
  and spreads the method groups: `splits.ts`, `sources.ts` (B17 upload, writers, terms), `reports.ts`
  (reconciliation, owner balance, signals, track explanation), `owner-view.ts` (owner detail, merges),
  `payouts.ts` (operations, payout button, payment proof, returns), `artist-view.ts` (the card and the money of one
  pseudonym, D-165). Shared checks live in `context.ts`. `track-artists.ts` (D-166) is the pure helper the catalog
  methods of `aggregates.ts` use to name the registry pseudonyms of an ISRC (split rows, participations, registry
  links, merged ids resolved); the artist string of a report pair is never matched against the registry.
- `calculation.ts` is the domain core: `calculate()` reads `sources.snapshot()` first, then every module inside one
  `db.snapshot()` (read-only REPEATABLE READ), so one request sees one version of the data (D-012, D-121). Keep new
  reads inside that snapshot. It builds the pure `LayerContext` and runs `allocateUnit` per unit; `reconcile()` is
  per source, account and month, `ourShare` = Σ label share of the units where it is ours (D-127).
- `layers/` holds the master money as pure functions (no storage, own tests in `tests/layers/`). The order is the list
  `MASTER_LAYERS` in `layers/index.ts`: label of record → perimeter → off the top → split → carves (pool, artist share,
  label share, sublabel, in `carve.ts`) → categorise (10 §3). Exactness: quantise every amount to 12 decimals right
  after its multiplication (`layers/exact.ts`: `q`, `pct`), get every remainder by subtraction, distribute pro rata /
  scale-downs with `distribute` (residue to the largest absolute amount, a tie: first by id). When percents sum to
  exactly 100 the rounded amounts may exceed their base by a few pico: `capToBase` / `distributeCapped` take the excess
  off the largest, so no remainder or allocation has the opposite sign of the unit (D-130). The publishing layers
  follow the same 12 decimals (equal writer parts cut at 12, author `q(part × percent / 100)`). Σ allocations + label
  share = net after every layer; `tests/layers/exactness.test.ts` and the golden cases (`tests/golden.test.ts`) check it.
- A method that writes to two modules wraps them in `db.transaction()` (all or nothing, D-121); a method that reads
  two modules for one answer uses `db.snapshot()`. A write cannot start inside a snapshot (it throws).
- Nothing is stored or cached: every method recalculates from scratch. Do not add accrual tables or caches
  without an owner decision (README §2: caches out of scope; 09 principle 7).
- **Unit scope** (`scope.ts`, D-161, D-162): `calculate()` is never changed for speed; a method whose answer depends on a
  subset of the Believe units passes `scoped(modules, { isrcs | upcs | accounts | labelIds | from/to/basis, publishingLines })` so
  that `sources.snapshot()` reads only that subset; with `isrcs` the split index and the known pairs are read for those
  ISRCs only, and `publishingLines: false` skips the B17 lines for the master-only answers (the allocation of a unit
  depends on the unit and the reference data of its ISRC alone, so the answer is byte for byte the full one). Used by
  track money / explain (one ISRC), release (one UPC), every read under a label (`labelIds`: the loaded files of
  the label, D-169; the test's `withFullReads` ignores it), track summary (account, month, or the ISRC list of the visible
  rows of P5), the C queue (period), the ads list / card / summary (the ISRCs of the records). The list reads beside
  the calculation take the same filters (`owners.listTracks({ isrcs })`, `splits.listSplits({ isrcs })`,
  `sources.pairAttributes({ isrcs | upcs })`). Never for balances, payables, the overview, the reconciliation, the
  signals or the document uses (counts over everything, D-012). One path, no mode: `tests/scope.test.ts` asserts
  scoped = full for every scoped method by patching the test's own reads to ignore the filters (D-164).
- **Owner reach** (`owner-scope.ts`, D-163, D-164): `ownerReach` / `ownersReach` give the ISRCs that can carry an
  owner's money (splits and participations of its pseudonyms, label strings of sublabels whose rule names them, its
  ads); a calculation over them gives the same `ownerBalance()`, since the balance reads only the units where the owner
  has an allocation. The balance route, the payout snapshot (`balanceWithFiles`) and `ownerPayables({ ids })` use it.
  `artistReach` is the same for one pseudonym, by every id it had: `artistBalance()` (`balance.ts`) takes the artist row
  of `ownerBalance()` from a calculation over that reach (`artistBalanceWithReach` in `context.ts`), which is the row of
  the full calculation because the row reads only the units where the pseudonym has an allocation and recoups its
  positions from its own master income (the owner's publishing is read whole); `tests/scope.test.ts` pins it (D-165).
  `artistsReach` is the union over a list of pseudonyms (D-167): `artistBalances({ ids })` (`artist-view.ts`, the
  visible rows of P11) runs one calculation over it and takes the `artistBalance()` row of each with the prebuilt
  `artistUnitIndex` / `ownerIndex`; `artistList()` is the row per pseudonym without money (owner, merged ids, tracks,
  open rows, contracts, rows without a document), one snapshot, no calculation.
  **A new way for money to reach a pseudonym** (a new layer, a new rule kind, a new kind of record) must extend
  `ownerReach`, and `tests/scope.test.ts` must pin balance-by-reach = full for it; `scripts/check-owner-scope.ts`
  proves it on the real data.
- **The label as a book** (`label-scope.ts`, `balance.ts`, D-168, D-169): the book of a Believe unit is the own label its
  **file** was loaded under (`source_files.label_id`, R6; `UnitResult.bookLabelId / bookLabelName`, set in `calculate()`
  after `allocateUnit`, `LayerContext` untouched); the label string still decides the label of record, the sublabel rule
  and «ours / `label_unmapped`» (`layers/label-of-record.ts`, `ourShareByLabel`, the signal `labelOutsideAccount`). A
  file without a label is the book `'?'`. Publishing sits in the book of its statement (`PublishingResult.labelId`, R8),
  an advertising charge in the book of its payer (`ad.labelId`, R9), an operation in its own label (D-168). The book of
  an own label is `labelBook()` = `LabelBook { id, name, fileIds }` (its loaded files); a read under a label is
  `scoped(modules, { labelIds: [L] })` over the unit scope, the reference lists restricted to `sources.isrcsOfFiles(fileIds)`,
  and the B17 results filtered after the calculation by `underLabel(calc, L)`; `labelVisibility()` adds the pseudonyms
  with a row or participation on those ISRCs, sublabel-rule recipients of L, operations and ads paid by L (and the split
  rows of their ISRCs), the owners of L's publishing lines. The facade methods take the label as the last argument
  (`ctx.labelContext` / `ctx.viewOf`); the routes pass `?label=`. `ownerBalance()` partitions **every** field by book
  (the label id, `''` = without a label, named `'?'` in the answer): earned / waiting by the unit's book and the
  statement's label, recouped by the book of the income consumed, adsCharged by the payer, paid / returns / credits by the
  operation. The master income item carries its book in its id (`m|artist|isrc|month|<book>`), so one ISRC-month from
  two accounts is two items; a position under a label is recouped from that book's master income only
  (`layers/recoup.ts`), one without a label from any income (publishing stays eligible by scope: Open В1 of D-169).
  The recoup always runs over everything; a view (`BalanceView`) is the same computation projected to one book, so
  Σ books = total field by field (`Case.verify()`, `tests/scope.test.ts`, `scripts/check-label-books.ts`).
  `createPayout(owner, { labelId })` pays the book: master **and** publishing of L, its snapshot takes the statements and
  Believe files of L. Gate (`payout-gate.ts`): `owner_not_confirmed` (no approved contract at all, `confirmedAny`,
  internal) → `no_contract_for_label` (none whose document is of L or without a label: `calc.confirmedOwnersUnder(L)`)
  → the other checks; an advance under L in `createOperation` asks the same. `createOperation` requires `labelId`
  (except a migrated one); `setOperationLabel` marks the history (no gate, Open В9). Uploads: `assertUploadLabel` runs
  before the body is received, `ingestBelieve` checks the account (`account_unregistered`, `account_of_other_label`)
  before the module's serial load; `removeLabelAccount` only while the account has no file.
- Category C reasons are one shared enum (`C_REASONS` / `CReason` in `packages/shared/src/api-responses.ts`), used by
  `C_breakdown` and `waitingBreakdown`; a new reason goes there first, then check the pages that show them
  (`SourcesPage.tsx`, `OwnerBalancePage.tsx`) and the A = B + C + ours identity in `reconcile()`.
- Every method is async (the modules are PostgreSQL, D-121); await everything.
- Payouts: `createPayout` is the only way to pay earned money (D-051). It records the payout (deferred, with the
  snapshot of the very calculation it used, D-053) before calling `payment-service.ts` (a stub, D-013).
- Recoupment itself is in `layers/recoup.ts` (moved from the settlements module, D-127; the shapes `Scope`, `IncomeItem`,
  `Position` stay in `modules/settlements`); `balance.ts` feeds it income items and positions.
  **The forgiveness (D-173) is the one change of a layer this stage allows:** `Position.forgiven` (the counted
  forgivenesses of an advance by month, ascending; one month in (date, id) order) caps the capacity of the position
  from the month of each date: `effective = min(forgiven, max(0, amount − recouped_before_date − forgiven_so_far))`,
  `left = min(left, max(0, amount − consumed − forgivenEff))`; leftover forgivenesses after the income loop by the same
  rule; `RecoupResult.forgiven` is the effective sum, `amount = recouped + forgiven + remaining`. The D-094 netting
  runs only when a trial pass (on a copy of the capacities) shows the position takes something, so D-101 holds with
  forgiveness. No new multiplication, order and `eligible` unchanged; without forgivenesses byte for byte the old
  result. Income before the date arriving later shrinks the effective forgiveness (signal `forgivenessReduced`).
  (as landed: `settle()` per position, the forgivenesses applied in month order, the trial copy kept only when the position takes something; reviewed)
- `audit.ts`: `recordAction(input)`, `auditOf(entityId, limit, labelId?)`, `recentActions(limit, labelId?)` over the `audit` module (D-140; the label of a write, D-169, is chosen by the hook: `labelOfWrite`). The API hook `api/audit.ts` calls `recordAction` after every successful write (needs `X-Operator`); a facade method never records by itself.
- **The organization** (D-170): a facade is opened per organization. `openFacade({ db, orgId, sources, dataDir, … })`
  calls `openModules(db, orgScope(orgId), { publishingDir })` (`modules.ts`: the seven PostgreSQL modules, every
  repository statement filtered by `shared/org-scope.ts`) and asserts `sources.orgId === orgId` (the caller opens the
  sources with `sourcesFor(stores, orgId, dataDir)`); B17 files go to `<dataDir>/orgs/<orgId>/files/publishing`.
  `src/orgs/facades.ts` sits above it: one facade and router per organization, opened lazily (single-flight, the
  `orgs.organizations` row checked first). The facade never imports `src/orgs` / `src/auth` and never reads an
  organization from a request; `calculation.ts`, `layers/*`, `balance.ts`, `owner-scope.ts` did not change (the filter
  sits in the repositories, so `calculate()` sees only the organization's rows).
- **The viewer** (`viewer.ts`, D-171): the data-dependent right lives here through the facade's own type
  `Viewer = { kind: 'all' } | { kind: 'labels', labelIds }` (never `Principal`; the facade never imports `src/auth` /
  `src/api` / `src/orgs` and never names a role: `tests/boundaries.test.ts`). Every record-dependent method takes a
  trailing `viewer = ALL_VIEWER`: scripts, tests and `AUTH_MODE=off` call without it and get the answers byte for byte;
  the routes pass `viewerOf(res)` (`src/api/viewer.ts`; `labelsViewer(ids)` for a label manager). Rules: a read of
  another label's record answers as an unknown id (404: owner / pseudonym card and balance with the documents and
  contracts of other labels hidden, an ad by its payer, document uses); a write on another label's record or ISRC is
  `403 label_forbidden` (`assertViewerLabel` for a record that may be «any label» = `null`, a document;
  `assertViewerHolds` for a record in a book, an operation or an ad, where `null` is the administrator's). **The ISRC
  rule**: a manager may touch an ISRC in the loaded files of its labels or in no loaded file at all (a new track); an
  ISRC only in other files (a file without a label included) is another book (splits, participations, change, buyout,
  confirm, close, `updateTrack` old and new ISRC). **The document rule**: a cited document of the viewer's label or of
  none. The lists `listSplits`, `listParticipations`, `search` (filtered after its per-kind limit), `artistDuplicates`
  keep only what is visible under the union of `labelVisibility()` of the viewer's labels; an owner visible under no own
  label is reachable as a new one (`ownerReachable`). `viewerScope(modules, viewer)` reads each set lazily once per
  call and nothing for `ALL_VIEWER`. The routes no longer call modules directly for these writes: `attachDocumentFile`,
  `approveDocument`, `createContract`, `updateTrack`, `setOperationDeferred`, `deactivateOperation`,
  `operationSnapshot`. The operation's own right (class, the label of the request) is decided before the route by
  `authorize`; a new record-dependent method takes a viewer and gets a case in `tests/viewer.test.ts`.
- **The split import** (`split-import.ts`, D-172): `importSplits({ path, fileName, labelId, dryRun }, viewer)` reads a csv /
  xlsx (`src/shared/csv.ts`, `src/shared/xlsx-rows.ts`; columns `SPLIT_IMPORT_COLUMNS`, ≤ 5 000 rows), groups rows by
  (ISRC, floored `from`) and classifies the groups in file order over a model of the ISRC's splits that each earlier
  group updates (`create` / `change` / `unchanged` / `blocked`, row classes `SPLIT_IMPORT_ISSUES` of
  `packages/shared/src/split-import.ts`). The preview runs in one `db.snapshot()` (no write lock, nothing written, no
  audit row); the apply repeats the classification inside ONE `db.transaction()` and writes through `owners.createOwner`
  / `createArtist` / `assignArtistOwner` and `createSplit` / `changeSplit` (all or nothing: `422 import_invalid` with
  `details.rows`, or `details.group` + `details.cause` for a refusal while writing). The pseudonym index is read once per
  transaction: `createSplit` / `changeSplit` / `resolveShares` take an optional `opts: SplitWriteOpts = { index }`
  (`context.ts` `artistIndexCache`, `cacheArtist`); routes never pass it. A viewer of some labels may only create (a
  change or an owner assignment = a `forbidden` row). `assumeSplits` (`splits.ts`) = one `assumption` document under the
  label + `splits.confirmSplit` per split without a document (`nothing_to_assume` when none).
- **The catalog** (`catalog.ts`, `release-registry.ts`, D-172): navigation, not money. `deriveIsrc` (pure) builds the
  label history of an ISRC from its observations (ISRC, reporting month, label of the loaded file; `sources.isrcFilePairs`):
  runs by month (a new label opens a run, a label seen again is a tail while the current one is observed, else a
  return), the boundary `min(max(last_A + 1, start_B), first_B)`, ties by `loaded_at` then label id, the `operator`
  months cut out. `deriveTrackLabels({ apply, isrcs })` rewrites the `files` rows; `setTrackLabel` writes an operator
  interval (same `from` = replace; `catalog_overlap`, `catalog_same_label`) and rebuilds that ISRC's `files` rows in the
  same transaction. `catalogSignals` gives `catalogOutsideAccount` / `tracksWithoutLabel`, the registry its
  `releasesIncomplete` / `releasesUnknown`; `trackCatalog` adds the catalog label (`catalog=current`). **Never** read the
  history or the registry from `calculation.ts`, `layers/*`, `scope.ts`, `owner-scope.ts`, `balance.ts`,
  `label-scope.ts` (`boundaries.test.ts`); `tests/catalog.test.ts` pins the money byte for byte.
- **The onboarding checklists** (`onboarding.ts`, D-172): `labelChecklist(labelId, viewer)` reads PostgreSQL in one
  `db.snapshot()` and at most three ClickHouse queries (`isrcFilePairs`, `labelStringsOfFiles`, `isrcsOfUpcs`) and never
  calculates (the file must not import `./calculation`: `boundaries.test.ts`); the backend decides each step's state.
  `organizationChecklist({ members, admins })` gets the member counts from its route (`api/routes/onboarding-org.ts` in
  the org-admin router): the facade never imports `src/auth`.
- **The payroll stage (D-173).** Operations carry a stored `kind` (`modules/settlements/CLAUDE.md`); `balance.ts`
  branches on `o.kind`. Book fields (`LabelBook`, `total`, `byLabel`, artist rows): `buyouts` (outside `paid` and
  `payable`), `forgiven` (lowers `unrecouped` only), `writtenOff` (minus), `adjustments` (= −Σ amount, plus);
  `payable_L = earned − recouped − paid − adsCharged + returns + credits + adjustments − writtenOff`; `byArea { master,
  publishing }` per book (earned / recouped by income stream, ads master, operations by `operations.area`), Σ areas =
  the book. `payoutGate` gets `floor(min(payable_{L,area}, payable_L))` for `area ≠ all`; reads without `area` are
  `all`; `createPayout({ labelId, area = 'master' })` stores the area in the snapshot (the new snapshot fields are
  optional in `payoutSnapshotSchema`, old snapshots still parse). `createOperation` checks the kinds in a fixed order
  (`label_required` → `kind_*` → `use_*_button/action` → `*_required` → `scope_*` / `writeoff_area` → document →
  gate → `writeoff_exceeds`); `forgiveAdvance` (`payouts.ts`) takes `remaining` from `balanceWithFiles(owner)`
  (`forgiveness_exceeds`, `forgiveness_before_advance`, `operation_ref_not_advance`).
  **`asOf`** (`YYYY-MM`) is a cut of the inputs of `ownerBalance` made from one full calculation (units by reporting
  month, publishing lines by report month through a filtered `ownerIndex`, operations / positions / forgivenesses by
  date, ads through `index.ads`), `PeriodFilter.to = min(to, asOf)`, `reconcile(calc, { to: asOf })`; `calculate()`
  never sees it; document statuses are those of now.
  **`payroll.ts`** (`GET /owners/payroll`): one `calcWithOps()`, the cut, the view `{ labelId }`; sheets `payroll`
  (pseudonym rows with `recoupedFromMaster`, the owner row with `publishingRecouped`, the `total` row with the gate and
  `belowThreshold`; the contract column and `byDecision` for `label_decision`), `waiting`, `buyouts`, `control`; json
  and csv from the same rows. **`operation-import.ts`** (`importOperations`): the csv (`OPERATION_IMPORT_COLUMNS`),
  the preview in a `db.snapshot()`, the apply in one `db.transaction()` through `createOperation` row by row (all or
  nothing, `422 import_invalid { line, cause }`), every row `migration: true` with `label_source = 'operator'`;
  `external_id` required for payout / buyout, a matching content key = `unchanged`. The B17 replacement is
  `sources.ts` `replaceStatement` over the publishing module.
