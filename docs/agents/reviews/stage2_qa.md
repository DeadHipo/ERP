Verdict: yes

# Stage 2 review: QA (`10_target_model.md`, `11_plan.md`, `12_golden_cases.md`), 2026-11-02

## Revision 3 (re-review, 2026-11-02)

The verdict changes to **yes**. The remaining blocker RB1 is fixed, and so are RS1–RS4 and RN1. The baseline is
unchanged, because there have been no code changes since `e2524f4`. typecheck and lint are clean. The suite gives
186/187: the one failure is the known `sources-loader` flake, which plan 3.1 fixes.

Fixed:
- **RB1.** The "Exactness" paragraph of 10 §3 now states one rule for every layer:
  - every allocation is quantised to 12 decimals (half-up) right after its multiplication;
  - every remainder (`scaledNet = net − Σ top`, `labelShare = scaledNet − Σ rows`, the rest of a bucket) is
    obtained by subtraction;
  - pro rata and scale-downs quantise each share, and the residue goes to the largest absolute amount.

  Plan 3.4a and 12 "Checks" set the generator: 6-decimal percents in every position, nets up to 1e5 with 12 decimals.
  I checked the rule myself, keeping the repo's global precision of 40. The chain was: top, three rows, two pool
  carves (scale-down in about 20 % of units), two `label_share` carves (scale-down in about 20 %), and the sublabel.
  It ran on 10,000 units with nets up to 1e5, plus 2,000 pico nets and the pico case of RS1. Result: **0 identity
  breaks, and 0 negative rows on a positive unit**. Under revision 2 the same generator gave 986 breaks per 10,000.
- **RS1.** The residue goes to the largest absolute amount, ties first by id.
  G34 recomputed: A 12.266666666666, B 12.266666666667, C 12.266666666667, M 13; Σ rows 36.8; plus 13 and 50.2 = 100.
  Correct.
- **RS2.** Scale-downs are quantised with a residue.
  G44 recomputed: 13 × 10 / 39 = 3.333…; three quantised shares sum to 9.999999999999; the residue 1e-12 goes to M1.
  Result: M1 3.333333333334, M2 and M3 3.333333333333; A 0; shortfall 39 − 10 = 29; B 10; ours 90. Correct.
- **RS3.** G26d uses its own writer W3, and G26e is pinned.
  G26e recomputed: A 400; B 25 + 45 + 25 + 25 + 50 = 170; C 50; ours 25 + 5 + 25 + 25 + 50 + 50 = 180;
  400 = 170 + 50 + 180. Correct.
- **RS4.** All the requested completions are in, and I recomputed each new number:
  - G17: the 2026-05 unit gives A 50 / ours 50; 2026-06 gives DU 100 / ours 0.
  - G27b: P earns 7.5 − 7.5 = 0. `recoup.ts` caps at `max(net in scope, 0)` = 0, so recouped 0, remaining 10,
    payable 0.
  - G08c asserts the `labelUnmapped` signal.
  - G40 adds an unknown pair: 7 C on the 1055956 row.
  - G18b: E = 10 % × 14.75 = 1.475, A 13.275; B stays 57.5.
  - G10a asserts the assumption-document signal (E22).
  - The UPC scope of an advance is listed as out of scope in 10 §9 (E9).
- **RN1.** The over-100 top cap is a pure layer test (10 §3 layer 3, plan 3.4a). Its outcome is defined: scaled
  down to net, quantised with a residue, `scaledNet` 0, shortfall.

Notes (not blocking):
- **N-R3a.** The layer table still writes some formulas without `q(…)`: layer 4 rows, `artist_share`, `label_share`
  and sublabel. The "Exactness" paragraph covers them, but the code reviewer of 3.7 should check that every
  multiplication site quantises. The seeded test catches a miss only when the result exceeds 40 digits, so add a
  pure assertion that every allocation amount has at most 12 decimals.
- **N-R3b.** Remaining partial edge cases, acceptable for this stage:
  - E4: a `label_share` carve on a label share of 0.
  - E6: an Echo8 sublabel without a split (same code path as G21).
  - E7: a participation starting after the first unit month.
  - E10: the M39 signal assert.
  - E19: data-side only.

Refreshed E→G coverage: **20 full, 5 partial, 0 uncovered.**
- Newly full since revision 2: E9 (UPC scope now out of scope by design), E11 (G40), E15 (G08c), E18 (G18b),
  E21 (G27b), E22 (G10a), E25 (G17).
- E17 is full now that RB1 is fixed.
- Still partial: E4, E6, E7, E10, E19.

