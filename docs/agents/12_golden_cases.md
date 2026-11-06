# Golden cases: synthetic scenarios with hand-computed answers (stage 2, 2026-11-02, revision 2)

Every case is a test in `packages/backend/tests/golden.test.ts` (end to end on the private stack) or in
`tests/layers/*.test.ts` (pure layer functions). The answers below were computed by hand from the contract rule
before any code; the test asserts them exactly (decimal strings). Synthetic data only: ISRC `QZTST26000NN`,
UPC `1234567890123`, owners "Owner X", pseudonyms single letters.

Conventions unless a case says otherwise: one Believe file of account 1052428, report month 2026-03, one unit with
net 100 and label string `Test Label`, which the test fixture registers as an alias of the own label 0to8; every
document is approved and every owner confirmed; percents are written as stored (up to 6 decimals). "ours" is the
remainder of the label of record. B = confirmed, C = waiting (reason in brackets). A participation is written as
(base, funded_from): `(net, top)`, `(net, artist_pool)`, `(net, label_share)`, `(bucket, label_share)`,
`(bucket, artist_share of X)`.

Layer order (10 §3): label of record → perimeter → off the top → split → carves (pool, artist share, label share,
sublabel) → categorise.

## Master cases

| # | Scenario (rules in force) | Expected allocations | B | C | ours | Case |
|---|---|---|---|---|---|---|
| G01 | row A 50 | A 50 | 50 | 0 | 50 | M1 |
| G02 | rows A 16.6, B 16.6, C 16.6 | A 16.6, B 16.6, C 16.6 | 49.8 | 0 | 50.2 | M2, M37 |
| G03a | floor title entered scaled: rows A 33.333333, B 16.666667 | A 33.333333, B 16.666667 | 50 | 0 | 50 | M3a (owner decision 4, Trilalero) |
| G03b | rows A 25, B 25; participations M1 13 `(net, artist_pool)`, M2 13 `(net, artist_pool)` | targets 13 + 13 = 26 from the pool 50 pro rata: A 12, B 12; M1 13, M2 13 | 50 | 0 | 50 | M3b (Sleeping City Funk) |
| G03c | rows A 29.761905, B 10.119048, C 10.119047 (MALAME, entered scaled from 50/17/17 to the pool 50) | as entered | 50 | 0 | 50 | M3a (MALAME): the registry decides the rows; the test pins that nothing rescales them |
| G04 | rows A 25, B 25; participation R 15 `(net, top)` | R 15; scaled net 85: A 21.25, B 21.25 | 57.5 | 0 | 42.5 | M4 (owner decision 5) |
| G05a | label string `NoGhost Records` (sublabel of 0to8, rule 50 → pseudonym NG of owner "NoGhost Records", kind label, approved agreement); row A 50 | A 50; NG 25 | 75 | 0 | 25 (0to8) | M5 |
| G05b | as G05a with row A 70 | A 70; NG 15 | 85 | 0 | 15 | M5 |
| G06 | row RX 66.6 (pseudonym of owner "RioX", kind label), no artist rows | RX 66.6 | 66.6 | 0 | 33.4 | M6 |
| G07 | row LL 25 (pseudonym of owner "Lost Label", kind label) | LL 25 | 25 | 0 | 75 | M7 |
| G08a | label string `Ahh Music` (alias of 0to8); row A 50 | A 50 | 50 | 0 | 50 (0to8) | M8 (owner decision 3) |
| G08b | label string `Echo8` (own label); row A 50 | A 50 | 50 | 0 | 50, in `ourShareByLabel.Echo8` | M8 |
| G08c | label string `Mystery Records` (not in the dictionary); row A 50 | A 50; the remainder 50 is C `label_unmapped`; the `labelUnmapped` signal lists `Mystery Records` with net 100 | 50 | 50 (label_unmapped) | 0 | E15 |
| G09 | row A 50 from 2020-01-01; partial buy-out: change from 2026-03-15 (floored to 2026-03-01) to A 25 with a buyout document; full buy-out from 2026-05-10 (floored to 2026-05-01); units in 2026-02, 2026-03, 2026-05 | 2026-02: A 50 / ours 50; 2026-03: A 25 / ours 75; 2026-05: no row (percent 0 is skipped) / ours 100 | | | | M9, M52 |
| G10a | rows A 23, L 20, D 7 under one approved appendix; the row L carries its own document of kind `assumption` (Q1) | A 23, D 7; L 20 C `assumption`; the signals' assumption list shows that document with 20 | 30 | 20 (assumption) | 50 | M11 rows, Q1, E22 |
| G10b | as G10a after a full buy-out of A from 2026-05-01 (rows L 20, D 7) | D 7; L 20 C | 7 | 20 | 73 | M9 + M11 |
| G11 | row A 50; participation P 15 `(bucket, label_share)` | P 7.5 | 57.5 | 0 | 42.5 | M12 |
| G12 | row A 50; participation E 10 `(bucket, artist_share of A)` | E 5; A 45 | 50 | 0 | 50 | M13 |
| G13 | row A 50 until 2026-06-01; from 2026-06-01 row A2 50 (pseudonym of another owner, assignment document); units 2026-05 and 2026-06 | 2026-05: A 50; 2026-06: A2 50 | | | 50 each | M10 |
| G14 | row A 50; participation P 15 `(bucket, label_share)` valid 2026-01-01 … 2026-04-01; units 2026-03 and 2026-04 | 2026-03: P 7.5, ours 42.5; 2026-04: no P, ours 50 | | | | M25, M36 |
| G15 | net −100; label `NoGhost Records` (rule 50 → NG); rows A 25, B 25; participation R 15 `(net, top)` | R −15; scaled net −85: A −21.25, B −21.25; label share −42.5 → NG −21.25 | −78.75 | 0 | −21.25 | E1, M26 |
| G16 | net 0; rows A 25, B 25; participation R 15 `(net, top)`; label `NoGhost Records` | allocations R 0, A 0, B 0, NG 0 (emitted, percent non-zero), no error, A = B + C + ours = 0 | 0 | 0 | 0 | E2 |
| G17 | row A 50 until 2026-06-01; from 2026-06-01 row DU 100 (pseudonym of owner "Duetti", kind label; sale document); units 2026-05 and 2026-06 | 2026-05: A 50, ours 50; 2026-06: DU 100, ours 0 | | | | M28, E25 |
| G18 | label `NoGhost Records` (rule 50 → NG); rows A 25, B 25; participations R 15 `(net, top)`, M 13 `(net, artist_pool)`, P 10 `(bucket, label_share)` (G18b adds E 10 `(bucket, artist_share of A)`: E 1.475 from A after the pool carve, A 13.275, everything else unchanged) | R 15; scaled net 85: A 21.25, B 21.25, label 42.5; M 13 from the pool: A 14.75, B 14.75; P 10 % of 42.5 = 4.25, label 38.25; NG 50 % of 38.25 = 19.125; P and NG are C `assumption` (Q11: a label-share carve and a sublabel on one unit) | 57.5 | 23.375 (assumption) | 19.125 | E18, Q11 |
| G19 | row A 50 with **no** document; participation P 10 `(bucket, label_share)` with an approved document | A 50 C `split_unconfirmed`; P 5 B | 5 | 50 (split_unconfirmed) | 45 | E12 |
| G20 | label `qaraqshy records` (sublabel of Echo8; rule 50 → QQ under an `assumption` document); row A 50 | A 50; QQ 25 C `assumption` | 50 | 25 (assumption) | 25 (Echo8) | Q12 |
| G21 | label `NoGhost Records` (rule 50 → NG); the ISRC has **no split** | no rows; label share 100; NG 50 C `assumption` (R1) | 0 | 50 (assumption) | 50; `ourShareNoSplit` 50 | R1, D-029 |
| G22 | row A 10; participation P 20 `(net, artist_pool)` | P 10 (the whole pool), A 0; shortfall signal `unfunded` missing 10 | 10 | 0 | 90 | E3, P08 §6.7(a) |
| G23 | row A 50 exists; `createParticipation` for A on the same ISRC and period → error `double_participation`; a split change that adds a row for an existing participant → the same error; two `(net, top)` participations 60 + 60 on one ISRC → error `top_above_100` | — | | | | E16, E24 |
| G24 | ISRC with two UPC: units UPC1 net 100 and UPC2 net 50; row A 50; participation P 10 `(bucket, label_share)` | UPC1: A 50, P 5, ours 45; UPC2: A 25, P 2.5, ours 22.5; owner of A earned 75 | 82.5 | 0 | 67.5 | E9 |
| G25 | participation P 15 `(bucket, label_share)` created with `validFrom` 2026-03-15 | stored `validFrom` 2026-03-01; the 2026-03 unit carries P 7.5 | | | | M52 |
| G27 | participation P 15 `(bucket, label_share)` on an ISRC with row A 50; units 2026-03 and 2026-04 (net 100 each); advance 10 on the pseudonym P (owner of P; scope `any`, dated 2026-03-01, basis and proof approved) | P earns 7.5 + 7.5 = 15; recouped 10 (7.5 from March, 2.5 from April); payable 5. G27b: the 2026-04 unit is −100 instead: P earns 7.5 − 7.5 = 0; recouped 0 (net income in scope is 0), remaining 10, payable 0 | | | | M19 participation-only, E21 |
| G28 | row A 50 (owner A earned 50); migration payout 30 → payable 20; a second migration payout 40 → payable −20, shown 0 | | | | | M27, MVP 29 |
| G29 | G05a plus an advance 50 on the pseudonym NG (scope `any`) | NG earns 25; recouped 25; remaining 25; payable 0 | | | | Q10, E21 |
| G30 | perimeter: unit with empty ISRC net 2; unit with unknown pair net 7 (existing tests) | C `no_isrc` 2, C `unknown_pair` 7, ours 0 | | | | D-023, D-035 |
| G31 | rows A 100; label `NoGhost Records` (rule 50 → NG) | A 100; label share 0; NG 0 (emitted, amount 0) | 100 | 0 | 0 | E4 |
| G32 | rows A 100; participation R 15 `(net, top)` | R 15; scaled net 85: A 85; label share 0 | 100 | 0 | 0 | E24 |
| G33 | reconciliation over two files: account 1052428 (unit 100, `Test Label`) and account 1055956 (unit 50, `Echo8`); row A 50 on both ISRC | two rows: account 1052428 A 100 / B 50 / ours 50 (`ourShareByLabel` 0to8 50); account 1055956 A 50 / B 25 / ours 25 (Echo8 25); discrepancy 0 on both | | | | §6 reconcile |
| G34 | rows A 16.6, B 16.6, C 16.6; participation M 13 `(net, artist_pool)` (pseudonym ids order A < B < C) | pool 49.8; shares 13 × 16.6 / 49.8 = 4.3333… quantised to 12 decimals; the residue to the row with the largest absolute amount (tie → first by id, A): A gives 4.333333333334, B and C 4.333333333333; A 12.266666666666, B 12.266666666667, C 12.266666666667, M 13 | 49.8 | 0 | 50.2 | exactness (QA B1) |
| G35 | rows A 50; two `(bucket, label_share)` participations P1 10 and P2 15 | both from the base 50: P1 5, P2 7.5 | 62.5 | 0 | 37.5 | shared base per kind (architect B2) |
| G36 | rows A 25, B 25; participation S 15 `(net, label_share)` (the settlement) | S 15 taken from the label share 50 | 65 | 0 | 35 | M35, Q6 |
| G37 | rows A 50; participation P 70 `(net, label_share)` | label share 50 < 70: P 50, shortfall 20 (signal) | 100 | 0 | 0 | E3 on the label share |
| G38 | label string `NoGhost Records` in 2026-03 and `Test Label` in 2026-04 on the same ISRC; row A 50; units in both months | 2026-03: A 50, NG 25, ours 25; 2026-04: A 50, ours 50 | | | | E14 |
| G39 | row A 50; unit 100; migration payout 50 to A's owner; then participation R 15 `(net, top)` added valid from 2026-01-01 | A earned 42.5; paid 50; payable −7.5, shown 0 | | | | E20 |
| G40 | the same ISRC in both accounts: file 1052428 unit 100 and file 1055956 unit 50, both with label string `Echo8`; row A 50; plus an unknown pair net 7 in the 1055956 file | both units: label of record Echo8; A 50 + 25; reconciliation rows per account; `ourShareByLabel.Echo8` 50 and 25; the unknown pair is C `unknown_pair` 7 on the 1055956 row | | | | E13, E11 |
| G41 | label `NoGhost Records`; split with one row A 0 (all-zero split) | no row (percent 0); label share 100; NG 50 **B** (a split exists, not R1) | 50 | 0 | 50 | E5 |
| G42 | brand artist: pseudonym "0to8" owned by the label owner, linked to the track, no row; row A 50 | A 50 | 50 | 0 | 50 | MVP 16 |
| G44 | rows A 10; three participations M1, M2, M3 each 13 `(net, artist_pool)` | targets 39 on a pool of 10: scaled down to 3.333333333334 / 3.333333333333 / 3.333333333333 (quantised, residue to the largest, here the first by id), A 0, shortfall 29 | 10 | 0 | 90 | scale-down exactness (QA RS2) |
| G43 | three separate tests, each starting from owner A (pseudonym A) earning master 50 (row A 50) and publishing 30 (a B17 line, G26-style), payable 80: (i) advance 40 scope `publishing` → recouped 30, remaining 10, payable 50; (ii) advance 40 scope `isrcs` [another ISRC] → recouped 0, payable 80; (iii) a migration payout 20 without scope (non-recoupable one-off) → paid 20, payable 60 | | | | | M19, M20 |
| G45 | settlement window: legacy registry rows A 35, S 15 valid 2000-01-01 … 2026-02-01; from 2026-02-01 row A 35 and participation S 15 `(net, label_share)` under the settlement document; the loader rewrites the legacy split for the months before the window (owner decision 6, Main payment fact); units 2026-01 and 2026-03 | 2026-01: A 50, S 0; 2026-03: A 35, S 15 taken from the label share 65 | 50 and 50 | 0 | 50 and 50 | M35, M33, owner decision 6 |
| G46 | rows A 25, B 25; Main carve "16.66 % (8.33 %/8.33 %) M1 & M2": each of A and B pays 8.33 % of net, each of M1, M2 gets 8.33 % of net; entered as participations M1 16.66 `(bucket, artist_share of A)`, M1 16.66 `(bucket, artist_share of B)`, M2 the same two, valid from the release's first month, approved documents | A 25 − 4.165 − 4.165 = 16.67; B 16.67; M1 4.165 + 4.165 = 8.33; M2 8.33 | 50 | 0 | 50 | M13, M43 |
| G47 | settlement window with co-artists: legacy rows A 17.5, B 17.5, S 15 under one appendix, valid 2000-01-01 … 2026-02-01; from 2026-02-01 rows A 17.5, B 17.5 and participation S 15 `(net, label_share)` under the settlement document; the loader spreads S's 15 over A and B pro rata to 17.5 : 17.5 for the months before the window (owner decision 6, Main payment fact); units 2026-01 and 2026-02 | 2026-01: A 25, B 25, S 0; 2026-02: A 17.5, B 17.5, S 15 taken from the label share 65 | 50 and 50 | 0 | 50 and 50 | M35, M33, owner decision 6, D-138 |
| G48 | owner A (row A 50, unit 100) earns 50; operations of the balance rule (10 §5), three tests: (i) a deduction `in` 10 (artist A, scope `any`, 2026-03-01) on a basis document that is not approved waits (payable 50, pending 1), approved it is a position recouped from the income: recouped 10, remaining 0, payable 40; (ii) the same deduction plus a credit `in` −5 (approved basis): recouped 10, credits 5, payable 45; (iii) a deduction 70 above the income: recouped 50, remaining 20, payable 0 | (i) 50 → 40; (ii) 45; (iii) 0 | 50 | 0 | 50 | S31 k4, 10 §5 |
| G49 | owner A as in G48; three tests: (i) a migration payout 30 → payable 20; deactivated → paid 0, payable 50; (ii) a button payout 50 without proof does not count (payable 50, blocking 1); deactivated with `transferFailed` → blocking 0, gate allowed; (iii) deduction 10 → 40; credit −5 → 45; deduction deactivated → 55; the button pays 5500, proof attached → paid 55, payable 0; return of the payout (date = payout date) → operation `return` −5500, returns 55, payable 55 | (i) 20 → 50; (ii) 50; (iii) 40, 45, 55, 0, 55 | 50 | 0 | 50 | S31 k4, S22, 10 §5 |
| G50 | owner A with rows A 50 on I(1) (`Test Label` → 0to8, unit 100, in the file of the 0to8 account) and on I(2) (`Echo8`, unit 60, in the file of the Echo8 account, the same month; D-169); an advance 40 without a label (migrated) and an advance 10 under Echo8, both of 2026-03; then the button under 0to8 | books: 0to8 earned 50, recouped 40 (the advance without a label takes I(1) first), payable 10; Echo8 earned 30, recouped 10 (its advance takes Echo8 alone), payable 20; the payout under 0to8 pays 10.00 and carries the label; after its proof 0to8 paid 10, payable 0; total payable 20 | 80 | 0 | 80 | D-168 |
| G51 | row A 50 on I(1); unit 100 with the label string `Echo8` in the file of the 0to8 account (R6: the book is the label of the file) | A 50; the reconciliation row of the 0to8 account has the one book 0to8 (A 100, B 50, ours 50); `ourShareByLabel.Echo8` 50 (the string); the unit: book 0to8, label of record Echo8; the signal `labelOutsideAccount` 1 (100); A's balance has the book 0to8 only, under Echo8 earned 0 | 50 | 0 | 50 | D-169 |
| G52 | row A 50 on I(1); an advance 100 under 0to8 of 2026-03 (scope `any`, with proof); I(1) earns 120 in the 0to8 account in 2026-03 and 80 in the Echo8 account in 2026-04 (the ISRC moved); variant «the same month»: both in 2026-03 | 0to8 earned 60, recouped 60 (the advance takes the 0to8 income alone), remaining 40, payable 0; Echo8 earned 40, recouped 0, payable 40; total earned 100, recouped 60, payable 40; the same numbers in the variant (the income item of an ISRC-month carries its book) | 100 | 0 | 100 | D-169 |
| G54 | row A 50 on I(1); unit 100 with the string `Echo8` in the file of the Echo8 account (2026-03); an ad 10 of 2026-03 on I(1), recovery 100 %, paid by 0to8 | books: 0to8 earned 0, adsCharged 10, payable −10; Echo8 earned 50, adsCharged 0, payable 50; total payable 40; `adOutsideBook` 1 (payer 0to8, book Echo8); `createAds` without `labelId` → `label_required` | 50 | 0 | 50 | D-169 |
| G55 | row A 50 on I(1) (unit 100 in the 0to8 account, 2026-03); A's only contract is marked 0to8 and is the document of A's publishing terms 50 %; a B17 statement Q2 2026 loaded under Echo8 with one line of A, payable 60 | books: 0to8 earned 50, payable 50; Echo8 earned 30 (the publishing), payable 30; total 80; under Echo8 `confirmed` false, `payout.reason` `no_contract_for_label`, the publishing line 2026-Q2 30 B; under 0to8 no B17 line, payable 50; the B17 reconciliation row has the one book Echo8; `statementsWithoutLabel` 0 | 80 | 0 | 80 | D-169 |
| G56 | rows A 50 on I(1) (unit 100 in the 0to8 account) and on I(2) (unit 60 in the Echo8 account), 2026-03; A's contract document first without a label, then marked 0to8 | without a label: confirmed and payable under both (0to8 50, Echo8 30, total 80); marked 0to8: under Echo8 `confirmed` false, `payout.reason` `no_contract_for_label`, the button and an Echo8 advance refused 422 `no_contract_for_label`; under 0to8 and in total unchanged; no approved contract at all stays `owner_not_confirmed`; the payout under 0to8 pays 50.00 | 80 | 0 | 80 | D-169 |
| G57 | row A 50 on I(1), unit 100 (2026-03, 0to8); a `buyout` 1 000 under 0to8 of 2026-04 with a `buyout` document; first without its proof, then with it (D-173) | without the proof: not counted, blocking 0, the button may pay 50.00; with it: earned 50, paid 0, buyouts 1 000 (book 0to8, area master), payable 50; the button pays 50.00; control: the same 1 000 as a migrated payout gives paid 1 000, payable −950 | | | | D-173 §3.4 |
| G58 | row A 50 on I(1); unit 2026-02 100; an advance 100 under 0to8 of 2026-01-01 (scope `any`, with proof). Step 2: a forgiveness 30 dated 2026-04-10. Step 3: unit 2026-04 100 (D-173) | step 1: recouped 50, remaining 50, payable 0; step 2: recouped 50, forgiven 30, remaining 20, payable 0 (unchanged); refusals: 21 → `forgiveness_exceeds` {unrecouped 20}, dated 2025-12-31 → `forgiveness_before_advance`, a payout as the ref → `operation_ref_not_advance`, deactivating the advance → `has_forgiveness`; step 3: recouped 70, forgiven 30, remaining 0, payable 30 | | | | D-173 §3.1 |
| G58b | G58 after step 3, then the unit 2026-03 100 arrives | recouped 100 (2026-02 and 2026-03), forgiven 0, remaining 0, payable 50; signal `forgivenessReduced` [the advance, recorded 30, effective 0] | | | | D-173 К2 |
| G59 | row A 50 on I(1) (unit 100, 0to8); a B17 statement 2026-Q2 under 0to8, one line of A payable 60, terms 50 %; a `writeoff` 20 (adjustment basis) (D-173) | before it 31 → `writeoff_exceeds` {available 30}, area master → `writeoff_area`; after it: earned 80 (master 50, publishing 30), writtenOff 20, payable 60; byArea master payable 50, publishing 10; then 11 → `writeoff_exceeds` {available 10} | | | | D-173 К6 |
| G60 | row A 50 on I(1) (unit 100, 2026-03, 0to8); an `adjustment` −170.55 dated 2026-10-15, then +20.55 (D-173) | adjustments 170.55, payable 220.55; then adjustments 150, payable 200, the button 200.00; no Echo8 book appears; without a document → `document_required` | | | | D-173 К5 |
| G61 | rows A 30, B 20 on I(1), participation P 10 `(net, top)`; B's owner is confirmed by a contract whose document is of kind `label_decision`; B's row and P's participation cite an approved `label_decision` | P 10; net 90: A 27, B 18, all B; before the contract document is approved B 18 C `owner_unconfirmed` (row B 37, C 18, ours 45); the same scenario with kind `contract` gives the same allocations, reconciliation row and balance of B (earned 18) | 55 | 0 | 45 | D-172 |

