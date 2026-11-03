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