The tables below are revision 2 and revision 1, kept for traceability.

---

# Stage 2 review: QA (`10_target_model.md`, `11_plan.md`, `12_golden_cases.md`), 2026-11-02

Reviewer: QA member of the council (read-only). Revision 2 re-read in full, including the later edits of 10 and 12
(G43 split into three tests, G39 now E20 only, §5 balance per paying label, §7 shortfall line).

## Revision 2 (re-review, 2026-11-02)

The verdict stays **no**, with one remaining blocker: RB1. RB1 is what is left of B1. The new exactness paragraph of
10 §3 is false at the repo's decimal precision. The fix is one sentence. Everything else of revision 1 is fixed or
reduced to should-fix. The golden arithmetic of revision 2 is right: every case I recomputed matches, 0 mismatches.

### Baseline (refreshed, code unchanged since e2524f4)

typecheck clean; **lint clean**; `REQUIRE_STACK=1 npm test`: 18 files, 187 tests, **186 passed, 1 failed**. The
failure is the known flaky `sources-loader.test.ts` "keeps the units projection (D-122)" test, the same row-order
failure as before. 11 now records the flake, and step 3.1 fixes it.

### Fixed

- **B1, the pool-carve rounding (fixed): rows lose 12-decimal shares, the last row takes the residue.** I reproduced
  it with the 10 §3 rule and the same 20,000 random units. The pool step no longer breaks the identity (0
  mismatches), and the shared random test is in 12 "Checks" and plan 3.4a. G34 recomputed:
  13 × 16.6 / 49.8 = 4.3333…; A and B give 4.333333333333, C the residue 4.333333333334. A 12.266666666667,
  B 12.266666666667, C 12.266666666666, M 13, ours 50.2, Σ 100. Correct.
- **B2 fixed.** `scaledNet = net × max(0, 100 − Σp)/100` cannot flip a sign. Σ top > 100 is refused at entry
  (`top_above_100`, G23, plan 3.3). The cap is applied in data, with a shortfall.
- S1 (flake noted, `ORDER BY` in 3.1), S2 (`ourShare` from the layer state, plus the broken-layer test), S3
  (`ourShareNoSplit` = remainder of `no_split` units; G21 gives 50), S4 (zero rule: rows with percent 0 skipped,
  carves emitted whenever the percent is non-zero; G09, G16 and G31 follow it), S5 (one shared base per kind, G35),
  S6 (missing source row → 0 + shortfall; unmapped imprint: carves run, no sublabel; no signal for a 0 target), S8
  (G25 split between 3.3 and 3.4b; G33 in 3.4b), S9 (`newFacade` seeds 0to8 with `Test Label`), S10 (expected
  differences with amounts, tolerance 0.01 per cell), S11 (stage 7: sources, measures, loop back to stage 6,
  acceptance), N1–N5 (shared reason enum and page guard in 3.6, explain sum and shuffled order in 3.4, `LOG_TIMINGS`
  in 3.1 and 3.4b, fixture additions in 3.1, 3.2 and 3.5).

### Remaining

**RB1 (blocker). The claim "every multiplication is exact" is false at decimal.js precision 40.**
`src/shared/money.ts` sets `Decimal.set({ precision: 40 })` globally. A chain of percent multiplications grows the
digits: each `× p / 100` with a 6-decimal p adds 8 decimals. Net (up to 74,474.003185107906 on the real data, so 5 +
12 digits), then the top factor, rows, a `(bucket, label_share)` carve and the sublabel. This passes 40 significant
digits, and decimal.js rounds the product.
Evidence: my seeded run of that chain with 6-decimal percents everywhere broke Σ allocations + labelShare = net by
about 1e-35 in **986 of 10,000 units**. Example: net 35251.337364315987; top 7.632277; rows 24.994772, 6.388247,
3.886448; label carve 13.626425; sublabel 48.533055.
The same run gives 0 mismatches at precision 80, and 0 with 2-decimal carve percents. Real split shares today have at
most 2 decimals (24,754 rows, `splits.split_shares`), but `numeric(9,6)` allows 6, and stage 4 enters 6-decimal rows
(33.333333, 16.666667, 29.761905…). The seeded test of 12 "Checks" will therefore fail in 3.4a, or pass only if its
generator is narrowed.
Required (one sentence in the 10 §3 "Exactness" paragraph, one line in plan 3.4a), either of:
- the layers compute with `Decimal.clone({ precision: 80 })`. The worst chain needs about 6 + 12 + 4 × 8 = 50 digits;
  do not change the global 40 used elsewhere.