## Publishing cases

| # | Scenario | Expected | Case |
|---|---|---|---|
| G26a | B17 line, period 2026-Q1, holder H, songwriters "W1, W2" (both ours), work T, `operation_type` Mechanical, payable 100; terms: W1's owner 50 (no type); W2's owner 90 (no type) and 50 (Synchronization) | parts 50 / 50; W1 author 25 (B), label 25; W2 author 45 (B), label 5 | M15, M16, M17 |
| G26b | the same with `operation_type` Synchronization | W1 25 / 25; W2 25 / 25 | M16 |
| G26c | songwriters "W1, X" where X is external; payable 100 | W1 gets the whole line (external writers take nothing, D-087): author 50, label 50 | M17 |
| G26d | songwriters "W3" alone (a third writer of ours whose owner has no terms), payable 100 | author 50 C `publishing_terms_unconfirmed` (default), label 50 | D-043 |
| G26e | reconciliation of the four lines G26a–d loaded together: A 400; B 170 (25 + 45 + 25 + 25 + 50); C 50; ours 180 (25 + 5 + 25 + 25 + 50 + 50); discrepancy 0 | | §6 |

## Checks every master case also asserts

- `reconciliation()` for the file's month: `A_received` = Σ units; `B_notOurs` + `C_waiting` + `ourShare` =
  `A_received`; `discrepancy` = 0; `ourShare` comes from the layer state (a test with a deliberately broken layer
  shows a non-zero discrepancy).
