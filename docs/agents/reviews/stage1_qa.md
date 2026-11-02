Verdict: yes

# Stage 1 review: QA (`docs/agents/09_settlement_cases.md`), 2026-11-02

Reviewer: QA member of the council (read-only). Checked against ClickHouse `believe.rows` (only the 47 `loaded` files
of `public.source_files`), PostgreSQL `erp`, `context_data/Annex 14_beta (обновлено покрытие).xlsx` (stdlib reader) and
the contract folders. HEAD `86c3383`, branch `feature/fable-001`.

The §1 facts and the sampled examples are correct: every number matches to the cent or within rounding, and every ISRC
exists with the stated receipts. Revision 1 was rejected for three reasons. First, one Annex claim is misclassified in a
way that would drop real buyouts in stage 4. Second, the catalogue marks the buyout case (M9) "exact" although the ERP
and Annex give different amounts in the month the buyout takes effect. Third, the catalogue has no list of edge cases
per layer, so stage 2 has no checklist for its golden cases. All three fixes are small (a few rows and one section).

## Revision 2 (re-review, 2026-11-02)

Verdict changes to **yes**. I re-read the rewritten `docs/agents/09_settlement_cases.md` (389 lines) and re-checked the following.

Fixed:
- **B1 fixed.** M9 now says 767 transfers + 578 contributor buy-outs (294 pp + 88 whole + 196 "not stated per recording"), and the 196 are a new case, M51. This matches my Sch3C(ii) Basis × Interest cross-tab. §4 records the revision-1 error.
- **B2 fixed.** M52 and the §4 verdict are in. D-025 stays, and the entry rule sets `valid_from` to the first day of the month that contains the effective date. Stage 4 normalises the 1,043 legacy dates. §1 states the 458 unit-months / 13,363.21 / DGA072567654 2,223.72 exactly as I measured them. Safety check: no ISRC has two splits whose `valid_from` fall in the same month, and no split has `valid_to` in its own start month. Both queries on `splits.splits` return 0, so the normalisation cannot create empty or overlapping periods.
- **B3 fixed.** §7 lists E1–E25 with the layer, evidence and expected treatment, and covers every item of my table. E18 (all layers combined on one ISRC) is handed to `12_golden_cases.md` with a hand answer.
- **S1 fixed.** Q12 covers the unlisted and Echo8 sublabels (assumption → C), including the qaraqshy advance.
- **S2 fixed.** NoGhost is now about 87.3 k (56,160 + 31,075 + 49).
- **S3 fixed.** §1 has a row for participants already stored as split rows, M43 has the migration rule, and E16 refuses the double entry.
- **S4 fixed.** The meaning of Sch3C(i) is stated.
- **S5 fixed.** Paths use the prefixes `PD/`, `R/` and `P37/`. I spot-checked 7, and all exist: `PD/` DJ TUUV CAPA, the ILLXSION and LEXFEED co-ownership agreements, Matra; `R/` GRIXOR RSA and Lost Label Schedule C; `P37/3.4 Fixed term/` DYLANFK Schedule C. The Maroi letter is now under `P37/3.5`.
- **S6 fixed.** The privacy line is now a neutral description. A grep for the legal surnames and first names seen in the folder file names finds nothing.
- **S7, S8, N1, N3–N7 addressed.** Two-UPC ISRC and the complementary cross-account reporting are in §1, E9 and E13. The Echo8 unknown bucket, the negative and zero units, and ACIDO III (E22) are in.

Remaining (should-fix for stage 2, not blocking):
- **R1. E5 and E6 treat a sublabel ISRC differently with no source.** An all-zero split gets the sublabel half of 100, but no split at all gives the sublabel nothing (D-029 "ours"). Owner decision 2 is phrased on "the label share", which is 100 in both cases. On real data this moves NoGhost 139.37 and makes the Echo8 sublabels (qaraqshy, fate music, CATCORE, SF Records: about 12.3 k, all with no split) earn 0. The qaraqshy advance of 20,000 could then never recoup. Stage 2 should either treat both the same way or record the difference as an assumption in a D-entry, and write a golden case for each.
- **R2. Q11 needs an answer before the golden cases.** The order of a label-share carve and the sublabel half is an assumption. E18 depends on it, so `12_golden_cases.md` must state which order its hand answer uses.
- N8 still stands: the `0to8 Main.xlsx` figures were not rechecked by QA.

