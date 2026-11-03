# Stage 5 verification: golden cases, A = B + C + ours, Annex 14 and 0to8 Main (2026-11-03)

Stage 5 of `11_plan.md` and `notes/goal_prompt.md`, read only (SELECT, read-only `calculate()` scripts, the API on
port 3009 for GET calls only, stopped afterwards). Stage names, ISRC, amounts and owner id prefixes only. Two names in
the Main ledger look like legal names; they are written as "(nickname withheld)". B17 holders are not named.

**Two states of the database.** Another agent applied the stage 6 data fixes in the same database while this check ran
(D-135, committed `5d9a410`: 44 (ISRC, UPC) pairs registered, the `lost` sublabel rule closed, the LUNAR MEDIA
licence as an assumption participation, 13 B17 holders confirmed by their own contracts, 55 Main carve deductions
replaced by 336 participations; D-136 `424fcfe` adds signals only).

| Run | Time (UTC) | State |
|---|---|---|
| run 1 | 2026-11-02 22:31:42 … 22:35 | HEAD `e276ad2`, before the fixes (applied 22:35:39 … 22:37:24) |
| run 2 | 2026-11-02 22:50:48 … 22:51:39 | HEAD `5d9a410`, after the fixes (no write after 22:37:24) |

The Annex analysis (§3) was made on run 1 data and re-checked on run 2. The owner analysis (§4) was made on the run 2
state (the end state, what stage 6 starts from). §8 compares the headline numbers of both runs. Scripts and raw output:
`/private/tmp/claude-501/-Users-nearlydeadhipo-Desktop-0to8-ERP/441975a6-0f8b-4dbd-b984-d2856fc5b0b0/scratchpad/stage5/`
(`annex_dump.mts`, `owner_dump.mts`, `decomp.py`, the settlement script, `carve2.mts`, `run1/`, `run2/`).

## 0. Headline

- Golden cases: green (32 files, 354 tests, 0 failed, 0 skipped).
- A = B + C + ours: 52 reconciliation rows for 2024-01…2026-08 (account 1052428: 32, account 1055956: 13, B17: 7),
  `discrepancy` = 0 on every row; `fileDiscrepancy` = 0 on all 45 Believe rows (B17 rows have no file total: null).
- Annex 14 (0to8 perimeter, 107,006 ISRC-month cells): label share within 0.01 on 91,364 cells (92.37 % of receipts)
  after the fixes, 90,967 (89.38 %) before. Σ ERP label share − Σ Annex NLS = 411,847.85 (453,909.23 before), of
  which 348,112.67 is the Duetti catalogue that Annex excludes for all months (reference perimeter). No layer error
  found; one data gap fixed during the run (second UPC, 41,552.72 of `other`).
- Main (992 owners matched to a Main nickname): 802 differ by more than 1.00 (799 before). With the named causes of
  §4, 633 of the 802 are explained within max(1.00, 2 % of the owner's Main income) and 169 are not (Σ|residual|
  430,254.18); with a strict 1.00 tolerance 503 explained, 299 not.
- ERP errors found: 3 that move money (E1 the settlement participant paid by a legacy row before its start,
  137,982.02; E2 the D-135 carve participations start in 2026-07 and take the percent of the source row, so 4,967.80
  replaces 101,552.83 of Main carve history; E3 the Q1 and Q5 assumption documents not attached, 19,169.49 + 270.31
  in B instead of C), and one hygiene item (E4, 38 empty-period splits). All are data or loader errors; the layers
  compute what the data says. Golden cases for stage 6 in §6.
- Stage 6 rework (D-137, §9): E1–E4 fixed through the loader; B −120,902.12 → C on account 1052428, ours unchanged;
  Main explained owners 633 → 640 (2 % tolerance), Σ|residual| not explained 430,254.18 → 346,014.05.
- Stage 7 closing (D-138, §10): the E1 settlement share before 2026-02 spread pro rata over the legacy rows (Main's
  payment fact): DJ Ikeraus +7,886.93, RD12 and DJ MRCL +136.56 each, ours +165.80, LDRR −8,325.86; Main explained
  owners 640 → 641 (2 % tolerance), Σ|residual| not explained 346,014.05 → 337,982.01; the decomposition is now
  `scripts/mvp/decompose-main.ts`.
- Performance: balance 6.6–6.9 s, reconciliation 7.3–7.8 s; the layers dominate (3.9–4.3 s of 721,975 units); the
  B17 part is the publishing snapshot, 1.05–1.08 s (SQL aggregation of 1,162,586 lines into 8,660).

## 1. Golden cases

`REQUIRE_STACK=1 npm test`, once, 2026-11-02 22:32:09 UTC on HEAD `e276ad2`: **32 test files passed, 354 tests
passed**, 0 failed, 0 skipped, 27.6 s (the frontend workspace has no tests). The suite includes `tests/golden.test.ts`
(every master case G01–G25, G27–G44 end to end with the reconciliation identity) and `tests/layers/*` (the layer
halves, the exactness and shuffled-order tests). D-135/D-136 later report 356 tests at `5d9a410` (two new golden
tests, G21b and G21c); not re-run here.

## 2. A = B + C + ours (`GET /api/v1/reconciliation?from=2024-01&to=2026-08`)

| Source / account | Rows | Months | discrepancy ≠ 0 | fileDiscrepancy ≠ 0 |
|---|---|---|---|---|
| believe 1052428 (0to8) | 32 | 2024-01 … 2026-08 | 0 | 0 |
| believe 1055956 (Echo8) | 13 | 2025-08 … 2026-08 | 0 | 0 |
| b17 | 7 | 2024-12, 2025-03, 2025-06, 2025-09, 2025-12, 2026-03, 2026-06 | 0 | null (no file total for B17) |

Totals per account, run 2 (run 1 in brackets where it differs):

| Account | A received | B not ours | C waiting | ours | ours by label | ours without a split |
|---|---|---|---|---|---|---|
| 1052428 | 15,280,793.42 | 6,743,236.57 (6,710,253.48) | 748,978.81 (889,957.87) | 7,788,578.04 (7,680,582.07) | 0to8 7,656,729.75 (7,548,733.79), Echo8 131,848.28 | 469,642.73 (402,187.13) |
| 1055956 | 1,050,945.10 | 53,363.50 | 330,354.64 | 667,226.96 | Echo8 667,226.96 | 150,923.15 |
| b17 | 2,496,581.91 | 682,348.36 (0.00) | 845,990.25 (1,528,338.61) | 968,243.31 | (publishing has no label) | 0 |

C by reason, run 2 (run 1):

| Reason | 1052428 | 1055956 | b17 |
|---|---|---|---|
| owner_unconfirmed | 592,602.73 (593,983.94) | 2,770.16 | 520,584.25 (1,528,338.61) |
| split_unconfirmed | 133,856.56 (133,870.04) | 320,636.21 | |
| publishing_terms_unconfirmed | | | 325,405.99 (0) |
| unknown_pair | 0.00 (150,057.35) | | |
| assumption | 15,885.63 (5,412.65) | 5,922.83 | |
| artist_without_owner | 4,360.20 | 936.43 | |
| no_isrc | 2,273.68 | 89.00 | |

The assumption C of 1052428 after the fixes: sublabel halves 5,374.09 (NoGhost before 2026-06 4,840.35, the Q12
imprints 470.44, R1 63.30), LUNAR MEDIA participation 5,543.73, carve participations of D-135 4,967.80. Of the
150,057.35 that left `unknown_pair`, 32,983.09 became B and 107,995.97 ours (67,455.60 of it on ISRC without a split);
the rest moved between C reasons. Ours per label: 0to8 7,656,729.75 and Echo8 131,848.28 in account 1052428 (the
`Echo8` label string inside the 0to8 account), Echo8 667,226.96 in account 1055956.

## 3. Annex 14 comparison (label share per ISRC-month vs "Monthly NLS by ISRC", account 1052428, Echo8 excluded)

`compare-annex.ts` re-run twice (run 1, run 2). It assigns each differing cell to the first cause in a fixed order
using `splits_diff.json` (pre-load). That classification is stale for two buckets, so they were re-classified from the
calculated units (`annex_dump.mts`: every differing cell with its ERP allocations, label strings and statuses) against
the `splits_diff.json` Annex rows and `exclusions.json`.

### 3.1 Cause → cells → Σ|diff| → verdict → action (run 1; run 2 where it changed)

