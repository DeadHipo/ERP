# Plan: stages 3–7 of the MVP goal (2026-11-02)

Each step of stage 3 is one commit that meets the definition of done of `CLAUDE.md`: typecheck clean, lint clean,
`REQUIRE_STACK=1 npm test` green (187 tests at the start, HEAD `e2524f4`), its D-entry appended to
`docs/97_принятые_решения.md` and indexed in `03_decision_index.md`. The golden cases of `12_golden_cases.md` become
tests as the layers they need land; a step is not done while one of its golden cases is red. Baseline at HEAD `e2524f4`:
typecheck and lint clean, 187 tests, of which `sources-loader.test.ts` "keeps the units projection (D-122)" is flaky
(no `ORDER BY` in `columnar.units()`): step 3.1 fixes it. Every module gets a three-sentence `CLAUDE.md` in the step
that touches it (owners and splits in 3.3, publishing in 3.5, settlements in 3.4, labels in 3.2). Agents: sonnet writes
code and tests from this plan and the target model; opus reviews the layer chain; the orchestrator integrates.

## Stage 3: development

| Step | Commit scope | D-entry | Golden cases |
|---|---|---|---|
| 3.0 | Design recorded: `10_target_model.md`, `11_plan.md`, `12_golden_cases.md`; D-123 "Layered calculation: the design and the decisions Q1…Q12, R1, E15, M52, M33, M29" | D-123 | — |
| 3.1 | **sources**: ClickHouse migration `0003_units_by_label.sql` (projection `units_by_label`, view `believe.units` with `label_name`, old projection dropped); `columnar.units()` with an `ORDER BY` and `SourceUnit.labelName`; loader test updated to the new projection (and no longer order-dependent); `tests/clickhouse-migrate.test.ts` covers 0003; `LOG_TIMINGS=1` measurement on the real data before and after (budget: the balance page stays under 10 s) | D-124 | — (fixture `writeBelieve` gets `labelName`, a distinct report id per file) |
| 3.2 | **labels** module: migration `0006_labels.sql` + `tracks.note` + documents kind `assumption`; `modules/labels/{schema,repository,service,index}.ts` (create label, add alias, set rule, `index()` with `labelOf(string, date)`); `CLAUDE.md` of the module (three sentences); boundaries test lists the schema; unit tests; fixtures: `newFacade` seeds the own label 0to8 with aliases `Test Label` and `0to8` and the own label Echo8 with alias `Echo8`; helpers for owners of kind label, an unconfirmed owner, an `assumption` document, `approvedDoc` of any kind | D-125 | — |
| 3.3 | **splits**: migration `0007_participations.sql` (table `participations`, `split_shares.document_id`); service `createParticipation`, `closeParticipation`, `listParticipations`, `index()` returns rows (with their documents) and participations at a date; the double-participation check in both directions; Σ `top` ≤ 100 per ISRC and overlapping period; dates floored to month start in the facade (`createSplit`, `changeSplit`, `buyout`, participations, label rules); unit tests | D-126 | G23, the storage half of G25 |
| 3.4a | **facade layers, pure**: `src/facade/layers/{label-of-record,perimeter,off-the-top,split,carve,categorise,index}.ts` with a pure context builder; one test file per layer (`tests/layers/*.test.ts`, no stack); the seeded random exactness test (6-decimal percents in every position, nets up to 1e5 with 12 decimals) and the shuffled-order test; the pure test of the over-100 top cap; `recoup.ts` moved to `layers/` with its tests (`Scope`/`ScopeKind` stay in settlements) | D-127 | the master layer halves of G01–G25, G27–G44 |
| 3.4b | **facade rewired**: `calculate()` reads labels and participations and runs the chain; `reconcile()` per account with file totals per account, `ourShare` from the layer state, `ourShareByLabel`, the new reasons; the broken-layer discrepancy test; `signals()` additions; `explainTrack()` with per-layer states and the sum test; `tests/golden.test.ts` (end to end on the stack); existing tests adjusted only where the response shape changed (`account`, `ourShareByLabel`); `LOG_TIMINGS=1` measurement on the real data | D-127 | G01–G25, G27–G44 |
| 3.5 | **publishing**: `aggregatedLines()` keeps `operation_type`; migration `0008_pub_terms_operation_type.sql`; `setTerms({ operationType })` with overlap and closing per (owner, operation type); `accruals()` leaves the module: `layers/writer-parts.ts`, `layers/author-share.ts`; `calculate()` uses them; tests moved from the module to the layers; fixture `writeB17` gets `operationType` per row | D-128 | G26a–e |
| 3.6 | **API and pages**: routes labels, participations, terms with type, tracks note, documents kind, split rows with `documentId`; `operations.ts`, `api-schemas.ts`, `api-responses.ts` (the C reasons as one shared enum); contract scenario calls every new operation; the guard test that every reason has a label on the pages; frontend pages Labels and Participations, terms select, reasons on the balance and sources pages; `npm run build:client` | D-129 | — |
| 3.7 | Council review of stage 3 (architect: layer chain and boundaries; product: golden numbers; QA: runs the suite, edge cases) → `reviews/stage3_*.md` | — | all |

