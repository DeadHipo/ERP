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
  subset of the Believe units passes `scoped(modules, { isrcs | upcs | accounts | from/to/basis, publishingLines })` so
  that `sources.snapshot()` reads only that subset; with `isrcs` the split index and the known pairs are read for those
  ISRCs only, and `publishingLines: false` skips the B17 lines for the master-only answers (the allocation of a unit
  depends on the unit and the reference data of its ISRC alone, so the answer is byte for byte the full one). Used by
  track money / explain (one ISRC), release (one UPC), track summary (account, month, or the ISRC list of the visible
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
- **The label as a book** (`label-scope.ts`, `balance.ts`, D-168): an own label is seen in the data only as the label
  string of a unit, so the book of a label is `labelBook()` (its id, name and the raw label strings of its aliases and
  its sublabels' aliases) and a read under a label is `scoped(modules, { labelStrings, publishingLines: false })` over
  the unit scope plus `labelVisibility()` (the ISRCs of the strings, the pseudonyms with a row, participation, rule,
  operation or ad under the label, their owners). The facade methods take the label as the last argument (`ctx.labelContext`
  / `ctx.viewOf`); the routes pass `?label=`. `ownerBalance()` partitions **every** field by label key (the label id,
  `''` = without a label; named `'?'` in the answer): earned / waiting by the unit's label of record, recouped by the
  label of the income consumed, adsCharged by the charge, paid / returns / credits by the operation; a position under
  a label is recouped from that label's master income only (`layers/recoup.ts`), one without a label from any income.
  The recoup always runs over everything; a view under a label (`BalanceView`) is the same computation projected to one
  book, never a separate calculation, so Σ books (without a label included) = total field by field. `Case.verify()`,
  `tests/scope.test.ts` and `scripts/check-label-books.ts` pin it. Publishing has no label: its money sits in the
  «without a label» book and is not paid by a label payout. `createPayout(owner, { labelId })` pays the book;
  `createOperation` requires `labelId` (except a migrated one); `setOperationLabel` marks the history.
- Category C reasons are one shared enum (`C_REASONS` / `CReason` in `packages/shared/src/api-responses.ts`), used by
  `C_breakdown` and `waitingBreakdown`; a new reason goes there first, then check the pages that show them
  (`SourcesPage.tsx`, `OwnerBalancePage.tsx`) and the A = B + C + ours identity in `reconcile()`.
- Every method is async (the modules are PostgreSQL, D-121); await everything.
- Payouts: `createPayout` is the only way to pay earned money (D-051). It records the payout (deferred, with the
  snapshot of the very calculation it used, D-053) before calling `payment-service.ts` (a stub, D-013).
- Recoupment itself is in `layers/recoup.ts` (moved from the settlements module, D-127; the shapes `Scope`, `IncomeItem`,
  `Position` stay in `modules/settlements`); `balance.ts` feeds it income items and positions.
- `audit.ts`: `recordAction(input)`, `auditOf(entityId, limit)`, `recentActions(limit)` over the `audit` module (D-140). The API hook `api/audit.ts` calls `recordAction` after every successful write (needs `X-Operator`); a facade method never records by itself.