- `explainTrack(isrc)` lists the state after every layer; the last state sums to the unit net.
- `ownerBalance(owner)` of every recipient equals the sum of its B allocations (C in `waiting`).
- A seeded random test (10,000 units; 6-decimal percents in every position, nets up to 1e5 with 12 decimals, rows,
  carves of every kind, signs and zeros) asserts Σ allocations + labelShare = net exactly after every layer, and that
  a shuffled unit order gives identical results.

## Hand computation notes (so a reviewer can recompute)

- G03b: targets 13 + 13 = 26 from the pool 50 pro rata of 25 : 25 → 13 each from A and B.
- G15: scaled net = −100 × 0.85 = −85; A = −85 × 0.25 = −21.25; label share = −85 − (−42.5) = −42.5; the sublabel
  half of −42.5 is −21.25.
- G18: top 15 → scaled net 85 → rows 21.25 each, label 42.5; pool carve 13 → rows 14.75 each; label carve 10 % of
  42.5 = 4.25 → label 38.25; sublabel 50 % of 38.25 = 19.125; sum 15 + 14.75 + 14.75 + 13 + 4.25 + 19.125 + 19.125 = 100.
- G22: pool = 10 < 20: the carve takes 10, the shortfall 10 is a signal, not money.
- G27: income items of P are `m|P|isrc|2026-03` 7.5 and `m|P|isrc|2026-04` 7.5; the advance (month 2026-03) takes
  7.5 then 2.5.