Order inside 3.4 (the only step with design risk): the layer files and their unit tests first, then `calculate()`,
then reconcile and balance, then the golden end-to-end file. The old `calculation.ts` unit loop is deleted, not kept
behind a flag.

## Stage 4: data

Scripts under `packages/backend/scripts/mvp/`, each idempotent, each writing a log under `data/mvp-load/` (git-ignored)
and never personal data into the repo. Everything goes through the facade or the module services (same validation
as the API), with documents of kind `contract`/`appendix`/`buyout`/`assumption` created with `migration: true`.

| Step | What | Source | D-entry |
|---|---|---|---|
| 4.1 | Labels dictionary: own labels 0to8 and Echo8; every distinct `label_name` of the loaded files as an alias; sublabels NoGhost (rule from 2026-06 by its agreement, 2026-02…2026-05 under an `assumption` document), R2R PRODUCTION and 77 Records (owner decision 2 as the document, from the imprint's first month); the other sublabel strings with the half rule under an `assumption` document (Q12); Ahh Music and `0to8/Echo8` as aliases of 0to8; each sublabel owner (kind label) with one pseudonym | ClickHouse distinct `label_name`; owner answers; `09` §1 | D-130 |
| 4.2 | Registered splits: compare the ERP splits with Annex "Splits by ISRC" per ISRC and period; enter the differences (new recordings, buy-outs in pp, floor titles scaled, assignments, Duetti 100 % rows, representative rows, licensor rows) as split changes with their documents; normalise the 1,043 mid-month `valid_from` (M52); log every change | Annex beta sheets Splits by ISRC, Sch3C(ii), Sch1B; `contract_index/documents.json` for the 196 "see the instrument" rows (M51) | D-131 |
| 4.3 | Participations: Kenke and Eiden XII `(net, top)` 15; Sleeping City Funk MCs `(net, artist_pool)` 13 each with the artist rows re-entered as 16.666666 / 16.666667 / 16.666667 (so the label is 50 and the artists 8 each; the duplicate DJ FANGZ row removed explicitly; the MC rows leave the split in the same change); the settlement 15 `(net, label_share)` from 2026-02 (the USD 100,000 as a document only); Maximum Madness, Matra, XENO `(bucket, label_share)` per ISRC window; era `(bucket, artist_share)`; co-ownership routed through #1; Trilalero and MALAME rows re-entered scaled (33.333333 / 16.666667; 29.761905 / 10.119048 / 10.119047) from the registry rows named in the log; every re-entered row keeps its original document | Annex Sch3A, Derivative authorisations; contracts | D-131 |
| 4.4 | Echo8 reference data: Echo8 tracks (ISRC + UPC pairs of the Echo8 account) and the Echo8 artists' splits from the Echo8 Backstage export and the Echo8 RSAs; what has no document gets a split without a document (C `split_unconfirmed`); one balance per owner across both labels (an assumption, D-131: the entities are separate; the balance shows B, recouped and paid per paying label) | `context_data/ERP_data/believe_echo8` export, `contract_index` | D-131 |
| 4.5 | History of payments, every cash row of `0to8 Main.xlsx` classified and logged: each Main nickname resolved to a pseudonym and its owner (ambiguous and unmatched ones logged, not guessed); every `Expense / Royalties` row as a migration payout on that owner (date = column C, `period` = column B report month, comment with the route; rows paid through another payee's account listed in the log), including the 383.67 "переплата" row; the 9,500 "переплата, которую заносим как аванс" row as a recoupable advance (as its comment says); `Expense / Advance` rows as recoupable payouts entered on the earning pseudonym with the scope from registry v7 (any / publishing; "none" = a plain migration payout); the 15 "ноу рекап" rows loaded as they are with a note (known stage-5 difference); `Expense / Publishing` (1 row, 9,638.69) as a payout; `Expense / Advertising` (7 rows, 2,699.39) not loaded (M21 later, known difference); `Expense / Sample` "вычет доли" rows (104 rows, 219,095.20) and the matching `Income / Sample` rows **not** loaded where step 4.3 enters a carve for that pair (they are the ledger's form of the carve), and loaded as deductions on the artist with a note where no carve covers the pair, each pair listed with its amount; the other 40 `Expense / Sample` rows (280,771.38) classified row by row in the log: a row that paid cash to the nickname is a payout, a row that reduced the nickname's balance without cash to it is a deduction with the basis document (the three 1,666.66 "штраф за Sleeping City Funk" rows are deductions: MC Denny's USD 5,000 fee charged to the artists), the 100,000 row is checked against the settlement lump and the buy-out prices and becomes a document only if it is one of them; buy-out prices and one-off fees as documents only; M47 rows per their comment; the MC Denny 10,774.41 as a payout; the load log reconciles its loaded cash to the Expense total 8,045,246.75 minus the rows it names as not loaded | `0to8 Main.xlsx` INCOME/EXPENSE; `реестры_каталога_2026-08_v7.xlsx` Sch3B | D-132 |
| 4.6 | Publishing terms by type: co-pub owners 50 (exists), the administration owner 90 / 50 sync, 0 % for bought-out writers (D-045 as is) | contracts | D-132 |