The test baseline below is unchanged, since there have been no code changes since `86c3383`.

The findings and edge-case table below are from revision 1. They are kept for traceability; the §7 table of the catalogue now supersedes my edge-case table.

## Test baseline (for stage 3)

- `npm run typecheck`: clean (backend, frontend, shared), exit 0.
- `REQUIRE_STACK=1 npm test`: **18 files, 187 tests, 187 passed, 0 failed, 0 skipped**, 7.6 s (stack up).
- Lint was not run: it was not part of this review.

## Verification of §1 (own queries)

All on `file_id IN (loaded files)`; A1 = account 1052428, A2 = account 1055956.

| Claim | Own result | Match |
|---|---|---|
| 47 files, 75.7 M lines, net 16,338,476.40 | 47 files; 75,744,752 lines; net 16,338,476.40; gross 19,324,727.34 | yes |
| A1: 34 files, 2023-11…2026-08; A2: 13 files, 2025-08…2026-08 | same; A1 net 15,287,531.30, A2 net 1,050,945.10 | yes |
| Echo8 in A1 2024-12…2025-07, net 222 k | `label_name='Echo8'` in A1: 2024-12…2025-07, net 222,129.81, plus **one stray line in 2025-12 (−0.06)** | yes (note S8) |
| 2,436 ISRC in both accounts, zero identical lines | 2,436; full 21-column fingerprint match A1∩A2 = 0 lines; looser key (sales month, platform, country, UPC, ISRC, sales type, subscription, quantity, net) = 0 | yes (note S8) |
| Imprints: 0to8 90.6 %, Echo8 7.7 %, 17 ISRC change label | 90.57 %, 7.72 %, 17 | yes |
| sales_type: Stream 16.5 M, Creation 0.39 M, Download 25 k, Promotion −581.6 k since 2024-04 gross = net, Abnormal −33 | 16,506,757.86 / 387,911.28 / 25,462.15 / −581,621.61 (gross −581,621.61, from 2024-04) / −33.28 | yes |
| Negative lines 5.44 M, −624 k, 3.8 %, 234 k Stream | 5,438,279; −624,280.92; 3.82 %; 234,634 | yes |
| No ISRC: 1,444 lines, 2,364, all Download | 1,444; 2,364.33; all Download | yes |
| gross/net 1.1765 before promo, ~1.18 after | Stream 1.1765; all 1.1828 | yes |
| Split coverage 2024-01…2026-08: 89.6 / 6.6 / 3.3 / 0.5 | split in force 89.60 %; track known, no split 6.58 %; unknown 3.33 %; all-zero split 0.48 %; no ISRC 0.01 % (base 16,331,738.52, both accounts) | yes (note N5) |
| 1,114 owners all `person`, 341 confirmed; 1,107 artists | 1,114 `person`; 341 owners with an approved contract; 1,107 artists | yes |
| 13,610 splits / 24,754 shares, 0 above 100, 447 all-zero | 13,610 / 24,754; 0 shares or splits above 100; 447 all-zero | yes |
| B17: 4 statements, 1.05 M lines, 2.17 M payable | 4; 1,054,229 lines; 2,171,639.63 | yes |
| 0 operations | `settlements.operations` = 0 | yes |
| B17 `operation_type`: Mechanical 1.34 M, Performance 0.54 M, Sync 0.29 M, Print 7 k; dropped by the accrual query | 1,335,151.24 / 537,170.71 / 292,421.36 / 6,896.32; `aggregatedLines()` in `packages/backend/src/modules/publishing/repository.ts` groups without `operation_type` | yes |
| 32 holders mapped, 14 external; pub_terms 92 × 50 %, 6 × 0 % | `pub_writers` 46 rows, 32 with owner; `pub_terms` 92 × 50, 6 × 0 | yes |