- G34: 13 × 16.6 / 49.8 = 4.333333333333… (non-terminating); quantised to 12 decimals; the residue goes to the row
  with the largest absolute amount (a tie: the first by artist id, here A): A takes 4.333333333334, B and C
  4.333333333333; A 12.266666666666, B 12.266666666667, C 12.266666666667, + 13 + 50.2 = 100.
- G36: the settlement is 15 % of net (15), funded by the label (50 − 15 = 35); the artists keep 25 + 25.
- G39: the retroactive rule changes earned from 50 to 42.5 (scaled net 85 × 50 %); the payout stays as paid.
- G45 (stage 5, `14_verification.md` §6 E1; D-137): the loader step `settlement-prestart` changes the legacy split
  from the ISRC's first report month (here 2026-01) to the rows without S, S's 15 added to A's row (35 + 15 = 50),
  under an approved document of kind `other`; the window from 2026-02-01 is untouched: 15 % of net from the label
  share 50 leaves ours 35, A keeps 35. Before the fix the 2026-01 unit gave A 35, S 15 (same B and ours, wrong
  recipient).
- G46 (stage 5, `14_verification.md` §6 E2; D-137): the D-135 entry (8.33 per source, from 2026-07) gave M1
  2.0825 + 2.0825 = 4.165, A 20.835, and nothing before 2026-07. The loader (D-137) enters the same comment as pool
  participations of a percent of net, M1 8.33 `(net, artist_pool)` and M2 8.33 `(net, artist_pool)` from the
  release's first month: targets 16.66 from the pool 50 pro rata 25 : 25, 8.33 from each of A and B; the same
  allocations as the per-source entry when A and B are the only rows (with a third row the pool form takes from it
  too, pro rata). The test asserts both entry forms in 2026-01 and 2026-03.
