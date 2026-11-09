# sources module (Believe)

Keeps the file registry and the raw report lines; the unit of calculation is ISRC + UPC + report month + sales month +
the label string (`label_name`), with net. Equal keys are summed by the view; nothing is deduplicated across accounts.
The account comes from the registry per file.

## Notes for agents

- Storage: file registry in PostgreSQL (`registry.ts`, table `source_files`), report lines in ClickHouse
  (`columnar.ts`, table `believe.rows` plus views `lines`, `units`, `breakdown`, `file_totals`, `pairs`, …).
  No SQLite here: `boundaries.test.ts` fails if `schema.ts`/`repository.ts` appear (D-102, D-104, D-110).
- Load path (`loader.ts`): registry row `loading` → stream CSV/zip (`csv.ts`, `believe-format.ts`) into
  `believe_stage.rows_<id>` → control check against the file totals → `ATTACH PARTITION` into `believe.rows` →
  row `loaded`. Any caught error drops the stage table/partition and marks `failed` (D-108, D-112).
  A process crash leaves `loading`; recovery is manual (SQL in D-112).
- Reads always start from the registry: take `loaded` files, then query ClickHouse with `file_id IN (...)`.
  A file that is not `loaded` must never count. `snapshot()` returns files and units together for one calculation;
  its `SnapshotFilter` (month range on a basis, `isrcs`, `upcs`, `accounts`, `labelIds` (only the loaded files with
  that `label_id`: a label book, D-169); an empty list = no unit) narrows the units read, never the list of files (the
  facade's unit scope, D-161). `SourceUnit.labelId` is the label of the unit's file (the map file → label, beside the
  account). `filesOfLabel(L)` / `isrcsOfFiles(fileIds)` give the book and the catalogue of a label; `isrcsOfLabelAliases`
  (with `columnar.labelStrings` / `isrcsOfLabelStrings`) stays for the reach of sublabel-rule recipients (D-163).
- **Album lines (D-211):** `snapshot()` spreads every unit with a UPC and no ISRC over the tracks of its release
  (`album-lines.ts`, `spreadAlbumLines`: weights = each track's cumulative net up to the line's month in the same label
  book, equal when ≤ 0, pico residue to the largest |weight|). A narrowed read (`isrcs`) reads the album lines of its
  releases and keeps only its ISRCs; a release with no known track stays as it is. Test fixtures without an ISRC use
  `UPC_NO_TRACKS` (`golden-case.ts`).
- **The label of a file** (D-169, R7): `source_files.label_id` (the own label the file was uploaded under) and
  `uploaded_by` (the operator) are written at load and never change; the module treats the label as opaque text and
  knows nothing about accounts. `assignFileLabel(fileId, labelId)` sets it only where it is NULL (the script
  `assign-label-books --step files`). `listFiles({ labelId })`, `LinesQuery.labelId` and `linesFacets(…, labelId)`
  read the files of one label. The facade refuses an upload before this module is called, in this order: the label
  (`label_required`, `not_found`, `label_not_own`, before the body is received), then the account of the file name
  (`account_unregistered`, `account_of_other_label`); then the module's own `duplicate_period`, sha256,
  `duplicate_file` inside the serial load. A refused upload leaves no registry row and no ClickHouse rows.
- **Catalog reads** (D-172, no schema change): `isrcFilePairs(fileIds, isrcs?)` = the (ISRC, file, reporting month)
  pairs of the given files in one `GROUP BY` (the observations of the label history of an ISRC); `isrcsOfUpcs(fileIds,
  upcs?)` = the distinct ISRCs per UPC (release completeness); `labelStringsOfFiles(fileIds)` = the raw label strings of
  the files (the checklist's unmapped strings). The caller passes `loaded` files of the registry. The streaming
  `parseCsv` moved to `src/shared/csv.ts`; `csv.ts` here only re-exports it.
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
- **The organization** (D-170): `createSourceFilesRegistry(pool, org)` filters and stamps every statement with the
  organization (`$1` = the organization, `org_id` on every row), so `loaded()` and every ClickHouse read that follows
  are the organization's; ClickHouse has no organization column. `source_files_scope (org_id, source, account,
  reporting_month)` and `source_files_sha (org_id, sha256)` kept their names, so `409 duplicate_period` /
  `duplicate_file` are per organization (one account in two organizations is allowed). Opened by `sourcesFor(stores,
  orgId, dataDir)` (`src/connect-sources.ts`); stored copies in `<dataDir>/orgs/<orgId>/files/sources`, upload temp
  files in `<dataDir>/orgs/<orgId>/tmp`. The upload queue (`serial()`) is per service instance = per module and
  organization; between processes the partial unique index decides (`tests/concurrency.test.ts`).
