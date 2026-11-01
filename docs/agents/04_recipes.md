# Recipes: typical changes and the tests that guard them

Written 2026-11-01 (D-120), checked against the code at that date. Paths are under `packages/backend/` unless they
start with `packages/`.

## 0. Before and after any change

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d   # PostgreSQL + ClickHouse (+ migrations)
npm run typecheck && npm run lint && REQUIRE_STACK=1 npm test          # 186 tests on 2026-11-01, ~6 s
```
Without the stack the facade/sources tests are **skipped**, not failed: always use `REQUIRE_STACK=1` before saying
"tests pass". Then append a D-entry to `docs/97_принятые_решения.md` and a line to `docs/agents/03_decision_index.md`.

## 1. Guard tests you will hit (read them before you are surprised)

| Test | What it enforces | Typical way to break it |
|---|---|---|
| `tests/boundaries.test.ts` | a module imports no other module, no facade, no API; the API opens no module; each of the 4 modules has its own PostgreSQL schema, no foreign key crosses schemas (D-121) | importing `../splits` inside `modules/owners`; calling `openXModule` in a route |
| `tests/rules-coverage.test.ts` | one test per README §5 rule; **every `Number(` in `src` must be in an allow-list** | `Number(amount)` anywhere, even for a non-money value: add it to the allow-list only if it is really not money |
| `tests/api-contract.test.ts` | every Express route is in `src/api/operations.ts`, every response fits its schema, **the scenario calls every operation** | adding a route without an `API_OPERATIONS` entry, or without calling it in the scenario |
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
6. Client: method in `packages/frontend/src/api/client.ts` (typed by the shared schemas).

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
- The facade's `calculate()` adds its lines to `publishing` results; `reconcile()` gets a new `source` value;
  `PublishingResult` and `Reconciliation.source` types grow; the payout snapshot must store the new file hashes (D-100).
- Decide and log: duplicate-period rule, amount column, period → report month mapping, unknown writer handling.

## 6. Add a UI page

- One folder per domain in `packages/frontend/src/<domain>/<Page>.tsx`; route in `packages/frontend/src/App.tsx`;
  shared bits in `components/ui.tsx`; plain CSS in `styles.css`; no UI kit (README §3).
- Data only via `api/client.ts`. Money arrives as decimal strings: format, do not parse to float for arithmetic.
- Check: `npm run build:client`, then open the page on the running server (`PORT=3001 npx tsx
  packages/backend/src/main.ts data/real` or an empty dir) and look at it.

## 7. Change a money rule

1. Find the rule in README §5 and the module doc; find the D-entry in `03_decision_index.md`; check it is not
   ⚠ waiting for the owner.
2. Change it in one place: master allocation in `facade/calculation.ts`, balance/payable in `facade/balance.ts`,
   recoupment in `modules/settlements/recoup.ts`, payout gate in `facade/payouts.ts`.
3. Run `scripts/reconcile-erp.ts data/real` if you have the data archive: every new difference against the old ERP
   must be explained in the D-entry.

## 8. Run things on real data

- Needs the separate data archive (D-093) unpacked into the repo root, and the compose stack.
- `PORT=3001 npx tsx packages/backend/src/main.ts data/real`; Swagger UI at `http://localhost:3001/api/v1/docs`.
- `data/real` holds personal data (writer legal names). Never copy values from it into code, tests, fixtures, logs or docs.
