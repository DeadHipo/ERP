Verdict: no

Stage 7 council, product member. HEAD `9643b34` (branch `feature/fable-001`), 2026-11-03. Read-only: SELECTs on the
dev database `erp`, read-only `calculate()` scripts (bootstrap of `scripts/mvp/compare-common.ts`), GET calls to the
API on port 3013 (stopped afterwards). My scripts and raw outputs are in the session scratchpad
(`.../scratchpad/s7p/`: `ex.py`, `sub.mts`, `own.mts`, `cmp.py`, `du.mts`, `rec.json`, `sig.json`). No file of the
repository was changed except this one.

One blocker (finding 1): the E1 loader step (D-137 `settlement-prestart`) gives the settlement participant's 15 %
before 2026-02 entirely to LDRR on the settlement ISRCs that have co-artists. Main's payment fact, which D-137 cites as
its source, shows the 15 % split pro rata between the co-artists. About 8.3 k of B is on the wrong owners.

## 1. "Готово" criteria: every ✅ MVP item has a golden test or a data rule with a D-entry

All in `packages/backend/tests/golden.test.ts` (the `describe` "golden master cases (12 §Master cases), end to end"
unless said otherwise). No ✅ item is left without a test or a D-entry.

| MVP item | Closed by |
|---|---|
| 1 M1 | `G01: row A 50` |
| 2 M2 | `G02: rows 16.6 × 3`, `G34 (exactness)` |
| 3 M3 | `G03a`, `G03b: two MCs from the artist pool`, `G03c: MALAME rows as entered` |
| 4 M4 | `G04: remixer off the top`, `G32` |
| 5 M5 | `G05a` / `G05b: NoGhost sublabel half`, `G15`, `G31`, `G41` |
| 6 M6 | `G06 / G07: label owners as rows` |
| 7 M7 | `G06 / G07`; schemes replaced by date: `G13`, `G14`; conflicting schedules: Q5 data rule (D-137 E3) |
| 8 M8 + Echo8 | `G08a`, `G08b`, `G08b (D-130)`, `G08c (E15)`, `G20 (Q12)`, `G33`, `G38`, `G40` |
| 9 M9 | `G09 (M9, M52)`, `G10a / G10b` |
| 10 M11 | `G10a / G10b (Q1, E22)` (licensor row), `G03b` (pool form); base = net: M11 in 09, D-123 Q1 |
| 11 M12 | `G11`, `G35`, `G36`, `G37` |
| 12 M13 | `G12`, `G18b`, `G46` (both entry forms) |
| 13 M10 | `G13 (M10)` |
| 14 M25 | `G14 (M25, M36)`, `G25 (M52)` |
| 15 M26 | `G15 (E1, M26)`, `G16 (E2)`, `G27b` |
| 16 M28 | `G17 (M28, E25)` Duetti; `G42 (MVP 16)` brand artist; withdrawn recordings keep their last split (09 M28, D-131) |
| 17 M18 | data rule D-130 ("Believe = digital, the split percent is the digital column") |
| 18 M14 | `G12`, `G46` (participation from an artist's share); two own rows = data (09 M14) |
| 19 M29 | `signals of 10 §6 without a golden number (M29, D-130)` › `tracksWithNote …` |
| 20–22 M17, M15, M16 | `publishing golden cases G26a-e`: `G26a`, `G26b`, `G26c`, `G26d` |
| 24 Believe 0to8 + Echo8 | `G33: reconciliation per account`, `G40` |
| 25 B17 | `G26e` |
| 29 Main history | `G28 (M27)`, `G43 (iii)`; load D-132 |
| 30 M19 | `G27 / G27b`, `G29`, `G43 (i)`, `G43 (ii)` |
| 31 M20 | `G43 (iii)` |
| 32 M27 | `G28`, `G39 (E20)` |

## 2. Five recordings recomputed (explainTrack, API on 3013)

| ISRC | Month (net) | ERP allocations | My hand computation | Result |
|---|---|---|---|---|
| FRX282688758 (NoGhost) | 2026-08 (10,345.80) | Raiden row 50 % 5,172.90 B; NoGhost sublabel 50 % 2,586.45 **C owner_unconfirmed**; ours 2,586.45 | owner decision 2: label share 50 → half 2,586.45 to NoGhost, 2,586.45 ours | amounts right, category wrong (finding 3) |
| DGA062593864 (Sleeping City Funk) | 2026-08 (1,801.12) | MC MAGRINHO 234.15, Mc Denny 234.15 (pool 13 %); DJ FANGZ, DJ Raulipues, TrongKien 144.09 each (16.667 − 8.667 = 8 %); ours 900.56 | owner decision 4: label 50 % = 900.56; MCs 13 % each = 234.15; artists (50 − 26) / 3 = 8 % = 144.09 | equal. First report month is 2025-10, so the undocumented legacy split (to 2025-10-01) never applies |
| FRX282644590 (remixer) | 2026-08 (11,978.52) | Kenke top 15 % 1,796.78; Sxilwix 1,697.30, TWXNY 1,697.30, Innxcence 1,696.28; ours 5,090.87 | owner decision 5: 15 % off the top = 1,796.78; scaled net 10,181.74 × 16.67 / 16.67 / 16.66 %; label 42.5 % of net = 5,090.87 | equal (first report month 2026-06 = participation start) |
| FRX762590589 (FUNK DO SURPRISE) | 2026-04 (1,207.06) / 2026-05 (989.19) | 2026-04: KXZINVK 23 % 277.62 B, MC Da 12 7 % 84.49 B, MC ROBA CENA 20 % 241.41 **C assumption**, ours 603.53. 2026-05: KXZINVK 0, MC Da 12 69.24 B, MC ROBA CENA 197.84 C, ours 722.11 (73 %) | rows of the registry; the licensor row is a Q1 assumption, so C; buy-out of KXZINVK from 2026-05 → label 50 + 23 = 73 % | equal |
| DGA082458655 (settlement, also DJ Ikeraus buy-out) | 2025-02 (33,085.12); 2026-01 (652.22); 2026-03 (797.03) | 2025-02: DJ Ikeraus 17.5 % 5,789.90, LDRR 32.5 % 10,752.66, ours 16,542.56. 2026-01 (after the buy-out): LDRR 32.5 % 211.97, ours 440.25. 2026-03: participant 15 % from the label share 119.56, LDRR 17.5 % 139.48, ours 538.00 | from 2026-02: settlement 15 % of net from the label share; LDRR 17.5 %; ours 67.5 % = 538.00, **equal**. Before 2026-02 (owner decision 6 + Main's payment fact): the 15 % goes to the co-artists pro rata, DJ Ikeraus 25 % 8,271.28, LDRR 25 % 8,271.28, ours 16,542.56 | **different before 2026-02** (finding 1) |

## 3. Owner balances vs Main: 10 of the 162 unexplained owners (largest residual first)

Method: ERP 0to8-account B + C per report month (one `calculate()`, my `own.mts`) against Main `Income/Royalties` per
report month from `data/mvp-load/main/cash_rows.json`, then per ISRC against the splits and the Annex registry sheet.

| Owner | Residual (14 §9.3) | What the months show | Verdict |
|---|---|---|---|
| 3fecfb7a DJ MH | −24,390 | ERP/Main 0.58–0.62 through 2025-06, 0.79 later, ~1.0 from 2026-06. The ERP rows match the registry (e.g. DGA0R2443390 DJ MH 28 / Mc M4 10 / MC RELL KAMASUTRA 12). Main credited the MC shares to DJ MH, then credited Mc M4 (5,145.45 in 2025-06) and MC RELL KAMASUTRA (8,128.89 in 2025-11) as catch-ups, and booked an Expense "Royalties" 8,128.89 without a month on DJ MH (the loader took it as a payout) | **reference** (Main practice against the owner's registry). The 8,128.89 row is a share transfer, not a payout: the balance effect is the same, but the label is misleading |
| 4e37a283 Zachz Winner | +21,354 | ERP = Main to the cent in every month except 2025-05…2025-12. In those months the second UPC 3617396033894 (registered by D-135) carries 21,225.40 for this owner. Main pays that UPC from 2026-01 | **reference error** (Main did not pay 2025-05…12). The ERP is right; the artist is owed about 21.2 k. 14 §4.3 says "about 13,000"; it is the whole residual |
| 0637477b DJ DYLANFK | −19,463 | Main row 3619 is an extra `Income/Royalties` of 16,325.00 dated 2025-12-15 (report month 2025-10) beside the regular 11,055.50; the rest is about −3.1 k | **reference** (manual Main credit without a report counterpart); a data gap only if a document for that credit exists |
| 14b5366d UdieNnx | −19,083 | ERP/Main 0.90–0.96 in 2025-04…2025-11. The rows match the registry (e.g. DGA0Q2487903 35 + Mc Gw 15; FR59R2595701 20 + HXVSAGE 20 + 10). HXVSAGE's residual goes the other way (+4,775) | **reference** (Main practice: MC shares paid to the artist) |
| e2d3baf4 DJ Ikeraus | −15,034 | From 2025-01 to 2025-07 the monthly deficit tracks 7.5 / 17.5 of his earnings on the settlement ISRCs (2025-01: −1,503 vs 1,256; 2025-02: −2,775 vs 2,563; 2025-03: −818 vs 770). 2025-11: ERP 3,396.69 vs Main 5.43 (buy-out 2025-12-16, floored by M52) | **ERP error** 7,886.93 (finding 1). The 2025-11 month is the M52 convention. The rest is reference |
| a4da9ccf DJ ZENITE | −13,742 | ERP/Main 0.65–0.72 until 2025-05. The rows match the registry (DGA0R2479606 30 / Mc Gw 10 / MC R DE NITEROI 10; buy-out of 25 pp from 2026-06). The MC owner (dc286fd0) had no Main credit until a 37,088 lump in 2025-11 | **reference** (Main practice and catch-up lumps to the MCs) |
| 657b16ca DJ Raulipues | −13,175 | ERP/Main 0.46 in 2024-08…2024-12, rising to 0.9. The deficits are identical to DJ SILVER ZN's in 2024-08…12 (−142.02, −1,139.31, −1,727.57, −1,365.80): the same ISRCs, e.g. QZTB32445510 (Mano Kalebe 17, DJ Raulipues 11.5, DJ SILVER ZN 11.5, MC BM OFICIAL 10 = registry). MC BM OFICIAL is +5,280 the other way | **reference** (Main paid the DJs the MC shares) |
| dc286fd0 MC Fera owner (8 nicknames) | +10,431 | Main royalties are 0 until 2025-11, then lumps (37,088 in 2025-11, 19,664 in 2026-05, 20,260 in 2026-07). The ERP credits the same pseudonyms every month (row 136,350 B; carve 14,712 C; SCF pool 11,405 B) | **reference** (Main catch-up is incomplete). The carve part is in C assumption |
| 3e3c52e6 DJ SILVER ZN | −8,458 | the same ISRCs and months as DJ Raulipues; all of his ERP money is C `owner_unconfirmed` | **reference**; the C part is an ERP data gap (no contract in the index) |
| d60c00c4 MC Denny | −8,294 | ERP > Main by 1.0–2.1 k a month in 2025-12…2026-06 (13 % pool from 2025-10), then Main lumps (14,469 in 2026-07, 20,360 in 2026-08: the retroactive credit, 09 M20 "accrued royalty paid at signing") | **reference** (timing of Main's retroactive credit); about −3.3 k left after the timing |

The LDRR owner (68583cad, explained by the 2 % tolerance) confirms finding 1. ERP − Main per month in
2024-06…2026-01 equals the pro rata candidate in 2024-06 to the cent (26.83 / 26.83) and stays at or above it in every
month (Σ candidate 8,325.87 of Σ excess 9,789.63).

## 4. Findings

1. **Blocker: E1 data step (D-137 `settlement-prestart`) gives the co-artists' part of the participant's 15 % to LDRR
   before 2026-02 (B on the wrong owners).**
   - What D-137 does: it adds the participant's 15 % to the LDRR row "Main's payee; 35 → 50, 17.5 → 32.5, 14 → 29".
   - Source: owner decision 6 says the pre-settlement share belongs neither to the participant nor to the label. The
     only source for who received it is Main's payment fact (map §6), and Main split it **pro rata between the
     co-artists**.
   - Evidence (section 3): DJ Ikeraus' monthly deficit equals 7.5 / 17.5 of his settlement-ISRC earnings; LDRR's
     monthly excess equals the pro rata candidate (2024-06 exactly 26.83); RD12 (−790) and DJ MRCL (−145) are lower
     in the ERP on the four DGA0L ISRCs.
   - The goal's rule is also broken: the split "all to LDRR" has no source, it is an assumption, and its money is B
     (approved document of kind `other` "Owner decision 6 …").
   - Expected (2024-06 … 2026-01):
     - DJ Ikeraus +7,886.93 B (17.5 → 25 on the 24 splits with LDRR 17.5 / DJ Ikeraus 17.5, months before his buy-out
       of 2025-12);
     - RD12 and DJ MRCL +136.57 each (10.5 → 15 on DGA0L2423523…526, where LDRR goes 14 → 20 instead of 29);
     - after the buy-out (2025-12, 2026-01) LDRR keeps 25 and the bought-out half stays with the label: ours +178.18;
     - LDRR −8,325.87; the participant unchanged.
   - Required: rewrite the step so the participant's percent is spread pro rata over the non-participant rows of the
     legacy split. Add a golden case: legacy A 17.5, B 17.5, S 15 before the window → A 25, B 25; from the window
     A 17.5, B 17.5, S 15 from the label share. Re-run the Main compare and update 14 §9.2, 15 §1 and D-137 with a new
     D-entry.

2. **Should-fix: 15 §4 does not list the E1 distribution as a decision that money depends on.** Until finding 1 is
   fixed, the pre-2026-02 rows under "Owner decision 6" are B money on a council reading. Either fix finding 1 (it
   then rests on Main's payment fact, a source) or move it to §4 with its amount. Minor in the same table: Q12 is
   given as 11,297 "incl. NoGhost before 2026-06 4,840" but contains Q11's 63.30, which has its own line.
   - Signals `assumptions` (45 documents): Q12 11,233.63, Q11 (`basis r1`) 63.30, Q1 24,713.23 (FUNK DO SURPRISE
     19,169.49 + LUNAR 5,543.73), Q5 270.31, M43 107,914.94.
   - Σ 144,195.41 = `C_breakdown.assumption` of the reconciliation (138,272.57 + 5,922.83).
   - Every other figure in §4 is right.

3. **Should-fix: the whole sublabel money waits in C, not only NoGhost before 2026-06, and 15 says otherwise.**
   - `calculate()` gives sublabel allocations 0.00 in B. The C amounts (2024-01…2026-08):

     | Sublabel | Money in C | Reason |
     |---|---:|---|
     | NoGhost from 2026-06 | 19,133.97 | `owner_unconfirmed` |
     | 77 Records | 14,326.87 | `owner_unconfirmed` |
     | R2R PRODUCTION | 471.08 | `owner_unconfirmed` |
     | NoGhost before 2026-06 | 4,840.35 | `assumption` |

   - Cause: the owners NoGhost (c31d31a4), 77 Records (d9919aac) and R2R PRODUCTION (202eba71) have no contracts row.
   - NoGhost's approved contract (document 0ad6648f, "NoGhost Exclusive Sublabel Agreement") is attached to the label
     rule only (`scripts/mvp/labels.py`, `owner_id` empty).
   - 77 and R2R have no written contract by owner answer 2. Their basis is the approved document "Owner decision 2",
     which can never confirm an owner.
   - G05a assumes "approved agreement" for NoGhost; the real data does not meet that premise.
   - 15 §3.6 ("the months before 2026-06 wait in C") is therefore incomplete. The NoGhost payments routed through an
     artist's account (13 C22: 7,000; 15,000 + 25,000; 10,560.91) are not on the NoGhost owner, so confirming it
     without them would overstate its payable.
   - Required: state in 15 §3 that all three sublabels' halves (33,931.92 + 4,840.35) wait in C, and why. Ask the
     owner whether owner decision 2 confirms 77 and R2R. Link the NoGhost contract to its owner only together with the
     routed payments (M50).

4. **Should-fix: 15 §3 omits open items of 13 §3(c).**
   - C26 is missing: the administration terms 90 / 50 apply from 2026-01-01, so the 2025 quarters of holder afaed4c7
     sit at the default 50 % in C.
   - C11 is missing: 430 k of no-split money is "ours" by D-029 and may be third-party repertoire. It is only
     mentioned in §2, not as an open item for the owner.
   - C25 is partial: the ACIDO III 23 % licence vs 25 % registered is not mentioned.
   - C22 is partial: §3.6 names 7,000 and 25,000; 13 has 7,000, 15,000 + 25,000 and 10,560.91.
   - Required: add these lines.

5. **Should-fix: Zachz Winner and similar residuals are explained.**
   - The +21,353.95 is UPC 3617396033894 in 2025-05…12 (21,225.40), which Main did not pay; Main pays it from
     2026-01. It is a Main error, and the artist is owed about 21.2 k.
   - 14 §4.3 ("about 13,000") should say so, and 15 §3.10 should name it as money the owner owes, not as unexplained.
   - The other residuals in section 3 are of two kinds:
     - Main paid the MC shares to the main artist and caught up later: DJ MH, UdieNnx, DJ ZENITE, DJ Raulipues,
       DJ SILVER ZN, MC Fera owner, MC Denny. The registry ranks higher, so these are reference differences.
     - Single Main credits without a report: DJ DYLANFK 16,325.00.
   - Recommended: one cause "Main paid the MC share to the artist" in the decomposition. It would explain most of the
     162 owners without new data.

6. **Note: `compare-main` loads Main Expense rows without a month as payouts even when they are share transfers.**
   Example: DJ MH 8,128.89, booked as income to MC RELL KAMASUTRA in the same ledger. The balance effect is the same as
   a deduction, but the operation's meaning is wrong. Worth a reclassification when the carve groups are next touched.

7. **Note: Duetti (owner bc75ffe5) is not confirmed.**
   - After the sale its ISRCs carry −842.91 + −54.11 in C `owner_unconfirmed`: Believe's last lines after the sale
     month are a −910.52 correction in 2026-06.
   - The amounts are as expected: 2026-05 still ours on the 112 ISRCs sold from 2026-06; 135 ISRCs from 2026-05.
     Confirmation would not change anything material.

8. **Note: wording and drift.**
   - 10 §9 (D-136) calls owner answer 7 "legal interest on late payments". The answer is the legal interest (rights
     category) of a recording, as 13 C29 says correctly.
   - `sublabelWithoutRule` now fires 10 times for `lost` after 2025-10 (D-135 closed the rule instead of re-pointing
     the alias). This is expected, but 13 C04 still says "measured 0.00".
   - 15 §2 mixes 13's C figures, which exclude report month 2024-01, with the reconciliation figures, which include
     it: `owner_unconfirmed` 594,153 vs 594,161.85.

## 5. 13 §3 dispositions (spot check of 8)

| Item | Disposition | Check | True? |
|---|---|---|---|
| C07 `0to8/lost` | (b) fixed, D-135 | alias still points to sublabel `lost`; its rule is closed at 2025-11-01, only October 2025 C assumption 2.89 is left, as D-135 states | yes (D-135 title says "alias of 0to8"; the database closes the rule instead) |
| C08 LUNAR MEDIA | (b) fixed, D-135 | 34 participations, 10 % `(net, artist_pool)` from 2025-03-01, unapproved assumption document; C 5,543.73 | yes |
| C09 B17 holders | (b) fixed, D-135 | 32 owners of origin `publishing`, 13 with an approved contract; 19 left in `owner_unconfirmed` (520,584.25) | yes |
| C12 XENO XID | (c) open | 15 §3.2 | yes |
| C17 Updated Q2 2026 B17 | (c) open | 15 §3.8 (+184,828.17, D-041) | yes |
| C22 NoGhost routed payments | (c) open | 15 §3.6 names part of the amounts | partly (finding 4) |
| C27 advertising | (d) out | 10 §9 "M21 ads" | yes |
| C37 lines without ISRC | (d) out | 10 §9 "M41 no-ISRC folding (D-035 ⚠)" | yes |

The (a) cases M53…M58 exist in 09 §3 (checked M54, M58).

## 6. What would make it yes

Fix finding 1 (loader step and golden case, re-measure, new D-entry). Correct 15 §3 and §4 per findings 2–5.