- every allocation is quantised to 12 decimals (ROUND_HALF_UP), and `scaledNet` and `labelShare` are always
  obtained by subtraction (`scaledNet = net − Σ top`), so no value ever exceeds 12 decimals.
The seeded test must draw 6-decimal percents in every position and nets up to 1e5 with 12 decimals (see RS2).

**RS1 (should-fix). The residue rule can make a row negative on a positive unit.** Evidence: net 0.000000000001
(pico lines exist in the data), rows A 49.9 and B 0.1, pool carve 50. A's quantised share is 0, B takes the residue:
A 4.99e-13, B −4.99e-13. Σ is exact, but E3 says "rows never go negative on a positive unit". Required: the residue
goes to the row with the largest absolute amount (ties by artist id). G34 is unchanged, because with equal rows the
tie-break gives C. Add this pico case as a layer test.

**RS2 (should-fix). The scale-down paths are not quantised.** When |Σa| > |bucket| (pool, `label_share`, over-100
top), the carves are "scaled down to the bucket": `a_i × bucket / Σa` is a division that does not terminate (for
example three carves of 13 on a pool of 10). The identity still holds if the bucket loses exactly Σ of the scaled
carves (my run: 0 mismatches). It breaks if the implementation sets the bucket to 0 while the rounded carves sum to
bucket ± 1e-38. Required in 10 §3: scaled carves quantised to 12 decimals with the residue to the largest carve, so
the bucket ends at exactly 0. Add a golden case: rows A 10; pool carves 13, 13, 13 → 3.333333333333,
3.333333333333, 3.333333333334; A 0; shortfall 29. The seeded generator must reach these paths (Σ carves above the
bucket in a share of its units).

**RS3 (should-fix). G26d and G26e contradict each other.** G26d needs "no terms for W1's owner", but G26a–c give W1's
owner a 50 term. G26e reconciles "the b17 rows of G26a–d" together, which cannot happen on one database. Required:
G26d uses another writer W3 with its own owner. Then pin the G26e numbers: A 400, B 170 (45 + 25 + 25 + 25 + 50),
C 50 (G26d), ours 180, discrepancy 0.

**RS4 (should-fix). Cheap edge-case completions are still missing** (partial rows of the table below):
- G17: add the 2026-05 unit under the old split (E25).
- G27b: P's income is 0 or negative in one month (E21).
- G08c: assert the `labelUnmapped` signal (E15).
- G40: add an unknown-pair unit to the 1055956 file (E11 per account).
- G18b: add an `artist_share` carve (09 E18 names all layers).
- G10a: assert the signal "allocations under `assumption` documents grouped by document" (E22, M39).
- E9's UPC scope for an advance: either design it or list it in 10 §9 as out of scope (it is in neither).

**RN1 (note).** The cap for "Σ top > 100 met in data" cannot be reached through the services, since entry refuses
it. Pin it with one pure layer test (two tops 60 + 60 injected → scaled down to 50 + 50, `scaledNet` 0, shortfall 20)
or turn it into an invariant error.

**RN2 (note).** All new cases G34–G43 are reachable with the fixture additions now listed in 3.1, 3.2 and 3.5. G42
needs a track linked to an artist without a split row, which `owners` supports today. G43 needs `writeB17` with a
holder or writer resolved to A, which exists today.

### Arithmetic recomputed (revision 2): 0 mismatches

| Case | My computation | Match |
|---|---|---|
| G03b (rev 2 wording) | Σ targets 26 from the pool 50 at 25 : 25 → A 12, B 12; M1 13, M2 13 | yes |
| G03c | 25 + 8.5 + 8.5 = 42; ours 58 | yes |
| G10a | A 23 + D 7 B 30; L 20 C assumption; ours 50 | yes |
| G18 (rev 2) | R 15, A 14.75, B 14.75, M 13 → B 57.5; P 4.25 + NG 19.125 C 23.375; ours 19.125; Σ 100 | yes |
| G21 (rev 2) | NG 50 C assumption; B 0; ours 50 = `ourShareNoSplit` | yes |
| G34 | see Fixed | yes |
| G35 | base 50: P1 5, P2 7.5; B 62.5; ours 37.5 | yes |
| G36 | S 15 from label 50 → 35; B 65 | yes |
| G37 | 70 > label 50 → P 50, shortfall 20; B 100; ours 0 | yes |
| G38 | 2026-03: NG 25, ours 25; 2026-04: ours 50 | yes |
| G39 | earned 85 × 0.5 = 42.5; paid 50; payable −7.5, shown 0 | yes |
| G40 | Echo8 for both units; A 50 + 25; ours per account 50 and 25 | yes |
| G41 | row 0 skipped; label 100; NG 50 B; ours 50 | yes |
| G42 | A 50; ours 50 | yes |
| G43 | base payable 80: (i) recouped 30, remaining 10, payable 50; (ii) recouped 0, payable 80; (iii) paid 20, payable 60 | yes |
| G26e | arithmetic as in RS3 once the setup conflict is removed | setup conflict |
| Stage 4.3 re-entries | 16.666666 + 16.666667 + 16.666667 = 50; 29.761905 + 10.119048 + 10.119047 = 50; 33.333333 + 16.666667 = 50 | yes |

