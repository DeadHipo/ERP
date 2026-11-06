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
  `echo8.py`) and SELECTs on `owners.*` (`build_main.py`). The stores and the output directory come from `stores.py`:
  the environment first, then `<repo>/.env`, then the defaults — `DB_DATABASE` (`erp`), `DB_USERNAME`,
  `CLICKHOUSE_DATABASE` / `_HOST` / `_HTTP_PORT` / `_USERNAME` / `_PASSWORD`, `MVP_LOAD_DIR` (`data/mvp-load`, the
  input and output directory of every extractor; `pg.sh` likewise). Only Main has a rebuild command from the repo
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
  upload route under an own label, D-169 R8; it stores its copy of the statement under `DATA_DIR`, default `data/real`,
  in `<DATA_DIR>/orgs/<id>/files/publishing`, like the other `compare-common.ts` scripts; without `--label` the statement is loaded without one, a warning is
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
- **A new label (D-172)**: do not extend the JSON inputs above; its splits come from the template import
  (`POST /api/v1/splits/import?label=<id>`, the button on P15, columns `SPLIT_IMPORT_COLUMNS` of
  `packages/shared/src/split-import.ts`; recipe 13). The loader stays the record of the 0to8 / Echo8 history. The
  converter `npx tsx packages/backend/scripts/mvp/splits-diff-to-csv.ts [<load dir>] [--out <file.csv>]` writes the
  stage 4 split diff as such a file (the same filters and order as the `splits` step; `tests/split-import-loader.test.ts`
  proves import = step). `MVP_LOAD_DIR` (default `data/mvp-load`) is read by `scripts/mvp/lib.ts` too: with it, the
  loader's inputs, logs, `connectOrg({ dataDir })` and `steps-main.ts` (`LOAD_DIR/../..`) move to that directory.

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

**Since D-170 every step runs inside one organization.** On a clean stack create it first (recipe 12, steps 1–6);
on the live `erp` it is №1 (`00000000-0000-4000-8000-000000000001`, created by migration 0016). Put
`ERP_DEFAULT_ORG=<id>` in `.env` (every script resolves `--org <id>` → `ERP_ORG` → `ERP_DEFAULT_ORG`, else exits 1
listing the organizations), or pass `--org <id>` to each script below. The dev stand for the API steps (5, 6, 8) runs
with `AUTH_MODE=off ERP_DEFAULT_ORG=<id>` (no login, the operator from `X-Operator`, the principal `local` = an
`org_admin`); with `AUTH_MODE=on` log in as an `org_admin` of the organization (recipe 12, step 8). Since D-171 the
system key or the system administrator with `X-Org` is `403 support_required` on every organization step (support
needs a grant and can never `approve`, `pay` or `admin`), and a `label_manager` cannot do steps 5–6 (accounts, approvals). Stored copies land in `<dataDir>/orgs/<id>/files/{sources,publishing}`.

1. Believe: the 47 report files (34 of account 1052428 from `context_data/ERP_data/believe/raw`, 13 of 1055956 from
   `context_data/ERP_data/believe_echo8`) through `scripts/load-believe.ts --data data/real [--org <id>] <files>` (since D-170 `--data`; the copies go to `data/real/orgs/<id>/files/sources`)
   (the loader takes the account and month from the file name; the July 2026 Echo8 file is taken under its proper
   name `data/real/stage/2154953_1055956_2026-07-01_2026-07-01.csv`). Expect 75 744 752 rows, Σ net 16 338 476,404666051188.
   Since D-169 the labels and the two accounts exist on a clean stack only after `load.ts labels` (step 3) and step 5,
   so the reports load here without `--label` (warning) and step 7 marks them by account. To load them under their
   labels instead: run step 2 and `load.ts labels --apply` and register the two accounts first, then
   `load-believe.ts --label 0to8 <the 34 files>` and `--label Echo8 <the 13 files>`.
2. The base reference data: `npx tsx packages/backend/scripts/migrate-sqlite-to-pg.ts data/pub --org <id>` (the four
   SQLite files of the format before D-121; columns added by later migrations stay at their defaults). It must run
   **before** `load.ts labels` (step 3, or the label-first variant of step 1): that step creates 15 owners, and the
   import refuses a non-empty `owners.owners` (without `--replace`).