| Cause (compare-annex) | Sub-cause (this check) | Cells | Σ diff (ERP − Annex) | Σ\|diff\| | Verdict | Action |
|---|---|---|---|---|---|---|
| split_differs | Duetti ISRC outside the Annex perimeter, months before the sale (206 ISRC; after the sale both are 0) | 3,399 | 348,659.91 (run 2: 348,112.67) | same | reference: Annex Sch1B drops the sold catalogue for every month; the sale is dated (P03 from 2026-05, P04 from 2026-06, M28) and the label owned the share before | report only |
| split_differs | withdrawn recordings (Sch1B) | 49 | 54.03 | 54.03 | reference perimeter (M28: they keep their last split) | report only |
| split_differs | in the Annex: rows or period boundary differ (stale `different_rows` / `different_period`) | 216 | −72.42 | 558.92 | data: small boundary and row differences, below 0.01 % of receipts | report only |
| other | second UPC of a known ISRC not registered: the unit sat in C `unknown_pair`, so its whole net counted as label share (20 ISRC) | 387 | 41,552.72 (run 2: 0) | 41,552.72 | data gap (E9, M54) | loader fix, done by D-135 `pairs` during the run |
| other | Matra! participation from the label share; Annex prints Matra! as a row of net (24 ISRC) | 76 | 6,531.97 | 6,531.97 | reference: contract "% of the label's net master royalties" (contract analysis `RAZBOR.md` §12: a percent of our share); Main pays it the same way as the Annex | report only |
| other | Maximum Madness participation from the label share; Annex lacks it or prints it as a row of net (40 ISRC) | 446 | −241.35 | 1,863.95 | reference (contract base = label share, MC Hub task_128: 5 % of label profit = 2.5 % of net) | report only |
| other | residual: Annex NLS at 25 % in the first month of 8 ISRC; one cell rounding | 9 | 7.40 | 7.40 | reference (Annex part-month) | report only |
| annex_no_share | ERP has no split (ours by D-029), Annex "no share established" (836 ISRC) | 10,535 (run 2: 10,542) | 72,214.15 | 72,215.28 | data gap: no document on either side; the ERP shows it as `ourShareNoSplit` | report only (M54 watch list) |
| annex_no_share | ERP has a split, Annex "no share" | 12 (5) | 3.20 | 3.20 | reference | report only |
| sublabel_assumption | 77 Records (`77 Records`, `0to8 / 77 Records`, 19 ISRC): ERP gives 77 half of the label share, the Annex NLS keeps the label share whole | 112 | −13,149.96 | 13,149.96 | reference: owner decision 2 (half for 77, R2R, NoGhost) > Annex | report only |
| sublabel_assumption | NoGhost (`NoGhost Records / 0to8` −2,165.03, `NoGhost Records` +17.42, `0to8, NoGhost Records` −12.31) | 48 | −2,159.92 | 2,223.22 | reference (decision 2); before 2026-06 the half waits in C assumption | report only |
| sublabel_assumption | Q12 imprints (Enarma, PCR, Bear, `lost` (October 2025 only in run 2), Hoboshrine, no job records) | 79 (69) | −345.72 (−307.17) | same | assumption (Q12): the sublabel half is C, our half ours; Annex keeps the whole | report only |
| sublabel_assumption | R2R PRODUCTION | 39 | 12.49 | 12.49 | reference | report only |
| remixer | FRX282644590 (Kenke) −1,148.47, FRX282644591 (Eiden XII) −2,164.22 | 6 | −3,312.69 | 3,312.69 | expected: owner decision 5 (15 % off the top, label 42.5) > Annex 50 | report only |
| floor_titles | Sleeping City Funk (3 ISRC) | 33 | 1,774.45 | 1,863.31 | expected: owner decision 4 (label 50; Annex 45.8 from the duplicated DJ FANGZ row) | report only |
| floor_titles | FUNK DO MALAME AMARELO (4 ISRC) | 68 | −41.00 | 41.00 | reference (rows re-entered scaled to 50, Annex 50.2) | report only |
| ahh_music | one empty-ISRC unit (C `no_isrc`) with an Ahh string among its labels | 5 | 1,015.98 | 1,015.98 | perimeter: no ISRC (D-035) | report only |
| ahh_music | FR2X42670219…222: DJ VRK row kept 2026-05 and 2026-06 (ERP legacy buy-out #7 from 2026-07, Annex "выкуп DJ VRK 25 %" from 2026-05) | 8 | −541.27 | 541.27 | data: two instruments disagree on the date; Sch3C(ii) lists only the DJ TUUV instrument of 2026-05-08 | report only (check the VRK instrument) |
| ahh_music | other cells | 11 | −2.84 | 6.08 | rounding | none |
| m52_month | after the D-131 normalisation | 32 | 16.02 | 16.02 | expected (the ±13,363.21 of 09 §1 is gone) | none |
| no_split_erp | Annex share printed without named rows (DGA062294214/215: Catalog Shares register 0.75, 502.63) and 9 more ISRC; ERP no split | 106 | 512.41 | 512.41 | data gap (no rows to load) | report only |
| no_split_erp | ISRC without Annex receipts in those months | 336 | 178.90 | 178.90 | perimeter | report only |
| not_in_annex | the empty ISRC (C `no_isrc`) | 27 | 1,235.03 | 1,235.03 | perimeter (D-035) | report only |
| **Total** | | **16,039 (15,642)** | **453,909.23 (411,847.85)** | **495,901.49 (453,762.98)** | | |

Receipts: 4,069 cells differ (Σ|diff| 655,913.54), all of them ISRC that the Annex does not list (the Duetti
catalogue before its sale, withdrawn and other excluded recordings); no receipts difference on an ISRC the Annex lists.

**No ERP error in the Annex comparison.** Every difference is either the Annex not updated to an owner decision
(2, 4, 5), its perimeter (Duetti, withdrawn), a contract the Annex records differently (Matra!, Maximum Madness), a
data gap (second UPC: fixed; no split; no rows) or the Q12 assumption. Precedence of map §6 decides every verdict.

### 3.2 Top 40 ISRC by |diff| in `split_differs` and `other` (run 1; 353,199.48 of 399,228.89)

ERP rule = the splits and participations of the ISRC from `splits.splits`, `splits.split_shares`,
`splits.participations` (period, rows, document kind). Annex row = `splits_diff.json` (Annex "Splits by ISRC").
Verdicts: **R-Duetti** = reference perimeter (Annex Sch1B excludes the sold ISRC for every month; ERP keeps the
pre-sale label share, then 100 % to the buyer from the sale month, M28); **D-pair** = data gap, second UPC not
registered (the unit was C `unknown_pair`, its whole net counted as label share), fixed by D-135; **R-Matra** =
reference, label-share participation by contract.

| # | ISRC | Bucket | Cells | Σ diff (ERP − Annex) | ERP net | ERP rule in force (SELECT) | Annex row | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | FRX282403913 | split_differs | 25 | 52,933.12 | 101,760.72 | 2000-01..2025-12 DJ Ikeraus 35, MC FERNANDINHO FN 15 (appendix); 2025-12..2026-05 DJ Ikeraus 0, MC FERNANDINHO FN 15 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 2 | FR96X2414092 | split_differs | 27 | 28,631.12 | 53,149.46 | 2000-01..2026-03 Lxzt 50 (appendix); 2026-03..2026-06 Lxzt 0 (buyout); 2026-06..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P04 from 2026-06) |
| 3 | DGA052458596 | split_differs | 23 | 28,031.94 | 54,036.05 | 2000-01..2025-12 DJ Ikeraus 35, MC FERNANDINHO FN 15 (appendix); 2025-12..2026-05 DJ Ikeraus 0, MC FERNANDINHO FN 15 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 4 | DGA052458597 | split_differs | 23 | 18,509.01 | 35,710.08 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 5 | FRX282403914 | split_differs | 26 | 17,098.47 | 32,337.56 | 2000-01..2025-12 DJ Ikeraus 35, MC FERNANDINHO FN 15 (appendix); 2025-12..2026-05 DJ Ikeraus 0, MC FERNANDINHO FN 15 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 6 | FRX452444855 | split_differs | 25 | 14,156.64 | 27,356.71 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 7 | FR2X42478250 | other | 31 | 12,500.02 | 36,693.69 | 2000-01..- 2KE 50 (appendix) | 2024-02 — 2026-08 LS 0.5 [('2KE', 50.0)] same | D-pair |
| 8 | FRX872563577 | split_differs | 10 | 11,548.66 | 17,222.50 | 2000-01..2026-03 Lxzt 50 (appendix); 2026-03..2026-06 Lxzt 0 (buyout); 2026-06..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P04 from 2026-06) |
| 9 | FRX452444856 | split_differs | 25 | 11,118.41 | 20,829.11 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 10 | FRX872449088 | split_differs | 24 | 10,810.64 | 20,430.34 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 11 | DGA062478767 | split_differs | 22 | 10,756.07 | 21,374.42 | 2000-01..2025-12 DJ Ikeraus 10, DJ JUN01 40 (appendix); 2025-12..2026-05 DJ Ikeraus 0, DJ JUN01 40 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 12 | DGA092498133 | split_differs | 21 | 10,605.77 | 19,897.17 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 13 | DGA072455118 | split_differs | 22 | 10,272.21 | 20,349.78 | 2000-01..2025-12 DJ Ikeraus 10, DJ JUN01 40 (appendix); 2025-12..2026-05 DJ Ikeraus 0, DJ JUN01 40 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 14 | FRX452444857 | split_differs | 25 | 9,154.05 | 17,375.54 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 15 | FR96X2414091 | split_differs | 27 | 7,861.53 | 14,775.45 | 2000-01..2026-03 Lxzt 50 (appendix); 2026-03..2026-06 Lxzt 0 (buyout); 2026-06..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P04 from 2026-06) |
| 16 | FRX872449089 | split_differs | 24 | 6,841.04 | 12,845.57 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 17 | FR96X2414093 | split_differs | 27 | 6,462.49 | 12,452.89 | 2000-01..2026-03 Lxzt 50 (appendix); 2026-03..2026-06 Lxzt 0 (buyout); 2026-06..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P04 from 2026-06) |
| 18 | DGA072470217 | other | 26 | 6,109.39 | 12,987.58 | 2000-01..- Zachz Winner 50 (appendix) | 2024-07 — 2026-08 LS 0.5 [('Zachz Winner', 50.0)] same | D-pair |
| 19 | FRX282403912 | split_differs | 25 | 6,079.68 | 11,656.49 | 2000-01..2025-12 DJ Ikeraus 35, MC FERNANDINHO FN 15 (appendix); 2025-12..2026-05 DJ Ikeraus 0, MC FERNANDINHO FN 15 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 20 | DGA062478768 | split_differs | 22 | 6,035.78 | 11,980.78 | 2000-01..2025-12 DJ Ikeraus 10, DJ JUN01 40 (appendix); 2025-12..2026-05 DJ Ikeraus 0, DJ JUN01 40 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 21 | SE6TI2310816 | other | 31 | 5,843.78 | 12,307.35 | 2000-01..- Burnedsam 50 (appendix) | 2024-02 — 2026-08 LS 0.5 [('Burnedsam', 50.0)] same | D-pair |
| 22 | DGA092498134 | split_differs | 21 | 4,830.35 | 8,637.19 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 23 | DGA072490317 | other | 26 | 4,623.37 | 11,100.76 | 2000-01..- Zachz Winner 50 (appendix) | 2024-07 — 2026-08 LS 0.5 [('Zachz Winner', 50.0)] same | D-pair |
| 24 | FR96X2577362 | split_differs | 13 | 4,276.12 | 8,286.18 | 2000-01..2025-12 DJ Ikeraus 12, DJ VICTOR ZL 11, DJ ZENITE 12, MC Alexandre Fabuloso 10, MC K3 5 (nodoc); 2025-12..2026-05 DJ Ikeraus 0, DJ VICTOR ZL 11, DJ ZENITE 12, MC Alexandre Fabuloso 10, MC K3 5 (buyout); 2026-05..2026-06 Duetti 100 (contract); 2026-06..- Duetti 100 (contract); 2026-06..2026-06 DJ Ikeraus 0, DJ VICTOR ZL 11, DJ ZENITE 0, MC Alexandre Fabuloso 10, MC K3 5 (buyout) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 25 | DGA0P2386044 | other | 32 | 4,225.73 | 8,709.75 | 2000-01..- DEHA INC. 50 (appendix) | 2024-01 — 2026-08 LS 0.5 [('DEHA INC.', 50.0)] same | D-pair |
| 26 | FR2X42440404 | split_differs | 28 | 4,096.31 | 7,150.13 | 2000-01..2026-03 Lxzt 50 (appendix); 2026-03..2026-06 Lxzt 0 (buyout); 2026-06..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P04 from 2026-06) |
| 27 | FR2X42436311 | split_differs | 27 | 3,910.31 | 7,195.09 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 28 | DGA0H2435892 | split_differs | 21 | 3,645.16 | 5,734.72 | 2000-01..2026-03 Lxzt 50 (appendix); 2026-03..2026-06 Lxzt 0 (buyout); 2026-06..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P04 from 2026-06) |
| 29 | DGA092411025 | split_differs | 21 | 3,629.19 | 6,464.06 | 2000-01..2025-12 DJ Ikeraus 25, RD12 25 (appendix); 2025-12..2026-05 DJ Ikeraus 0, RD12 25 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 30 | DGA092498132 | split_differs | 21 | 3,220.96 | 6,110.43 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 31 | FR59R2676669 | other | 4 | 3,049.10 | 65,047.46 | 2000-01..2026-05 DJ eu4oria 12.5, DJ FZ DA ZN 12.5, lirvie 12.5, Matra! 12.5 (appendix); 2026-05..- DJ eu4oria 12.5, DJ FZ DA ZN 12.5, lirvie 12.5 (contract); participation Matra! 12.5 (bucket, label_share) from 2026-05 | 2026-04 — 2026-08 LS 0.5 [('DJ eu4oria', 12.5), ('DJ FZ DA ZN', 12.5), ('lirvie', 12.5), ('Matra!', 12.5)] same | R-Matra |
| 32 | FRX872449090 | split_differs | 24 | 3,007.88 | 5,330.15 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 33 | FR2X42436310 | split_differs | 27 | 2,934.48 | 5,532.96 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 34 | QZZ972426904 | other | 24 | 2,663.70 | 13,978.81 | 2000-01..- brianjcb 50 (appendix) | 2024-08 — 2026-08 LS 0.5 [('brianjcb', 50.0)] same | D-pair |
| 35 | FRX872563576 | split_differs | 10 | 2,509.07 | 3,710.07 | 2000-01..2026-03 Lxzt 50 (appendix); 2026-03..2026-06 Lxzt 0 (buyout); 2026-06..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P04 from 2026-06) |
| 36 | GX8LE2458681 | other | 23 | 2,491.33 | 4,663.03 | 2000-01..- springs! 50, Zachz Winner 25 (appendix) | 2024-10 — 2026-08 LS 0.25 [('springs!', 50.0), ('Zachz Winner', 25.0)] same | D-pair |
| 37 | QM6N22335946 | split_differs | 29 | 2,440.16 | 4,139.08 | 2000-01..2026-03 Lxzt 50 (appendix); 2026-03..2026-06 Lxzt 0 (buyout); 2026-06..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P04 from 2026-06) |
| 38 | DGA092411027 | split_differs | 21 | 2,356.73 | 4,136.10 | 2000-01..2025-12 DJ Ikeraus 25, RD12 25 (appendix); 2025-12..2026-05 DJ Ikeraus 0, RD12 25 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 39 | DGA092411026 | split_differs | 21 | 2,230.37 | 4,061.02 | 2000-01..2025-12 DJ Ikeraus 25, RD12 25 (appendix); 2025-12..2026-05 DJ Ikeraus 0, RD12 25 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |
| 40 | DGA052458598 | split_differs | 23 | 1,699.29 | 3,226.03 | 2000-01..2025-12 DJ Ikeraus 50 (appendix); 2025-12..2026-05 DJ Ikeraus 0 (buyout); 2026-05..- Duetti 100 (contract) | excluded (Sch1B Duetti) | R-Duetti (P03 from 2026-05) |