- G47 (stage 7, product verdict finding 1; D-138): the legacy split carries the participant S beside two co-artists.
  Main paid S's 15 % before the window to the co-artists pro rata (DJ Ikeraus and LDRR +7.5 each where both held
  17.5), so the loader step `settlement-prestart` changes the legacy split from the first report month (here
  2026-01) to A 17.5 + 15 × 17.5 / 35 = 25 and B 17.5 + 7.5 = 25, ours 50 (the label share is unchanged before the
  window). From 2026-02-01: rows A 17.5, B 17.5 (35), label share 65, S 15 % of net from it, ours 50. With one
  co-artist (G45) the pro rata gives it the whole 15. A row that is 0 in a later split before the window (a buy-out)
  takes nothing; its part stays with the label (after the 2025-12 buy-out of DJ Ikeraus: rows DJ Ikeraus 0, LDRR 25,
  ours 75, where the D-137 form gave LDRR 32.5, ours 67.5).
- G48 (D-142; S31/k4): payable = earned − recouped − paid + returns + credits. A deduction is a position of scope
  `any` whose income is the owner's B: 50 − 10 = 40. A credit `in` −5 is stored as −500 cents and counts as +5:
  40 + 5 = 45. Waiting on an unapproved basis document leaves it out of both sides (payable 50) and lists it as
  pending. A deduction 70 takes the whole income: recouped min(70, 50) = 50, remaining 20, payable 50 − 50 = 0.