3. Stage 4 loader, one step at a time with `--apply`: `labels tracks normalise-dates splits participations exclusions
   echo8 main terms contracts`, then the two B17 statements (`scripts/mvp/load-b17.ts
   context_data/ERP_data/publishing/raw/0to8_Q22025_Statement.xlsx` and `…/0to8_Q42024_Q12025_Publishing_Breakdown.xlsx`,
   D-134; with `--label 0to8` since D-169, or marked by step 7), then `pairs label-fixes lunar b17-holders carves settlement-prestart assumption-rows hygiene`.
4. Advertising: `python3 -I packages/backend/scripts/mvp/extract-main-ads.py` first (the mapping carries pseudonym
   ids, which the loader generates anew on every rebuild; the extractor is deterministic in money and ISRC; it reads
   the stores named by the environment, then by `.env` — `DB_DATABASE`, `CLICKHOUSE_DATABASE`, … — and writes
   `<MVP_LOAD_DIR>/ads/main_ads_mapping.json`, recipe 9), then
   `load.ts ads --apply` (2 686 records; the 33 without an ISRC are created with the payer label 0to8).
5. `scripts/assign-operation-labels.ts data/real --apply` (D-168), then (D-173, after migration 0019) `scripts/assign-operation-labels.ts data/real --mark-source` (dry run: 1 315 `default` = D-168, the 7 Echo8 operations on their own line as `operator`; another count stops the step unless `--force`) and `--mark-source --apply` (a second dry run changes nothing; it must run after step 7 `operations-echo8`, or rerun it then), and the two accounts: `POST /labels/:id/accounts`
   1052428 → 0to8, 1055956 → Echo8 (if not registered already for step 1; an operator header is needed on every write).
6. The seven manual API writes of 2026-11-03 (operator `13`: an approved `advance_basis` document, an operation out
   40.00 with its payment proof, an approved `appendix` document confirming the split of ISRC FRX202537544): replayed
   through the API with the same bodies; they are part of the reference.
7. D-169: `npx tsx packages/backend/scripts/assign-label-books.ts data/real` (dry run), then `--apply`: steps `files`
   (34 → 0to8, 13 → Echo8; already done when the reports were loaded with `--label`), `statements` (→ 0to8), `ads`
   (2 653 → 0to8; the dry run lists the 117 disputable records, Σ 30 012,71), `operations-echo8` (exactly 7 → 0to8). A
   second dry run prints only `already_done`. `scripts/check-label-books.ts data/real`: (а) and (б) 0, (д) 0 expected once `statements` is applied.
   Then (D-172) the label history of the ISRCs: `npx tsx packages/backend/scripts/derive-track-labels.ts data/real
   --org <id>` (dry run: 2 436 ISRCs with two intervals 0to8 → Echo8, boundary 2025-08 for all, 1 tail, 18 249 with one
   interval, 23 121 rows to insert applied 2026-11-06: 23 121 rows for 20 685 ISRCs, 2 436 with two intervals, boundary 2025-08), then `--apply`; a second dry run prints 0 changed.
   It needs the files marked with their labels (files without a label are skipped and counted). Navigation only: step 8
   is unchanged by it except the counters of the new signals.
8. `npx tsx packages/backend/scripts/compare-reference.ts data/backup/2026-11-05-before-org/reference --api
   http://localhost:3001 --strict` against `AUTH_MODE=off ERP_DEFAULT_ORG=<id> PORT=3001 npx tsx packages/backend/src/main.ts data/real`: every section
   must print `0 differing` (`--strict` compares the books too; without it the books may move as a stage decides,
   and the script prints the movement per label). `--strict` held at the D-169 commit 0 (the reference predates
   D-169); since D-169 (the 33 ISRC-less ads already carry the payer 0to8, then step 7) run without `--strict`: the invariants (totals, the 54 reconciliation rows, owners'
   `total.*`, tracks, queue, labels, signal counters) print `0 differing`, Σ Δ recouped = Σ Δ payable = 0, and the books
   move as D-169 records (the «Echo8» string of 1052428, 222 129,81, from Echo8 to 0to8; ads and B17 from `'?'` to 0to8).
   Then `scripts/check-owner-scope.ts data/real --org <id>` (0 differing). Since D-173 the default mode also prints the
   section «kinds» (operations by kind: buyout, forgiveness, writeoff, adjustment 0 on the rebuilt stack; per owner
   Δpaid = 0 and Δpayable = Δadjustments − ΔwrittenOff + Δreleased by forgiveness, all 0) and the owners with
   publishing whose button amount at the default area `master` differs from `all` (`byArea.publishing.payable`).
   Before `npm run migrate:pg` applies 0019 on the live `erp`, the plan's read-only SQL check of the history against
   `operations_kind_rules` must give 0 violations.

