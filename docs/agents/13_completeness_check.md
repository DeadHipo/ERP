# 13. Completeness check (stage 7, map section 8)

Purpose: prove that every data element of every source falls into a catalogue case of `09_settlement_cases.md` (M1…M58), or is named as not covered, and that the money in C is explained reason by reason. Output of the nine read-only checks plus this consolidation. No legal names of people appear here: stage names, label names, ISRC, owner id prefixes and amounts only.

## 0. Method

- **Who.** Seven independent read-only checkers, none of whom wrote the code under check, on 2026-11-02 and 2026-11-03: contracts; report-processor; zero-erp; owner answers of 2026-11-02; Believe 0to8 + Echo8 with the ERP reference data; B17; Annex 14 beta with `0to8 Main.xlsx`. Each returned a table `data element -> catalogue case / not covered` plus a NOT COVERED list and a partial list. This file consolidates them; the long per-element tables stay in the checkers' reports (scratchpad of the stage 7 session) and are condensed here to one row per data element or per run of equal rows.
- **Read-only.** `SELECT` only on PostgreSQL `erp` and ClickHouse `believe.rows`; `calculate()` runs through a read-only snapshot. Nothing in `context_data`, `zero-erp` or `report-processor` was run or modified; personal data was not copied.
- **State of the database when measured.** Believe figures: PostgreSQL `erp` with 1,342 documents and 24,051 splits, after D-131, D-132 and D-133 (reference data, Main history, contract registry); two full `calculate()` runs 30 minutes apart gave identical totals. B17 figures: the four statements 2025-Q3 … 2026-Q2 loaded at that time; D-134 later added 2024-Q4, 2025-Q1 and 2025-Q2. The stage 6 data steps (D-135 and following) came after the measurements; they are named in each disposition and **the refreshed numbers are in `14_verification.md`**.
- **Legend.** covered = a case exists and a layer computes it, or the catalogue disposes of it explicitly (data / signal / later / out); partial = the case exists but a named variant cannot be expressed; NOT COVERED = no case, no later/out status, no signal at the time of the check. "yes-def" (report-processor) = covered by a catalogue line that defers, refuses or leaves it out. The new cases M53…M58 of `09` section 3 were written after the checks to close their NOT COVERED rows (section 3 of this file maps each).

## 1. Share of net 2024-01 … 2026-08 through the layers and in C by reason

**Final, 2026-11-03, after D-137** (the D-135 data fixes and the stage 6 rework D-137 are in; the stage 5 and stage 6
measurements are in `14_verification.md` §0 … §9). Units are (account, ISRC, UPC, report month, sales month, label string). Accounts: 1052428 = 0to8 (master), 1055956 = Echo8. USD net from the 47 loaded files (34 + 13). The accounting identity `sum of allocations + label share - net = 0.00` holds on every unit of both accounts. The measuring script compares the report month with `2024-01-01`, so report month 2024-01 of account 1052428 (net 28,124.94, C 10.99) is outside the tables of 1.1 … 1.4; the reconciliation totals of `14_verification.md` §9 include it.

### 1.1 Headline

| | net | B (confirmed, to owners) | ours (label of record) | C |
|---|---:|---:|---:|---:|
| ALL | 16,303,613.59 | 6,674,320.42 (40.94 %) | 8,429,068.58 (51.70 %) | 1,200,224.58 (7.36 %) |
| 1052428 (0to8) | 15,252,668.48 | 6,620,956.92 (43.41 %) | 7,761,841.62 (50.89 %) | 869,869.95 (5.70 %) |
| 1055956 (Echo8) | 1,050,945.10 | 53,363.50 (5.08 %) | 667,226.96 (63.49 %) | 330,354.64 (31.43 %) |

Ours by label of record (ALL): 0to8 7,629,993.33 (46.80 %), Echo8 799,075.25 (4.90 %; of which 131,848.28 are `Echo8` strings inside the 0to8 account).

### 1.2 Unit status (net of the unit)