## Stage 5: verification

| Check | How | Output |
|---|---|---|
| Golden cases | `REQUIRE_STACK=1 npm test` | green |
| A = B + C + ours | `GET /reconciliation` for 2024-01…2026-08, per account: `discrepancy = 0` on every row | `docs/agents/14_verification.md` |
| Net label share vs Annex | script `scripts/mvp/compare-annex.ts`: per ISRC and report month, the ERP label remainder after the sublabel (the layer state's `labelShare`, before categorisation, 0to8 account only, Echo8 excluded by the Sch1B ISRC list) vs Annex "Monthly NLS by ISRC"; differences grouped by cause with totals and a tolerance of 0.01 per cell | same file, a table per cause with totals |
| Owner balances vs Main | script `scripts/mvp/compare-main.ts`: per owner, earned (B) by report month vs Income rows of the nickname; paid vs Expense rows; the list of owners whose payable differs from Main's balance with the cause | same file |
| Known differences expected (amount, cause) | Annex's Ahh Music 25 % deduction on 383 recordings (+27.5 k of 110 k to ours); Annex label 50 on FRX282644590 / 591 (−1,148.47 and −2,164.22, owner decision 5); Sleeping City Funk 45.8 → 50 (+1,819); M52 month start (±13,363.21 by ISRC-month, net 0 over the period only where the next month is in range); NoGhost months before 2026-06 and the Q12 imprints (in C, Annex deducts 25 %); the Q1 and Q5 rows in C; M44 recoup holidays (15 Main rows, in the Main comparison) | listed before the run |

## Stage 6: rework

A difference not in the expected list becomes a golden case from the contract; if the ERP is wrong, fix (back to
3.x, then 5); if the reference is wrong, it goes into the differences report, never into the code.

## Stage 7: completeness and hand-over

Parallel read-only agents (not the ones who wrote the code), one per source of map §8 (contracts, Annex 14 beta,
Believe 0to8 and Echo8 in ClickHouse, B17, the ERP reference data, `0to8 Main.xlsx`, report-processor, zero-erp, the
owner's answers), each returning "data element → catalogue case / not covered" → `docs/agents/13_completeness_check.md`
(the share of net 2024-01…2026-08 through each layer and in C by reason, from `GET /reconciliation` and one SQL over
`explainTrack`-style output; the uncovered list). Every uncovered element becomes a case and goes through stage 6
before stage 7 closes; the council accepts 13 before the hand-over. Acceptance: no uncovered element left, and the
share of net in C by reason explained line by line. Then: `01_big_picture.md`, `03_decision_index.md`, `04_recipes.md`, `05_doc_drift.md`
and the module `CLAUDE.md` files updated; final report in `docs/agents/15_mvp_report.md` (closed, open, assumptions).
Council acceptance of 13 and of stage 7 → `reviews/stage7_*.md`.

## D-entries planned

| D | Title |
|---|---|
| D-123 | Layered calculation of the master money: design, layer order, recipients are pseudonyms, document kind `assumption`, decisions Q1…Q12, R1, E15, M33, M52, M29 |
| D-124 | Believe unit carries `label_name` (projection `units_by_label`) |
| D-125 | Labels module (own labels, aliases, sublabel rules); `tracks.note`; document kind `assumption` |
| D-126 | Participations in the splits module; the row-or-participation rule; rule dates floored to the month start |
| D-127 | Facade layers for the master money; reconciliation per account with ours per label; new C reasons; recoup moved to the facade |
| D-128 | Publishing terms by operation type; the author share computed in the facade |
| D-129 | API and pages for labels, participations, terms by type, track notes |
| D-130 | Labels dictionary loaded from the Believe label strings and the owner decisions |
| D-131 | Registered splits, buy-outs, participations and Echo8 reference data loaded from Annex 14 and the contracts; legacy mid-month dates normalised |
| D-132 | Payment history and advances loaded from `0to8 Main.xlsx`; publishing terms by type |
| D-133 | Verification against Annex 14 and Main: results and the explained differences |
| D-134 | Completeness check and hand-over of the MVP goal |