- G49 (D-142; S31/k4, S22): a migration payout counts without proof (paid 30, payable 20) and its deactivation
  removes it (50). A button payout is deferred and uncounted until the proof; it has an external reference, so its
  deactivation needs `transferFailed`. S31/k4: 50 − 10 = 40; + credit 5 = 45; deduction deactivated → 50 + 5 = 55; the
  payout 55 with proof → 55 − 55 = 0; the return +55 → 55 (earned 50 + credit 5 − paid 55 + returned 55).
- G50 (D-168): the books of the labels partition every field of the balance. earned by the unit's label of record;
  recouped by the label of the income consumed: the advance 40 without a label is recouped from any income in month
  order (the income items of one month are ordered by id: I(1) before I(2)), so it takes 40 of the 50 of 0to8; the
  advance under Echo8 is recouped from the master income of Echo8 only, 10 of 30. payable_L = earned_L − recouped_L −
  paid_L − adsCharged_L + returns_L + credits_L: 0to8 10, Echo8 20, Σ = the total 30. The button under 0to8 pays the
  0to8 book (10), records the label, and after the proof the 0to8 book is 0 while Echo8 keeps its 20. Since D-169 the
  two units come in the files of the two accounts: the book is the label of the file, the numbers are the same.
- G51 (D-169, R6): the book of a unit is the label its file was loaded under; the label string still decides the
  label of record (the sublabel rule and «ours / label_unmapped»). A 50 of 100 is earned in the book 0to8;
  `ourShareByLabel` stays by the string (Echo8 50). The unit is the one `labelOutsideAccount` group (its string leads to
  Echo8, its file is 0to8's); under Echo8 nothing of it is seen: earned 0.
- G52 (D-169): A earns 120 × 50 % = 60 in the 0to8 book and 80 × 50 % = 40 in the Echo8 book. The advance 100 under
  0to8 is recouped from the master income of the 0to8 book only: min(100, 60) = 60, remaining 40. payable_0to8 = 60 −
  60 = 0, payable_Echo8 = 40 − 0 = 40, total 40 (the brief's «0» was wrong: the Echo8 income is not the advance's).
  In the same month the master income item id is `m|artist|isrc|month|<book>`: two items (60 and 40), not one of 100
  recouped from 0to8.
- G54 (D-169, R9): the label of an advertising record is its payer. A's part of the ad is 10 × 50 / 50 = 10 (the only
  row), recovered 100 % = 10, charged to the book of the payer 0to8 (payable_0to8 = 0 − 10 = −10), while the income
  50 sits in the Echo8 book of its file (payable_Echo8 = 50); total 50 − 10 = 40. The record is the one `adOutsideBook`
  row: its payer is not the income book of I(1) in 2026-03. A record without a label is refused (`label_required`).