| status | ALL net | share | 1052428 | 1055956 |
|---|---:|---:|---:|---:|
| allocated (a split by ISRC applied) | 15,704,527.04 | 96.33 % | 14,805,888.92 (97.07 %) | 898,638.12 (85.51 %) |
| no_split (ISRC and UPC known, no split in force; whole net is the label of record's share, D-029) | 596,724.70 | 3.66 % | 444,506.72 (2.91 %) | 152,217.98 (14.48 %) |
| unknown_pair (known ISRC, unregistered UPC) | 0 | 0 | 0 (the 44 pairs registered by D-135) | 0 |
| no_isrc | 2,361.85 | 0.01 % | 2,272.85 | 89.00 |

### 1.3 Money that passed through each layer (allocations, not distinct units)

| layer kind | ALL allocations | ALL amount | share of net | 1052428 amount | 1055956 amount |
|---|---:|---:|---:|---:|---:|
| row (split) | 1,085,511 | 7,664,485.50 | 47.01 % | 7,286,779.20 | 377,706.31 |
| top (remixer off the top, M4) | 14 | 6,625.38 | 0.04 % | 6,625.38 | 0 |
| artist_pool (M3b, M13, Q1 LUNAR, M43 Main carves) | 9,727 | 136,268.18 | 0.84 % | 136,268.18 | 0 |
| artist_share | 0 | 0.00 | 0 | 0 | 0 |
| label_share (M12, M35) | 4,192 | 19,575.24 | 0.12 % | 19,575.24 | 0 |
| sublabel (M5, Q12) | 17,578 | 45,228.85 | 0.28 % | 39,306.02 | 5,922.83 |

`artist_share` has 0 allocations: the D-135 carve participations of that form were replaced by pool participations of net (D-137), and the two remaining rows (1 ISRC) are valid from 2026-10-01, after the last report month. Participations: 283 (Annex step 108, LUNAR MEDIA 34, Main carves 141), 281 hit at least one unit (all but the two `artist_share` rows). Shortfalls: 507 `bucket_short` signals, Main carves 469 (1,065.94 on 4 ISRC, the pool of UPC 3617667203773 below 18 %) and LUNAR 38 (1.52 on 3 ISRC); `no_source_row` and `top_above_100` 0. Carved: top 6,625.38 + pool 136,268.18 + label_share 19,575.24 = 162,468.80.

### 1.4 C by reason, explained line by line

| C reason | ALL | share of net | 1052428 | 1055956 | What it is | Case / mechanism | Disposition (section 3) |
|---|---:|---:|---:|---:|---|---|---|
| owner_unconfirmed | 594,153.22 | 3.64 % | 591,383.06 | 2,770.16 | Split document is approved, the pseudonym's owner has no approved contract. By document: appendix 525,427.05, other 40,086.93, contract 21,360.41 + 2,770.16, buyout 4,508.67; includes sublabel halves (NoGhost / 77 / R2R pseudonyms) | owner-confirmation rule (D-043, D-057) | data gap, C07, C09 and stage 6 contract registry (D-133 already moved 525 k from `split_unconfirmed` into this reason) |
| split_unconfirmed | 454,217.47 | 2.79 % | 133,581.25 | 320,636.21 | Split exists, no document at all. Echo8 account 320,636.21 | `split_unconfirmed`; M8, M42 | C02 (M55 data gap: only four Echo8 RSAs exist); 133,581.25 are legacy splits whose rows differ from the Annex registry or have no label-share-only confirmation |
| assumption | 144,195.41 | 0.88 % | 138,272.57 | 5,922.83 | Not-approved `assumption` documents: Main carve participations 107,914.94 (M43, D-137), Q1 FUNK DO SURPRISE licensor row 19,169.49 (D-137), LUNAR MEDIA licence 5,543.73 (Q1, D-135), sublabel halves 5,374.09 + 5,922.83 (Q12, NoGhost before 2026-06, R1), Q5 Lost Label rows 270.31 (D-137) | Q1, Q5, Q11, Q12, M43, R1 | C24 (owner's list of imprints); owner confirmation of the carve, Q1 and Q5 documents |
| unknown_pair | 0.00 | 0 | 0 | 0 | the 44 (ISRC, UPC) pairs were registered by D-135 (150,057.35 left this reason) | M54 (E9 against D-023) | closed |
| artist_without_owner | 5,296.64 | 0.03 % | 4,360.20 | 936.43 | Pseudonym without owner: `top` 4,328.45, rows 968.19 | M31 convention (every recipient has an owner) | data; stage 6 owner linking |
| no_isrc | 2,361.85 | 0.01 % | 2,272.85 | 89.00 | 1,444 lines, all `Download`, 1,019 units | M41 out, D-035 | C37 |
| label_unmapped | 0.00 | 0 | 0 | 0 | 25 distinct label strings, all mapped (17 labels, 25 aliases, 16 rules) | M8, Q12 | none |
| **Total C** | **1,200,224.58** | **7.36 %** | 869,869.95 | 330,354.64 | | | |

Cross-check: 594,153.22 + 454,217.47 + 144,195.41 + 5,296.64 + 2,361.85 = 1,200,224.59 (0.01 rounding of the per-reason sums).

Not in C but a gap in the answer to "whose is it": `no_split` 596,724.70 stays in ours by rule D-029 (2,497 ISRC; it grew by the second-UPC units of no-split ISRC that left `unknown_pair`); 79 ISRC above 1,000 = 495,276.03. Whether that money is really ours is disposition C11.

C by account, reason and document state:

| account / reason / document state | amount |
|---|---:|
| 1052428 / owner_unconfirmed / approved appendix | 525,427.05 |
| 1055956 / split_unconfirmed / no document | 320,636.21 |
| 1052428 / assumption / not approved assumption | 138,209.27 |
| 1052428 / split_unconfirmed / no document | 133,581.25 |
| 1052428 / owner_unconfirmed / approved other | 40,086.93 |
| 1052428 / owner_unconfirmed / approved contract | 21,360.41 |
| 1055956 / assumption / not approved assumption | 5,922.83 |
| 1052428 / owner_unconfirmed / approved buyout | 4,508.67 |
| 1052428 / artist_without_owner / approved other | 4,328.45 |
| 1055956 / owner_unconfirmed / approved contract | 2,770.16 |
| 1055956 / artist_without_owner / approved contract | 936.43 |
| 1052428 / assumption / approved contract | 63.30 |
| 1052428 / artist_without_owner / approved contract | 31.76 |

Top 40 ISRC hold 414,108.17 of the C (34.5 %): owner_unconfirmed behind approved appendices (e.g. DGA0S2482123 33,313.80), Main carve participations (e.g. DGA0S2481329 26,040.24 assumption), split_unconfirmed on Echo8 repertoire (e.g. FR59R2556825 18,285.78).

### 1.5 Label strings (25), all mapped

| group | strings | net | case |
|---|---|---:|---|
| Own labels | `0to8` (14,763,621.44), `Echo8` in the 0to8 account (222,129.81) and in the Echo8 account (1,038,631.23), `0to8/Echo8` (6,025.57), `0to8, Echo8` (1.64) | 16,031,409.69 | M8, owner answer 1 |
| Ahh Music family | `Ahh Music` (110,127.59), `0to8 / Ahh Music` (0.11): alias of 0to8, no deduction | 110,127.70 | M8, owner decision 3 |
| Sublabels with a rule | NoGhost (4 strings, 56,159.51 + 31,075.33 + 49.25 + ...), `77 Records` (2 strings), R2R PRODUCTION | about 147,800 | M5, owner decision 2 |
| Sublabel strings, Q12 assumption | qaraqshy, fate, CATCORE, SF (Echo8 account); Enarma (2 strings), lost, odds, VBR, PCR, Bear catalogues, Hoboshrine, no job records (0to8 account) | about 15,300 | Q12 |

17 ISRC (net 38,257.88) carry two label strings over time; the label is decided per unit, so the sublabel half applies only to the months with the sublabel string (watch item for 77 Records).

### 1.6 B17 (publishing), quarter by quarter

Final state (all seven statements; 13 holders confirmed by their own contracts, D-135), from the reconciliation rows.

| Quarter | A payable | Author part | B | C | C by reason | Ours |
|---|---:|---:|---:|---:|---|---:|
| 2024-Q4 (month 2024-12) | 456.99 | 228.50 | 0.00 | 228.50 | terms 228.50 | 228.50 |
| 2025-Q1 (month 2025-03) | 43,324.58 | 21,662.29 | 0.00 | 21,662.29 | terms 21,662.29 | 21,662.29 |
| 2025-Q2 | 281,160.71 | 140,580.36 | 0.00 | 140,580.36 | owner 128,948.70, terms 11,631.66 | 140,580.36 |
| 2025-Q3 | 405,296.99 | 202,648.49 | 0.00 | 202,648.49 | owner 61,716.09, terms 140,932.41 | 202,648.49 |
| 2025-Q4 | 273,460.41 | 136,730.21 | 0.00 | 136,730.21 | owner 51,078.10, terms 85,652.11 | 136,730.21 |
| 2026-Q1 | 1,260,625.47 | 866,425.41 | 578,091.12 | 288,334.29 | owner 232,947.84, terms 55,386.46 | 394,200.05 |
| 2026-Q2 (original file) | 232,256.76 | 160,063.35 | 104,257.24 | 55,806.11 | owner 45,893.54, terms 9,912.58 | 72,193.41 |
| Σ of all seven quarters | 2,496,581.91 | 1,528,338.61 | 682,348.36 | 845,990.25 | owner 520,584.25, terms 325,405.99 | 968,243.31 |

"owner" = `owner_unconfirmed`, "terms" = `publishing_terms_unconfirmed` (a confirmed holder without a term: default 50). Reconciliation `A = B + C + ours` holds on every row (discrepancy 0). 32 rights-holders are person owners created by publishing, none merged into a legacy owner (D-083 ⚠); 13 are confirmed by their own contracts (D-135), 19 unmatched stay `owner_unconfirmed`; holder afaed4c7 has terms (90 general / 50 Synchronization from 2026-01-01, D-132). Operation types of the four statements measured before D-134: Mechanical 1,335,151.24 (578,106 lines), Performance 537,170.71, Synchronization 292,421.36, Print 6,896.32. Dispositions: C09, C17, C18, C19, C20, C21, C26, C39.

## 2. One section per source (map section 8)

### 2.1 Contracts (`Root`, PandaDoc 1,146 documents, 36 developer PDFs, `agent_special_cases.md`, `agent_sublabels.md`)

Counts (146 rows): covered 95, partial 46, NOT COVERED 5. Rows pinned by golden cases G01…G44.

| Block | Data element | Case | Handling | Covered |
|---|---|---|---|---|
| A 20 kinds of `documents.json` | recording 511, schedule 94, imro 166 | M1, M2, M3b, M7, M18, M19, M25, M31, M37, M38, M40 | layer split + carve + recoup; split rows per ISRC from the royalty column; owner aliases | yes (3 rows) |
| | indemnification 39, consulting 18, w8 18 | M20 note out; M31 later | out / later | yes |
| | advance 8, remix 6, beat_lease 4, sublabel 2 | M19, M20, M44, M50, M4, M46, M5, M6 | recoup layer; off-the-top; data operation | yes |
| | sample_license 82 | M11, M34, M20, M33 | carve / data; publishing interest not carved | partial [X3] |
| | other 70 | decomposed in block E | | partial |
| | co_pub 26 | M15 | data rule `pub_terms` 50 % (G26a) | partial (admin fee, term, 120 % clear) |
| | asset_purchase 23, assignment 12, work_for_hire 12, beat_purchase 7, caa 6, co_ownership 6 | M9, M10, M20, M47, M51, M52, M14, D-045 | master side exact; composition side per work not expressible | partial [X1] (co_ownership 90/10 composition: D-087 equal parts only) |
| | nda 36 | none | | **NOT COVERED** (non-economic) |
| B 55 rows, `agent_special_cases.md` | CAPA full and partial percent (8.3 … 25 pp), masters-only, installments, bundled old agreement, minor seller, unlisted derivatives, hyphenated ISRC, 196 ISRC without stated interest, 25 % with third-party clause, short purchase without ISRC | M9, M51, M40, M20, M24, M31 | data: split change from the month of the effective date; price outside balance (D-027) | yes (9 rows); unlisted derivatives [X2] partial |
| | YouTube channel purchase USD 25,000 (content and monetization) | none | not a Believe or B17 source | **NOT COVERED** |
| | beat purchase with no fee (10 % of the artist's share, reserve up to 15 %), exclusive master/beat cash fee | M13, M14, M20 | carve `(bucket, artist_share)`; fee = operation | yes; 15 % reserve not modelled; composition side [X1] partial |
| | sample letters 5-30 %, two licensors, recoupable advance, non-recoupable fee, flat fee, "less other participants" clause, term perpetuity vs 5 years, retroactive start, minor/represented licensor, signature pending, JET/INFINITY masters royalty | M11, M3b, M19, M20, M25, M31, M33, M7, G19 | row, carve from the pool, assumption document (C), `valid_from` before the document date | yes (10 rows) |
| | licensor keeps publishing interest in the new recording (12.5-50 %), JET/INFINITY composition share, vocal sample 20 % of publishing | M34 later | external writers take nothing (G26c) | partial [X3] |
| | $100 accounting floor, ratification of payment instructions, Red Bull fee, Kurate letter, NetEase, label-to-label inbound 25 % (YATOMI, ARCADIA, SUNDAY), Remixed Records inbound | M23, M50, M46, M45, M24 | later | yes (later) |
| | co-publishing 50 %, owner collects performance share | M15, M17 | `pub_terms` + author-share layer | yes; fee 10 % inside net income, 120 % clearance, "later of 3 years or recoupment", 15-year reversion: partial |
| | publishing administration 90 % / 50 % cover and sync | M16 | terms per operation type | partial (B17 has no cover type; performance excluded from advance reduction not modelled) |
| | work for hire delivery fee, co-ownership 50/50 and 90/10, CAA purchaser, limited platform licence, advance addenda, remix 15 % with receipts before the date, remix 50 % digital, A&R participation 10-15 % windows | M20, M14, M9, M4, M33, M1, M12, M36, M19 | operation / rows / carve | yes (6 rows); work for hire composer to zero, CAA, 90/10 composition: partial [X1] |
| | XENO XID: percent only in Schedule A (not extracted) | M12, M19 | data once the schedule is read | yes (case exists; data missing, C12) |
| | powers of attorney (~15), consent letters, DMCA counter-notifications (4), Grammy (2), rightsholder statement, authorization letter, reference letter, `[DEV]` test file | consent: M31 later; the rest none | | **NOT COVERED** (non-economic) |
| | Russian licences (3): percent and term per object, royalty on remuneration "received or accrued", RUB | M24, M25 | participation with period; accrual basis not in the catalogue | partial |
| | per-track split schedule, case types 1-22 | M37, M40, M38 | data entry rule | yes |
| C 23 rows, `agent_sublabels.md` | NoGhost 25/50/25, advance 50,000, imprint by label string, term 2 years, remainder never negative, Echo8 artist agreements x4 | M5, M19, M8, G05a, G05b, G29, G36, G38, G40 | label rule 50 % of the label share; recoup on the NG pseudonym | yes (owner decision and literal 25 % differ when artists are not at 50, NoGhost to be re-signed) |
| | NoGhost Excluded Projects (solo releases still carry the NoGhost share); Covered Compositions 25 % | M5 | per-ISRC carve to NG possible, not stated, not tested; composition side later | partial |
| | RioX 66.6 %, printed 99.9, closed list without ISRC; Lost Label rows, advances, supersession, cut without notice; YATOMI / SUNDAY / ARCADIA | M6, M37, M40, M7, M19, M44, M25, M38, M46 | data rows; later | yes (14 rows) |
| | 30 titles claimed by Lost Label and two direct schedules; stacking list | M39, Q5, Q11 | assumption document; stack above 100 % refused at entry | partial (no overlay, no explicit signal) |
| D 36 files of the developer folder | 9 assignments, Duetti purchases (2), RSAs, Schedule C tables, licence letters x9, Lost Label RDAA, dispute settlement, payment proof | M10, M28, M32, M1, M2, M11, M35, M7, M20, M33 | data / carve / operation | yes (21 rows); partial 15 ([X1] 5 assignments, [X2]/[X3] Duetti, CBMG, MC Denny, JOGA, NAIVE, MONTAGEM, MC Da 12, LUNAR MEDIA publishing, minor overlap) |
| E contract-type items outside the special-cases sections | older Recording / Exclusive Licence / Short Form, 2022 licences, Schedules F/G/H, Matra / XENO / Maximum Madness | M1, M18, M38, M12, M19, M36 | rows, assumption | yes (5 rows) |
| | transfer-of-exclusive-rights agreements 2022-2024, administration agreement, Russian licences, misfiled CAPA and remix | M10, M16, M24, M9 | data | partial ([X1], cover type, accrual) |
| | employment and reference letters, powers of attorney, DMCA, Grammy, statements, test file | M20 out (employment not named) | | **NOT COVERED** (2 rows) |

Source's NOT COVERED list (all non-economic or non-Believe): (1) NDA 36 documents; (2) YouTube channel purchase USD 25,000; (3) powers of attorney, DMCA counter-notifications, Grammy PDFs, rightsholder statement, authorization letter, reference letter, `[DEV]` test file; (4) employment and reference letters (not named in M20 out). Disposition: M53 (non-economic documents, out) closes (1), (3), (4); the YouTube purchase is not a Believe or B17 source and is covered by the same out line.

Shared partial causes: [X1] publishing-side transfer of compositions by work (terms are per owner, D-045 and D-087 waiting for the owner); [X2] unlisted derivative versions (rules keyed by ISRC, no title-family rule); [X3] licensor publishing interest in a new recording (M34 later).

### 2.2 Annex 14 beta (Sch3A, Sch3B, Sch3C, derivative authorisations, Sch1A/1B, Sch2, Sch4)

Counts (group rows of the source's verdict table, Annex part): covered 10, partial 7, NOT COVERED 5 (the source's combined Annex + Main count is covered 17, partial 12, NOT COVERED 9).

| Data element | Count | Case | Handling | Covered |
|---|---|---|---|---|
| Sch3C(i) 730 sublabel allocation rows: rule in force on every month | 343 (NoGhost 205, R2R 88, 77 Records 31, VBR 6, Bear 5, Enarma 3, no job records 5) | M5, Q12 | label rule 50 % of the label share | covered |
| Sch3C(i) Ahh Music rows | 387 | M8, owner decision 3 | alias of 0to8, no rule by design | covered |
| Sch3C(i) rule exists but the percent does not reproduce the Annex 0to8 share | 88 (R2R 75-family: ERP keeps 25, Annex 15; Bear 5 and Enarma 3: ERP 12.5, Annex 25; no job records 5: ERP 25, Annex 50); 4 NoGhost rows have no ERP split | M5, M42, Q12 | owner decision 2 gives half rule | partial |
| Sch3B 84 advances (257,050.00) | 81 recoupable (239,550.00: `any` 67, `publishing` 14) + 2 non-recoupable payouts (10,500.00) | M19, M20 | recoup positions | covered (83 of 84) |
| Sch3B NoGhost Records 7,000.00 on 2026-09-09 | 1 | M50 | no operation; nearest is another payee's 7,000 on 2026-09-04; Main says 25,000 to NoGhost went through another artist's Tipalti account | **NOT COVERED** |
| Sch3C(ii) buy-outs 1,345: pp 294, whole 88, own-entity transfers 767 | matched 290 + 88; 767 no effect by design | M9, M10, M52 | split change from the month start | covered |
| Sch3C(ii) "see the instrument" | 196 (168 without any ERP split, 28 with a split) | M51 | unchanged, seller percent per row unknown | partial |
| Sch3C(ii) DJ TUUV 12.5 pp rows | 4 (seller not a row of the split before or after) | M9 | | **NOT COVERED** |
| Derivative authorisations | 2 -> `remixer_top` participations (15 %, from 2026-06-01); 11 outside the authorisation -> track notes (net 7,513.16) | M4, M29 | off-the-top; signal | covered (owner says 10 versions, ERP 11: confirm) |
| Sch1B Duetti | 243 ISRC, 247 splits, valid from 2026-05-01 (135) and 2026-06-01 (108) | M28, M32 | split to the buyer at 100 % | covered |
| Sch1B withdrawn (10) and other expressly excluded (2) | 12; Believe net 174.34 still flows | M28 | listed only, "keep last split"; no perimeter exclusion | partial |
| Sch1B identified Echo8 repertoire | 4,104: 3,563 resolve to Echo8-family labels (719,886.97), 537 no loaded line, 4 `0to8/Echo8` (5,573.47) | M8, owner answer 1 | label of record per unit | covered / no money / partial (4 ISRC counted by ERP as 0to8 ours, Annex excludes) |
| Sch3A 9 participation rows: NoGhost 25 %, settlement 15 % (30 ISRC), Kenke, Eiden XII, Sleeping City Funk 13 % | rows 1, 3, 5, 6, 9 | M5, M35, M4, M3b | rule / participation / rewrite | covered |
| Sch3A 77 Records and R2R 25 % | row 2 | M5 | rules without document (assumption); R2R number differs on 75 rows | partial |
| Sch3A licensor of MC ROBA CENA vocal, 20 %, 4 recordings; MC Denny 23 % licence vs 25 % registered, ACIDO III | rows 7, 8 | M11, M43 | kept as split rows; licensor payee and rate not applied; 23 vs 25 unreconciled | partial |
| Sch3A LUNAR MEDIA 10 % income received (34 recordings, receipts 60,412.11) | row 4 | M11 | no pseudonym, participation or split row | **NOT COVERED** |
| XENO XID participation (80 Annex ISRC; USD 12,500 advance only as an advance) | | M12, M19 | Schedule A with the ISRC list and rate is missing | **NOT COVERED** |
| Sch2C consents (Remixed Records 75,647.74 by title, LUNAR MEDIA 60,412.11, CBMG sample licence 187,051.06), Sch2D, Sch4A claims (274,207.19, 31,258.71, 15,859.96), Sch4B | | M45 later, M30 later, M34 later | Retained Liability, not royalty rules | covered as out of scope (money exposed listed) |
| Sch1A permitted scope and term (10,228 rows: term not established 4,625; N years 2,376; derivative-version permissions 1,804 + 287) | | M25, M29 | ERP has no term end or scope; M29 notes only for 11 ISRC | **NOT COVERED as data** (verdict partial for M29) |

Source's NOT COVERED list, Annex part: (1) Sch3B NoGhost 7,000; (2) Sch3C(ii) 4 DJ TUUV rows; (3) Sch3A LUNAR MEDIA 10 %; (4) Sch3A XENO XID; (9) Sch1A term end and permitted scope as data. Doc drift found: D-132 says 145 `any` advances, the database has 144 (+14 publishing = 158).

### 2.3 Believe 0to8 (1052428) and Echo8 (1055956) in ClickHouse

Counts (verdict table of 15 rows plus 9 element rows of section 6): covered 19, covered with a data gap or open correctness 3 (split without document, owner unconfirmed, no_split), NOT COVERED 1 row (unknown_pair) which the source splits into 3 NOT COVERED items.

| Data element | Quantity | Case | Covered |
|---|---|---|---|
| Label strings, 17 labels, 16 rules, 25 aliases | 25 / 25 mapped, label_unmapped 0.00 | M8, M5, Q12 | covered |
| `Echo8` string inside the 0to8 account | 222,129.81 | M8 | covered |
| `sales_type` Stream 15,425,717.64 + 1,074,320.81; Creation 364,898.91 + 23,012.37; Download 24,696.23 + 747.45 | 5/5 types handled | M18 | covered |
| Platform Promotion (-534,519.35 and -47,102.25, all lines negative), Abnormal Streaming Recharge (-33.28) | 4,195,263 + 1,008,364 lines | M26 | covered |
| Negative lines | 5,438,279; unit-level negative net 3,752.34 | M26 | covered (every layer keeps the sign) |
| Lines without ISRC | 1,444 lines, 1,019 units, 2,361.85 | M41 out | covered (deliberately out) |
| ISRC with two label strings | 17, 38,257.88 | M8 | covered (watch item) |
| Echo8 account contour | ours 667,226.96 (63.49 %) | M8 | covered; C 31.4 % mostly without documents |
| Imprints with no sublabel decision | 11 strings | Q12 | covered as assumption |
| Layer kinds exercised | row, top, artist_pool, label_share, sublabel yes; artist_share 0 | M13 | covered, not exercised by period data |
| Split exists, document missing | 454,504.72 | `split_unconfirmed` | covered as a reason, data gap |
| Split approved, owner not confirmed | 596,745.48 | `owner_unconfirmed` | covered as a reason, data gap |
| Pseudonym without owner | 5,296.64 | `artist_without_owner` | covered as a reason |
| no_split, ISRC known | 79 ISRC > 1,000 = 430,355.45; all 2,497 ISRC 531,568.05 | D-029, M42 out | covered by rule, correctness open |
| Sublabel half on a no_split unit | | R1 | covered (assumption, C) |
| Participations top, artist_pool, label_share (net and bucket) | 108 rows, 49,010.13 carved | M3, M4, M12, M13 | covered; 2 artist_share rows future-dated |
| ISRC with two UPC | 105 ISRC, 1,336,750.07: allocated 1,107,833.85, no_split 69,751.39, **unknown_pair 146,717.75** | E9 against D-023 | **NOT COVERED** |

Source's NOT COVERED list (to become cases for stage 6): (1) second UPC of a known ISRC (proposed M53, now M54); (2) ISRC known, no split, third-party repertoire (proposed M54 "no-split watch list"; not adopted as a case, see C11); (3) Echo8 repertoire splits without documents (320,636.21, proposed M55, now M55).

### 2.4 B17 (publishing statements)

Counts (15 rows of the source table): covered or handled 7, NOT COVERED 7, open question 1.

| Data element | Case | Handling | Covered |
|---|---|---|---|
| Mechanical 578,106 lines, Performance 457,508, Print 1,824 (1,879,218.27 together) | M15, M16 | author share by typed or untyped term, quarter-end month | yes (rate); payment gated by owner confirmation |
| Synchronization 16,791 lines, 292,421.36 | M16 | typed term for one owner, others untyped | yes |
| 99 `pub_terms` (92 x 50, 6 x 0 buyout, 90 general, 50 Sync) | M15, M16, D-045 | layer 2 | yes, but 97 attach to legacy owners that are not B17 holders |
| 32 holders, equal parts of our writers | M17 | writer-parts layer | yes (D-087 waiting) |
| Holder confirmation | D-043 | `owner_unconfirmed` | handled, 0 of 32 confirmed, B = 0 |
| Default 50 for 31 holders without term | D-043 | `publishing_terms_unconfirmed` once confirmed | handled; terms missing |
| Label-kind payee | decision 7 | `writer_unmapped` | covered, 0 lines |
| 14 external songwriters, 53,570.45 on 209 lines (all lines also hold one of our writers) | M17, M34 | ignored by design, no signal | **NOT COVERED** (silent) |
| Unequal writer shares | M14, D-087 | none | **NOT COVERED** |
| Publishing buyout by work | D-045 | whole-owner 0 % only | **NOT COVERED** per work |
| Company payee | D-096 | owner created, never approved | **NOT COVERED** |
| Updated Q2 2026, Q2 2025, Q4 2024 / Q1 2025 not loaded | D-041 | refused as duplicate or not loaded | **NOT COVERED** (since D-134 the last two are loaded; Updated Q2 2026 stays refused) |
| ACIDO licensor interest (title match, 27,688.02 + 677.84) | M34 | external songwriter, unpaid | **NOT COVERED** |
| Merge of 32 holders into legacy confirmed owners | D-083 | no merge (0 merges) | **NOT COVERED**, main gate |
| Agreement 90 % for 2025 quarters | M16 | default 50 for 2025 | open question |

Source's NOT COVERED list with money: (1) unequal writer shares, 3,381 aggregated lines with 2 or more of our writers, payable 1,696,744.28 (78.1 % of A) distributed equally, single-owner lines 474,895.35 unaffected; (2) publishing buyouts by work, 6 buyout terms, all on non-holder owners, 0.00 of the loaded payable depends on them today; (3) licensor interest, externals 53,570.45 on 209 lines, equal-share upper estimate 19,462.92, ACIDO 27,688.02 + 677.84 possible; "Sleeping City Funk" and "FUNK DO SURPRISE" do not appear in B17; (4) company payees, not measurable (suffix heuristic finds none), worst case author part 1,365,867.46; (5) also open: Updated Q2 2026 (old ERP value 417,084.93, +184,828.17 payable against the loaded file), holder-to-legacy merge (gate of the whole author part), 31 holders with no term (475,070.36 author part), admin rate for 2025 quarters (holder afaed4c7 earned 322,596 lines).

### 2.5 ERP reference data (every ISRC with net > 0: which layer computes it, or why it is in C)

Counts: ISRC with money in C 13,436; no_split ISRC 2,497 (79 above 1,000); no_isrc units 1,019; unknown_pair units 3,211; participation shortfalls 0; label strings 25 / 25 mapped. Result: every unit ends in exactly one of allocated (95.83 %), no_split (3.26 %), unknown_pair (0.90 %), no_isrc (0.01 %), and every unit of the C buckets carries a named reason (section 1.4). No ISRC with net > 0 is unexplained.

| Population | Net or C | Layer / reason | Case |
|---|---:|---|---|
| allocated units | 15,622,965.94 | row (+ top, pool, label_share, sublabel carve) | M1…M18 |
| ISRC under owner-unconfirmed pseudonyms | 596,745.48 | `owner_unconfirmed` | owner confirmation (data) |
| ISRC with split but no document | 454,504.72 | `split_unconfirmed` | M55 for Echo8 |
| ISRC with a second UPC | 146,717.75 | `unknown_pair` | M54, D-135 |
| ISRC with no split, label share = whole net | 531,568.05 | no_split, ours by D-029 | M42 out; C11 |
| Q12 sublabel halves | 11,335.48 | `assumption` | Q12 |
| 4 Echo8 imprint ISRC (`0to8/Echo8`) | 5,573.47 | no_split, ours | owner answer 1 |
| Duetti-sold 243 ISRC | in B of the buyer | 100 % split from 2026-05/06 | M28, M32 |

Further reference-data facts (Annex vs ERP, from D-131): the registered splits compare as 90,967 of 107,106 cells matched, receipts 89.38 %; differences grouped by cause (split_differs, annex_no_share, sublabel_assumption, no_split_erp, floor_titles) are stage 5 material, not completeness gaps. Dispositions for the uncovered rows: C01, C02, C11.

### 2.6 `0to8 Main.xlsx` (25 sheets; INCOME EXPENSE 19,345 typed rows)

Counts (group rows of the source's section C, Main part): covered 2, partial 3, NOT COVERED 5 (4 source NOT COVERED items; the PROMO sheets are the fifth in the advertising item), plus technical sheets not used.

| Data element | Rows / Σ | Case | Handling | Covered |
|---|---|---|---|---|
| Expense Royalties no comment | 2,355 / 6,542,557.83 (2,332 loaded) | M27 | plain payout migration | covered (23 rows not loaded: 22 DJ VETA3 ambiguous, 1 zero) |
| Expense Advance, "аванс за паблишинг", "переплата", Publishing, Sample, "вычет доли" carve, "штраф", review class | 145 + 17 + 2 + 1 + 35 + 104 + 3 + 2 ... | M19, M20, M12, M35, M27 | recoupable advance / payout / deduction (158 advances, 2,397 payouts, 104 deductions) | covered |
| "ноу рекап" (4 Expense 54,205.06; 13 Income 7,076.82) | 17 | M44 later | loaded as plain payouts tagged `[no recap]` | partial |
| Buy-out prices "выкуп" 24 / 273,000.00; bonuses and fees 9,000.00; netting of the pre-buy-out balance (33 Income rows 24,900.82) | | M20, M47 | document only, no operation | partial |
| Routed payouts "Send to fl / customer / echo" | 10 / 10,560.91 + 2,000 document-only | M50 later | route in the comment only | partial |
| Expense Advertising | 7 / 2,699.39 | M21 later | not loaded | **NOT COVERED** (PROMO posted 1,090,737.65 and Advertising Summary also not used) |
| Held payouts (MC 7belo, MC JHonny, ural gaisin) | 3 / 25,764.11 | M12 | wait for a participant credit no participation provides | **NOT COVERED** |
| Ambiguous nicknames DJ VETA3 (25 Expense rows 28,402.51; Income 32,336.34), DSHZS (21 Income rows 13,034.81), MC FLYXO (16 Income rows 4.02) | | owner/merge decision | skipped | **NOT COVERED** |
| Sheet "выплаты саблейблам": 15,000 to one artist, 25,000 to NoGhost through that artist's Tipalti account on 2026-09-09 | 40,000 | M50 | not operations | **NOT COVERED** |
| Income (16,565 rows, 8,499,624.88), FINANCE, NEW СВОДКА, Echo8 sheet, Tipalti, Contracts (28 term dates), PRO IMRO, technical sheets | | comparison only; ERP earns from reports | not loaded | not used (stage 5 comparison) |
| Nicknames 1,230 | matched 1,018, created from Main 18, unmatched without cash 191, ambiguous 3 | | | covered for 1,036 |

Reconciliation: 2,659 operations = 2,397 plain payouts + 158 advances + 104 deductions; Σ out 7,482,325.50, Σ in 212,650.11. Expense rows with a cash class but no operation: 25 payouts (22 DJ VETA3 ambiguous, MC 7belo, MC JHonny, ural gaisin) 53,577.26; 5 carve rows 11,494.55; 1 advance 500.00; 29 documents 277,000.00 (+5,000.00); 62 not loaded 2,699.39.

Source's NOT COVERED list, Main part: (5) Advertising 2,699.39 and PROMO ads 1,090,737.65 posted; (6) held payouts 25,764.11; (7) ambiguous nicknames, cash 28,402.51; (8) "выплаты саблейблам" 15,000 + 25,000.

### 2.7 report-processor (187 task folders in 13 families, `Sublabels Reports`, `MC Reports Hub`, `Label Reports/RULES.md`)

Counts (93 rows): yes 50, yes-def 21 (later 10, out 4, refused 5, replaced 1, differs and not modelled 1), partial 13, report only 6, NOT COVERED 3. 87 rows carry money; computed or entered today (yes + partial) 63; consciously deferred or refused with a catalogue line 21. All 187 task folders sit in exactly one family (T1 monthly royalties 7, T2 Echo8 13, T3 artist share reports 60, T4 UPC/title-family shares 22, T5 report only 28, T6 sublabel 2, T7 advertising 21, T8 advance/buyout/overpayment 5, T9 publishing 14, T10 SoundOn and tax 3, T11 profit funnel 2, T12 infrastructure 8, T13 other MC 2).

| Group | Data elements | Case | Covered |
|---|---|---|---|
| A. Mechanics (20) | net base, month key, artist share by ISRC, ISRC normalisation, two cabinets, label alias, A/B/C layering, advance recoup, overpayment, balance from the sheet | M1, M2, M8, M18, M19, M25, M26, M27, M40 | yes (11 rows) |
| | rounding HALF_UP to 0.01; splits version of an old month | principle D, D-025 | yes (differs by design) |
| | empty ISRC folded to the main ISRC; cabinet dedup | M41, D-035, D-032 | yes-def (refused) |
| | taxes 9 % / 30 %; frozen periods | M48, M49 | yes-def (out) |
| | overlay over cabinet splits (70 ISRC, keep-overlay-or-Backstage prompt) | M39 | partial |
| | buyout of a catalogue slice by title family (`*`, version suffix strip) | M9, M51 | partial |
| | payout-month lag +2 (`royalties-YYYY-MM` = accrual + 2) | none | **NOT COVERED** (no money effect) |
| B. Label rules and sublabels (13) | Ahh Music alias, imprint aliases, Echo8 separate, NoGhost / 77 half model, R2R, qaraqshy, fate / CATCORE / SF, missing sublabel ISRC, ad contribution | M8, M5, Q12, M42, M21 | yes / yes-def (R2R, Q12 differ by design) |
| | Bear / VBR / ENARMA fixed pool with a named partner who is not added twice | Q12 | partial |
| | partner named in `collaborator_names`, clamp to remainder | Q12 | partial |
| | 77 Records exception: lines with one artist are released on 0to8 and dropped | M28 | **NOT COVERED** |
| C. MC Reports Hub (13) | rates 5-25, ISRC subset in a UPC, MC identification, who funds the MC share (a-e), MC % of label profit, retro months, hub merge, fixed payment, MC management labels | M2, M3, M11, M12, M13, M20, M25, M33, M40, M43 | yes (11 rows) |
| | per-UPC MC share over the full net, all versions of the UPC | M2, M3 | partial |
| D. Task families (T1…T13) | royalties, single-UPC shares, REMIXED 30 / UMBRELLA 20 with advance, artist share reports, sublabel share, publishing B17 v3, B17 paylist, IMRO composite key, publishing label profit, profit funnel, equal-points mastering recalc, overpayment, publishing advance | M1, M2, M19, M17, M27, M43 | yes |
| | Echo8 no split pool 40-50 % equal; inbound splits from other labels; advertising allocation (21 folders), ad exclusions, recoup of ads, track recognition; ASCAP domestic/international; B17 publishing buyouts / hold lists / posting batches | M42, M46, M21, M9, M30, M23, D-045 | yes-def (refused, later, out) |
| | Echo8 match by ISRC + UPC, newest dump wins, one person under two aliases on one ISRC (25 % in total), audit of bought-out artists still in cabinet splits, publishing redirect for live quarters only, single/multi-UPC and title-family shares | E9, M38, M10, M9 | partial (6 rows) |
| | SoundOn 50/50 with token-matched eligible artists | map item 26 only | **NOT COVERED** |
| E. Believe Monthly Reports, config, system (6) | monthly report, Matra advance, buyout configs, empty-ISRC fold, hub cabinets, ClickHouse import | M19, M9, M41, M8, D-110 | yes / partial (buyout configs) / report only |

Source's NOT COVERED list: (1) A3 payout-month lag +2; (2) S10 77 Records exception for one artist; (3) T10a SoundOn-format statements. Partial list: A12, A14/E3, S3, S8, H1/T4a/T4b, T2a, T2c, T3b, T8c, T9d (what is missing is in section 4). Rules where the ERP computes a different number than report-processor by design: R2R and Q12 sublabels, sublabel without split, old-month splits, mid-month instruments, dedup, empty ISRC, Echo8 without a split, `0to8/Echo8`, B17 split, rounding, overpayment per release, frozen quarters, taxes, 77 `onimanxd`.

### 2.8 zero-erp (prisma schema, earnings, earning-rules, settlement, payouts, attribution)

Counts (129 constructs): yes 64, yes-refused 26, partial 29, NOT COVERED 10 (rule kinds and parameters 46: 20 / 9 / 14 / 3; 23 unresolved reasons: 21 / 0 / 1 / 1; identity, imprint, alias 21: 9 / 4 / 4 / 4; settlement kinds and recoup 26: 12 / 7 / 7 / 0; payouts, holds, currency 7: 2 / 5 / 0 / 0; SoundOn 6: 0 / 1 / 3 / 2). The four `imprint_revenue_share` reference deals reproduce under the ERP rules (deals 2 and 4 identical; deal 3 at artist total 50 and otherwise differs by owner decision 2; deal 1 only by entering scaled rows); no deal differs by an error.

| Block | Constructs | ERP analogue or refusal | Covered |
|---|---|---|---|
| Rule kinds: standard split, house remainder, rounding/dust, label alias to imprint, sublabel fixed cut, artist pool as-is, version dating, additional participation (beneficiary, rate), `fundedFrom` house and participants pro rata, `isrc_only`, shortfall, buyout of participants, counts of owners | A1-A3, A11, A12, A14, A15, A17, A21, A24, A26, A27, A29, A30, A34-A37, A42, A43, A44 | rows, `label_rules`, layers, residue to the largest, shortfall signal | yes (20) |
| Refused on purpose | A5, A6, A23, A25, A32, A33, A40, A46 (no-split pools, base ladder, publication sequence, equal-funding mode, add/replace) | M42, E9, E16, M49, D-029 | yes-refused (9) |
| Validations, payee earned vs payable, fixed house cut, normalised pool, residual, no-split fallback, partner in split, named funding subset, buyout by release, share redistribution, overlay order, sales-month date policy | A4, A7, A8, A13, A16, A18, A19, A20, A28, A31, A38, A39, A41, A45 | entered as rows at stage 4; M10, M50 later; R1; no guard that a rule recipient is not also a row | partial (14) |
| `fixed_revenue_share` participants equal / weighted by source tokens; no-participant fallback | A9, A10 | no analogue | **NOT COVERED** |
| `exclusions.trackIds / participantIds` of an imprint deal | A22 | none | **NOT COVERED** |
| 23 unresolved reasons | B1-B23 | 7 have a C reason/signal/entry error; 14 "no analogue" with the reason stated | yes 21; partial B5 (invalid_split); **NOT COVERED B20** (`imprint_without_deal`: a sublabel string with no rule in force keeps the whole label share as ours silently) |
| Identity: track identity, alias to imprint, Participant vs Performer vs tenant, document registry, split status | C1-C5, C7, C10, C13, C17-C19 | (ISRC, UPC) pair, `label_aliases`, pseudonyms and owners, documents | yes (9) |
| Alias key kind `believe_id` | C6 | the unit carries `label_name` only | **NOT COVERED** |
| Dated attribution of a release or shipment (`AttributionPeriod`, `AttributionRevision`) | C9 | label of record per unit from the printed string (17 ISRC change string over time are handled) | **NOT COVERED** |
| Empty label name = house without an alias | C12 | ERP: empty string cannot be an alias, falls to `label_unmapped` (measured: no such unit, `label_unmapped` = 0.00) | **NOT COVERED** (measured zero) |
| Participant merge with row-level undo, identity review decisions | C15 | `owners.merges` is one-way | **NOT COVERED** (reference-data feature) |
| Imprint retire/merge, review reasons, alias validity/homonym key, split expectation | C8, C11, C14, C16 | rule `valid_to`, one key kind, `owner_aliases`, signal `isrcsWithoutSplit` | partial (4) |
| Settlement kinds: advance, bonus, overpayment, period correction, recoup scope/buckets/stream/start/eligible status/rate, cutover, run states | D1, D3, D7, D8, D10-D14, D17-D25 | operations, recoup layer, reconciliation | yes (12) / yes-refused (7: M44 recoup rate and holiday, locks, postings) |
| Buyout payment installments, fixed fee fields, recoupable expense rate, additional obligation, planned status, explicit recoup priority, reference-compare classes | D2, D4, D5, D6, D9, D16, D26 | credits and deductions with a document; "largest first" (D-049 waiting) | partial (7) |
| Payouts, holds, currency: payout states, exceed, threshold (zero-erp has none), hold, payee, currency, flag | E1-E7 | D-051, D-052, D-013, M30, M50, M24 | yes 2 / yes-refused 5 |
| SoundOn source: snapshots, artist tokens, line recognition, shadow comparison, 50/50 house + pool | F1-F6 | none (map item 26) | partial F1, F4, F5; **NOT COVERED F2, F3**; F6 yes-refused (tax M48) |

Source's NOT COVERED list: A9, A10, A22, B20, C6, C9, C12, C15, F2, F3. Its notes for the next step: a signal `sublabelWithoutRule` (B20), a decision on empty `label_name` (C12), a line naming SoundOn / `fixed_revenue_share` and per-ISRC imprint exclusions as consciously not done. Differences the owner may want to rule on: sublabel cut = half of the label share instead of a fixed percent of net (deal 3), fixed layer order (buyout before carves), recoup netting stricter than zero-erp (D17), recoup priority "largest first" (D16, D-049).

### 2.9 Owner answers of 2026-11-02 (`решения_владельца_2026-11-02.json`, v5)

Counts (45 rows judged): covered 19, partial 11, NOT COVERED 13 (of which 8 are the expected documents counted as 6a-6g, 6i and J7 aggregates), out of scope 2.

| Owner point | Requires | Reflected in | Covered |
|---|---|---|---|
| 2a, 2b, 2d, 3a, 4a, 4b, 4c, 5a-5d, J2, J3, J5, D3-D6, D8-D11 | half of the label share to NoGhost / R2R / 77, Ahh Music = 0to8, scaled rows for three funk titles, Kenke and Eiden XII 15 % off the top, duplicate row, overpayment history | layers, `labels.json`, `participations.json`, G03a-c, G04, G05, G08a | yes (19) |
| 1a: release dates of 201 records unknown (temporary range after 16.10 and not later than 02.11) | a date field or a range per ISRC | no release-date field in the ERP | **NOT COVERED** |
| 1b: windows from release date | participation windows anchored to a release date | computed at load, floored to the month start | partial (new releases without a date get no window) |
| 2c: NoGhost basis "owner decision, contract will be changed" | one rule, pending-change flag | Feb-May 2026 under assumption (C); from 2026-06 an approved contract that says 25 % of net | partial |
| 2e: sublabel as a separate line "Reflected in split: no" | output column | no export | **NOT COVERED** (workbook output) |
| 2f: sublabel half follows remixers and MC only | carve order | Q11 assumption, owner never confirmed order | partial |
| 3b: other imprints of the 406 records | owner list awaited | Q12 half rule under assumption (default opposite to the owner's expectation: no external labels) | partial |
| 4d: artist split re-signed by new appendices | pending-appendix flag | rewrites carry an approved `other` document, not an appendix | partial |
| 6a-6g, 6i, J7: eight expected documents (an RSA, an assignment draft, Dj Svevsx 8A and 8B, DJ M-A 050224M-A, Wool Music, two Mc Gw licences: 21 CENTURY FUNK / BEAT PINOCADA / MONTAGEM LOST MEDIA / MONTAGEM ILUSTRACAO MAGNETICA, and ACIDO) | document registry; money held in C | none entered; money stays B on legacy rows | **NOT COVERED** (8 of 8) |
| 6h: generic missing document -> money in C | `split_unconfirmed`, `assumption`, `rule_unconfirmed` | `categorise.ts`, G10a, G19, G20 | partial (mechanism yes, nothing entered) |
| 7a: economic share and legal interest are different columns | splits store economic share only | true by design, no D-entry | partial |
| 7b: legal interest by basis (owned 100, whole buyout 100, partial buyout seller_pct, exclusive licence 0, "not established") | rights-category field per recording | none, not declared out | **NOT COVERED** |
| 8a, 8b: approvals (Sch2C, Sch2D, Sch4B), assets register | workbook content | out of scope, to be logged | out of scope (2) |
| 9: list of the 779 coverage differences | document-coverage status per ISRC | no coverage-status computation | **NOT COVERED** |
| J1: participant from 2026-02-27, no money before | window with "neither" before | 30 ISRC from 2026-02-01 (27 extra days); earlier months follow the old split | partial |
| D7: no rate invented for labels without a contract | | Q12 half is invented but kept in C | partial |
| 5c: 10 nightcore versions outside the authorisation | flag | 11 ISRC in track notes | covered (count to confirm); counted in the 19 |

Source's NOT COVERED list: (1) 201 release dates; (2) "Reflected in split: no" line; (3) all 8 expected documents; (4) legal interest / rights category; (5) the 779 coverage differences. Partial: 1b, 2c, 2f, 3b, 4d, 6h, 7a, J1, D7, 5c.

## 3. Consolidated uncovered list (de-duplicated across the nine sources)

Raw NOT COVERED rows before de-duplication: contracts 5, Annex 14 5, Believe 3, B17 7, Main 4, report-processor 3, zero-erp 10, owner answers 5 (ERP reference data shares the Believe items), 42 in all; they collapse into **40 items**. Dispositions: (a) became a catalogue case (M53…M58 of `09` section 3), (b) fixed by a stage 6 data step (D-135: pairs, 0to8/lost, LUNAR MEDIA, B17 holders, carve pairs), (c) open item for the owner, (d) consciously out or deferred. Money is as the source reports measured it, before D-135.

### (a) Became a catalogue case (6)

| # | Item | Money that depends on it | Case and status | Sources |
|---|---|---|---|---|
| C01 | Known ISRC under a second, unregistered UPC: 44 pairs, 40 ISRC | unknown_pair 146,717.75 (150,057.35 by direct count), 3,211 units; 82,601.75 would be allocated by splits that exist | **M54**, MVP data; also (b): the D-135 pairs step registers every Believe pair of a known ISRC. Status: closed after D-135, new numbers in 14 | Believe, reference data |
| C02 | Echo8 artist agreements: Echo8 splits without a document | split_unconfirmed 320,636.21 (30.5 % of the Echo8 account) | **M55**, data gap: stays in C until the four Echo8 RSAs and later agreements arrive; also open for the owner | Believe |
| C03 | A sublabel rule cannot exclude an artist's or ISRC's lines: 77 Records `onimanxd` lines (released on 0to8), NoGhost Excluded Projects (solo TRXSHBXY / WARMANE), zero-erp `exclusions` | bounded by the 77 Records net of those tracks (77 Records total about 57 k net; the ISRC DGA062570968 under `0to8 / 77 Records` carries net 22,139.32, C 5,479.63); NoGhost solo releases not measured | **M58**, open, not expressible; also (c): the 77 Records per-artist exception waits for the owner | report-processor, zero-erp, contracts |
| C04 | Sublabel string with no rule in force keeps the whole label share silently; a rule recipient that is also a split row of the same units pays twice (zero-erp B20, A20; report-processor S8) | measured 0.00 in the period (every string starts on or after its rule `valid_from`) | signals `sublabelWithoutRule` and `ruleRecipientIsRow` (D-136), referenced in M58; status: signal added | zero-erp, report-processor |
| C05 | SoundOn-format statements and `fixed_revenue_share` among people named on a line (tokens, 50/50 house + pool) | no SoundOn source loaded; nothing measured | **M56**, later (MVP item 26); a source module is needed | report-processor, zero-erp |
| C06 | Non-economic documents: NDA 36, powers of attorney about 15, DMCA 4, Grammy 2, statements, authorization and reference letters, employment letters, `[DEV]` test file, YouTube channel purchase (USD 25,000, not a Believe or B17 source) | none | **M53**, out | contracts |

### (b) Fixed by a stage 6 data step, D-135 (4; C01 above also)

| # | Item | Money that depends on it | Step | Sources |
|---|---|---|---|---|
| C07 | `0to8/lost` mapped to a sublabel `lost` by the Q12 half rule although Lost Label (M7) is a label representative with its own schedules | net 248.14, our half 41.44 in C `assumption` | D-135 0to8/lost | Believe |
| C08 | LUNAR MEDIA 10 % of income received (Sch3A row 4, "Tem que tirar o chapeu"; 34 recordings): no pseudonym, participation or split row | Annex receipts 60,412.11 (34 recordings by title, retroactive) | D-135 LUNAR MEDIA: participation to a licensor pseudonym (M11, M33, M40); the publishing 20 % stays M34 later | Annex, contracts |
| C09 | B17 holders: 32 rights-holders are owners created from the statements, 0 approved contracts, 1 with terms; payees are matched by the legal name of the party, the index by stage name | author part 1,365,867.46 (measured set), plus the three D-134 quarters 162,471.15 (1,528,338.61 in all); 31 holders at default 50 = 475,070.36 | D-135 B17 holders; the merge into legacy confirmed owners is C18 | B17 |
| C10 | Carve pairs and held rows of Main: 3 payouts (MC 7belo 19,660.71, MC JHonny 4,010.83, ural gaisin 2,092.57 = 25,764.11) wait for a participant credit, and 3 carve rows 11,405.19 are covered by a participation but not loaded; the ambiguous pairs below are separate (C14) | 25,764.11 + 11,405.19 | D-135 carve pairs | Main |

### (c) Open items for the owner (16)

| # | Item | Money that depends on it | Source and note |
|---|---|---|---|
| C11 | No-split money is "ours by default" (D-029, M42 out): 79 ISRC above 1,000 net; at least 23 Echo8 ISRC and several 0to8 ISRC with outside performers look like third-party repertoire (e.g. FR96X2588646 20,774; UKEX32359592 28,634; QZMHM2337230 26,223) | 430,355.45 (all no_split 531,568.05, 3.26 %); shown only as the signal `isrcsWithoutSplit` | Believe; the proposed "watch list" case was not adopted, the owner decides split or "fully ours" document per ISRC |
| C12 | XENO XID participation: Schedule A with the ISRC list and rate is missing | 80 Annex ISRC; USD 12,500 advance exists only as an advance | Annex, contracts |
| C13 | The 8 expected documents (wixsp RSA, LDRR assignment, Dj Svevsx 8A / 8B, DJ M-A 050224M-A, Wool Music, Mc Gw licences x2 incl. ACIDO) and the 779 coverage differences | their money is B on legacy rows; not measured | owner answers pt 6 and 9 |
| C14 | Ambiguous pseudonyms DJ VETA3, DSHZS, MC FLYXO, !Nxght | Main: 25 Expense rows 28,402.51 (22 payouts 27,813.15, 1 advance 500, 2 carve 89.36), Income 32,336.34 + 13,034.81 + 4.02; Echo8: 415 ISRC (424 rows) without split or owner (DJ VETA3 322, DSHZS 78, !Nxght 20, MC FLYXO 4) | Annex, Main, D-131 |
| C15 | The 4 DJ TUUV 12.5 pp buy-out rows on FR96X2623839 / 41 / 42 and one more ISRC: the seller is not a row of the split | not measured (12.5 pp of those ISRC) | Annex |
| C16 | M51 instruments: buy-outs "see the instrument", seller percent per row unknown | 196 ISRC (168 without any ERP split, 28 with) | Annex |
| C17 | The Updated Q2 2026 B17 statement (D-041 refuses a second statement for a loaded quarter; replace-a-statement decision pending) | +184,828.17 payable (417,084.93 against 232,256.76 loaded); author share 50-90 % | B17 |
| C18 | Holder-owner merge (D-083): the 32 holders are not merged into legacy confirmed owners | gate for the whole author part: 1,365,867.46 (+162,471.15 for the D-134 quarters) | B17 |
| C19 | Writer shares are equal parts of our writers (D-087 waiting): contracts may give unequal shares | 3,381 aggregated lines with 2 or more of our writers, payable 1,696,744.28 (78.1 % of A); single-owner lines 474,895.35 unaffected | B17, contracts (co-ownership 90/10) |
| C20 | Publishing buyouts by work (D-045): modelled as whole-owner 0 % | 0.00 live today (6 buyout terms on non-holder owners); live after the merge; CAA, work for hire, assignments of compositions depend on it ([X1]) | B17, contracts |
| C21 | Company payee (D-096): a holder that is a company would hold its lines | not measurable (suffix heuristic finds none); worst case the author part 1,365,867.46 | B17 |
| C22 | NoGhost payments through a third party: Sch3B 7,000 on 2026-09-09 (no operation; nearest is another payee's 7,000 on 2026-09-04), Main sheet "выплаты саблейблам" 15,000 + 25,000 through one artist's Tipalti account, 10 routed payouts (M50 later) | 7,000 + 40,000 + 10,560.91 (+ 2,000 document-only) | Annex, Main |
| C23 | NoGhost basis and re-signing: Feb-May 2026 sit in C `assumption` although the owner decision covers all months; from 2026-06 the approved contract says 25 % of net, so it is right only where the label share is 50 %; Q11 order with label-share carves unconfirmed | NoGhost units 56,159.51 + 31,075.33 net (our half 14,094.78 + 9,930.53 in C) | owner answers 2c, 2f |
| C24 | Other imprints (11 Q12 strings, "odds", "no job records", "Hoboshrine" may be junk) and the 88 Sch3C(i) rows where the percent differs from the Annex (R2R 75-family, Bear, Enarma, no job records) | C `assumption` 11,335.48; imprint nets about 3 k (0to8 family) and 12.3 k (Echo8 family) | owner answers 3b; Annex |
| C25 | Licensor payee and rate: MC ROBA CENA 20 % on FUNK DO SURPRISE (4 recordings, kept as split rows, not redirected to the licensor), ACIDO III 23 % licence vs 25 % registered | not measured | Annex Sch3A rows 7, 8 |
| C26 | Does the administration agreement (90 % general / 50 % Sync) reach back to the 2025 quarters? Now the default 50 applies to 2025-Q3 and Q4 | holder afaed4c7: 322,596 lines, author part 890,797.10 overall | B17 |

### (d) Consciously out or deferred (14)

| # | Item | Money (as measured, outside the ERP result) | Case |
|---|---|---|---|
| C27 | Advertising: Main Advertising 7 rows, PROMO posts, Advertising Summary, report-processor T7 (21 folders: allocation, exclusions, recoup of ads, track recognition) | 2,699.39 not loaded; PROMO posted 1,090,737.65 | M21 later (a deduction operation exists) |
| C28 | Payment fees (EasyStaff 6 %, Tipalti 0.5 %), threshold USD 100, currency (RUB, EUR, RMB, CNY), payees and designated payee, minors, W-8BEN, taxes (9 % label remainder, 30 % USA), locked/frozen quarters, payout-month lag +2, holds | none in the ERP result | M22, M23, M24, M31, M48, M49, M50, M30; payout side later |
| C29 | Legal interest / rights category per recording (owner pt 7): the split stores the economic share | none | out; economic share only (M1, owner decision 7), to be logged |
| C30 | Release dates of 201 records | none | out; windows are computed at load (M36, M52) |
| C31 | Approvals (Sch2C, Sch2D, Sch4B), assets register, claims and counter-claims (Sch4A) | claim receipts 274,207.19 + 31,258.71 + 15,859.96 exposed | out of scope; holds M30 later |
| C32 | Incoming flows and inbound licences: Remixed Records 70/30 flip (Annex receipts 75,647.74), label-to-label 25 % (YATOMI, ARCADIA, SUNDAY), NetEase, Red Bull fee, Clear Music commission, Kurate, Duetti participation back and remittance on non-owned works | our share and the artist share are overstated on the Remixed Records family until entered | M45, M46, M24 later |
| C33 | Recoup variants: recoup holiday "ноу рекап" (17 rows: Expense 54,205.06, Income 7,076.82), 100 %-of-gross recoup (UMBRELLA), Lost Label 50 % marketing, `recoupRate` | 61,281.88 | M44 later |
| C34 | Buy-out prices and one-off fees kept as documents only (24 prices 273,000.00, bonuses and fees 9,000.00) and the netting of the seller's pre-buy-out balance (33 Income rows 24,900.82) | 282,000.00 + 24,900.82 | D-027, M47 |
| C35 | Sch1B withdrawn recordings (10) and other expressly excluded (2): no perimeter exclusion; the 4 `0to8/Echo8` ISRC counted as 0to8 ours | 174.34 and 5,573.47 | M28 "keep last split"; owner answer 1 |
| C36 | Term end and permitted scope as data (Sch1A 10,228 rows; 18 agreements whose term has run out; Main Contracts 28 term dates); only 11 M29 notes | none | M25, M29 (term can be a `valid_to`; scope is a signal) |
| C37 | Lines without ISRC | 1,444 lines, 2,361.85 (0.0145 %) | M41 out, D-035 waits for the owner |
| C38 | Identity-model leftovers of zero-erp: alias key `believe_id`, dated attribution of a release, participant merge undo and identity review, imprint retire/merge, empty `label_name` (measured none), the "Reflected in split: no" workbook line | none measured | reference-data features, not money rules |
| C39 | Licensor publishing interest in new recordings (12.5-50 %) and external co-writers of B17: 14 externals (3 carry about 91 %) | 53,570.45 on 209 lines (equal-share upper estimate 19,462.92); ACIDO title 27,688.02 + 677.84; publishing shares in nine sample letters | M34 later; the ERP leaves the money with the line's owners and raises no signal |
| C40 | Co-publishing terms: 10 % administration fee and cost deduction inside net income, 120 % clearance, "later of 3 years or recoupment", 15-year reversion; no cover type in B17 | none measured | M15, M16: manual period closes |

Counts by disposition: (a) 6, (b) 4 (plus C01 which is both (a) and (b)), (c) 16, (d) 14; total **40**. Items with two dispositions: C01 (a, b), C02 (a, c), C03 (a, c).

## 4. Consolidated partial list (what is missing, one line each)

| # | Partial item | What is missing | Related disposition |
|---|---|---|---|
| P01 | [X1] publishing-side transfer of compositions: asset purchase, work for hire, assignment, beat purchase, CAA, 2022-2024 transfers | a per-work way to zero or redirect a writer's B17 share from a date (terms are per owner) | C20, C19 |
| P02 | [X2] unlisted derivative versions, UPC-wide and title-wide shares, buyouts by title family, Duetti, derivative-works clearance deals | a title-family rule or a detector for a derivative ISRC that appears after entry; only C `unknown_pair` and the manual track note | C01, C03 |
| P03 | [X3] licensor publishing interest | carving 12.5-50 % of the B17 line | C39 |
| P04 | Co-publishing and administration | admin fee, 120 % clear, term/reversion, cover type | C40 |
| P05 | Co-ownership 90/10 composition | unequal writer parts (D-087) | C19 |
| P06 | NoGhost Excluded Projects, Covered Compositions 25 % | per-ISRC carve not stated or tested, composition side later | C03 |
| P07 | Conflicting claims summing above 100 % (Lost Label vs direct schedules; stacking list) | split above 100 % is refused at entry; no overlay and no explicit signal | M39, Q5 |
| P08 | Russian licence on "received or accrued" royalty | accrual basis (ERP is cash-received only), RUB payout | **M57**, later |
| P09 | Duetti participation back, remittance on non-owned album works | incoming income | C32 |
| P10 | Sch3C(i) 88 rows with a different percent; Sch3A row 2 | rule percent per label from the owner's decision | C24 |
| P11 | Sch1B withdrawn / other excluded; 4 `0to8/Echo8` ISRC | perimeter exclusion | C35 |
| P12 | Sch3A rows 7, 8 licensor payee and rate | payee redirect, 23 vs 25 | C25 |
| P13 | M51 196 instruments | seller percent per row | C16 |
| P14 | Sch1A M29 notes for 11 ISRC only | term end and scope data | C36 |
| P15 | Main "ноу рекап", buy-out prices and M47 netting, routed payouts | holiday not modelled, no record of the price, route in the comment only | C33, C34, C22 |
| P16 | report-processor: A12 overlay drift, A14/E3 buyouts by title, S3 Bear/VBR/ENARMA partner, S8 recipient vs row, H1/T4a/T4b UPC-wide share, T2a Echo8 ISRC+UPC key, T2c newest dump wins, T3b one owner two rows, T8c audit of bought-out lists, T9d live-quarter-only redirect | signals or loader policy for each; no "same owner, two rows" guard | C03, C04 |
| P17 | zero-erp partials (29): split validations, payee earned vs payable, fixed house cut, normalised pool, residual, no-split fallback, partner in split, named funding subset, buyout by release, share redistribution, overlay order, sales-month date policy, imprint retire/merge, alias validity, split expectation, buy-out installments, fixed-fee fields, recoupable expense rate, additional obligation, planned status, explicit recoup priority, compare classes, SoundOn snapshots/comparison | each is entered as rows at stage 4 or refused by catalogue (see 2.8); no calculated normalisation (owner decision 4) | C05, C38 |
| P18 | Owner answers: 1b release-date windows, 2c NoGhost, 2f order, 3b other imprints, 4d pending appendix, 6h hold mechanism with nothing entered, 7a no D-entry, J1 settlement window floored, D7 invented half rate, 5c count 10 vs 11 | pending owner input or a D-entry line | C23, C24, C13 |
| P19 | B17: 31 holders with no term (default 50), 2025 admin rate | contract term to attach; reach-back decision | C09, C26 |

## 5. Acceptance statement (map section 8)

Every uncovered element has a disposition: 40 consolidated items, 6 closed as catalogue cases M53…M58, 4 fixed by stage 6 data steps (D-135), 16 open for the owner with the dependent money named, 14 consciously out or deferred. The share in C by reason is explained line by line in section 1.4: 1,216,961.92 (7.46 % of net 16,303,613.59) = owner_unconfirmed 596,745.48 + split_unconfirmed 454,504.72 + unknown_pair 146,717.75 + assumption 11,335.48 + artist_without_owner 5,296.64 + no_isrc 2,361.85, each tied to a case and to a disposition; the B17 quarters are explained in section 1.6 (all `owner_unconfirmed`). Residual caveats: the numbers in sections 1.1 to 1.6 predate the D-135 data fixes and the B17 columns of the D-134 quarters were not re-measured. **The refreshed numbers, the effect of D-135 on `unknown_pair`, the LUNAR MEDIA, carve and B17 holder items, and the acceptance by the council are in `14_verification.md`.**