## Verification of examples

ISRC receipts are taken from A1, by report month 2024-01…2026-08. All exist in ClickHouse:

| ISRC | Catalogue | ClickHouse | Note |
|---|---|---|---|
| FR10S2620775 | 243,762.88 | 243,762.87 | split BellyJay 50 in PG and Annex |
| FRX282572355 | 447,364.22 | 447,364.22 | 25 + 25 in PG and Annex |
| FRX282644590 | 15,312.89 | 15,312.89 | Annex Derivative authorisations same |
| FRX282644591 | 28,856.32 | 28,856.32 | same |
| FRX282688758 | 11,349.90 | 11,349.90 | `label_name` NoGhost Records, Raiden 50 |
| QZWFT2628432 | 605.70 | 605.70 | R2R PRODUCTION, split 70 → label 30 → 15/15 (Annex 0.15) |
| DGA082458655 | 90,984.38 | 90,984.39 | **2 UPC** on this ISRC; ERP split change dated 2025-12-16 |
| DGA072567654 | 40,442.37 | 40,442.38 | ERP split change dated 2026-08-13 |
| FRX762590589 | 31,682.16 | 31,682.16 | ERP split already holds MC ROBA CENA 20 % and MC Da 12 7 % **of net** (S3) |
| DGA062593864 / 863 | ~1.9 k difference | 28,850.67 + 14,456.17; 4.2 pp × 43,306.84 = 1,819 | consistent |
| QZPLR2584788 | valid ISRC | exists, 135.11 | |

Annex sheets:

| Claim | Own result | Match |
|---|---|---|
| Sch3C(i) 730 rows | 730 rows, 730 ISRC, **all "sub-label allocation"** (50 %: 371, 25 %: 247, 15 %: 91, 50.2 %: 19, 75 %: 2) | count yes, meaning see S4 |
| Sch3B 84 advances / 257,050 / 223,965.44 | 84 (64 open, 20 partial) / 257,050.00 / 223,965.44 | yes |
| Sch1B 4,359: Echo8 4,104, Duetti 243, withdrawn 10, other 2 | same | yes |
| Derivative authorisations 13 rows / 7,513.16 | 13 rows: 2 authorised (44,169.21) + 11 outside (7,513.16) | yes (N3) |
| Sch3C(ii) 1,345 ISRC; partial in pp 294; whole 88; **963 transfers between own entities** | 1,345; 294; 88; **767 transfers + 196 contributor buy-outs "not stated per recording"** | **no** (B1) |

Contract paths: the 23 named files and folders exist. The exceptions are listed in S5.

## Findings

### Blockers

**B1. Sch3C(ii) misclassification: 196 contributor buy-outs are counted as "transfers between own entities".**
Evidence: Sch3C(ii) column "Basis" × "Interest acquired": `Transfer between the Seller own entities` = 767 rows; `Buy-out from a
contributor` = 578 = 294 (pp) + 88 (whole) + **196 "not stated per recording; see the instrument"**. M9 says
"963 ISRC are transfers between the seller's own entities", and M10 says that for such transfers "nothing changes in money".
If stage 4 follows that, 196 real buy-outs never move the seller's share. Required change: correct M9 (767 transfers;
196 buy-outs with the interest only in the instrument), and add a case/data rule "buy-out with the interest not stated per
recording". Its stage 4 treatment: read the instrument; until it is read, the share stays where the split puts it and is
listed as an assumption.