## 4. Main comparison (owner balances vs `0to8 Main.xlsx`)

`compare-main.ts` re-run twice. The structure below is from run 2 (owner components by `owner_dump.mts` +
`decomp.py`: one `calculate()`, `ownerBalance()` per owner, Main rows from `data/mvp-load/main/cash_rows.json`).
Diff = ERP payable − Main balance (Main balance = Σ Income − Σ Expense of the owner's nicknames).

### 4.1 Totals

| Item | run 2 | run 1 |
|---|---|---|
| Owners matched to a Main nickname (nicknames matched / ambiguous / unmatched) | 992 (1,018 / 3 / 209) | same |
| Σ Main income, matched owners | 8,499,624.88 | same |
| Σ ERP earned B + waiting C, matched owners | 6,777,300.50 + 863,741.07 = 7,641,041.58 | 6,744,253.43 + 860,167.97 = 7,604,421.40 |
| Σ Main expense, matched owners | 7,915,206.41 | same |
| Σ ERP paid (counted out operations: payouts and advances) | 7,406,451.72 | 7,402,440.89 |
| Σ ERP payable / Σ Main balance | −506,569.03 / 584,418.47 | −633,959.30 / 584,418.47 |
| Owners with \|diff\| > 1.00 (Σ\|diff\|) | 802 (2,322,605.04) | 799 (2,413,555.53) |

**Income: Σ ERP B + C − Σ Main income = −858,583.30**, bridged:

| Item | Amount | Why |
|---|---|---|
| Main publishing income on the nickname owners | −855,819.32 | the ERP pays B17 to the 32 holder owners created from the statements (13 confirmed by D-135, B 682,348.36); none of them is a Main nickname owner (no merge, D-083 ⚠). Publishing B of the matched owners is 0 |
| Echo8 account 1055956 earned and waiting | +274,183.27 (B 53,363.50, C 220,819.77) | Main keeps the Echo8 account on its separate Echo8 sheet (27,124.99 there); the `Echo8` string inside the 0to8 account is in the Main ledger and in the residual below |
| 0to8 account B + C − Main royalties and other income | −276,947.29 | of which: Main income with no report month or for 2026-10 (no Believe file) −36,965.42; Main credits to carve participants that the ERP does not reproduce (162,851.52 credited by the carve groups, 4,967.80 earned in the ERP) about −157,883.73; the rest −82,098 is per-owner split and practice differences (the unexplained owners of §4.3; it can include no-split ISRC that Main pays, the ERP keeps 469,642.73 as ours without a split). E1 nets to 0 here (−137,982.02 on LDRR, +137,982.02 on the settlement participant) |

Outside these sums: Main income of nicknames without an owner 157,700.75 (209 unmatched, 3 ambiguous: DJ VETA3,
DSHZS, MC FLYXO, whose Echo8 rows block 415 Echo8 ISRC, D-131), and their Expense 130,040.40 (21 nicknames).

**Expense: Σ Main expense − Σ ERP out operations = 508,754.69** = buy-out prices and fees kept as documents (M47,
M20) 282,000.00 + carve deductions still loaded as `in` operations 111,097.28 + carve deductions replaced by
participations (D-135) 101,552.83 + carve rows covered by a participation and never loaded 11,405.19 + advertising
2,699.39 (M21). The ERP adds back what it has not recouped: advances 214,662.36 (scope any 156,162.36, publishing
58,500.00, the latter with no publishing B on the nickname owners) and carve deductions 19,017.11.

**Payable: Σ diff −1,090,987.50** = B17 holders −855,819.44, C `owner_unconfirmed` −559,424.64, C `split_unconfirmed`
−78,528.94, C `assumption` −4,967.79, Echo8 account B +53,363.50, documents only +282,000.00, advances not recouped
+214,662.36, carve deductions not recouped +19,017.11, carve rows replaced or covered +112,958.02, ads +2,699.39,
master residual −276,947.29 (sum −1,090,987.64; 0.14 rounding of 992 owners).

### 4.2 The 40 owners with the largest |payable difference| (run 2)

Components per owner (sum = diff to 0.01): B17 holder (Main publishing income on the nickname, ERP pays the holder
owner), C by reason of the owner's master allocations, Echo8 account B, buy-out price or fee kept as a document,
advance or carve deduction not yet recouped (Main subtracts the whole advance), carve rows replaced or covered by a
participation (Main subtracts them, the ERP does not), E1, and the **residual** = 0to8-account B + C − Main royalties.
"Carve credit" = what the Main carve groups credit to the owner's nicknames / what the ERP carve participations give.
The settlement participant (7c6a567e) is not named (the pseudonym carries a person's name).

| # | Owner | Stage name | Main balance | ERP payable | Diff | First cause (amount) | Next causes | Residual | Carve credit Main / ERP |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 68583cad | LDRR | -63,983.08 | -326,645.18 | -262,662.10 | settlement legacy row before 2026-02 (E1) -137,982.02 | B17 holder is a separate owner (Main publishing income) -127,161.70; RESIDUAL master earned vs Main income 5,022.14 | 5,022.14 | 0.00 / 0.00 |
| 2 | 7c6a567e | settlement participant | 1,271.49 | 139,847.50 | 138,576.01 | settlement legacy row before 2026-02 (E1) 137,982.02 | RESIDUAL master earned vs Main income 593.99 | 593.99 | 0.00 / 0.00 |
| 3 | 9670a62d | RD12 | 1,874.27 | -104,573.15 | -106,447.42 | B17 holder is a separate owner (Main publishing income) -99,802.46 | split unconfirmed (C split_unconfirmed) -5,855.44; RESIDUAL master earned vs Main income -789.52 | -789.52 | 0.00 / 0.00 |
| 4 | 14b5366d | UdieNnx | 34,455.81 | -63,726.49 | -98,182.30 | B17 holder is a separate owner (Main publishing income) -80,423.08 | RESIDUAL master earned vs Main income -19,224.58; carve row replaced or covered by a participation (E2) 1,465.74 | -19,224.58 | 0.00 / 0.00 |
| 5 | 0637477b | DJ DYLANFK | -12,838.64 | -110,784.68 | -97,946.04 | B17 holder is a separate owner (Main publishing income) -108,144.12 | carve row replaced or covered by a participation (E2) 31,156.39; RESIDUAL master earned vs Main income -20,197.02 | -20,197.02 | 0.00 / 0.00 |
| 6 | aba9837e | MC CODE (+7) | 5,431.50 | -88,183.86 | -93,615.36 | RESIDUAL master earned vs Main income -89,368.99 | assumption (C) -3,608.09; B17 holder is a separate owner (Main publishing income) -633.59 | -89,368.99 | 115,807.79 / 3,608.09 |
| 7 | 6d814d51 | DJ-JY12 | 1,088.10 | -80,174.52 | -81,262.62 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -67,885.32 | B17 holder is a separate owner (Main publishing income) -13,410.97; RESIDUAL master earned vs Main income 33.67 | 33.67 | 0.00 / 0.00 |
| 8 | bcf3c25f | Lxzt | -40,443.80 | 12,593.66 | 53,037.46 | buy-out price or fee kept as a document (M47/M20) 50,000.00 | RESIDUAL master earned vs Main income 3,451.68; B17 holder is a separate owner (Main publishing income) -414.22 | 3,451.68 | 0.00 / 0.00 |
| 9 | 3fecfb7a | DJ MH | 3,672.76 | -48,464.68 | -52,137.44 | B17 holder is a separate owner (Main publishing income) -27,926.34 | RESIDUAL master earned vs Main income -24,394.98; carve row replaced or covered by a participation (E2) 200.12 | -24,394.98 | 0.00 / 0.00 |
| 10 | 9272ef5f | qaraqshy | -23,114.87 | 26,768.63 | 49,883.50 | advance not yet recouped (scope any) 25,400.73 | buy-out price or fee kept as a document (M47/M20) 17,500.00; advance scope publishing, no publishing B to recoup from 10,000.00 | -2,972.33 | 0.00 / 0.00 |
| 11 | 4e37a283 | Zachz Winner | 15,932.93 | -28,497.88 | -44,430.81 | B17 holder is a separate owner (Main publishing income) -65,676.26 | RESIDUAL master earned vs Main income 21,353.95; split unconfirmed (C split_unconfirmed) -108.50 | 21,353.95 | 0.00 / 0.00 |
| 12 | 1b2a7fdf | SXLLX | 7,322.95 | 50,629.55 | 43,306.60 | Echo8 account income (Main: Echo8 sheet) 43,167.77 | ads (M21) 141.81; RESIDUAL master earned vs Main income -2.97 | -2.97 | 0.00 / 0.00 |
| 13 | b4a0fa90 | DJ RIO | 117,399.05 | 81,866.67 | -35,532.38 | B17 holder is a separate owner (Main publishing income) -35,497.69 | split unconfirmed (C split_unconfirmed) -81.64; RESIDUAL master earned vs Main income 46.95 | 46.95 | 0.00 / 0.00 |
| 14 | 3e3c52e6 | DJ SILVER ZN | 33,555.15 | 0.00 | -33,555.15 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -18,417.29 | B17 holder is a separate owner (Main publishing income) -12,694.50; RESIDUAL master earned vs Main income -8,457.61 | -8,457.61 | 0.00 / 0.00 |
| 15 | e2d3baf4 | DJ Ikeraus | -60,142.44 | -27,422.99 | 32,719.45 | buy-out price or fee kept as a document (M47/M20) 50,000.00 | RESIDUAL master earned vs Main income -15,034.41; split unconfirmed (C split_unconfirmed) -2,024.06 | -15,034.41 | 0.00 / 0.00 |
| 16 | 6c858647 | MXZHPHXNK | -20,814.65 | 10,275.32 | 31,089.97 | buy-out price or fee kept as a document (M47/M20) 27,500.00 | RESIDUAL master earned vs Main income 3,589.97 | 3,589.97 | 0.00 / 0.00 |
| 17 | d298b341 | !Nxght | 3,903.37 | -24,870.43 | -28,773.80 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -26,475.53 | RESIDUAL master earned vs Main income -2,298.27 | -2,298.27 | 0.00 / 0.00 |
| 18 | 003e2a60 | Sayfalse manager | 233.01 | -26,056.43 | -26,289.44 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -26,220.88 | B17 holder is a separate owner (Main publishing income) -78.97; RESIDUAL master earned vs Main income 10.41 | 10.41 | 0.00 / 0.00 |
| 19 | a4da9ccf | DJ ZENITE | -37,265.10 | -11,115.89 | 26,149.21 | buy-out price or fee kept as a document (M47/M20) 40,000.00 | RESIDUAL master earned vs Main income -13,741.85; split unconfirmed (C split_unconfirmed) -1,017.27 | -13,741.85 | 0.00 / 0.00 |
| 20 | 35a33bf3 | CRXSHXL | 3,179.62 | -21,810.13 | -24,989.75 | B17 holder is a separate owner (Main publishing income) -17,734.36 | RESIDUAL master earned vs Main income -7,255.39 | -7,255.39 | 0.00 / 0.00 |
| 21 | b5b6ded2 | DJ ZRED DA DZ7 | 62,887.97 | 40,926.25 | -21,961.72 | B17 holder is a separate owner (Main publishing income) -14,423.98 | RESIDUAL master earned vs Main income -5,836.59; split unconfirmed (C split_unconfirmed) -2,890.42 | -5,836.59 | 0.00 / 0.00 |
| 22 | bd3bd138 | PXLWYSE | 332.65 | -19,947.94 | -20,280.59 | split unconfirmed (C split_unconfirmed) -11,371.68 | B17 holder is a separate owner (Main publishing income) -8,908.94 | 0.03 | 0.00 / 0.00 |
| 23 | 8e9a3688 | MGD | 21,810.23 | 1,664.32 | -20,145.91 | B17 holder is a separate owner (Main publishing income) -14,013.38 | RESIDUAL master earned vs Main income -6,085.83; split unconfirmed (C split_unconfirmed) -46.69 | -6,085.83 | 0.00 / 0.00 |
| 24 | bf88a3a7 | DJ VICTOR ZL | 19,973.71 | 0.00 | -19,973.71 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -13,092.89 | RESIDUAL master earned vs Main income -5,994.82; split unconfirmed (C split_unconfirmed) -886.00 | -5,994.82 | 0.00 / 0.00 |
| 25 | 2c15025a | DJ KCH | 17,960.96 | 0.00 | -17,960.96 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -14,938.17 | B17 holder is a separate owner (Main publishing income) -3,022.58; split unconfirmed (C split_unconfirmed) -1.17 | 0.96 | 0.00 / 0.00 |
| 26 | 866cb91f | DJ ROBE | -16,912.56 | 935.98 | 17,848.54 | buy-out price or fee kept as a document (M47/M20) 20,000.00 | RESIDUAL master earned vs Main income -2,579.92; Echo8 account income (Main: Echo8 sheet) 428.45 | -2,579.92 | 0.00 / 0.00 |
| 27 | 9e0f799e | DJ LKS DA ZS (+2) | 519.40 | -16,996.76 | -17,516.16 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -10,720.71 | RESIDUAL master earned vs Main income -6,775.13; split unconfirmed (C split_unconfirmed) -20.32 | -6,775.13 | 0.00 / 0.00 |
| 28 | 30eb90ea | Gaiyu | 2,565.86 | -14,767.54 | -17,333.40 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -17,023.29 | B17 holder is a separate owner (Main publishing income) -999.63; RESIDUAL master earned vs Main income 689.80 | 689.80 | 0.00 / 0.00 |
| 29 | 61d7aca8 | PEK | 479.82 | -16,796.96 | -17,276.78 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -12,453.05 | B17 holder is a separate owner (Main publishing income) -4,823.18; split unconfirmed (C split_unconfirmed) -1.20 | 0.64 | 0.00 / 0.00 |
| 30 | 1b61e3e5 | hwungii | 17,929.63 | 1,144.00 | -16,785.63 | B17 holder is a separate owner (Main publishing income) -11,168.52 | RESIDUAL master earned vs Main income -5,607.54; split unconfirmed (C split_unconfirmed) -34.41 | -5,607.54 | 0.00 / 0.00 |
| 31 | ccfdca6f | MC BM OFICIAL | 1,295.48 | -15,085.98 | -16,381.46 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -21,631.35 | RESIDUAL master earned vs Main income 5,279.50; split unconfirmed (C split_unconfirmed) -29.61 | 5,279.50 | 0.00 / 0.00 |
| 32 | dd63655a | DJ JEEAN 011 | -14,553.56 | 1,316.83 | 15,870.39 | buy-out price or fee kept as a document (M47/M20) 16,000.00 | RESIDUAL master earned vs Main income -129.61 | -129.61 | 0.00 / 0.00 |
| 33 | 20cce5c0 | THEREEZAA | 283.90 | -13,439.24 | -13,723.14 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -9,017.77 | B17 holder is a separate owner (Main publishing income) -4,575.08; split unconfirmed (C split_unconfirmed) -134.39 | 4.09 | 0.00 / 0.00 |
| 34 | 7f12aeaf | sekairotten | -12,486.17 | 0.00 | 12,486.17 | advance not yet recouped (scope any) 12,500.00 | split unconfirmed (C split_unconfirmed) -13.83 | 0.00 | 0.00 / 0.00 |
| 35 | cfbe9e68 | Scythermane | 256.32 | -11,588.89 | -11,845.21 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -13,901.32 | advance not yet recouped (scope any) 2,000.00; RESIDUAL master earned vs Main income 209.76 | 209.76 | 0.00 / 0.00 |
| 36 | 1345d4a8 | H7H | 11,471.78 | 0.00 | -11,471.78 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -6,754.73 | B17 holder is a separate owner (Main publishing income) -4,717.87 | 0.82 | 0.00 / 0.00 |
| 37 | 5bbbb12e | RSFI | 1,622.05 | -9,655.49 | -11,277.54 | split unconfirmed (C split_unconfirmed) -9,260.50 | RESIDUAL master earned vs Main income -2,017.04 | -2,017.04 | 0.00 / 0.00 |
| 38 | 5dbc0383 | DJ FANGZ | -1,723.58 | -12,339.47 | -10,615.89 | unconfirmed owner, no contract in the index (C owner_unconfirmed) -10,675.20 | RESIDUAL master earned vs Main income -6,275.25; carve row replaced or covered by a participation (E2) 3,801.73 | -6,275.25 | 0.00 / 0.00 |
| 39 | 28b3b646 | Burnedsam (+1) | 8,862.78 | -1,584.10 | -10,446.88 | B17 holder is a separate owner (Main publishing income) -10,436.30 | RESIDUAL master earned vs Main income -10.58 | -10.58 | 0.00 / 0.00 |
| 40 | 0db102c6 | KXZINVK | -1,827.89 | 8,467.77 | 10,295.66 | buy-out price or fee kept as a document (M47/M20) 13,000.00 | RESIDUAL master earned vs Main income -2,702.53; B17 holder is a separate owner (Main publishing income) -1.81 | -2,702.53 | 0.00 / 0.00 |

First cause over all 802 differing owners (largest component, run 2):

| First cause | Owners | Σ\|diff\| |
|---|---|---|
| B17 holder is a separate owner (Main publishing income) | 62 | 663,456.40 |
| unconfirmed owner, no contract in the index (C owner_unconfirmed) | 481 | 588,360.69 |
| settlement legacy row before 2026-02 (E1) | 2 | 401,238.11 |
| buy-out price or fee kept as a document (M47/M20) | 16 | 219,379.80 |
| RESIDUAL master earned vs Main income | 70 | 162,804.83 |
| advance not yet recouped (scope any) | 35 | 135,667.44 |
| split unconfirmed (C split_unconfirmed) | 114 | 53,104.64 |
| Echo8 account income (Main: Echo8 sheet) | 5 | 51,879.18 |
| advance scope publishing, no publishing B to recoup from | 9 | 32,185.29 |
| carve row replaced or covered by a participation (E2) | 6 | 13,813.08 |
| ads (M21) | 2 | 715.64 |

Causes asked for and how they show: **B17 holder split** (B17 holders are separate owners: 855,819.32 of Main publishing
income); **unconfirmed owner, no contract in the index** (C `owner_unconfirmed` 559,424.64 on 481 owners as first
cause); **split unconfirmed** (78,528.94; 114 owners); **advance scope** (publishing scope with no publishing B
58,500.00 on 9+ owners; scope any still outstanding 156,162.36); **ads** (2,699.39 not loaded, 7 rows); **"ноу рекап"**
(17 owners carry such rows, 13 Income 7,076.82 and 4 Expense 54,205.06; no separate amount at all-time level: the
holiday is timing, the ERP recoups when income allows; 4 of them still have an advance outstanding, 32,668.89 in
the advance lines); **carve pairs** (Main credits 162,851.52 to the participants; the ERP gives 4,967.80 in C, see
E2; the payers now keep 101,552.83 that Main deducted); **held payouts** (25,764.11 not loaded in run 1, loaded by
D-135 in run 2; 4,010.83 of it on a matched owner, MC JHonny); **Echo8 ambiguous names** (DJ VETA3, DSHZS, MC FLYXO:
not matched, outside the 992; Expense 28,402.51, Income 45,375.17); **M44** (the "ноу рекап" rows above).

### 4.3 Explained and unexplained owners

An owner's difference is **explained** when, after the named components, the residual (0to8-account master B + C −
Main royalties, plus a fee kept as a document) is at most max(1.00, 2 % of the owner's Main income or difference).

| Tolerance | Explained | Not explained | Σ\|residual\| not explained |
|---|---|---|---|
| max(1.00, 2 %) | 633 | 169 | 430,254.18 (Σ −276,347.84: ERP higher on 88, lower on 81) |
| 1.00 | 503 | 299 | 455,410.70 |

The 169 by size: above 10,000: 8; 1,000–10,000: 54; 100–1,000: 32; below 100: 75. What they are (stage 6 work):
- **Carve participants and payers** (MC CODE owner −89,368.99 with Main carve credits 115,807.79; MC Fera owner, MC
  Denny, Mc Gw, MC Toy, MC Da 12, MC RP VK, REMIXED; payers DJ DYLANFK, WXCHSXN, heapper, Lost Label LLC, DJ
  Raulipues, Tsk.4): E2 and the 24 carve groups without a percent; closes when the carves reproduce the Main history.
- **ERP below Main in every month, decreasing over time** (DJ MH, median ERP/Main 0.79; DJ Ikeraus 0.93; DJ ZENITE
  0.87; DJ SILVER ZN 0.85; CRXSHXL; DJ LKS DA ZS 0.61; DJ VICTOR ZL 0.75; DJ ZRED DA DZ7 0.96; DJ Raulipues 0.93;
  heapper 0.94; Lost Label LLC 0.93; TrongKien 0.65): the registered rows of these owners' ISRC pay less than Main
  practice (several MC rows on the same ISRC, buy-outs of 2025-12): a per-ISRC check against their schedules.
- **Single Main months without a report counterpart** (DJ DYLANFK 2025-10 −16,500; MGD 2025-08 −5,011; hwungii
  2025-08 −4,667; DJ FANGZ 2026-08 −3,823; DJ JBK, SoulFusi, HXVSAGE: Main rows without a report month): manual Main
  income rows; report only unless a document is found.
- **ERP above Main** (Zachz Winner +21,353.95 in 2025-05…12: 21,225.40 of it is UPC 3617396033894 in 2025-05…12,
  the second UPC registered by D-135, which Main did not pay (Main pays it from 2026-01); a reference error, the
  artist is owed it (stage 7 product verdict §3); MC BM OFICIAL +5,279.50 in 2024-08…2025-02; Lyke +6,401.60 in months Main paid nothing; MC ROBA CENA
  +4,218.72): Main underpaid or paid another nickname; check per ISRC.

The full list (owner prefix, stage name, residual), largest first:

| Owner, stage name, residual | | | |
|---|---|---|---|
| aba9837e MC CODE -89,368.99 | 3fecfb7a DJ MH -24,394.98 | 4e37a283 Zachz Winner 21,353.95 | 0637477b DJ DYLANFK -20,197.02 |
| 14b5366d UdieNnx -19,224.58 | e2d3baf4 DJ Ikeraus -15,034.41 | a4da9ccf DJ ZENITE -13,741.85 | 657b16ca DJ Raulipues -13,503.70 |
| 3e3c52e6 DJ SILVER ZN -8,457.61 | 766bcd41 heapper -8,243.31 | 35a33bf3 CRXSHXL -7,255.39 | 7ccd56f8 Lost Label LLC -6,865.85 |
| 9e0f799e DJ LKS DA ZS -6,775.13 | aaa3431e DJ JBK -6,588.88 | fefe103a Matra! -6,428.99 | 3c1ac9d2 Lyke 6,401.60 |
| 5dbc0383 DJ FANGZ -6,275.25 | a2d4e8d2 SoulFusi -6,173.43 | 8e9a3688 MGD -6,085.83 | bf88a3a7 DJ VICTOR ZL -5,994.82 |
| b5b6ded2 DJ ZRED DA DZ7 -5,836.59 | ccfdca6f MC BM OFICIAL 5,279.50 | 9fe1b92a TrongKien -4,939.13 | 3376aee2 HXVSAGE 4,774.61 |
| b95661fb UMBRELLA -4,694.88 | 528041ab MC ROBA CENA 4,218.72 | 075ff14b WXCHSXN -4,022.51 | 86544aff MC JHonny -4,009.75 |
| 6c858647 MXZHPHXNK 3,589.97 | bcf3c25f Lxzt 3,451.68 | dc286fd0 MC Fera -3,418.50 | f554d00d DJ FZ DA ZN -3,257.02 |
| a2beaa95 ßino 3,202.15 | d60c00c4 MC Denny -3,142.89 | f2499059 MC Toy -3,132.63 | 9272ef5f qaraqshy -2,972.33 |
| 033fce27 DJ Papagaio -2,859.80 | e2b6a4f2 Roga. 2,768.86 | 0db102c6 KXZINVK -2,702.53 | 9970000e SXDNAY 2,640.54 |
| 47dbabe2 RXTVATE -2,629.47 | 09a31eb0 DJ ALEX -2,625.02 | 56b6fa9c DJ PR4 2,600.50 | 866cb91f DJ ROBE -2,579.92 |
| 1253f57e (nickname withheld) 2,385.94 | 0ac2e78d (nickname withheld: settlement family) 2,309.29 | d298b341 !Nxght -2,298.27 | c58e0b04 DJ Zynx -2,280.17 |
| d640e03d SASORIIXPP -2,125.28 | 5bbbb12e RSFI -2,017.04 | 94de64dd DJ VTTT77 -2,009.10 | 2619b97b springs! 1,895.36 |
| 57a80597 ZNVUTY -1,775.93 | 86e28011 Tsk.4 -1,670.09 | e1d5cdac SCRXXCH 1,506.76 | d3bb192a maxwell4k 1,486.61 |
| c71794e7 DJ PORTU -1,393.76 | 55481e06 DJ TUUV -1,307.68 | fff1f045 gala_prod -1,261.37 | 354553b6 maximum_madness -1,133.89 |
| 34e81760 gunbaou -1,027.18 | 89ea28cd DJ RUSSO ORIGINAL -1,006.92 | d5bf089e DJ FELD -917.95 | f83010c6 Manlikefdot -903.04 |
| 7f0d646b Mc M4 780.91 | e23a94ef MC Da 12 -772.12 | a0462d1d DJ JUN01 -770.15 | acf733fb DJ DANIELFK 693.36 |
| 30eb90ea Gaiyu 689.80 | e0c1b05b Prblmsss -650.03 | 85f30f22 viralune 629.18 | 8587b914 prodbydxm -584.48 |
| e4d88916 KIXIA 553.30 | 5c67c700 DJ VRK 550.34 | 6b999eda DJ DASIK -539.88 | 576bcaa1 DJ Funks -430.67 |
| d628b53d Dj Samir 429.09 | e93b64f3 cape 388.10 | 3d9a7716 MC Alexandre Fabuloso -378.39 | d24d31ec auxmit☆ -336.84 |
| 97bfc48c Habazane 332.06 | f9b95a0b MC RP VK -294.43 | ce2d4e45 launch13 252.73 | 062ebfed neko boku -240.21 |
| 950a3bb9 MC LOCKED -211.08 | 27f29d36 DJ SK3 013 -182.98 | 396a10e2 Dj RxdDxath -182.96 | 228feabe ZYNX -164.59 |
| f8fed559 DJ M-A 158.19 | 6a80e64c DJ MRCL -145.10 | ff1d32bc GAVORN 137.06 | bc455d85 MC HENRY 112.69 |
| 100d97ad JXXR -109.60 | 3a2b7d8c NISVANIS -109.47 | 2e38b66f xpominki 99.97 | 027057ae ROROPHXNK -95.67 |
| 5dbc00e9 Santa City 93.98 | a805e7df TRVNSPORTER 92.64 | ad62d5ac DJ FDK -90.44 | 59bdd6e2 DJ ZUKA TAU 87.18 |
| 64baa5c6 Skorde 77.12 | 4fdaa503 CREESHH -70.83 | b7cd8712 Cruzt -70.82 | c90da57b STXNIX 67.38 |
| 34412623 DJ ILOVECARSVFX -60.69 | 7b5f4f51 yamisxxq -60.35 | 5dbb638f zxcars -60.34 | 0e04bddc DJ RAY 07 57.72 |
| d3bb7c3d DJ RGLX 47.81 | e91cd931 MC MN 44.77 | cbd51b62 yeil 44.52 | 14804c46 Dexhenry 40.56 |
| 0956f205 Slowzz 39.19 | 7ddab498 DJ LE4K 36.42 | f513b1fa DJ PLT 011 36.20 | 0171e3bf DJ Lira da ZL 35.08 |
| 323d1be4 DJ NAOMI 31.69 | af79d052 BLXXDRIDE -31.30 | c52b767b Dyolow 30.44 | 84e87d4a DJ Javi26 27.97 |
| 41ccf187 ZZXWNCH 26.17 | 42b13e8c DXN CHVLX 25.94 | 7850cff3 Ibxrr -25.37 | 5194c2b2 WXRTNAX 23.10 |
| 8824b4f7 DJ FLG 23.05 | 458d1a97 JXM 22.93 | ba45d2ac SVPPHXRE -21.16 | 4bc4c4a7 Dj Funk dlam 20.58 |
| 9db2e6af cutemain 19.89 | 073d929c Purpose 115 17.82 | 2075eccc DJ OREKI -17.23 | cdbb00d4 TXLMANE 15.07 |
| c9b637c9 DYNAMIS 15.03 | c89b141f SXID -14.96 | 8f0c46bc DJ Ritmo55 13.74 | 8e683557 DJ gato 011 12.98 |
| d2798dd3 Jovias 12.51 | a2fb1930 DJ MZH 11.81 | 47ed3eae DJ Ameli 11.66 | 7dbecab5 DJ Saba 7 11.12 |
| 95e63eb7 DJ Jacob7 9.75 | 025b553c AXTGZ 9.18 | 26cf6ad7 ASXRA 9.02 | 86c5ddae Yeyzy. 8.00 |
| ab6a6e4c LXTTERIZE -7.44 | 3a68df61 DJ PLAGO 7.29 | e5a2c6e7 quinque -7.01 | 382fc8c0 DJ Frizer 5.82 |
| 441b757b DJ GZC 5.63 | 2d3ad316 DJ VIBER 5.58 | 5411dcd2 DJ BRZ 013 4.95 | df6fbb0e Tigmus 4.57 |
| 5b2d795a dxtype 4.00 | a53ea4cf zCris 3.83 | 13525a1e Nutoon 3.56 | 965c360d SMRAX 3.37 |
| 113d0be6 ArBon 3.01 | 0020bd6d stxrbøy 2.99 | 86c13711 слушай экзорцист 2.98 | fa030c35 DJ LER9 DA ZL 2.18 |
| ebe9c77e prodBigMike 2.08 | ac58159a Mwwlkiy 1.91 | 67f4b692 DJ SMW -1.88 | b88851cc SERGXM -1.88 |
| 25bf8a16 TXNJI 1.69 | c780117e FNYX 1.41 | 86ea9b04 Sxcr0se 1.25 | 269c7c2c Paizo 1.19 |
| 3187e516 K!LLV 1.04 |  |  |  |

## 5. Expected differences of plan stage 5: measured vs expected

| Expected (11 plan) | Expected amount | Measured | Note |
|---|---|---|---|
| Ahh Music: Annex deducts 25 % on 383 recordings | +27.5 k to ours (of 110 k) | −544.04 on the 1,287 `Ahh Music` cells (ERP share 65,616.53, Annex NLS 66,160.57); the `ahh_music` bucket +471.87 (24 cells, mostly a no-ISRC unit and the DJ VRK date) | the Annex "Monthly NLS" sheet already treats Ahh Music as 0to8; only Sch3C(i) shows the 25 % |
| Annex label 50 on FRX282644590 / 591 (owner decision 5) | −1,148.47 and −2,164.22 | −1,148.47 and −2,164.22 (Σ −3,312.69, 6 cells) | exact |
| Sleeping City Funk 45.8 → 50 | +1,819 | +1,774.45 (33 cells, 3 ISRC); MALAME −41.00 | within the months of the Annex period |
| M52 month start | ±13,363.21 by ISRC-month, net 0 | 32 cells, Σ 16.02 | the D-131 normalisation removed it |
| NoGhost before 2026-06 and the Q12 imprints (in C, Annex deducts 25 %) | in C | NoGhost before 2026-06: 4,840.35 in C assumption; Q12 imprints 0to8 account 470.44, Echo8 account 5,922.82 in C assumption; vs Annex: NoGhost −2,159.92, Q12 −345.72, 77 Records −13,149.96 (Annex NLS does not deduct 77) | 77 Records was not in the expected list: the Annex NLS keeps its label share whole |
| Q1 and Q5 rows in C | in C | **0** in C: FUNK DO SURPRISE licensor row (MC ROBA CENA 20 %) B 19,169.49; Lost Label rows on the 60 ISRC shared with DJ DYLANFK / DJ Raulipues B 270.31; only LUNAR MEDIA (Q1, D-135) is C 5,543.73 | **E3** |
| M44 recoup holidays (15 Main rows) | in the Main comparison | 17 rows (13 Income 7,076.82, 4 Expense 54,205.06) on 17 owners; no all-time amount of its own | timing only |

## 6. ERP errors found (for stage 6; nothing fixed here)

All four are data or loader errors: the layers compute what is stored. No layer error was found (the identity holds,
the Annex differences are all reference or data, the golden suite is green).

### E1. Settlement participant paid by a legacy split row before the settlement (137,982.02)

- Rule: owner decision 6 (owner answers J1 "participant_from 2026-02, no money before") and the settlement
  (`P37/3.11 Disputes`, Sch3A row 3): 15 % of net from the label share from 2026-02-27 (floored to 2026-02-01, M52);
  earlier uses were settled by the USD 100,000 lump, which belongs neither to the participant nor to the label as a
  rule. Fact of payment (map §6 exception): Main paid that 15 % to the artist LDRR before 2026-02 and charged the
  100,000 lump to LDRR (Main row 11936, 2026-03-13, loaded as a review payout on LDRR).
- ERP: on the 30 ISRC of the settlement the legacy split `2000-01-01 … 2026-02-01` still has the participant as a row
  (LDRR 35 + participant 15, or DJ Ikeraus 17.5 + participant 15 + LDRR 17.5); the loader removed the row only from
  2026-02. The participant earns 137,982.02 B before 2026-02 (unit net 919,880.16 × 15 %) plus 8,123.30 from the
  participation (Main 7,529.32). LDRR earns 137,982.02 less than Main.
- Expected: before 2026-02 the participant earns 0; the 15 % goes with the artist row (LDRR 50, or 32.5 where DJ
  Ikeraus has 17.5 until his buy-out), as Main paid; from 2026-02 unchanged. Payable: the participant −137,982.02,
  LDRR +137,982.02; the 100,000 stays charged to LDRR (as a payout or a deduction, the same balance effect).
- Golden case (data case of the settlement loader, hand-computed; the calculation is unchanged):

| # | Scenario (rules in force) | Expected allocations | B | C | ours | Case |
|---|---|---|---|---|---|---|
| G45 | settlement window: legacy registry rows A 35, S 15 valid 2000-01-01 … 2026-02-01; from 2026-02-01 row A 35 and participation S 15 `(net, label_share)` under the settlement document; the loader rewrites the legacy split for the months before the window (owner decision 6, Main payment fact); units 2026-01 and 2026-03 | 2026-01: A 50, S 0; 2026-03: A 35, S 15 taken from the label share 65 | 50 and 50 | 0 | 50 and 50 | M35, M33, owner decision 6 |

  Today the 2026-01 unit gives A 35, S 15 (same B and ours, wrong recipient).

### E2. D-135 carve participations: start month and base (Main moved 101,552.83, the ERP 4,967.80)

- Rule: plan 4.5 and D-123 (M13, M43): a Main "вычет доли" row is the ledger's form of a carve; where a participation
  replaces it, the participation must produce what the row moved, as of the rows' history. Main fact: each row is the
  cumulative amount booked in report month 2026-07 (dated 2026-10-07) on the paying artist, credited to the
  participant.
- ERP (D-135 `carves`): 336 participations `(bucket, artist_share of the source)` with the comment's percent, valid
  from 2026-07-01 (MC Denny's from 2026-08-01), under assumption documents; 55 deductions (101,552.83) deactivated.
  The participations give 4,967.80 (C assumption, 2026-07…08). Per row (`carve2.mts`): the "percent of net through
  2026-07" reading fits 6 of 55 Main amounts within 3 %, the "percent of the source row" reading fits none; e.g.
  rows 3660 and 18886 ("16.66 % (8.33 %/8.33 %) MC CODE & Mc Tigrão", UPC 3617667478720, 3 ISRC): Main 20,239.00 on
  each of DJ DYLANFK and WXCHSXN = 8.33 % of the release net through 2026-07 (net basis 20,235.88); the ERP gives
  MC CODE 203.94 from these participations.
- Effect: payers keep what Main deducted (DJ DYLANFK +31,156.39, WXCHSXN +23,696.91, heapper +16,551.97, Lost Label
  LLC +11,020.75, DJ Raulipues and others: Σ +101,552.83 against Main); participants miss the credits (the MC CODE
  owner: Main credits 115,807.79, ERP 3,608.09 in C).
- Expected: participations in force from the first report month of the release (so the 2026-07 history is
  reproduced), the percent converted to the source row when the comment states a percent of net (p_row = p_net ×
  100 / row percent / number of payers), or the deductions kept until the base of each group is read; the assumption
  documents stay (C) until the owner confirms.
- Golden case (hand-computed, current layers; the entry is the fix):

| # | Scenario (rules in force) | Expected allocations | B | C | ours | Case |
|---|---|---|---|---|---|---|
| G46 | rows A 25, B 25; Main carve "16.66 % (8.33 %/8.33 %) M1 & M2": each of A and B pays 8.33 % of net, each of M1, M2 gets 8.33 % of net; entered as participations M1 16.66 `(bucket, artist_share of A)`, M1 16.66 `(bucket, artist_share of B)`, M2 the same two, valid from the release's first month, approved documents | A 25 − 4.165 − 4.165 = 16.67; B 16.67; M1 4.165 + 4.165 = 8.33; M2 8.33 | 50 | 0 | 50 | M13, M43 |

  The D-135 entry (8.33 per source, from 2026-07) gives M1 2.0825 + 2.0825 = 4.165, A 20.835, and nothing before 2026-07.

### E3. Q1 and Q5 assumption documents not attached (19,169.49 + 270.31 in B instead of C)

- Rule: D-123 Q1 and Q5, 09 §5: a sample licensor row with the "less other participants" clause (FUNK DO SURPRISE;
  its envelope is not closed either) and the rows of a conflicting document (Lost Label against the DJ DYLANFK and DJ
  Raulipues schedules) carry a document of kind `assumption`, so their money is C `assumption`.
- ERP: FRX762590589…592 row MC ROBA CENA 20 % is B 19,169.49 (Annex Sch3A row 7 also says the payee is the licensor,
  not the artist); Lost Label LLC rows on the 60 ISRC it shares with DJ DYLANFK or DJ Raulipues are B 270.31;
  `split_shares.document_id` of kind `assumption`: 0 rows.
- Expected: C `assumption` 19,169.49 and 270.31 (B −19,439.80).
- Golden case: G10a (a row with its own `assumption` document → C) exists and is green; the fix is data only.

### E4. 38 splits with an empty period (hygiene, no money)

- Rule: D-130 refuses a period that is empty after flooring (`empty_period`).
- ERP: 38 splits (origin `manual`, legacy buy-outs) have `valid_to = valid_from` after `normalise-dates` (D-131), which
  wrote SQL directly and bypassed the facade check (e.g. FR96X2577362 2026-06-01 … 2026-06-01, the DJ ZENITE buy-out;
  DGA052431789 2026-10-01 … 2026-10-01, the LDRR buy-out to FZ). They are never in force, so no amount changes; the
  intermediate holder of a part-month is skipped, as M52 intends.
- Expected: no such rows (delete or merge them in the loader); no golden case (the facade rule is tested in
  `tests/participations.test.ts`, `tests/labels.test.ts`).

## 7. Performance (`LOG_TIMINGS=1`, real data: 47 Believe files, 721,975 units, 6 B17 statements, 1,162,586 B17 lines)

| Call | Total | calculate | ClickHouse units + parse | Reference data (of it: publishing snapshot, splits index) | Layers (master) | Publishing layers | Rest |
|---|---|---|---|---|---|---|---|
| `GET /owners/28b3b646…/balance` (51 operations), run 1 | 6.62 s | 6.47 s | 0.80 + 0.31 s | 1.33 s (1.05 s, 0.18 s) | 3.91 s | 0.12 s | ownerBalance 0.09 s |
| same, run 2 | 6.94 s | 6.75 s | 1.02 + 0.28 s | 1.35 s (1.08 s, 0.19 s) | 3.97 s | 0.13 s | ownerBalance 0.11 s |
| `GET /reconciliation?from=2024-01&to=2026-08`, run 1 (quiet) | 7.34 s | ≈ 6.4 s | 0.78 + 0.27 s | 1.32 s (1.07 s) | 3.88 s | 0.14 s | ≈ 0.9 s reconcile grouping and JSON |
| same, run 2 | 7.54–7.77 s | ≈ 6.7 s | 0.85 + 0.30 s | 1.33 s (1.06 s) | 3.93–4.27 s | 0.13 s | ≈ 0.9 s |

What dominates: the master layer chain in JS, 3.9–4.3 s (about 55 %). The B17 load shows in the reference data: the
publishing snapshot (`GROUP BY` of 1,162,586 lines into 8,660 aggregated lines) takes 1.05–1.08 s, the publishing
layers 0.12–0.14 s; against D-132 (balance 6.6 s, calculate 6.2 s, reference data 1.2 s with 4 statements) the two
new statements add about 0.1–0.2 s. Reconciliation has no root timing line of its own; its extra ≈ 0.9 s over
`calculate` is the per-month grouping and the response. The first reconciliation call (7.62 s) overlapped the test run.
Both calls are inside the 10 s budget of the plan.

## 8. Before / after the parallel data fixes (run 1 22:31 UTC, run 2 22:50 UTC)

| Headline | run 1 (before D-135) | run 2 (after D-135) | Change |
|---|---|---|---|
| Reconciliation rows 2024-01…2026-08 with discrepancy ≠ 0 | 0 of 52 | 0 of 52 | — |
| 1052428: B / C / ours | 6,710,253.48 / 889,957.87 / 7,680,582.07 | 6,743,236.57 / 748,978.81 / 7,788,578.04 | +32,983.09 / −140,979.06 / +107,995.97 |
| 1052428 C `unknown_pair` / `assumption` | 150,057.35 / 5,412.65 | 0.00 / 15,885.63 | pairs registered; LUNAR + carves in C |
| 1055956: B / C / ours | 53,363.50 / 330,354.64 / 667,226.96 | same | — |
| B17: B / C | 0.00 / 1,528,338.61 | 682,348.36 / 845,990.25 | 13 holders confirmed |
| Annex: cells within 0.01 (of 107,006) | 90,967 | 91,364 | +397 |
| Annex: receipts whose label share matches | 89.38 % | 92.37 % | +2.99 pp |
| Annex: Σ ERP label share − Σ Annex NLS | 453,909.23 | 411,847.85 | −42,061.38 |
| Annex: `other` cells / Σ\|diff\| | 918 / 49,956.04 | 531 / 8,403.32 | second UPC fixed |
| Annex: `split_differs` Σ\|diff\| | 349,272.86 | 348,725.62 | Duetti perimeter remains |
| Main: Σ ERP B + C (matched owners) | 7,604,421.40 | 7,641,041.58 | +36,620.18 |
| Main: Σ ERP payable / Σ Main balance | −633,959.30 / 584,418.47 | −506,569.03 / 584,418.47 | +127,390.27 |
| Main: owners with \|diff\| > 1.00 (Σ\|diff\|) | 799 (2,413,555.53) | 802 (2,322,605.04) | +3 (−90,950.49) |
| Main: owners within 1.00 | 193 | 190 | −3 |
| Main: explained / not explained (2 % tolerance) | not computed on run 1 | 633 / 169 | — |

The payable moved up mostly by E2 (the 101,552.83 of carve deductions no longer charged) and by the second-UPC pairs
(B +32,983.09); three more owners differ because of E2 (payers above Main) and the held payout loaded on MC JHonny.

## 9. After the stage 6 fixes (D-137)

Stage 6 rework, 2026-11-03, on the dev database `erp` (no other writer). Loader steps through the facade, each run as
dry run, `--apply`, idempotent dry run (logs `data/mvp-load/log/{settlement-prestart,carves,assumption-rows,hygiene}-*`):
`settlement-prestart` (E1), `carves` reworked (E2), `assumption-rows` (E3), `hygiene` (E4); `normalise-dates` now
refuses an empty period. "Before" is the state of run 2 (§0 … §8), re-measured at the start of the rework with the
same scripts and identical to run 2; "after" is the end state. Compares re-run: `compare-annex.ts`,
`compare-main.ts` (reports in `data/mvp-load/verify/`), `GET /reconciliation?from=2024-01&to=2026-08` on port 3012
(stopped afterwards), the stage 5 owner decomposition (`owner_dump.mts` + `decomp.py`, extended as said in 9.3).
Scripts and raw output: `/private/tmp/claude-501/-Users-nearlydeadhipo-Desktop-0to8-ERP/441975a6-0f8b-4dbd-b984-d2856fc5b0b0/scratchpad/stage6/`
(`before/`, `after/`, `measure.mts`, `carve_take.mts`, `decomp2.py`, `short.mts`).

### 9.1 Headline before / after

| Headline | Before (run 2) | After (D-137) | Change |
|---|---|---|---|
| Reconciliation rows 2024-01…2026-08 with discrepancy ≠ 0 | 0 of 52 | 0 of 52 (`fileDiscrepancy` 0 on all 45 Believe rows) | — |
| 1052428: B / C / ours | 6,743,236.57 / 748,978.81 / 7,788,578.04 | 6,622,334.45 / 869,880.94 / 7,788,578.04 | −120,902.12 / +120,902.13 / 0 |
| 1055956: B / C / ours | 53,363.50 / 330,354.64 / 667,226.96 | same | — |
| B17: B / C / ours | 682,348.36 / 845,990.25 / 968,243.31 | same | — |
| Annex: cells within 0.01 (of 107,006) | 91,364 | 91,364 | — |
| Annex: receipts whose label share matches | 92.37 % | 92.37 % | — |
| Annex: Σ ERP label share − Σ Annex NLS | 411,847.85 | 411,847.85 | — |
| Main: Σ ERP B / C (matched owners) | 6,777,300.50 / 863,741.07 | 6,656,398.37 / 984,739.93 | −120,902.13 / +120,998.86 |
| Main: Σ ERP payable / Σ Main balance | −506,569.03 / 584,418.47 | −627,471.16 / 584,418.47 | −120,902.13 |
| Main: owners with \|diff\| > 1.00 (Σ\|diff\|) | 802 (2,322,605.04) | 802 (2,124,352.00) | 0 (−198,253.04) |
| Main: owners within 1.00 | 190 | 190 | — |
| Main: explained / not explained, max(1.00, 2 %) (Σ\|residual\| not explained) | 633 / 169 (430,254.18) | 640 / 162 (346,014.05) | +7 (−84,240.13) |
| Main: explained / not explained, 1.00 | 503 / 299 (455,410.70) | 513 / 289 (373,414.03) | +10 (−81,996.67) |
| Golden suite | 32 files, 356 tests | 32 files, 360 tests (G45, G46 ×2, hygiene) | +4 |

The Annex numbers do not move, as expected: none of the four fixes changes a label share (E1 moves the 15 % between
two rows, E2's pool participations are funded by the artist rows, E3 changes only the category, E4 removes splits
that were never in force). The ours of every account is unchanged to the cent; what moves is B ↔ C and B between
owners.

C breakdown after (before in brackets):

| Reason | 1052428 | 1055956 | b17 |
|---|---|---|---|
| owner_unconfirmed | 591,391.69 (592,602.73) | 2,770.16 | 520,584.25 |
| split_unconfirmed | 133,582.80 (133,856.56) | 320,636.21 | |
| publishing_terms_unconfirmed | | | 325,405.99 |
| assumption | 138,272.57 (15,885.63) | 5,922.83 | |
| artist_without_owner | 4,360.20 | 936.43 | |
| no_isrc | 2,273.68 | 89.00 | |
| unknown_pair | 0.00 | | |
| **C total** | 869,880.94 (748,978.81) | 330,354.64 | 845,990.25 |

The assumption C of 1052428 after: Main carve participations 107,914.94 (was 4,967.80), Q1 licensor row 19,169.49,
LUNAR MEDIA 5,543.73, sublabel halves 5,374.09, Q5 Lost Label rows 270.31 (Σ 138,272.56; 0.01 rounding). The
owner_unconfirmed and split_unconfirmed C fall by 1,211.04 and 273.76 because the pool carves take pro rata from
rows in those categories too (that money moves to the carve participants, C assumption).

### 9.2 Effect of each fix

**E1 (step `settlement-prestart`).** 38 splits changed on the 30 settlement ISRC: from the ISRC's first report month
(2024-04 … 2024-09) to 2026-02-01 the participant's row is removed and its 15 % added to the LDRR row (35 → 50,
17.5 → 32.5 while DJ Ikeraus holds 17.5 and in his buy-out period of 2025-12, 14 → 29 on the four DGA0L ISRC), under
the approved document of kind `other` "Owner decision 6 of 2026-11-02: settlement share before 2026-02-27"; the other
rows keep their documents; the window from 2026-02-01 (participation 15 % `(net, label_share)`) is unchanged. The
participant's legacy row remains only in the months before the first report (no money).

| | Before | After | Change |
|---|---|---|---|
| Settlement participant (owner 7c6a567e): B before 2026-02 | 137,982.02 | 0.00 | −137,982.02 |
| Settlement participant: payable / diff to Main | 139,847.50 / 138,576.01 | 1,865.47 / 593.98 | −137,982.03 |
| LDRR (owner 68583cad): payable / diff to Main | −326,645.18 / −262,662.10 | −188,663.15 / −124,680.07 | +137,982.03 |

The participant's remaining difference 593.98 is the participation from 2026-02 (ERP 8,123.30, Main 7,529.32);
LDRR's is the B17 holder (−127,161.70) and its residual 5,022.15. The 100,000 lump stays charged to LDRR.

**E2 (step `carves` reworked).** The 336 D-135 participations `(bucket, artist_share of the source)` from 2026-07
(origin `mvp:carve`, note `mvp:carve:<participant>:<upc>:<source>:<isrc>`) were deleted by id through the splits
module (repository delete of loader-owned rows; the log names the count and the marker) and replaced in the same
transaction by 141 participations `(net, artist_pool)`, one per participant and ISRC of the UPC, percent of net per
participant as the comment states (8.33 each for "16.66 % (8.33 %/8.33 %)", 6.25 each for "12.5 % (6.25 % each)"),
from the first report month of each ISRC, open-ended, under the same 29 assumption documents (note
`mvp:carve2:<participant>:<isrc>`). MC Denny's 13 % on the three Sleeping City Funk ISRC is already a pool
participation of the Annex step (D-131, B) and is kept; no second one is created. The 55 deactivated carve
deductions (101,552.83) stay deactivated, the three held payouts (25,764.11) stay active; 24 groups without a
stated percent stay deductions.

Carved amount: 4,967.80 → 107,914.94 (all months, C assumption). Per group against Main (Main's row amount is the
cumulative booking up to its report month, 2026-07; MC Denny 2026-08):

| Group (title, participants, percent) | Main | ERP up to the Main month | Residual |
|---|---|---|---|
| 4 MONTAGEM LUNAR ESMERALDA, 2, 12 / 10 | 1,150.36 | 1,150.36 | 0.00 |
| 5 MELODIA DO ARGENTINO FUNK (Remixes), 1, 15 | 3,341.04 | 3,341.02 | −0.02 |
| 6 MONTAGEM LUNAR ESMERALDA (VERSIONS), 1, 10 | 7,152.92 | 7,152.91 | −0.01 |
| 7 MONTAGEM LUNAR ESMERALDA 2, 1, 10 | 78.99 | 649.06 | +570.07 |
| 8 Montagem Lunar Diamante, 2, 8.33 / 8.33 | 40,478.00 | 40,471.77 | −6.23 |
| 9 Montagem Lunar Diamante 2, 1, 10 | 6,294.88 | 6,294.05 | −0.83 |
| 10 Montagem Lunar Diamante 3, 1, 5 | 931.41 | 931.24 | −0.17 |
| 11 Montagem Lunar Esmeralda Meowsith, 1, 8 | 204.36 | 204.26 | −0.10 |
| 12 Montagem Lunar Esmeralda (Rkt Versions), 1, 8 | 287.37 | 287.37 | 0.00 |
| 13 Melodia Do Argentino Funk, 1, 8 | 307.50 | 307.49 | −0.01 |
| 14 Melodia Do Argentino Funk (Remixes), 1, 8 | 1,781.88 | 1,781.88 | 0.00 |
| 15 RZYIO, 1, 12 | 2,439.78 | 2,439.75 | −0.03 |
| 16 Montagem Lunar Espacial, 1, 7 | 262.71 | 262.71 | 0.00 |
| 17 RENICHT MIX VERSION FA3, 1, 18 | 2,369.92 | 1,316.61 | −1,053.31 |
| 18 Sleeping City Funk, 1, 13 (paid by the D-131 participation, B) | 11,405.19 | 0.00 | −11,405.19 |
| 22 MONTAGEM MACHUCAO, 1, 12 | 9.48 | 9.48 | 0.00 |
| 23 MONTAGEM CORE IZL, 1, 12 | 1,303.98 | 1,303.97 | −0.01 |
| 28 DJ MLK BOM 2.0, 1, 15 | 400.24 | 400.24 | 0.00 |
| 34 JOGA NO PULANDO, 1, 12 | 5.37 | 5.38 | +0.01 |
| 35 Montagem Direção Simétrica Meowsynth, 1, 15 | 1,307.20 | 1,307.21 | +0.01 |
| 39 MEOW MEOW, 1, 15 | 5,531.22 | 5,531.14 | −0.08 |
| 40 MONTAGEM VOZES TALENTINHO, 1, 10 | 22,041.50 | 22,038.97 | −2.53 |
| 41 NAIVE, 2, 6.25 / 6.25 | 976.36 | 3,090.90 | +2,114.54 |
| 42 FUNK SHENANIGANS, 1, 12 | 27.14 | 27.13 | −0.01 |
| 46 MONTAGEM RENITCH SEGREDO, 1, 15 | 1,981.02 | 1,981.03 | +0.01 |
| 47 HAZA II, 1, 20 | 977.56 | 977.56 | 0.00 |
| **Σ (26 groups with a percent)** | **113,047.38** | **103,263.51** | **−9,783.87** |

Without group 18 (never loaded as an operation, paid in B by the Annex participation): Main 101,642.19 (the 55
deactivated deductions 101,552.83 plus 89.36 of the two DJ VETA3 rows, not loaded), ERP 103,263.51, residual
+1,621.32. 20 groups agree within 1.00, two more within 0.03 % (8, 40). Four do not: **7** the comment names one
ISRC of the UPC ("оригинал"), the ERP carves every ISRC of the UPC; **17** the rows of UPC 3617667203773 are below
18 % on part of the units, the pool is short (469 `bucket_short` signals on 4 ISRC, 1,065.94; the shortfall is a
signal, not money, 10 §3); **41** "12.5 % shared, 6.25 % each" gives 3.2 times Main's amount (Main may have booked
one participant or one payer; owner question); **18** as said. Owners: the MC CODE owner's residual −89,368.99 →
−1,950.79 (its carve credit is now ERP C 91,026.29 against Main 115,807.79 credited in income); the payers now carry
the carve in their earned money as Main does in its expense (DJ DYLANFK −30,644, WXCHSXN −22,914, heapper, Lost Label
LLC, DJ Raulipues), so their diff no longer contains the +101,552.83 of §4.1. The MC Fera owner (8 nicknames, among
them three carve participants) now has a residual +10,430.87: Main credits those carves in a form the compare does
not see (627.47 as carve income), a stage 7 item.

**E3 (step `assumption-rows`).** 68 splits changed, same percents, row documents of kind `assumption`: 8 splits on
FRX762590589…592 (the MC ROBA CENA 20 % row, "Assumption Q1: licence base less other participants; envelope not
closed"), 60 splits on the 60 ISRC shared by the Lost Label rows and the DJ DYLANFK / DJ Raulipues rows ("Assumption
Q5: conflicting schedules (Lost Label vs direct artist schedules)"); each split from max(its `valid_from`, the ISRC's
first report month), so a legacy split keeps its record for the months without reports. Q1 B 19,169.49 → C
assumption 19,169.49; Q5 B 270.31 → C assumption 270.31 (B −19,439.80), as §6 expected.

**E4 (step `hygiene`).** 50 empty-period splits deleted (splits module `deleteEmptySplits`, repository SQL guarded by
`valid_to = valid_from`; logged per split): the 38 of §6 (notes `buyout #1` 30, `buyout #2` 4, `buyout #6` 4), 8 left
by E1 (the `buyout #14` splits of 2025-12-01 changed from their first day) and 4 by E3 (the `buyout #4` splits of
2026-05-01 of FRX762590589…592). Correction to §6 E4: they were not written by `normalise-dates`; the splits service
keeps a split replaced from its first day as the empty period `[d, d)` ("history is kept",
`migrations/postgres/0002_splits.sql`), and the loader steps that changed a split from its first day left them.
`normalise-dates` now refuses to write an empty period (`refused_empty_period`; a dry run after the fix reports
nothing to do). No amount changes.

### 9.3 Owner decomposition after the fixes

The stage 5 decomposition (`decomp.py`) hard-codes E1 (±137,982.02) and treats the payers' carve as residual, so
after the fixes it reports 628 / 174 (724,340.49). The numbers of 9.1 use it with two changes (`decomp2.py`): E1 is 0,
and a new component "carve participation taken from the rows (Main: deduction row)", −106,485.80 on 36 owners
(the pro rata take of the D-137 carve participations from the owner's split rows, account 1052428), is moved out of
the residual. Components after: B17 holder −855,819.44, C owner_unconfirmed −558,218.24, documents only +277,000.00,
master residual −170,364.74 (was −276,947.29), advances scope any +156,162.36, C assumption −127,354.73 (was
−4,967.79), carve rows replaced or covered +112,958.02, carve take −106,485.80, C split_unconfirmed −78,347.28, advances
scope publishing +58,500.00, Echo8 account B +53,363.50, deductions not recouped +19,017.11, ops mismatch +5,000.00,
ads +2,699.39. The 162 not explained: above 10,000: 8 (DJ MH −24,390.47, Zachz Winner +21,353.95, DJ DYLANFK
−19,462.64, UdieNnx −19,082.59, DJ Ikeraus −15,034.41, DJ ZENITE −13,741.85, DJ Raulipues −13,174.60, MC Fera
owner +10,430.87); 1,000–10,000: 53; 100–1,000: 30; below 100: 71; ERP higher on 90, lower on 72. E1 is no longer a
cause of any owner's difference.

## 10. Stage 7 closing: E1 pro rata (D-138)

2026-11-03, dev database `erp`, no other writer. The product verdict of the stage 7 council (`reviews/stage7_product.md`
finding 1) showed that Main paid the settlement participant's legacy 15 % before 2026-02 **pro rata to the co-artists**
(DJ Ikeraus and LDRR +7.5 each where both held 17.5; LDRR's monthly ERP − Main excess equals the pro rata candidate,
2024-06 to the cent), not all to LDRR as D-137 entered it. "Before" is the end state of §9; "after" the end state of
this rework. Loader: `load.ts settlement-prestart` (dry run, `--apply`, idempotent dry run), then `hygiene` (logs
`data/mvp-load/log/{settlement-prestart,hygiene}-2026-11-02T23-5*`). Compares: `compare-main.ts`, `compare-annex.ts`
(reports in `data/mvp-load/verify/`), `decompose-main.ts` (new, recipe 9), the reconciliation by
`facade.reconciliation({from: 2024-01, to: 2026-08})` (the same code as `GET /reconciliation`).

**The step.** On the 30 settlement ISRC the participant's percent in the ISRC's first legacy split (15) is spread over
that split's other rows pro rata to their percents: LDRR 35 → 50 where it is the only other row (unchanged); 17.5 /
17.5 → 25 / 25 (DJ Ikeraus, LDRR; 8 ISRC); 14 / 10.5 / 10.5 → 20 / 15 / 15 (LDRR, RD12, DJ MRCL; DGA0L2423523…526).
After the DJ Ikeraus buy-out of 2025-12 his row is 0 and takes nothing: LDRR keeps 25 and the bought-out 7.5 stays
with the label (the buy-out moved his whole row to the label). The D-137 splits (marker `mvp:settlement-prestart:`)
were re-entered from the same date under the same approved document "Owner decision 6 …" (marker
`mvp:settlement-prorata:<isrc>:<from>`): 20 changed (12 before the buy-out, 8 in the buy-out period); 18 single-row
splits already have the pro rata rows and keep their D-137 record; `hygiene` deleted the 20 replaced splits left as
empty periods. A second dry run: `already_done=12 already_pro_rata=18`; `hygiene` `already_done=1`. Golden case G47.

**The five totals, report months 2024-06 … 2026-01, the 30 settlement ISRC** (one read-only `calculate()`):

| Owner | Before (D-137) | After (D-138) | Change | Product verdict |
|---|---:|---:|---:|---:|
| DJ Ikeraus (e2d3baf4), B | 18,402.84 | 26,289.77 | +7,886.93 | +7,886.93 |
| RD12 (9670a62d), B | 318.66 | 455.22 | +136.56 | +136.57 |
| DJ MRCL (6a80e64c), C `owner_unconfirmed` | 318.66 | 455.22 | +136.56 | +136.57 |
| ours | 458,112.59 | 458,278.39 | +165.80 | +178.18 |
| LDRR (68583cad), B | 438,298.73 | 429,972.87 | −8,325.86 | −8,325.87 |
| settlement participant (7c6a567e) | 0 | 0 | 0 | 0 |

The changes sum to 0.00 (net 915,451.48 unchanged). Ours is 7.5 % of the net 2,210.58 of the 8 DJ Ikeraus ISRC in
2025-12 … 2026-01. The verdict's +178.18 is LDRR's whole reduction in those two months (86.83 + 91.35), which
includes the 12.38 that goes to RD12 and DJ MRCL on the four DGA0L ISRC; its five figures did not sum to zero by that
amount. The cent differences are rounding (the verdict summed rounded months).

**Headline before / after:**

| Headline | Before (§9) | After (D-138) | Change |
|---|---|---|---|
| Reconciliation rows with discrepancy ≠ 0 | 0 of 52 | 0 of 52 (`fileDiscrepancy` 0 on 45 Believe rows) | — |
| 1052428: B / C / ours | 6,622,334.45 / 869,880.94 / 7,788,578.04 | 6,622,032.09 / 870,017.51 / 7,788,743.83 | −302.36 / +136.57 / +165.79 |
| 1052428 C owner_unconfirmed | 591,391.69 | 591,528.25 | +136.56 (DJ MRCL) |
| 1055956, B17 | as §9 | same | — |
| Annex: cells within 0.01 (of 107,006) | 91,364 | 91,348 | −16 |
| Annex: receipts whose label share matches | 92.37 % (92.81 % without "no share") | 92.35 % (92.80 %) | −0.02 pp |
| Annex: Σ ERP label share − Σ Annex NLS | 411,847.85 | 412,013.64 | +165.79 |
| Main: Σ ERP B / C (matched owners) | 6,656,398.37 / 984,739.93 | 6,656,096.01 / 984,876.50 | −302.36 / +136.57 |
| Main: Σ ERP payable / Σ Main balance | −627,471.16 / 584,418.47 | −627,773.52 / 584,418.47 | −302.36 |
| Main: owners with \|diff\| > 1.00 (Σ\|diff\|) | 802 (2,124,352.00) | 802 (2,140,428.23) | 0 (+16,076.23) |
| Main: explained / not explained, max(1.00, 2 %) (Σ\|not explained\|) | 640 / 162 (346,014.05) | 641 / 161 (337,982.01) | +1 (−8,032.04) |
| Main: explained / not explained, 1.00 | 513 / 289 (373,414.03) | 513 / 289 (363,535.47) | 0 (−9,878.56) |
| Golden suite | 32 files, 360 tests | 32 files, 361 tests (G47) | +1 |

The 16 Annex cells are the 8 DJ Ikeraus buy-out ISRC in 2025-12 (cause `m52_month`, the buy-out dated 2025-12-16) and
2026-01 (`split_differs`): Annex keeps the label share at 67.5 % after the buy-out, the ERP now gives the label 75 %
(the bought-out 7.5 of the pro rata). Main's LDRR credit in those months is at the 25 % reading (verdict §3), so the
ERP follows Main, the payment fact; the 165.80 is listed for the owner (`15` §3). Σ|diff| of the Main compare grows
because LDRR's diff (−124,680.07 → −133,005.93, mostly its B17 holder) grows by more than DJ Ikeraus' falls; the
residuals, which are what the decomposition judges, fall: LDRR +5,022.15 → −3,303.71, DJ Ikeraus −15,034.41 →
−7,147.48, RD12 −789.52 → −652.95, DJ MRCL −145.10 → −8.53.

**Owner decomposition** (`npx tsx packages/backend/scripts/mvp/decompose-main.ts`, after `compare-main.ts`; the
same method as `decomp2.py` of §9.3 without the E1 constant, which is gone; on the same state both give the same
counts). Owners with |diff| > 1.00, Σ by cause (ERP − Main):

| Cause | Owners | Σ |
|---|---:|---:|
| B17 holder separate (ERP publishing B + C − Main publishing income) | 260 | −855,784.09 |
| C master owner_unconfirmed | 500 | −558,345.35 |
| Main expense not loaded: buy-out price / fee (document only) | 19 | 277,000.00 |
| **not explained: master earned (B + C) vs Main royalties** | 649 | −170,757.73 |
| advance unrecouped (scope any) | 48 | 156,162.36 |
| C master assumption | 6 | −127,354.74 |
| Main expense not loaded: carve row covered or replaced by a participation | 29 | 112,958.02 |
| carve participation taken from the rows (Main: a deduction row) | 34 | −106,485.79 |
| C master split_unconfirmed | 336 | −78,135.52 |
| advance unrecouped (scope publishing) | 13 | 58,500.00 |
| Echo8 account 1055956 B (Main keeps it on the Echo8 sheet) | 12 | 53,363.50 |
| deduction (carve row) unrecouped | 7 | 19,017.11 |
| **not explained: ops vs Main expense mismatch** | 1 | 5,000.00 |
| Main expense not loaded: ads | 7 | 2,699.39 |

Explained within max(1.00, 2 %): 641, not explained 161 (Σ 337,982.01; ≥ 10,000: 7, 1,000–10,000: 54, 100–1,000: 29,
below 100: 71; ERP higher on 90, lower on 71). Within 1.00: 513 / 289 (363,535.47). The seven above 10,000: DJ MH
−24,390.47, Zachz Winner +21,353.95, DJ DYLANFK −19,462.64, UdieNnx −19,082.59, DJ ZENITE −13,741.84, DJ Raulipues
−13,174.60, the MC Fera owner +10,430.87. DJ Ikeraus (−7,147.48) left that group. The product verdict §3 reads most of
them as Main practice against the owner's registry (Main paid the MC shares to the main artist and caught up later:
DJ MH, UdieNnx, DJ ZENITE, DJ Raulipues, DJ SILVER ZN, the MC Fera owner, MC Denny), Zachz Winner as Main's
underpayment of UPC 3617396033894 in 2025-05…12 (21,225.40, §4.3) and DJ DYLANFK as a single Main credit without a
report (16,325.00): reference differences, no ERP error.
