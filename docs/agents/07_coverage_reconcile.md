# Checking contractual coverage against the reference workbooks

The calculation does not change. `calculate()` still gives the label whatever is left after the registered percents of Believe net. This check only says where a reference workbook disagrees, and by how much.

## What is compared

Window: reporting months from January 2024 through August 2026.

- Annex 14, sheet `Monthly receipts by ISRC`: distributor net per ISRC.
- Annex 14, sheet `Monthly NLS by ISRC`: the label amount the workbook states for that net.
- Annex 14, sheet `Splits by ISRC`: registered percents. The label percent used here is 100 minus their sum. The workbook's own "share of 0to8" column is compared with its NLS as well, and a disagreement is a case inside the workbook, not a new rate.
- `0to8 Main.xlsx`, sheet `INCOME  EXPENSE`: royalties and publishing in the same window are written next to the artist share of the Annex receipts. They are not the same list of recordings, so the difference is not a case.
- Loaded Believe files only (`source_files.status = loaded`), ClickHouse `net_revenue`, imprint name exactly `0to8`. An ISRC is compared after dashes and spaces are removed and letters are uppercased, the same way a report line is stored. If that window has no loaded file, the run stops instead of calling every recording missing. Other imprints stay out. A file that is not loaded does not count.

## What a gap means

`packages/backend/src/shared/coverage-check.ts` classifies each recording:

- Absolute difference under 20 dollars: the same figure. The dollars are summed in `absorbedUsd` so a pile of small gaps stays visible.
- Absolute difference of 20 dollars or more: a case, until a layer in the next section explains it. The reference cell is not written back into `calculate()`.

## Layers

`packages/backend/src/shared/share-layers.ts` derives the label percent from the split row. Nothing in it is tied to one recording or one name.

- Itemized parties are deducted. The label keeps 100 minus their sum.
- A buyout names one party. That party's percent is not deducted. The other parties still are.
- A percent settled outside the split is deducted as well. When that percent only repeats the sum of the parties, it is not deducted a second time.
- When the row itemizes nobody, the label percent is the one written on the term. When that is empty too, the reference allocates nothing.
- A term applies only inside its period. A month outside every term adds nothing to this amount.

A recording these rules leave 20 dollars or more away is deferred. A cluster of that kind with few participants is not given its own branch.

```
npx tsx packages/backend/scripts/apply-share-layers.ts \
  "/absolute/path/Annex 14 — contractual coverage by recording.xlsx"
```

The script writes `context_data/contract_index/coverage.sqlite` (terms, deferred recordings, totals) and does not open the shared database. Receipts of a recording that is in the reference are the sum of its report lines on every imprint. Limiting that sum to the imprint name `0to8` drops recordings the reference includes.

## How to run the first check

From the repo root, with the stack up:

```
npx tsx packages/backend/scripts/reconcile-coverage.ts \
  "/absolute/path/Annex 14 — contractual coverage by recording.xlsx" \
  "/absolute/path/0to8 Main.xlsx"
```

The report is `context_data/contract_index/coverage_reconcile.json`. It stores ISRCs and amounts. It does not store names, and it is not committed.

Entering a contract into the system is still `06_close_contract_cases.md`. This check does not approve documents and does not load splits.