**B2. The boundary for dated instruments is missing. M9 "exact" contradicts Annex in the month the change takes effect.**
Evidence: 1,043 of 13,610 splits have a `valid_from` that is not the 1st of a month (`extract(day from valid_from)<>1`).
D-025 applies them from the next report month. Annex "Splits by ISRC" applies them **in the month of the effective
date**: DGA082458655 0.675 from 2025-12 (instrument 2025-12-16), DGA072567654 0.75 for 2026-08 (2026-08-13), FRX762590589
0.73 from 2026-05 (2026-05-26). Own computation over the units 2024-01…2026-08: **458 unit-months, 13,363.21 net**
shift to the label under the Annex rule. The largest is DGA072567654 2026-08 (2,223.72). The same boundary decides M10,
M28 (Duetti 2026-05-08 / 2026-06-01), M33 and M35 (2026-02-27). Required change: add the contradiction to §4 with a verdict.
D-025 stays in force (the next report month), or the council changes it with a new D-entry. Stage 5 must explain this
difference and must not fit the numbers to Annex. Add "instrument effective mid-month" to the edge-case list.

**B3. No edge-case list per layer.** §6 gives the order of the layers but not the boundary cases that golden tests must
pin. Stage 2 cannot check its golden cases for completeness without that list. Required change: add a section with the list below
(at least the items marked "missing"), each with the real example or count given here.

### Should-fix

**S1. No rule for the Echo8 sublabels and the 0to8 imprints that are not listed.** The owner decision 2 names only NoGhost, R2R and
77 Records. The owner answer 3 asks for the list of other imprints. Data 2024-01…2026-08 shows the following. Echo8 sublabels
have **no split at all**: qaraqshy records 6,841.85 (with a 20,000 advance in Sch3B), fate music 2,722.60, CATCORE 2,619.91,
SF Records 129.52. Unlisted 0to8 imprints: `0to8 / Enarma records` 2,094.39, `0to8 / VBR` 160.25, `0to8 / PCR` 121.71,
`0to8 / Bear catalogues` 78.47, `odds` 246.86, `no job records` 1.41, `Hoboshrine` 5.97, `0to8 x ENARMA` 0.50. Annex
Sch3C(i) treats Enarma, VBR and Bear as 25 % sub-label allocations. M5 calls report-processor's 25/25 for Bear/VBR/ENARMA
"superseded by the owner rule", but the owner rule does not cover them. Required change: add an open question with a proposed
answer and money treatment (C "assumption" per the goal), and state how the qaraqshy advance recoups when no split exists.

**S2. NoGhost net is understated.** M5 gives "NoGhost 56 k". By the `X / 0to8` rule, the following also belong to NoGhost:
`NoGhost Records / 0to8` 31,075.33 (20 ISRC) and `0to8, NoGhost Records` 49.25. Total ≈ 87.3 k. Required change: correct the
figure. It is the largest sublabel amount and the base of the 50,000 NoGhost advance scope (Q10).

**S3. Some participants are already split rows today, and M11 "Now: none" hides this.** FRX762590589 holds MC ROBA CENA 20 %
and MC Da 12 7 % as split rows of **net** (PG `splits.split_shares`). Sleeping City Funk DGA062593864 holds MC MAGRINHO 13 %
and Mc Denny 13 % as split rows (sum 50). When the participation layer is added, these rows would be paid twice unless they
move out of the split. Required change: fix M11/M3 "Now", and add a migration rule: a participant moves from the split to
the layer in the same change, never in both. Add a golden case "participant present as a split row and as a layer" whose
answer is "refused / signal".

**S4. The map's "Sch3A: 730 ISRC participations outside the split" is wrong, and the catalogue does not correct it.**
All 730 Sch3C(i) rows are sub-label allocations: 366 Ahh Music + 5 `no job records` at 50 %; NoGhost, 77, Enarma, VBR and Bear at 25 %;
R2R and 77 at 15 %; Ahh Music at 50.2 % and 75 %. Sch3A itself has 9 data rows. Required change: say what Sch3C(i) is. It is the
Annex reference for M5/M8, and it also shows Annex's Ahh Music deduction on 383 recordings (owner decision 3).

