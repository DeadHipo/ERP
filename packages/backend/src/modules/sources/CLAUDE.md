# sources module (Believe): notes for agents

- Storage: file registry in PostgreSQL (`registry.ts`, table `source_files`), report lines in ClickHouse
  (`columnar.ts`, table `believe.rows` plus views `lines`, `units`, `breakdown`, `file_totals`, `pairs`, …).
  No SQLite here: `boundaries.test.ts` fails if `schema.ts`/`repository.ts` appear (D-102, D-104, D-110).
- Load path (`loader.ts`): registry row `loading` → stream CSV/zip (`csv.ts`, `believe-format.ts`) into
  `believe_stage.rows_<id>` → control check against the file totals → `ATTACH PARTITION` into `believe.rows` →
  row `loaded`. Any caught error drops the stage table/partition and marks `failed` (D-108, D-112).
  A process crash leaves `loading`; recovery is manual (SQL in D-112).
- Reads always start from the registry: take `loaded` files, then query ClickHouse with `file_id IN (...)`.
  A file that is not `loaded` must never count. `snapshot()` returns files and units together for one calculation.
- Equal line keys are **not** merged at load; the views `sum()` them. Do not switch to SummingMergeTree (D-102).
- `believe.rows` has an aggregate projection `units_by_label` (D-122, D-124): the `units` view is answered from it. The unit key includes `label_name`, so `SourceUnit.labelName` is the label string and one ISRC/UPC/month can give several units; `columnar.units()` has a fixed `ORDER BY`. The stage table
  must stay `CREATE TABLE … AS believe.rows` so that a file's parts carry it; a part without it still counts, only
  slowly. A materialized view would not work here: `ATTACH PARTITION` does not trigger one.
- ClickHouse alias trap: never name a result alias like a column (`toString(file_id) AS file_id` silently changes
  the `WHERE`). Use another name.
- Money from ClickHouse is `Decimal(38,12)` read as **text**; convert with `Decimal` / `parsePico` from
  `src/shared/money.ts` (plain decimal.js keeps only 20 significant digits). Never `Number(...)`.
- Duplicate rules: same account + reporting month → 409 `duplicate_period`; same sha256 → 409 `duplicate_file`.
  Replace/delete exists in storage but has no API/UI (D-112).
- Schema changes: `packages/backend/migrations/clickhouse/NNNN_*.sql` (`npm run migrate:ch`) and
  `migrations/postgres/NNNN_*.sql` (`npm run migrate:pg`). Tests create private databases per test file
  (`tests/helpers/test-sources.ts`), so a migration is exercised by `REQUIRE_STACK=1 npm test`.