### E → G mapping (refreshed for revision 2)

| E | Golden case / existing test | Coverage | Missing |
|---|---|---|---|
| E1 negative | G15; `review-fixes` negative lines; `recoup.test` negative capacity | full | — |
| E2 zero | G16 | full | — |
| E3 carves above bucket | G22 (pool), G37 (label share), G23 (top refused at entry) | full | in-data top cap (RN1) |
| E4 label share 0 | G31, G32 | partial | a `label_share` carve on a label share of 0 |
| E5 label share 100 | G21 (no split, R1), G41 (all-zero split) | full | — |
| E6 sublabel, no split | G21 | partial | Echo8 sublabel without split (same code path) |
| E7 mid-history / window | G09, G13, G14, G39 (retro start) | partial | participation starting after the first unit month |
| E8 mid-month instrument | G09, G25 | full | — |
| E9 two UPC | G24 | partial | UPC scope of an advance: not designed, not listed out of scope |
| E10 Echo8 unit, 0to8 paper | G08b, G40 | partial | M39 signal assert |
| E11 unknown pair | G30; `facade.test` | partial | per account (RS4) |
| E12 split unconfirmed, carve confirmed | G19 | full | — |
| E13 same ISRC in two accounts | G40 | full | — |
| E14 label_name over time | G38 | full | — |
| E15 unmapped imprint | G08c | partial | `labelUnmapped` signal assert |
| E16 double participation | G23 | full | — |
| E17 rounding chain | G02, G03a, G34, seeded test | full once RB1 is fixed | — |
| E18 all layers | G18 | partial | `artist_share` in the combined case (G18b) |
| E19 instrument not per recording | plan 4.2 (196 rows from `documents.json`, logged) | partial | data side only, no test |
| E20 retro rule after payout | G39, G28; `facade.test` "balance may be negative after a split change" | full | — |
| E21 advance from participation / sublabel | G27, G29; `recoup.test` negative capacity | partial | zero or negative month on that pseudonym (G27b) |
| E22 licence rate ≠ registered | G10a mechanism (row with `assumption` document) + §6 signal | partial | signal assert |
| E23 window ends | G14 | full | — |
| E24 top on rows = 100 | G32, G23 | full | — |
| E25 sold recording | G17, G13 (old split before a change) | partial | the unit before the sale month in G17 |

Full: 13 of 25. Partial: 12. Not covered: 0. In revision 1 it was 9 / 13 / 3.

### Required to accept

RB1: one sentence in 10 §3 "Exactness" (layer-local precision 80, or 12-decimal quantisation of every allocation with
the buckets obtained by subtraction), plus the generator rule for the seeded test in plan 3.4a. RS1–RS4 are expected
in the same pass. If RS4 is deferred, name the step (3.4b) that adds the rows.

---


## Revision 1 (kept for traceability)

# Stage 2 review: QA, revision 1 (`10_target_model.md`, `11_plan.md`, `12_golden_cases.md`), 2026-11-02

Reviewer: QA member of the council (read-only). HEAD `e2524f4`, branch `feature/fable-001`; the three stage-2 files
are untracked. Inputs: `09_settlement_cases.md` §7 (E1–E25), `reviews/stage1_qa.md`, `notes/settlement_landscape.md`
§8, `packages/backend/src/facade/calculation.ts`, `src/modules/settlements/recoup.ts`, `src/shared/money.ts`
(decimal.js, precision 40, ROUND_HALF_UP), `tests/helpers/fixtures.ts`.

Summary: the golden arithmetic is right (every case I recomputed matches, 0 mismatches), and the layer order is
clear. Two rules of 10 §3 are not exact or not guarded, and the design does not say how to fix them. Both are one
sentence each in 10 §3 plus one golden case. Several edge cases have no golden case yet, and the plan has gaps in
step assignment, fixtures and checks. Accept after B1 and B2 are fixed. The should-fix items can be folded into the
same revision.

## Baseline (run now, HEAD e2524f4, stack up)