Counts after the rebuild (= the snapshot README): owners 1 151, artists 2 134, tracks 26 305, documents 1 400,
contracts 803, splits 24 107 / shares 42 070, participations 283, operations 2 663, statements 6 (lines 1 162 586),
labels 17, ads 2 686.

## 12. A clean stack with an organization and a login

D-170. The stack starts without organizations and users; the first of each is made by the system administrator.

1. `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`, then `npm run migrate:pg` (and
   `npm run migrate:ch`). Migration 0016 creates `orgs` and `auth` but no organization on an empty base.
   The clean stack keeps the default names `erp` / `believe`: it is reached by `docker compose … down -v` (dropping the
   volumes) and `up -d` again. A private database name is for tests only: `npm run migrate:pg` and any `docker compose
   run` / `up` with another `DB_DATABASE` recreate the shared PostgreSQL container (`POSTGRES_DB` and its healthcheck
   come from `${DB_DATABASE}`) and restart it, killing every session on it. For a private pair beside the live stores
   do what `createPrivateStores` (`src/shared/private-stores.ts`) does, by hand: `CREATE DATABASE erp_<x>` in the
   running container, `psql -1 -d erp_<x> -f` per file of `migrations/postgres/` in order (plus its
   `schema_migrations` row), and `CLICKHOUSE_DATABASE=believe_<x> node --env-file=.env
   packages/backend/scripts/migrate-clickhouse.ts` (it retargets `believe` / `believe_stage` to `believe_<x>` /
   `believe_<x>_stage`); then point the scripts at the pair with `DB_DATABASE` / `CLICKHOUSE_DATABASE`.
   To prove the empty-stack path without touching the live project, `packages/backend/scripts/acceptance/clean-stack.sh
   --project <name>` runs the whole acceptance on a separate compose project with its own containers, volumes and ports.
2. `.env` (see `.env.example`): `AUTH_MODE=on`, `AUTH_SECRET=$(openssl rand -hex 32)` (≥ 32 bytes, never
   `change_me…`), `SYSTEM_ADMIN_KEY=$(openssl rand -hex 24)`; `AUTH_COOKIE_SECURE=1` only behind https.
3. The system administrator: `ERP_NEW_PASSWORD=… npx tsx packages/backend/scripts/create-user.ts admin --system`
   (or the password on stdin; never in argv; prints the id).
4. Start the server: `npm run dev` (or `PORT=3001 npx tsx packages/backend/src/main.ts data/real`).
5. The organization: `curl -X POST localhost:3000/api/v1/orgs -H 'Content-Type: application/json'
   -H "X-System-Key: $SYSTEM_ADMIN_KEY" -H 'X-Operator: admin' -d '{"name":"0to8"}'` → `201 { id, … }` (the id comes
   from the server). The system administrator's session in the browser (P24) does the same.
6. `ERP_DEFAULT_ORG=<id>` in `.env` for the scripts (or `--org <id>` / `ERP_ORG` per run).
7. Recipe 11, steps 1–8, with `--org <id>` (incl. `scripts/derive-track-labels.ts --org <id> --apply` after the
   reports are loaded under their labels, D-172; re-run it after every later batch of reports; and
   `assign-operation-labels.ts --mark-source --apply` after the operations, D-173) (the API steps under `AUTH_MODE=off ERP_DEFAULT_ORG=<id>` on the dev stand,
   or, with `AUTH_MODE=on`, under the session of the `org_admin` of step 8; not with `X-System-Key` + `X-Org`, which
   is `403 support_required` since D-171).
