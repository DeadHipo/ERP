# facade: notes for agents

- The only place that composes modules (D-009, D-060). Modules never import it; routes call only `Facade` methods.
- `index.ts` opens the 4 SQLite modules (the sources service is passed in by the caller, `src/connect-sources.ts`)
  and spreads the method groups: `splits.ts`, `sources.ts` (B17 upload, writers, terms), `reports.ts`
  (reconciliation, owner balance, signals, track explanation), `owner-view.ts` (owner detail, merges),
  `payouts.ts` (operations, payout button, payment proof, returns). Shared checks live in `context.ts`.
- `calculation.ts` is the domain core: `calculate()` reads `sources.snapshot()` first (async), then every SQLite
  module in one synchronous stretch, so one request sees one version of the data (D-012, D-110). Keep new reads
  inside that stretch; do not add an `await` between the SQLite reads.
- Nothing is stored or cached: every method recalculates from scratch. Do not add accrual tables or caches
  without an owner decision (README §2: caches out of scope; 09 principle 7).
- Category C reasons (`CReason` in `calculation.ts`) reach the API as free keys of `C_breakdown` /
  `waitingBreakdown` (`z.record(z.string(), money)`), so a new reason passes the schemas silently: check the pages
  that show them (`SourcesPage.tsx`, `OwnerBalancePage.tsx`) and the A = B + C + ours identity in `reconcile()`.
- `calculate()`, `ownerBalance`, `reconciliation`, `signals`, `explainTrack`, `createPayout` are async; the rest is sync.
- Payouts: `createPayout` is the only way to pay earned money (D-051). It records the payout (deferred, with the
  snapshot of the very calculation it used, D-053) before calling `payment-service.ts` (a stub, D-013).
- Recoupment itself is in `modules/settlements/recoup.ts`; `balance.ts` feeds it income items and positions.
