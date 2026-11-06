# pubv2 module (publishing v2, D-182)

Stands beside `publishing`: the report summaries as they are, for a list of songwriters, songs and quarterly accruals.
`calculate()`, the layers and the balance never read it (`tests/boundaries.test.ts`); the old module keeps the money.

- Knows nothing outside the reports: no owner, no ISRC. A link to an owner or an ISRC belongs above the module and does not exist yet.
- `summary-format.ts` reads a sheet by its shape, never by its name: `periods` (Q4 2024 + Q1 2025; the writer is the one
  rights-holder of the lines), `blocks` (`SONGWRITER: name` then its songs; the Cover of Q2 and Q3 2025, the Songwriter
  Breakdown of Q1 and Q2 2026), `flat` (a writer on every row; the Songwriter Breakdown of Q4 2025). The Cover of Q2 and Q3
  2025 gives cents, the rest full precision.
- A file is a partition: `accruals.file_id`, reads take only `status = 'loaded'`. A quarter of a loaded file of the same
  label is `409 period_loaded` unless `replace=1`; `removeFile` deletes the partition and restores the files it replaced.
- A spelling with the same `normalizeName` is the same songwriter or song, through `songwriter_aliases` / `song_aliases`.
  Another spelling makes a new record: nothing merges them yet.
- Amounts are pico in `bigint`; `gross` and `withholding` are null where a report does not name them.