**S5. Example paths are imprecise.** 13 files written as `Root/...` are in `PandaDoc_documents_0 (2)/Root/`, not in
`context_data/Root`: Kenke remix, DJ TUUV CAPA, JET sample licence, Maximum Madness, Matra, era, DRXG co-ownership, DJ ZENITE
co-pub, the M16 publishing admin agreement, DJ KAI01 advance, beat purchase, both SXLLX RSAs. Only the Lost Label Schedule C
and the GRIXOR RSA are in `context_data/Root`. The Maroi letter is in `для_разработчика_37_документов_2026-11-02/3.5 Not yet
documented (featured vocalists, cleared by licence)/`, not in `3.10 Third-party licences`. The Schedule C of M2 and the
RDAA of M3 are in `3.4 Fixed term/`. Required change: write the full relative paths.

**S6. Privacy: line 146 (M16 example) quotes a file name that begins with a person's first name.** Required change:
replace it with a neutral description, for example "the related-party exclusive publishing administration agreement, PandaDoc Root".

**S7. Two UPC for one ISRC is not mentioned.** 105 ISRC carry more than one UPC in the data, with 1,338,259.98 net
(for example DGA082458655, a buy-out example). The unit key is ISRC + UPC. Rules are keyed by ISRC, and the M19 scope is
ISRC/UPC lists (Matra: 4 UPC of 7). Required change: list it as an edge case. Answer to fix: a rule by ISRC applies to every
UPC, and a rule by UPC applies only to that release.

**S8. Cross-account reporting is complementary, not duplicated.** There are 6,551 (ISRC, sales month) pairs in both accounts.
For sales month 2025-07 they are split by platform: A1 41,082.00 (YouTube, Apple, Snapchat…) and A2 40,760.56 (Spotify,
Yandex, TikTok…), with no common platform. The claim "zero identical lines" holds, but the catalogue should also say the
following. One ISRC and one sales month can sit in two accounts, so the label of record must come from `label_name` per unit
and be the same in both. A1 has one stray Echo8 line in report month 2025-12. Echo8 units in A2 under legacy 0to8 splits:
69,070.94 net. Required change: one sentence in §1 and an edge case.

### Notes

- **N1.** The thirds figure "752 ISRC, 1.47 M" could not be reproduced. Annex "Splits by ISRC" has 896 ISRC with 0to8 share 0.502
  (819 with A1 receipts, 1,508,754.85). The ERP has 1,193 ISRC with split sum 49.8 (885 with receipts, 1,535,947.31). State the
  filter used.
- **N2.** The "Sch3A row N" references use data rows (sheet row − 2). Say so; row 9 is sheet row 11.
- **N3.** Derivative authorisations: 11 rows are outside the authorisation. One of them, FRX992667050 (0.87), is on another UPC. The owner answer 5
  says "10 versions". The money 7,513.16 matches.
- **N4.** "`0to8/Echo8` (24 + 4 ISRC)": the data shows 24 `0to8/Echo8` and 2 `0to8, Echo8`. The 4 are `0to8 / Ahh Music`.
- **N5.** The whole "ISRC unknown" bucket (3.33 %, 543,209.59) is in the Echo8 account. Only 69 k of A2's 1.05 M is under a split.
  Stage 4 must bring Echo8 splits in, or most Echo8 money stays "ours by default".
- **N6.** Annex Sch3A data row 8 (ACIDO III): the licence rate differs from the rate registered and paid (23 % vs 25 %). This is a
  licence-vs-registry conflict of the M39 type. Add it to the M39 examples.
- **N7.** Zero net: 815 zero lines and 7 zero units (ISRC + UPC + report month). Negative units: **438 unit-months, −959.73**.
- **N8.** `0to8 Main.xlsx` figures (Lost Label, RioX, Echo8 sheet, Expense rows) were not rechecked in this review.

## Edge cases golden tests must cover (per layer of §6)

Mark: **in** = the catalogue mentions it; **partial** = it mentions the case but gives no example or treatment; **missing**.