| Command | Result |
|---|---|
| `npm run typecheck` | clean, exit 0 (backend, frontend, shared) |
| `npm run lint` | **clean, exit 0** (lint is clean at HEAD) |
| `REQUIRE_STACK=1 npm test` | 18 files, 187 tests: **186 passed, 1 failed** in the first full run (9.2 s). I reran the file and the suite: the same test failed in 2 of 6 runs |

The failing test is `tests/sources-loader.test.ts` "keeps the units projection in every attached part and answers the
units view from it (D-122)", line 127. It is flaky, not broken. `columnar.units()` has no `ORDER BY`, and the test
expects `[QZTST2600011, QZTST2600012]` in that order. ClickHouse sometimes returns them reversed. See finding S1.

## Findings

### Blockers

**B1. The pro rata pool carve is not exact: A = B + C + ours can be off by 1e-38.**
10 §3 layer 5 takes the pool carve from the rows "pro rata to their current amounts", that is `a × row / pool` per
row. The division usually does not terminate, so decimal.js rounds each quotient at 40 digits, and the Σ of the
deductions is not `a`.
Evidence: I ran a random test with the rules of 10 §3 (rows of up to 4 six-decimal percents, nets with 12 decimals
incl. negative, top, pool, label-share carve, sublabel half; script in my scratchpad). **457 of 20,000 units
(2.3 %)** give Σ allocations + label share − net = ±1e-38. One example: net 62.61761188507; rows 10.841848,
10.23698, 2.553446, 11.478837; top 10.535097; pool 1.231773.
The golden cases cannot catch this: G03b, G18 and G22 use ratios that divide exactly (18.5 : 18.5, a pool of 10).
Required change:
- 10 §3 states the residue rule. The deductions are computed pro rata, and the last row in a fixed order (artist id)
  takes `a − Σ others`, so Σ deductions = a exactly. Or quantise each deduction to pico-USD (12 decimals) and put the
  residue on the last row. Either way, write down the rule and the order.
- 12 adds **G34**: rows A 16.6, B 16.6, C 16.6; pool participation M 13; net 100. M gets 13. Each row loses
  4.333…, and the residue goes to the row named by the rule. Assert Σ = 100 exactly and the three exact strings.
- `tests/layers/` adds an invariant test: about 10 k seeded random units, incl. negative, zero and 12-decimal nets.
  After every layer, Σ allocations + labelShare = net exactly, and every allocation has the sign of the net.

**B2. Off-the-top has no guard for Σ top > 100: the signs flip, against E3.**
The factor `(net − Σ top) / net` is negative when the top participations in force add up to more than 100 %.
Example: top 120 gives factor −0.2, so a row of 50 becomes −10 on a positive unit. E3 (accepted in 09) requires "take
what is there, `unfunded` signal; rows never go negative on a positive unit". 10 §3 guards only net = 0. Also, by the
same arithmetic the factor is exactly `1 − Σp/100`: the division and its net = 0 guard are not needed.
Required change:
- 10 §3: factor = `max(0, 1 − Σ top / 100)`. When Σ top > 100, the top allocations are scaled to the net (or are
  ordered and capped), and the excess is reported as `unfunded`.
- Entry validation in splits: refuse Σ top > 100 on any ISRC and date, in both directions, like `double_participation`.
- 12 adds **G35**: rows A 50; participations R1 60 `top` and R2 60 `top`. Expected: rows 0, label share 0, R1 + R2 =
  100 under the stated cap rule, `unfunded` 20. Plus the refusal at entry.

### Should-fix

**S1. The flaky loader test breaks the DoD "suite green".** 11 says "187 tests at the start", but at HEAD the suite
fails about one run in three. Step 3.1 rewrites this exact projection and test. Required: 3.1 gives `columnar.units()`
an `ORDER BY` (or the test sorts before it compares). Note in 11 that the start baseline is 186/187 with a known flake.

**S2. `discrepancy` must stay a real check.** Today `reconcile()` computes `ourShare = A − B − C`, and each unit's
`ours = net − Σ allocations`. With these definitions `discrepancy = 0` holds by construction. The stage 5 check "0 on
every row" then proves nothing about the layer chain. Required:
- 10 §6 states that the remainder is Σ `state.labelShare` taken from the layer state, never `net − Σ allocations`.
- A test in `tests/layers/` feeds a deliberately broken layer that drops 0.01, and `reconcile` reports a non-zero
  discrepancy.

**S3. `ourShareNoSplit` under R1 is not defined.** Today it adds the whole net of a no-split unit. G21 expects 50,
because NG takes 50. 10 §6 must say that it is the label share left after the sublabel half.