8. The users of the organization (D-171): the administrator `ERP_NEW_PASSWORD=… npx tsx
   packages/backend/scripts/create-user.ts <login> --org <id> --role org_admin`; a label manager
   `create-user.ts <login> --org <id> --role label_manager --label <labelId> [--label <labelId>]…` (own labels of the
   organization; the label ids from `GET /api/v1/labels`); the same command with an existing login adds a membership
   in another organization. Or through the API: `POST /api/v1/orgs/:id/users { login, password, role, labelIds }` by
   the system administrator, and (commit 4) `POST /api/v1/users` by the organization's `org_admin` (P26). Later
   `--reset-password`, `--disable`, `--enable` (all revoke the user's sessions).
9. Restart with `AUTH_MODE=on` and log in (`/login` in the client, or `POST /api/v1/auth/login { login, password }` →
   cookie `erp_session`, `__Host-erp_session` with `AUTH_COOKIE_SECURE=1`). A user with several memberships gets
   `409 org_choice_required` with `details.orgs: [{ id, name, role }]` and repeats the login with `{ …, orgId }` (the
   client shows the choice as a second step); no membership = `403 no_membership`. The organization then comes from the
   session; changing it = log out and in. The system administrator works in an organization only as support: its
   `org_admin` grants it (`POST /api/v1/support { login, expiresAt?, write? }`, ≤ 7 days, commit 4), then the system
   administrator sends `X-Org: <id>` (or `POST /api/v1/orgs/:id/support/enter`). After a deployment of 0017 everyone
   signs in again (tokens without `sid` are refused). Failed logins are limited (`AUTH_LOGIN_LIMIT` 5 per login,
   `AUTH_IP_LIMIT` 20 per IP and minute, `429` with `Retry-After`; behind a reverse proxy `TRUST_PROXY=1`); a write
   from another origin is `403 csrf` (add the public origin to `APP_ORIGIN` if the client is served from another one).

**The live `erp`** (data before D-170): `npm run migrate:pg` creates organization №1
`00000000-0000-4000-8000-000000000001` (`Организация №1`) and stamps every row; set `ERP_DEFAULT_ORG` to it; run the
server and the scripts as before (`AUTH_MODE=off` on the dev stand, or create users with `--org <№1> --role …` and
log in; migration 0017 turned every stage-2 user into an `org_admin` member of its organization);
`compare-reference` and `check-owner-scope --org <№1>` give 0 differing (recipe 11, step 8). Old `stored_path` values are
absolute: the files are not moved. The Python extractors of recipe 9 read without an organization: valid only while
the database holds one organization.

**The scripted run** (D-173): `packages/backend/scripts/acceptance/clean-stack.sh --yes --data data/real --port 3002`
does steps 1–9 with recipe 11 from `down -v` (destructive; read its `README.md`). Its order follows recipe 11:
`assign-operation-labels --apply`, the seven manual writes (step 6), then `--mark-source --apply --force`,
`assign-label-books`, `derive-track-labels`, the proofs. `--mark-source` expects `default` = 1 315 (D-168, the live
history, where the manual operation of 2026-11-03 had gone under 0to8 by default); on a clean rebuild the replayed
operation is created with `labelId` 0to8 (`operator`), so `default` is **1 314** + 1 `operator` (mixed advances 67, not
68): the script passes `--force` and asserts `default` ∈ {1 314, 1 315} itself. The replayed documents need a
`fileRef` (approve refuses `422 document_not_attached`). The July 2026 Echo8 report is taken from `<data>/stage`, else
`data/real/stage`. Run of 2026-11-06 (`data/acceptance/20261106T063708Z`, finished by hand after the 1 314 stop):
47 files, 75 744 752 rows; `assign-label-books` statements 4 → 0to8 (+2 done at load), ads 2 653 → 0to8, operations-echo8
7; `derive-track-labels` 23 121 rows for 20 685 ISRCs, 2 436 with two intervals; `compare-reference` (default mode)
`TOTAL differing: 0`; `check-owner-scope` `differing owners: 0` (1 151); `check-label-books … 200` (а) (б) (д) (ж) 0,
`differing: 0`; `/auth/me` on / operator / 0to8 / `org_admin`; the counts of recipe 11 all equal (operations 2 663,
documents 1 400, `track_labels` 23 121).

Without touching the live stores: `packages/backend/scripts/acceptance/clean-stack.sh --private <name>` runs every step on an empty private pair (`erp_<name>`, `believe_<name>`) and prints the commands that drop it. Use it while dev servers run on `erp`: `down -v` would wipe the store under them, and a new organization id breaks their `ERP_DEFAULT_ORG`. Passed end to end on 2026-11-06 (run 20261106T083510Z).

## 13. A new label from zero through the UI (D-172)

The order of the onboarding checklist (`GET /api/v1/onboarding?label=<id>`, P1 under the label): each step links to the
page that fixes it, and the backend decides `done` / `todo`. An `org_admin` session (or `AUTH_MODE=off` on the dev
stand); a `label_manager` of the label can upload files (2), correct the history and import releases (3), import
splits (4: only create — new ISRCs, new pseudonyms and owners; a change of an existing split or an owner assignment is
a `forbidden` row), create documents (6, not approve) and upload B17 (8), but not create labels or accounts (0–1),
approve, or assume (7).

0. The organization and the label: `GET /api/v1/onboarding/organization` (the administrator's checklist: labels,
   members, accounts); create the own label on P17 (`POST /labels`) and its aliases (the label strings of its reports).
1. **Accounts**: register the Believe account(s) of the label (`POST /labels/:id/accounts`, the «Счета» block of P17).
   A file whose account is not registered under the label is refused (`account_unregistered`, D-169).
2. **Files**: upload the Believe reports under the label (P19, `POST /sources/believe?label=<id>`, or
   `scripts/load-believe.ts --label <label> --org <id> <files>`). The `files` step lists per account the first and last
   month and the months without a file; `unmapped` lists label strings that are an alias of no label (add the alias on
   P17 or a sublabel rule, recipe 2b).
3. **Catalog**: `npx tsx packages/backend/scripts/derive-track-labels.ts --org <id>` (dry run), then `--apply`; a wrong
   interval is corrected on P6 («История лейбла»: `POST /tracks/:isrc/label { labelId, from, to? }`; the same `from`
   replaces). Releases: P7 «Импорт релизов» with the Believe release export of the account
   (`POST /releases/import?label=<id>`, all or nothing; a repeat is `unchanged`). Signals `tracksWithoutLabel`,
   `releasesIncomplete`, `releasesUnknown` on P21.
4. **Splits**: download the template on P28 (from P15 «Загрузить из файла»), fill `isrc, pseudonym, percent, from`
   (+ `to, owner, document, artist_id, note`), upload: the preview (`dryRun=1`) classifies every row; fix the file until
   no `error` row is left (`artist_id` for `pseudonym_ambiguous`, a common `document` for a `change` group), then apply
   (`dryRun=0`, all or nothing). `≤ 5 000` rows per file: split a larger catalogue. Rows without a document wait in C
   `split_unconfirmed`.
5. **Owners**: pseudonyms without an owner (`/artists?status=no_owner`, P11): the `owner` column of the import creates
   or finds one; otherwise assign on the pseudonym card.
6. **Documents**: upload and approve the contracts (P13 / P14; `createContract` for the owner; a decision of the label
   without a contract is a document of kind `label_decision`, approved like a contract, money in B); split rows cite
   their appendix or the split's document.
7. **Assume** what has no document yet and is accepted by the label: «Принять как допущение» on P6 (all splits of an
   ISRC) or P15 (one split) = `POST /splits/assume { labelId, isrcs | splitIds, reason }`; the money waits in C
   `assumption` (never paid until a real document replaces it through `changeSplit`). An `org_admin`'s right only.
8. **Publishing** (if any): B17 statements under the label (`POST /publishing/b17?label=<id>`); the step is `info`.
9. The checklist green: every step but `publishing` is `done`; `GET /api/v1/reconciliation` discrepancy 0;
   `scripts/check-label-books.ts` (D-169) as after any load.

## 14. Import a cash file (operations from a file, D-173)

For the payouts made outside the ERP (the cash after 30.10 of the payment channels, owner's answer 3), a starting
balance or a correction to the cabinet (`adjustment` with a document `adjustment_basis`), buyout payments (`buyout`
with a document of kind `buyout`) and publishing write-offs (`writeoff`). An `org_admin` session (`pay`; a label
manager and support are refused) or `AUTH_MODE=off` on the dev stand.

1. Download the template on P29 «Импорт операций» (from P20, `action-operation-import-template`): the columns
   `OPERATION_IMPORT_COLUMNS` = `owner, pseudonym, date, amount, kind, channel, confirmation, document, external_id,
   scope, comment` (owner or pseudonym = an id or the exact name, at least one; amount in dollars with a dot, signed for
   `adjustment`; `document` = an id or the exact title, else one `?documentId=` for the file; `confirmation` = the
   reference of the payment document, a `payment_proof` is created). Convert the channel's own file to it (no
   converter in the repo yet, Open О8). **`external_id` is required on every `payout` and `buyout` row** (the channel's
   transaction id): a repeated file must not double `paid`.
2. Preview: P29 upload, or `curl -F file=@cash.csv "…/api/v1/settlements/operations/import?label=<id>&dryRun=1"
   -H 'X-Operator: …'`: every row is `create`, `unchanged` (an active operation with the same kind, owner, pseudonym,
   date, amount, channel and `external_ref` already exists) or `error` with its classes (`owner_not_found`,
   `external_ref_required`, `duplicate_external_ref`, `kind_not_importable` for return / forgiveness, `document_kind`,
   `writeoff_exceeds`, …). Fix the file until no `error` row is left; warnings (`no_external_ref` on other kinds,
   `no_contract_for_label`) do not block. The preview writes nothing and leaves no audit row.
3. Apply (`dryRun=0`): one transaction, all or nothing (`422 import_invalid { line, cause }`). Every row is
   `migration: true` (counted at once without a payment document, never blocking), under `?label=`, `label_source =
   'operator'`. The audit row carries the summary of the response.
4. Check: P10 / `GET /owners/:id/balance` (the new rows `paid`, `buyouts`, `writtenOff`, `adjustments`), the payroll
   `GET /owners/payroll?label=<id>&asOf=<YYYY-MM>` and its `control` sheet (discrepancy 0). A second apply of the same
   file must answer all rows `unchanged`. A wrong row is undone by deactivating its operation (P20), never by deleting.

## 15. Replace a B17 statement by its «Updated» version (D-173)

The mechanism closes D-041; **the run on Q2 2026 «Updated» waits for the owner's confirmation** (decision 6): do not
replace a real statement without it.

1. Snapshot the stores (recipe 10). Note `GET /api/v1/reconciliation` (b17 rows) and the payables of the label.
2. On P19 the `loaded` statement → «Заменить» (`ReplaceStatementDialog`), or `curl -F file=@updated.xlsx
   "…/api/v1/publishing/statements/<oldId>/replace?label=<id>" -H 'X-Operator: …'` (approve: an `org_admin`). The new
   file must cover exactly the same quarters (`409 periods_differ { old, new }`), the old statement must be `loaded`
   (`409 replace_not_loaded`) and of the same label (`409 replace_label_differs`); an identical file is
   `duplicate_file`.
3. Result: the old statement is `superseded` with `replacedBy` (P19 shows the link; `GET /sources/files`), its lines,
   stored file and sha stay; the new statement's lines feed the calculation. Payout snapshots made before are byte for
   byte the same (`GET /settlements/operations/:id/snapshot`).
4. Check: the b17 reconciliation rows of the quarters (discrepancy 0), the writers of the new file mapped (signals
   `writer_unmapped`), `scripts/check-label-books.ts`, and the owners whose publishing moved (`compare-reference`
   without `--strict`, recipe 11 step 8, prints them).

## 16. Load the start of 15.10.2026 (the opening balances, D-174)

The cabinet position of every pseudonym replaces the recalculated history of the book of 0to8 up to 2026-08. The
owner's files (`cabinet_snapshot_2026-10-15.json`, `transition.json`, in the pack of 2026-11-06) are converted by the
script; an operator can also import a csv of `START_IMPORT_COLUMNS` on P30 «Старт 15.10». An `org_admin` session
(`pay`) or `AUTH_MODE=off` on the dev stand.

1. Preview: `npx tsx packages/backend/scripts/start/load-cabinet.ts <snapshot.json> <transition.json>`: writes
   `data/mvp-load/start/start_<cutoff>.csv` (a row per nick: `master = amount − publishing`, `publishing` from the
   `terms`; the `missing` nicks as rows without an amount; the approved `start_adjustments` as `adjustment` rows, a
   `pub_advance` one with `operation_ref` = the advance found by pseudonym, date and amount) and prints the classes:
   `pseudonym_not_found`, `artist_without_owner`, `pseudonym_ambiguous`, the warning `no_contract_for_label`.
2. Give the nicks an owner: `--create-owners` creates a person owner named after every pseudonym without one and the
   unknown nicks themselves (`origin: 'start'`); the ambiguous nicks (two live pseudonyms of one name) stay errors:
   resolve them on P11 «Дубликаты» (merge or rename), then import their rows from `start_issues.csv` on P30.
3. Apply: `--skip-errors --apply` writes the rows without an error in one transaction (`start_<cutoff>_clean.csv`); a
   second run answers every row `unchanged`. A wrong row is deactivated on P30 with a reason, never deleted; a
   correction is a new `adjustment` row (P30 import, `kind = adjustment`, its `basis`).
4. Check: `npx tsx packages/backend/scripts/start/check-start.ts [--cutoff 2026-08]`: one `ownerPayables` under 0to8
   at `asOf = cutoff`; every owner with rows must have `payable = Σ rows` and a `missing` row the gate
   `start_missing`; it exits 1 and lists the owners that differ. Then P10 of an owner shows `balance-start`, the cut and
   the rows; the payroll `GET /owners/payroll?label=<0to8>&asOf=2026-08` has payable = start on every row.
5. After the start: the reports of 2026-09 and later, the operations dated after `synced_at` (the cash registers), the
   advertising of 2026-09 and later count as before; the history of the book up to the cut is reference only
   (`OwnerBalance.start.insideStart`). The reach (`ownerReach`) is unchanged: the start is not a unit.

## 17. Load a month's data after the start (September 2026, D-175)

The stage 2 loads of the pack of 2026-11-06, in order; every script is a dry run without `--apply` and idempotent (a
second apply answers `unchanged`). An `org_admin` session or `AUTH_MODE=off` on the dev stand; the stack up.

1. The Believe report of the month under its label: `npx tsx packages/backend/scripts/load-believe.ts --label 0to8
   <zip>` (the account of the file name must be registered under the label), then
   `npx tsx packages/backend/scripts/derive-track-labels.ts data/real --apply` (recipe 11). Check the `file_totals`
   net against the owner's figure (September: 792 134,86).
2. The split versions of the month: a «100 % label» version (an assigned work) is a split without rows: on P28 a row with
   an empty `pseudonym` and `percent` 100 (the class `label_only`); from the owner's `split_changes.json`:
   `npx tsx packages/backend/scripts/stage2/load-label-splits.ts <json> --apply` (one approved document per basis group,
   the file reference points to the pack). Rows with pseudonyms come through P28 as in recipe 13.
3. The buyouts of the registry: `npx tsx packages/backend/scripts/stage2/load-buyouts.ts <folder 7> --apply`: a
   `buyout` document per contract, `facade.buyout` from the signing month (the owner's answer 2: the whole seller share;
   `buyout_overrides.json` for an explicit month), the Main prices as `buyout` operations (`external_id` = `main:<row>`).
   Read `data/mvp-load/stage2/buyouts_report.csv`: `already_zero` (in the splits already), `pct_differs` (the registry's
   share ≠ the row: the owner decides), `no_split_at_date`, `seller_not_in_split`, `pseudonym_ambiguous`.
4. The owner's write-offs (publishing deducted by Main, nothing accrued): `npx tsx
   packages/backend/scripts/stage2/load-writeoffs.ts <writeoffs.json> --apply` = `adjustment` rows of the start (master).
5. The numbers: `npx tsx packages/backend/scripts/stage2/payroll-summary.ts --month 2026-09` (the reconciliation row
   with the C reasons, the payroll at `asOf` with the gates, the largest payables) and `scripts/start/check-start.ts`
   (the start still equals the cabinet). Then P9 / P10 under 0to8 with `asOf` = the month, and the csv of
   `GET /owners/payroll?label=&asOf=&area=master`.

## 18. The admission to the payout (payees, holds, answers, the contract threshold, D-176)

The gate of the payout (the button, P9, P10, the payroll) follows the owner's module 17: contract → start → nothing to
pay → the threshold (the contract's, else $50) → a hold → a payout without a proof → no payee → the first payout without
an answer «pay» → ready. The checks «no payee» / «needs an answer» are on from the first payee row of the organization.

1. The owner's decisions (folder 6 of the pack): `npx tsx packages/backend/scripts/stage3/load-admission.ts <folder 6>
   --apply` (a dry run without `--apply`; idempotent by `source`): the payees (`payee_decisions.json`), the holds
   (`holds.json`), the open disputed items (`history_exceptions.json`: blocks only with `impact: block_row`), the answers
   (`payout_answers.json`).
2. By hand on P10 «Допуск»: set or replace the payee (the channel, the reference in the cash register, the basis),
   put a hold (a decision, an artist's request, a question, a disputed item with an amount and a period; in the book of
   the switch or in every book) and release it with a reason, record an answer «pay» for exactly the gate's amount
   (the dialog pre-fills it), set the threshold of a contract in cents (empty = the default). Every row keeps its reason;
   nothing is deleted.
3. Read: the gate of the owner (`GET /owners/:id/balance?label=` → `payout.reason`, `admission`), the payroll
   (`GET /owners/payroll?label=&asOf=` → `gate.reason` per owner), `scripts/stage2/payroll-summary.ts` (the owners per
   reason). A payee «by the payment history» (the owner's empty `payee`) needs the cash registers of stage 4; until then
   such owners are `no_payee`.

## 19. Read the ERP from Claude over MCP (D-177)

1. Put `MCP_READ_TOKEN=<openssl rand -hex 32>` in `.env`, run the API (it needs `ERP_DEFAULT_ORG`).
2. `.mcp.json` in the repo root starts `packages/backend/scripts/mcp-erp.ts`: open a new Claude Code session in the repo and allow the server `erp`. `ERP_API_URL` switches the API (default `http://localhost:3000`).
   Remotely (D-180): `POST <public address>/api/mcp` with the header `Authorization: Bearer <token>`; the page «Подключить Claude» (`/claude`) gives the command and the connector steps. After a change of the API restart the process behind the public address; `VITE_PUBLIC_ORIGIN` takes effect at `npm run build:client`.
3. The tools are the GET operations without `auth`, `orgs`, `users`, named from `operationId` (`get-owners-by-id-balance`). Long lists answer 50 rows with `total`: pass `limit` (≤ 500) and `offset`.
4. A new read field needs a `.describe()` (`tests/api-descriptions.test.ts`): a common name goes through `D` of `api-responses.ts`. A money answer Claude has to interpret gets `explain: true` in `operations.ts` (D-178).
5. A new long list: add `...S.pageQuery.shape` to its query, `pagedList` / `pagedField` in the route, `...pageFields` or `R.listOrPage` in the response. The token never writes: a new write needs no check here, `RULES.reader` refuses it.

## 19. The update of the pack of 2026-11-06 (the positions per pseudonym, the buyouts by the registry, the loaders, D-181)

The owner's answers of 2026-11-06 (evening) are analysed in `docs/разбор_пакета_2026-11-06.md` §8. What they changed in
the data of the live store, in order (every script is a dry run without `--apply`, idempotent; an `org_admin` session or
`AUTH_MODE=off`):

1. The nine label strings of September as aliases on P17 (or `POST /labels/:id/aliases`): six to 0to8, three to NoGhost (§8.2/3).
2. The buyouts by the registry of 2026-11-03: `npx tsx packages/backend/scripts/stage3/apply-buyout-workbook.ts "<…>/Выкупленные записи — сплиты после выкупа.xlsx" "<…>/transition_buyouts.csv" --apply`.
   The first month of the label per seller is «первый месяц лейбла» of the csv; a seller row ≥ the bought percent is
   zeroed (`facade.buyout`), a larger row loses the bought part (`changeSplit`). Read `data/mvp-load/stage3/buyout_workbook_report.csv`
   (`no_split_at_date`, `seller_not_in_split`, `pseudonym_ambiguous` wait for the owner). After the cut only LDRR
   (from 2026-09) changes money.
3. The payees of the old ERP's route: `npx tsx packages/backend/scripts/stage3/load-payout-checks.ts "<…>/payout_checks.json" --apply`
   (`proposed` payees for the owners without a decision, the open questions as `question` holds; a decision of
   `payee_decisions.json` wins). Then P9 under 0to8 with `asOf` shows who is still `no_payee` / `hold`.
4. The ASCAP money outside the start: `npx tsx packages/backend/scripts/stage3/load-ascap-supplement.ts "<…>/ASCAP_доплата_артистам_2026-11-06.csv" --apply`
   (group А «начислить» as `credit` operations dated 2026-11-06; `ascap_left.csv` lists what waits for the owner).
5. The positions: P10 «Баланс» of an owner with pseudonyms of both signs shows the net («сальдо»), «К выплате: сумма
   положительных позиций» and the negative ones; the payroll's pseudonym rows carry their position. `scripts/start/check-start.ts`
   still holds (the start is per pseudonym).