| # | Edge case | Layer | Real evidence | Catalogue |
|---|---|---|---|---|
| E1 | Negative unit net (the whole unit below zero), each layer keeps the sign, sublabel half of a negative label share | all | 438 unit-months, −959.73; promo −581.6 k | partial (M26 "sign test per layer") |
| E2 | Zero net unit, no division by zero, no empty rows | all | 7 units, 815 lines | missing |
| E3 | Participations above their pool: artist-pool participants above the artist pool; off-the-top + split + participations above 100 | 2, 4 | Sleeping City Funk Annex sum above 50; M39 | partial (M39 signal only, no money rule) |
| E4 | Label share 0 (split = 100): sublabel gets 0, label-share participation gets 0 | 5, 6 | 87 splits at 100 | missing |
| E5 | Label share 100 (split all-zero or no split): sublabel half of 100 | 3, 6 | 447 all-zero splits; Ahh Music 19,694.98 under all-zero | partial (fact only) |
| E6 | Sublabel imprint on an ISRC with no split | 1, 6 | qaraqshy 6,841.85, fate 2,722.60, CATCORE 2,619.91, NoGhost 139.37 | missing |
| E7 | Rule starting mid-history (participation from 2026-02-27, retro Kenke, window from release date) | 2, 4, 5 | M33, M35, M36 | in |
| E8 | Instrument effective mid-month (buy-out, assignment, sale) | 3 | 1,043 splits; 458 unit-months, 13,363.21 | missing (B2) |
| E9 | Two UPC for one ISRC: rule by ISRC vs by UPC; advance scope by UPC | 3, recoup | 105 ISRC, 1.34 M; DGA082458655 | missing (S7) |
| E10 | Echo8 unit with a 0to8-paper artist (or identical paper with both entities) | 1, 3 | SXLLX; 69 k of A2 under legacy 0to8 splits | partial (M8, M39) |
| E11 | Unit with an unknown pair / unknown ISRC: category C, which our label | 1, 7 | 543 k unknown, all in A2 | partial (fact only) |
| E12 | Split unconfirmed (no approved document) with an approved participation on top: category of each part | 3, 4, 7 | 773 of 1,114 owners without an approved contract | missing |
| E13 | Same ISRC and sales month in two accounts (different platforms): same label of record | 1 | 6,551 pairs | missing (S8) |
| E14 | ISRC whose `label_name` changes over time: rule per unit-month | 1 | 17 ISRC | in |
| E15 | Imprint string not in the dictionary | 1 | Enarma, VBR, PCR, Bear, odds, no job records, Hoboshrine | missing (S1) |
| E16 | Gross base on promo lines (gross = net, negative) | 2, 4 | Platform Promotion every month since 2024-04 | missing |
| E17 | Participant both as a split row and as a layer (double count) | 3, 4 | FRX762590589, DGA062593864 | missing (S3) |
| E18 | Duplicate split rows of one person under two pseudonyms | 3 | Sleeping City Funk (two rows of one person, Annex) | in (M3) |
| E19 | Rounding: thirds residue to the label; cents of a chain of layers so that A = B + C + ours holds exactly | 7 | 16.6 × 3; RioX 99.9 | partial (residue only) |
| E20 | All layers combined on one ISRC (off-top + artist pool + label participation + sublabel) | 2–6 | no real single ISRC named | missing (the goal requires combinations on one ISRC) |
| E21 | Buy-out with the interest not stated per recording | 3 | 196 Sch3C(ii) rows | missing (B1) |
| E22 | Rule entered retroactively after a payout of that month: snapshot vs recalculation, payable negative | payout | Kenke retro; M27 | partial |
| E23 | Advance recouped only from a participation or a sublabel share; sublabel share zero or negative in a month | recoup | Matra, XENO, NoGhost 50,000 | in (M19, Q10) |
| E24 | Licence rate differs from the registered and paid rate | 4 | ACIDO III 23 vs 25 | missing (N6) |
| E25 | Participation window ending mid-history (3 years from release) | 4, 5 | Maximum Madness | in (M36) |

## Re-review condition

Fix B1–B3 (corrected Sch3C(ii) numbers and the case; the mid-month contradiction in §4 with a verdict; the edge-case
section). S1–S8 should be fixed in the same pass, since they are one line each. QA will then re-run the B1/B2 queries and
say yes.