**S4. Zero-amount allocations are inconsistent.** G31 says "no allocation row for a zero carve". G16 says "all
allocations 0", G22 lists "A 0", G09 2026-05 lists "A 0", and today's code skips 0 % shares. Required: one rule in
10 §3 (my proposal: no allocation for a zero percent, but an allocation of amount 0 when a non-zero percent meets a
zero amount, so `explainTrack` still shows the rule). Fix G09, G16, G22 and G31 to match the rule.

**S5. The base of several `label_share` carves is ambiguous.** 10 §3 takes each carve as a percent of the *current*
label share, in the order of `valid_from`. Two carves of 10 and 15 then give 10 + 13.5 = 23.5 % of the label share,
not 25 %. The contracts (M12, the settlement 15 %, Maximum Madness, Matra) speak of "the label share". Required: state
the base explicitly (before carves, or after the earlier ones) as a Q-line in 10 §7, and add G36: two `label_share`
carves on one unit.

**S6. Guards missing in layer 5:**
(a) An `artist_share` carve whose `from_artist` has no row at that date. Proposal: shortfall `unfunded`, 0 taken.
(b) A `label_share` carve on a unit whose label string is unmapped (E15). Proposal: the carve still runs on the label
share, which waits in C `label_unmapped`.
(c) A pool carve on a net-0 unit. 0/0 is guarded by "zero pool → shortfall", but this must not emit `unfunded` with
`missing 0`.
Each needs a sentence in 10 §3 and a pure layer test.

**S7. E→G coverage gaps** (table below). Uncovered: E14, E19, E22, and the UPC-scope half of E9 (recoup has no UPC
scope at all; either the design adds it or 10 §9 lists it as out of scope). Partial: E3, E4, E5, E6, E7, E10, E11,
E13, E15, E17, E18, E21, E25. Required new or extended cases:
- G21b: all-zero split + sublabel = G21 (R1 says they are the same).
- G21c: an Echo8 sublabel (qaraqshy) with no split.
- G31b: a `label_share` participation where the label share is 0.
- G14b: a participation starting after the first unit month.
- G17: add the 2026-05 unit under the old split.
- G27b: an advance on P where P's income in one month is 0 or negative.
- G33: state explicitly that it is the *same* ISRC and sales month in both accounts (E13), and add an unknown-pair unit
  to the Echo8 account (E11 per account).
- G08c and G08b: assert the signals `labelUnmapped` and M39.
- New: one ISRC whose `label_name` changes between two months (E14).
- E18: G18 has no `artist_share` carve and two rows, while 09 E18 names "rows 50/25/25". Either add G18b with three
  rows and an `artist_share` carve, or correct the E18 wording.
- E19 and E22 are data-side (M51 listing, M39 delta flag): name the signal or the stage 4 log that pins each.

**S8. Plan step assignment.**
- G33 is assigned to no step. It belongs in 3.4.
- G25 is assigned to 3.3, but its second half ("the 2026-03 unit carries P 7.5") needs the layers of 3.4. Split it:
  the stored date in 3.3, the allocation in 3.4.
- G23 is in 3.3, which is fine. Its signal `double_participation` is also listed for the stage 4 migration and needs
  a check there.

**S9. The existing tests will change meaning unless the fixture default is decided.** `believeCsv` writes
`'Label Name': 'Test Label'` on every line. After 3.4 that string is unmapped, so by E15 every existing test's "ours"
moves to C `label_unmapped` and many reconciliation and balance assertions break. 11 says that existing tests are
adjusted "only where the response shape changed". Required: 11 step 3.2 or 3.4 decides that `newFacade` seeds the own
label 0to8 with the alias `Test Label` (or that the default changes to `0to8`), and existing numbers stay as they are.

**S10. Stage 5 comparisons need explicit tolerances and amounts.**
- The "expected differences" row lists 5 items, but only one has an amount (13,363.21). Give the expected amount or
  ISRC count for each: M44 15 rows, Ahh Music, the remixed ISRC, Sleeping City Funk 45.8.
- Add the causes that `compare-annex` already groups by (owner decisions 2–5, Echo8 perimeter, assumptions in C) to
  the list as expected differences with their amounts. Then "not in the list" is a mechanical test.
- `compare-annex` compares "ours + the sublabel allocation" with the Annex NLS. Say whether the `label_share` carves
  (P, the settlement 15 %) count on the ERP side. They come out of the label share, so the Annex figure is probably
  before them.
- State the tolerance per comparison: 0.01 per ISRC-month, or exact.