- G55 (D-169, R8): the lines of a B17 statement sit in the book of the label the statement was loaded under. A's
  publishing is 60 × 50 % = 30 (one listed writer, terms 50 %), category B (the categorisation does not look at the
  label), in the Echo8 book; the master 100 × 50 % = 50 in the 0to8 book of its file. The gate under Echo8 asks for a
  contract of Echo8: A's only contract is of 0to8, so `no_contract_for_label`; the money does not move.
- G56 (D-169, R10): a contract opens the label of its document; a document without a label opens every label. The
  books do not move (0to8 100 × 50 % = 50, Echo8 60 × 50 % = 30, total 80): only the gate under Echo8 changes, to
  `no_contract_for_label` (an approved contract exists, none with Echo8); with no approved contract at all the reason
  stays `owner_not_confirmed`, under a label too.
- G61 (D-172): an approved label decision confirms the owner exactly like a contract (`computeConfirmedOwners` looks at
  the status and label of the contract document, not its kind) and a split row or participation exactly like an
  appendix (`categorise` looks at the kind only for `assumption`): P 100 × 10 % = 10 off the top, net 90, A 90 × 30 % =
  27, B 90 × 20 % = 18, ours 45. No layer changes; the case is the same numbers with kind `contract`.
- G57 (D-173): a buyout is an `out` operation outside the balance (README §5, D-027): `buyouts_L` = Σ counted buyouts,
  in neither `paid` nor `payable` (50 − 0 = 50), and it never blocks (`BLOCKING_KINDS` = payout, advance). It counts
  with an approved proof and its approved `buyout` document. The control: as a payout it would be 50 − 1 000 = −950.
