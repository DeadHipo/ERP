# Recipes: typical changes and the tests that guard them

Written 2026-11-01 (D-120), extended 2026-11-03 for the layers, labels and participations (D-123…D-135). Paths are under `packages/backend/` unless they
start with `packages/`.

## 0. Before and after any change

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d   # PostgreSQL + ClickHouse (+ migrations)
npm run typecheck && npm run lint && REQUIRE_STACK=1 npm test          # 406 backend + 65 frontend tests on 2026-11-03
```
Without the stack the facade/sources tests are **skipped**, not failed: always use `REQUIRE_STACK=1` before saying
"tests pass". Then append a D-entry to `docs/97_принятые_решения.md` and a line to `docs/agents/03_decision_index.md`.

## 1. Guard tests you will hit (read them before you are surprised)

| Test | What it enforces | Typical way to break it |
|---|---|---|
| `tests/boundaries.test.ts` | a module imports no other module, no facade, no API; the API opens no module; each PostgreSQL module (owners, labels, splits, settlements, publishing) has its own PostgreSQL schema, no foreign key crosses schemas (D-121) | importing `../splits` inside `modules/owners`; calling `openXModule` in a route |
| `tests/rules-coverage.test.ts` | one test per README §5 rule; **every `Number(` in `src` must be in an allow-list** | `Number(amount)` anywhere, even for a non-money value: add it to the allow-list only if it is really not money |
| `tests/api-contract.test.ts` | every Express route is in `src/api/operations.ts`, every response fits its schema, **the scenario calls every operation** | adding a route without an `API_OPERATIONS` entry, or without calling it in the scenario |
| `tests/api-reasons.test.ts` | every `C_REASONS` value has a label in `packages/shared/src/reasons.ts` (`REASON_LABELS`, typed by the enum) and no label is left over; breakdowns accept only enum reasons | adding a reason to the enum without a label, or a label for a reason not in the enum |
| `tests/layers/exactness.test.ts` | Σ allocations + label share = net exactly after every layer (seeded random, 6-decimal percents, 12-decimal nets, any decimal.js precision) | multiplying twice for a remainder instead of subtracting; rounding without `q`/`distribute` |
| `tests/golden.test.ts` | the hand-computed scenarios of `12_golden_cases.md` end to end, plus the identity checks every master case runs (A = B + C + ours, discrepancy 0, explain sums to the unit) | changing a layer without redoing the hand computation; "fixing" an expected number |
| `tests/layers/*.test.ts` | each layer as a pure function over a hand-built world (`tests/layers/world.ts`); `index.test.ts` pins the order and a deliberately broken layer showing as a discrepancy | reordering `MASTER_LAYERS`; a layer that reads storage |
| `tests/review-*.test.ts` | regressions found by independent reviews (D-069…D-101) | "simplifying" a rule that a reviewer once found broken: read the D-entry named in the test |

## 2. Add or change an API endpoint

1. Request schema (zod) in `packages/shared/src/api-schemas.ts`; response schema in `packages/shared/src/api-responses.ts`.
2. Facade method in the right topic file of `src/facade/` (`splits.ts`, `sources.ts`, `reports.ts`, `owner-view.ts`,
   `payouts.ts`). If it needs one module only, it still goes through the facade (D-060).
3. Route in `src/api/routes/<topic>.ts`: `parse(S.schema, req.body)` → `facade.method(...)`. Errors: throw
   `ValidationError` (400), `NotFoundError` (404), `ConflictError` (409), `RuleViolationError(message, code)` (422)
   from `src/shared/errors.ts`; `api/http.ts` turns them into `{ error: { code, message, statusCode, details } }`.
4. Entry in `src/api/operations.ts` (method, Express-style path, tag, summary, body/query, status, response, errors).
5. Call it in the scenario of `tests/api-contract.test.ts`, plus a behaviour test where the rule lives.
6. Client: a function in `packages/frontend/src/api/<domain>.ts` (or `client.ts`) parsed with the shared schema; the operation must appear in `packages/frontend/src/api/coverage.ts` (page + route, or a refusal with the reason), or `tests/coverage.test.ts` fails.

## 2a. Add a layer or a C reason

- **A layer:** a pure function `(state, ctx) => state` in `src/facade/layers/<name>.ts` (no storage; inputs come in
  `LayerContext`, built in `facade/calculation.ts`). Register it in the list `MASTER_LAYERS` (or `PUBLISHING_LAYERS`)
  in `src/facade/layers/index.ts`: that list is the only place the order is written. Money: follow the exactness
  rule (recipe 7a). Tests: a file `tests/layers/<name>.test.ts` on `tests/layers/world.ts`, a golden case in
  `12_golden_cases.md` + `tests/golden.test.ts` when the behaviour is new, and check `explainTrack` still sums to the unit.
- **A C reason:** add it to `C_REASONS` in `packages/shared/src/api-responses.ts` first, then its label in
  `packages/shared/src/reasons.ts` (it does not compile without one; `tests/api-reasons.test.ts` guards it), set it in
  `layers/categorise.ts` (first reason wins: put it at the right place of the order), check `reconcile()` still has
  discrepancy 0, and look at the pages that show reasons (`SourcesPage.tsx`, `OwnerBalancePage.tsx`; they use
  `reasonLabel` from `components/ui.tsx`). Add a D-entry and an index line.

## 2b. Enter a sublabel or an imprint alias

Labels API (`/api/v1/labels`, page `/labels`): `POST /labels` (`kind: own | sublabel`; a sublabel names the `own`
label its money belongs to), `POST /labels/:id/aliases` (the string Believe prints; unique after normalisation),
`POST /labels/:id/rules` (percent of the label share, recipient pseudonym, `validFrom`, optional `validTo`, a document;
the half rule is 50), `POST /labels/rules/:id/close`. Dates are floored to the month start. A new string not in any
alias shows in the signals (`labelUnmapped`) and its "ours" waits in C `label_unmapped` until it is mapped. The
recipient needs an owner with a pseudonym (`labelOwner` in the tests); a rule under an `assumption` document pays into C.

## 2c. Enter a participation

`POST /participations` (page `/participations`; `GET ?isrc=`; `POST /participations/:id/close`). Fields: ISRC, recipient
pseudonym, `percent`, `base` (`net` | `bucket`), `funded_from` (`top` | `artist_pool` | `artist_share` with
`fromArtistId` | `label_share`), `validFrom` / `validTo` (month start), a document. Used kinds: remixer = (`net`, `top`);
licensed MC from the pool = (`net`, `artist_pool`); settlement 15 % of net = (`net`, `label_share`); A&R 15 % of the
label's share = (`bucket`, `label_share`); beat 10 % of an artist's share = (`bucket`, `artist_share`). Rules checked at
entry: Σ off-the-top ≤ 100 (`top_above_100`), no overlap per (ISRC, pseudonym, funded_from, source artist), and the
**row-or-participation rule**: a pseudonym is a split row or a participation on an ISRC and date, never both (re-enter
the row as a participation, as the stage 4 rewrites did). A row that needs its own document (a disputed row) takes
`documentId` on the split row; a document of kind `assumption` sends that row to C `assumption`.

## 3. Change a module's data (owners, splits, settlements, publishing: PostgreSQL, D-121)

- The table is described **twice**: the DDL in a migration `migrations/postgres/NNNN_<name>.sql` (schema `<m>`) and
  the Drizzle table in `modules/<m>/schema.ts` (`pgSchema('<m>')`). Change both.
- A change is a **new** migration file (the next number); never edit an applied one (the runner rejects a changed
  checksum). Write it idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), apply with `npm run migrate:pg`;
  tests apply all migrations to their private database automatically.
- No foreign keys to another module's schema (`boundaries.test.ts`); ids of other modules are checked in the facade.
- Types: `date` (read as 'YYYY-MM-DD'), `timestamptz` (`isoTimestamp`, ISO text), `bigint` money (cents mode
  'number', pico as text → BigInt), `numeric` percents (canonical with `new Decimal(v).toFixed()`), JSON as text +
  `IS JSON` when the bytes matter.
- Repositories call `db.orm()` per query (never keep an executor); a check-then-write goes in `repo.transaction()`.
- If the data must also be copied from old SQLite files, keep `scripts/migrate-sqlite-to-pg.ts` in step.
- All SQL lives in `modules/<m>/repository.ts`; `service.ts` holds rules only (D-117).
- Expose new reads/writes in `service.ts`; the facade decides how modules combine.

## 4. Change the Believe sources (PostgreSQL + ClickHouse)

- Registry SQL: `modules/sources/registry.ts`; migrations in `migrations/postgres/NNNN_*.sql`, run by the
  `postgres-migrate` compose service (`npm run migrate:pg`).
- Lines and views: `modules/sources/columnar.ts`; migrations in `migrations/clickhouse/NNNN_*.sql`
  (`npm run migrate:ch`, runner `scripts/migrate-clickhouse.ts`).
- Read `packages/backend/src/modules/sources/CLAUDE.md` first (alias trap, money as text, loaded-files-first).

## 5. Add a new income source (e.g. ASCAP, iteration 2)

Not started; this is the shape the existing code suggests, not a decision:
- If it is publishing-like (works, writers, quarterly statements), it belongs next to B17 in `modules/publishing`
  (new `<source>-format.ts`, its own statement type), so that writer resolution and terms are shared.
- The facade's `calculate()` adds its lines to the publishing layers' input (`PUBLISHING_LAYERS`); `reconcile()` gets a new `source` value;
  `PublishingResult` and `Reconciliation.source` types grow; the payout snapshot must store the new file hashes (D-100).
- Decide and log: duplicate-period rule, amount column, period → report month mapping, unknown writer handling.

## 6. Add a page

1. Folder `packages/frontend/src/pages/<domain>/` with the page component (root hook `data-testid="<name>-page"`); reuse `components/` (`QueryView`, `DataGrid`, `ActionButton`, `FormDialog`, `Money`); the frontend computes nothing (R1).
2. Route: add the pattern to `ROUTE_PATHS` in `src/routes/paths.ts` (params only `isrc`, `upc`, `id`, `reason`, `name`) and a `<Route path={ROUTE_PATHS.x}>` in the route file of its section; a sidebar item in `src/nav.ts` if it has one.
3. Data: queries in `src/api/queries/<domain>.ts` over a client function parsed with a shared schema (no hand-written types in `src/api/`); money queries use the money keys and `staleTime: 0`.
4. Strings in `src/i18n/ru/<domain>.ts` (register a new file in `i18n/ru.ts`); code and comments in English.
5. `src/api/coverage.ts`: an entry for every operation the page calls (page id and route). New C reason or signal: its row in `pages/work/actions/action-table.ts`.
6. Spec in `packages/frontend/e2e/golden/` on the seeded stores (select by `data-testid` and roles, no `waitForTimeout`); a row in `19_golden_screens.md` if it shows numbers.
7. One sentence in `packages/frontend/CLAUDE.md` (the page's operator question and its hooks).
8. Check: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:client`, `npm run e2e`.

## 7. Change a money rule

1. Find the rule in README §5 and the module doc; find the D-entry in `03_decision_index.md`; check it is not
   ⚠ waiting for the owner.
2. Change it in one place: master allocation in the matching layer of `facade/layers/` (order in `layers/index.ts`; publishing: `writer-parts.ts`, `author-share.ts`), balance/payable in `facade/balance.ts`,
   recoupment in `facade/layers/recoup.ts`, payout gate in `facade/payouts.ts`.
3. Run `scripts/reconcile-erp.ts data/real` if you have the data archive: every new difference against the old ERP
   must be explained in the D-entry.

## 7a. The exactness rule when touching money code

In `facade/layers/`: quantise every allocation right after its multiplication (`q`, `pct` from `exact.ts`, 12 decimals,
half-up); get every remainder (`scaledNet`, label share, what is left of a bucket) by subtraction, never by a second
multiplication; distribute pro rata or scale down with `distribute` / `distributeCapped` (residue to the row with the
largest absolute amount); at exactly 100 % use `capToBase`. Keep the sign: a negative unit gives negative allocations.
Then run `tests/layers/exactness.test.ts` and `tests/golden.test.ts`. The publishing layers follow the same 12 decimals.

## 8. Run things on real data

- Needs the separate data archive (D-093) unpacked into the repo root, and the compose stack.
- `PORT=3001 npx tsx packages/backend/src/main.ts data/real`; Swagger UI at `http://localhost:3001/api/v1/docs`.
- `data/real` holds personal data (writer legal names). Never copy values from it into code, tests, fixtures, logs or docs.

## 9. Re-run the stage 4 loader and the stage 5 compares

All scripts are in `packages/backend/scripts/mvp/`, use the database of `<repo>/.env` (`DB_DATABASE`), and print
counts only (no names). The TypeScript loader writes through the facade, with three documented migration-only
bypasses: `normalise-dates` updates split dates by SQL (D-131), the two splits-module deletes `deleteEmptySplits` /
`deleteParticipations` (D-137), and a run-cached `owners.artistIndex` (D-131). Inputs live in git-ignored
`data/mvp-load/` and `context_data/`.
- Extraction (Python 3, standard library only, run with `python3 -I`): the JSON inputs of the loader are produced by
  `labels.py` (→ `annex/labels.json`), `splits_diff.py` (→ `annex/splits_diff.json`), `participations.py`
  (→ `annex/participations.json`), `exclusions.py` (→ `annex/exclusions.json`; with `duetti_schedule.py`),
  `echo8.py` (→ `echo8/{tracks,splits}.json`, `coverage.md`), `build_main.py` + `report_main.py`
  (→ `main/{nicknames,cash_rows,carve_pairs,sch3b_check}.json`, `README.md`, `reconciliation.md`), `annex_nls.py`
  (the Annex NLS cache of `compare-annex.ts`), `dump_sch3b.py`; helpers `common.py`, `xl.py`, `readmain.py`. They
  only read: the workbooks in `context_data/`, ClickHouse over HTTP (`common.py`), `splits.db` / `erp.db` (sqlite,
  `echo8.py`) and SELECTs on `owners.*` (`build_main.py`). Only Main has a rebuild command from the repo
  (`python3 -I packages/backend/scripts/mvp/build_main.py`, then `report_main.py`). The annex and echo8 scripts read
  dumps made in the stage 4 session scratchpad (absolute paths in `common.py`, `echo8.py`, `duetti_schedule.py`), so
  `annex/*.json` and `echo8/*.json` cannot be rebuilt from the repository alone: the loaded database (or the data
  archive) is the record.
- Loader: `npm run mvp:load -w @erp/backend -- <step> [--apply]` (or `npx tsx packages/backend/scripts/mvp/load.ts
  <step> [--apply]`). Dry run by default; steps: `labels`, `tracks`, `normalise-dates`, `splits`, `participations`,
  `exclusions`, `echo8`, `main`, `terms`, `contracts`, `pairs`, `label-fixes`, `lunar`, `b17-holders`, `carves`
  (D-135, reworked by D-137), `settlement-prestart`, `assumption-rows`, `hygiene` (D-137; `settlement-prestart` pro rata since D-138), `all`. Every step is idempotent (marker `mvp:<step>:<key>` in a
  note, or by title/alias): after `--apply` the same step in dry run must report only `already_done`. Logs:
  `data/mvp-load/log/`.
- B17: `npx tsx packages/backend/scripts/mvp/load-b17.ts <statement.xlsx> [generatedAt] --label 0to8` (the call of the
  upload route under an own label, D-169 R8; without `--label` the statement is loaded without one, a warning is
  printed and it waits for `assign-label-books --step statements`); `--reconcile` prints the b17 reconciliation rows.
- Believe reports: `npx tsx packages/backend/scripts/load-believe.ts --storage <dir> --label <own label> <files>` goes
  through the facade like the upload route (D-169 R7). **Register the accounts before the reports**
  (`POST /api/v1/labels/:id/accounts` 1052428 → 0to8, 1055956 → Echo8, or the «Счета» block of P17): a file whose
  account is not registered under the label is refused with 422 `account_unregistered` / `account_of_other_label` and
  leaves nothing behind. Without `--label` the files load without a label (the book `'?'`) until
  `assign-label-books --step files`.
- Advertising (`load.ts ads`): re-run `python3 -I packages/backend/scripts/mvp/extract-main-ads.py` first on every
  rebuild (the mapping carries pseudonym ids, which the loader generates anew). The loader creates the records with an
  ISRC without a payer (a migrated record may) and the 33 without an ISRC with the payer 0to8; then
  `scripts/assign-label-books.ts --step ads --apply` (D-169 R9).
- Compares (read-only, one `calculate()`): `compare-annex.ts` (net label share per ISRC and month vs the Annex
  workbook; `--refresh` rereads the workbook) and `compare-main.ts` (owner earned / paid / payable vs `0to8 Main.xlsx`),
  reports in `data/mvp-load/verify/`. `scripts/reconcile-erp.ts` (July 2026 vs the old ERP) still exists.
- Owner decomposition (read-only, after `compare-main.ts`): `npx tsx packages/backend/scripts/mvp/decompose-main.ts
  [--top N]` reads `data/mvp-load/verify/main_owners.csv`, the Main JSON and the database and prints, for the owners
  whose payable differs from the Main balance by more than 1.00, the explained / not explained counts at
  max(1.00, 2 %) and at 1.00 and the Σ per cause (`14` §9.3, §10). A warning names owners whose diff no longer
  matches the CSV (re-run `compare-main.ts`).
- After any load: `GET /api/v1/reconciliation` must show discrepancy 0 on every row.

## 10. Snapshot and restore the stores (PostgreSQL + ClickHouse)

Before a stage that changes the schema or re-keys the data, take a snapshot into `data/backup/<date>-<why>/` (files
under `data/` are git-ignored). Done on 2026-11-05 before the organisation / label work; that folder's `README.md` has
the exact commands and the restore recipes. The two layers:

- **Logical, hot:** `pg_dump -U erp -Fc --no-owner erp` (20 MB), `pg_dumpall --globals-only`; ClickHouse
  `ALTER TABLE believe.rows FREEZE WITH NAME '<name>'` (and `believe.schema_migrations`), tar of
  `/var/lib/clickhouse/shadow/<name>` (1.45 GB), then `rm -rf` that shadow directory (`SYSTEM UNFREEZE` is disabled in
  the image). Keep `SHOW CREATE TABLE` and `count() / sum(net_revenue) / uniqExact(file_id)` next to it. Restore:
  `pg_restore` into a new database; ClickHouse parts into `detached/` of a migrated empty table and `ATTACH PARTITION`.
- **Physical, cold:** `docker compose … stop postgres clickhouse`, tar of the named volumes `royalty-erp_pg_data` and
  `royalty-erp_ch_data` (exclude `./shadow`) with a throw-away alpine container, `start`. Two minutes of downtime, returns
  the whole stack byte for byte (test databases included). Restore: stop, empty the volume, untar, start.

Verify after any restore: the counts above, `GET /api/v1/reconciliation` discrepancy 0 on every row,
`scripts/check-owner-scope.ts` 0 differing. Mark the git point with a tag (`snapshot-<date>-<why>`).

## 11. Rebuild the reference data on a clean stack and prove the calculation unchanged

Done on 2026-11-05/06 before the «label from zero» work (`docs/идеи/лейбл_с_нуля/`); the reference answers are the
API JSON in `data/backup/2026-11-05-before-org/reference/` (git-ignored). The whole state is rebuilt from files on
disk, in this order (every step idempotent; the stack from `docker compose … up -d`, then `npm run migrate:pg`):

1. Believe: the 47 report files (34 of account 1052428 from `context_data/ERP_data/believe/raw`, 13 of 1055956 from
   `context_data/ERP_data/believe_echo8`) through `scripts/load-believe.ts --storage data/real/files/sources <files>`
   (the July 2026 Echo8 file is stored there under a name with a trailing ` 2`: copy it under its proper name first,
   the loader takes the account and month from the name). Expect 75 744 752 rows, Σ net 16 338 476,404666051188.
   Since D-169 the labels and the two accounts exist on a clean stack only after `load.ts labels` (step 3) and step 5,
   so the reports load here without `--label` (warning) and step 7 marks them by account. To load them under their
   labels instead: run step 2 and `load.ts labels --apply` and register the two accounts first, then
   `load-believe.ts --label 0to8 <the 34 files>` and `--label Echo8 <the 13 files>`.
2. The base reference data: `npx tsx packages/backend/scripts/migrate-sqlite-to-pg.ts data/pub` (the four SQLite
   files of the format before D-121; columns added by later migrations stay at their defaults).
3. Stage 4 loader, one step at a time with `--apply`: `labels tracks normalise-dates splits participations exclusions
   echo8 main terms contracts`, then the two B17 statements (`scripts/mvp/load-b17.ts
   context_data/ERP_data/publishing/raw/0to8_Q22025_Statement.xlsx` and `…/0to8_Q42024_Q12025_Publishing_Breakdown.xlsx`,
   D-134; with `--label 0to8` since D-169, or marked by step 7), then `pairs label-fixes lunar b17-holders carves settlement-prestart assumption-rows hygiene`.
4. Advertising: `python3 -I packages/backend/scripts/mvp/extract-main-ads.py` first (the mapping carries pseudonym
   ids, which the loader generates anew on every rebuild; the extractor is deterministic in money and ISRC), then
   `load.ts ads --apply` (2 686 records; the 33 without an ISRC are created with the payer label 0to8).
5. `scripts/assign-operation-labels.ts data/real --apply` (D-168) and the two accounts: `POST /labels/:id/accounts`
   1052428 → 0to8, 1055956 → Echo8 (if not registered already for step 1; an operator header is needed on every write).
6. The seven manual API writes of 2026-11-03 (operator `13`: an approved `advance_basis` document, an operation out
   40.00 with its payment proof, an approved `appendix` document confirming the split of ISRC FRX202537544): replayed
   through the API with the same bodies; they are part of the reference.
7. D-169: `npx tsx packages/backend/scripts/assign-label-books.ts data/real` (dry run), then `--apply`: steps `files`
   (34 → 0to8, 13 → Echo8; already done when the reports were loaded with `--label`), `statements` (→ 0to8), `ads`
   (2 653 → 0to8; the dry run lists the 117 disputable records, Σ 30 012,71), `operations-echo8` (exactly 7 → 0to8). A
   second dry run prints only `already_done`. `scripts/check-label-books.ts data/real`: (а) and (б) 0, (д) 0 expected once `statements` is applied.
8. `npx tsx packages/backend/scripts/compare-reference.ts data/backup/2026-11-05-before-org/reference --api
   http://localhost:3001 --strict` against `PORT=3001 npx tsx packages/backend/src/main.ts data/real`: every section
   must print `0 differing` (`--strict` compares the books too; without it the books may move as a stage decides,
   and the script prints the movement per label). `--strict` held at the D-169 commit 0 (the reference predates
   D-169); since D-169 (the 33 ISRC-less ads already carry the payer 0to8, then step 7) run without `--strict`: the invariants (totals, the 54 reconciliation rows, owners'
   `total.*`, tracks, queue, labels, signal counters) print `0 differing`, Σ Δ recouped = Σ Δ payable = 0, and the books
   move as D-169 records (the «Echo8» string of 1052428, 222 129,81, from Echo8 to 0to8; ads and B17 from `'?'` to 0to8).
   Then `scripts/check-owner-scope.ts data/real` (0 differing).

Counts after the rebuild (= the snapshot README): owners 1 151, artists 2 134, tracks 26 305, documents 1 400,
contracts 803, splits 24 107 / shares 42 070, participations 283, operations 2 663, statements 6 (lines 1 162 586),
labels 17, ads 2 686.