**S11. Stage 7 completeness check is not closed.** `notes/settlement_landscape.md` §8 says that every "not covered"
item becomes a new case and goes through stage 6, and that the council accepts 13 *before* stage 7. 11 puts the check
inside stage 7 and has no loop back. Required:
- Add the loop.
- Name the 9 sources of §8 (one agent each).
- Define the measured shares as SQL or facade calls over 2024-01…2026-08: share of net through the layers, C by
  reason.
- Define the acceptance criterion: the "not covered" list is empty, or every item in it is an owner-signed assumption.

### Notes (QA additions to 11, each a named test)

N1. **C reason guard**: `tests/rules-coverage.test.ts` (or a new guard) asserts that the `CReason` union equals a
shared enum in `@erp/shared`. `api-responses.ts` then uses `z.enum` instead of `z.record(z.string())` for
`C_breakdown` keys and `reason`. The frontend has a label for every reason; today `SourcesPage.tsx` prints the raw
keys. This covers `assumption`, `rule_unconfirmed` and `label_unmapped`.

N2. **explainTrack sum**: for every golden case, Σ explain allocations + ours + perimeter C = unit net, and every
allocation has `layer` and `ruleId` (one shared helper in `golden.test.ts`).

N3. **Order independence**: `calculate()` on shuffled units and shuffled participation lists gives byte-identical
reconciliation, balances and explain. ClickHouse returns units in no fixed order (S1 is the proof).

N4. **Performance**: `LOG_TIMINGS=1` on the real data (`data/real`, stack loaded). Record `calculate()`,
`allocate units (JS)` and the balance request now, as the stage 2 baseline, and again after 3.4 and 3.5, with a
budget (for example ≤ 1.5× the baseline). The layer chain allocates more objects per unit, and the units projection
gains `label_name` (more rows).

N5. **Fixture additions** needed by the golden cases (none exist today):
- `BelieveRowSpec.labelName` (default per S9).
- `B17RowSpec.operationType` (today hard-coded `Performance`; needed by G26a and G26b).
- `confirmedOwner(..., { kind: 'label' })`. `createOwner` is hard-coded `person`; G05, G06, G07, G17 and G29 need
  `label`.
- `unconfirmedOwner` (an owner with a contract document left unapproved; G10).
- `assumptionDoc` (kind `assumption`, `requiresApproval: true`, never approved; G20, Q11).
- `approvedDoc` widened to the kinds `assumption`, `other` and assignment/sale. Note: today's `approvedDoc` approves
  nothing (`requiresApproval: false`); the name is misleading.
- `ownLabel(f, name, aliases[])` and `sublabel(f, { name, alias, ownLabelId, percent, recipientArtistId, documentId,
  validFrom })`.
- `participation(f, { isrc, artistId, percent, fundedFrom, fromArtistId?, validFrom, validTo?, documentId })`.
- `track(f, isrc, upc, ...)` for known pairs.
- `advance(f, { ownerId, amount, scope, date })` with basis and proof approved (G27, G29).
- `writeBelieve` with a distinct `reportId` per file in multi-file cases (G33).
- A pure `layerContext({...})` builder for `tests/layers/*.test.ts` without the stack.

N6. 09 E5/E6 say "no split → no sublabel half", but R1 (10 §7) reverses this, and G21 follows R1. This is
consistent, but 09 is now stale on these two rows. Mark this in the D-123 text and in `05_doc_drift.md`.

N7. D numbering (D-123…D-134) and migration numbering (PG 0006–0008, CH 0003) follow HEAD (last D-122, PG 0005,
CH 0002). OK.

## Arithmetic recomputed (independently, decimal.js precision 40)

All match the file; **0 mismatches**.