- G58 (D-173 §3.1): the advance month is 2026-01, so the 2026-02 income 50 is recouped (remaining 50). The forgiveness
  of 2026-04 takes effect before the first income of a month ≥ 2026-04: effective = min(30, 100 − 50 − 0) = 30, the
  capacity from 2026-04 is 100 − 50 − 30 = 20. Step 2 has no such income: the forgiveness takes effect at the end,
  remaining 100 − 50 − 30 = 20, payable 50 − 50 = 0 (unchanged). Step 3: the 2026-04 income 50 gives 20 to the
  advance, recouped 70, payable 100 − 70 = 30. G58b: the 2026-03 income (before the date) is recouped first: 50 + 50 =
  100 before 2026-04, the effective forgiveness min(30, 100 − 100 − 0) = 0, payable 150 − 100 = 50; recorded 30 >
  effective 0 is the signal `forgivenessReduced`. amount = recouped + forgiven + remaining holds at every step.
- G59 (D-173 К6): publishing 60 × 50 % = 30 in the 0to8 book; available = 30 − 0 (recouped from publishing) − 0
  (earlier write-offs) = 30. payable = 80 − 20 = 60; by area: master 50, publishing 30 − 20 = 10. After the write-off
  available = 30 − 0 − 20 = 10.
- G60 (D-173 К5): an adjustment is `in` with a signed amount, `adjustments_L` = −Σ amount: −(−170.55) = 170.55,
  payable 50 + 170.55 = 220.55; + 20.55 → adjustments 150, payable 200.