| Case | My computation | Match |
|---|---|---|
| G03b | carve 1: pool 50, each row −6.5 → 18.5/18.5, M1 13; carve 2: pool 37, each −6.5 → 12/12, M2 13; B 50, ours 50 | yes |
| G04 | R 15; factor 0.85; A 21.25, B 21.25, label 42.5; B 57.5 | yes |
| G05a / G05b | label 50 → NG 25, B 75, ours 25 / label 30 → NG 15, B 85, ours 15 | yes |
| G09 | 2026-02 A 50; 2026-03 (15th → 1st) A 25 / ours 75; 2026-05 A 0 / ours 100 | yes (see S4 on "A 0") |
| G10a / G10b | A 23 + D 7 = 30 B, L 20 C, ours 50 / D 7 B, L 20 C, ours 73 | yes |
| G15 | R −15; factor −85/−100 = 0.85; A −21.25, B −21.25, label −42.5, NG −21.25; B −78.75, ours −21.25, Σ −100 | yes |
| G16 | all 0; with factor `1 − Σp/100` no guard needed | yes |
| G18 | R 15; rows 21.25, label 42.5; pool 42.5 −13 → 14.75/14.75; P 4.25 → label 38.25; NG 19.125 (C), ours 19.125; B 61.75; Σ 100 | yes |
| G19 | A 50 C split_unconfirmed; P 5 B; ours 45 | yes |
| G21 | no split, label 100, NG 50 B, ours 50 | yes (S3 on `ourShareNoSplit`) |
| G22 | a 20 > pool 10 → P 10, A 0, unfunded 10; B 10, ours 90 | yes |
| G24 | UPC1 50 / 5 / 45; UPC2 25 / 2.5 / 22.5; B 82.5; ours 67.5; Σ 150; A's owner 75 | yes |
| G26a / b / c | parts 50/50; W1 25/25; W2 Mechanical (no-type 90) 45/5; Sync 25/25; external writer → W1 100: 50/50 | yes |
| G27 | P 7.5 + 7.5; recoup oldest first (`recoup.ts` sorts by report month; op month 2026-03 is included, `>=`): 7.5 + 2.5; payable 5 | yes |
| G28 | 50 − 30 = 20; 50 − 70 = −20 shown 0 | yes |
| G29 | 25 − 25 = 0, remaining 25 | yes |
| G31 / G32 | label 0, NG 0 / R 15, A 85, label 0 | yes |
| G33 | 1052428: A 100, B 50, ours 50 (0to8); 1055956: A 50, B 25, ours 25 (Echo8) | yes |

Also checked: G02 (49.8 / 50.2), G03a, G06, G07, G08c, G11 (7.5 / 42.5), G12 (5 / 45), G14 (`valid_to` exclusive),
G20. All are correct.

## E → G mapping (09 §7)

| E | Golden case / existing test | Coverage | Missing |
|---|---|---|---|
| E1 negative | G15; `review-fixes` "negative master lines net…", `recoup.test` "negative income has no recoup capacity" | full | — |
| E2 zero | G16 | full | — |
| E3 carves above bucket | G22 (pool) | partial | Σ top > 100 (B2, G35) |
| E4 label share 0 | G31 (sublabel), G32 | partial | `label_share` carve on 0 (G31b) |
| E5 label share 100 | G21 (no split) | partial | all-zero split + sublabel (G21b) |
| E6 sublabel, no split | G21 (by R1, reverses 09) | partial | Echo8 sublabel without split (G21c) |
| E7 rule mid-history / window | G09, G13 (splits), G14 (window end) | partial | participation start after first unit (G14b) |
| E8 mid-month instrument | G09, G25 | full | — |
| E9 two UPC | G24 | partial | advance scoped to one UPC: no UPC scope in `recoup.ts`, not in design |
| E10 Echo8 unit, 0to8 paper | G08b, G33 | partial | signal M39 assert |
| E11 unknown pair | G30; `facade.test` (unknown_pair 10) | partial | per account (Echo8) in G33 |
| E12 split unconfirmed, carve confirmed | G19 | full | — |
| E13 same ISRC in two accounts | G33 (wording ambiguous) | partial | say "same ISRC and sales month" |
| E14 label_name over time | — | **none** | new case |
| E15 unmapped imprint | G08c | partial | signal `labelUnmapped` assert |
| E16 double participation | G23 | full | — |
| E17 rounding chain | G02, G03a | partial | thirds pro rata (B1, G34), invariant test |
| E18 all layers | G18 | partial | `artist_share` and three rows (G18b) |
| E19 instrument not per recording | — | **none** | stage 4 listing / signal named |
| E20 retro rule after payout | `facade.test` "balance may be negative after a split change", G28 | full (snapshot unchanged asserted in `facade.test` payout test) | — |
| E21 advance from participation / sublabel | G27, G29 | partial | zero or negative month (G27b) |
| E22 licence rate ≠ registered | — | **none** | signal M39 delta named and tested |
| E23 window ends mid-history | G14 | full | — |
| E24 top on rows = 100 | G32 | full | — |
| E25 sold recording | G17 | partial | unit before the sale month |

Fully covered: 9 of 25. Partially covered: 13. Not covered: 3 (E14, E19, E22).

## Required to accept

1. B1: the residue rule in 10 §3, plus G34 and the invariant test planned in 11 step 3.4.
2. B2: the cap rule and entry validation for Σ top, plus G35.

The should-fix items S1–S11 are expected in the same revision. If any is deferred, 11 must name the step that takes it.
