Verdict: yes

# Stage 3 review: product / money (layers, golden tests, API), 2026-11-03

Reviewer: the product member of the council, read-only, on `feature/fable-001` at HEAD `ca23896`.

**What I read:**
- `12_golden_cases.md`, `10_target_model.md` §3–§6, `11_plan.md`
- `notes/settlement_landscape.md` (the MVP list)
- `09_settlement_cases.md`
- the stage-2 product verdict (its "Remaining" items and its stage-3 checklist)
- D-124…D-129 in `docs/97_принятые_решения.md`
- `src/facade/layers/*`, `src/facade/reports.ts`, `tests/golden.test.ts`, `tests/layers/*.test.ts`

**What I ran:**
- `REQUIRE_STACK=1 npm test`: 32 files, 346 tests, all pass.
- `npx vitest run tests/golden.test.ts --reporter=verbose`: 57 tests pass, none skipped.
- The API on :3003 against the dev database, with GET calls only.

I did not modify the code or the data.

## 1. Golden numbers as tests

**Every case has an end-to-end test.** All of G01–G44 (G03a/b/c, G05a/b, G06/G07, G08a/b/c, G10a/b, G18 and G18b, G27 and G27b, and G43 (i)–(iii)) are in `tests/golden.test.ts`, and so are G26a–e. The cases that 12 says have a pure layer half also have a pure test in `tests/layers/*.test.ts`. There is no `.skip`, `.only` or `.todo` in either file.

**No assertion is weakened.** The expected strings equal the hand answers in 12 for B, C, ours, the reasons and the signals:
- **Signals:** `labelUnmapped` (G08c), `assumptions` with their document and basis (G10a, G18 `q11` ×2), `unfunded` (G22 `bucket_short` 10, G37 20, G44 29).
- **C reasons and breakdowns:** `C_breakdown` and `ourShareNoSplit` (G21 50, G41 0); NG `null` in G41 (B, not R1).
- **Recoupment:** `remaining` (G27, G27b, G29, G43 (i)).
- **Payouts:** a negative payable is shown as 0 (G28, G39).
- **Errors:** `double_participation` and `top_above_100` (G23).

**12 has not changed** since the stage-2 commit (`git diff 1db0d51 HEAD -- docs/agents/12_golden_cases.md` is empty).

**The money-format guard changed, but it is not weakened.** `8a288b6` changed its expectation from `333.43332999900033333333` to `333.433329999`. I recomputed it under the 12-decimal rule (D-123), quantising per unit:
- q(0.1 × 33.333333 %) = 0.033333333
- q(0.2 × 33.333333 %) = 0.066666666
- q(1000.000000000001 × 33.333333 %) = 333.333330000000
- total 333.433329999

The rule the guard protects (no floats) is unchanged.

**Every master case also runs `Case.verify()`, which covers the checks of 12 §"Checks every master case also asserts":**
- discrepancy 0;
- B + C + ours = A per account and month;
- the explain's last state is `categorise` and sums to the unit net;
- each recipient's earned equals its B allocations, and its waiting equals its C allocations.

G43 skips the owner check only for A, because the publishing income is not in the explain. The broken-layer test shows a discrepancy of 20.

Small looseness, none of which changes a number (finding 4): G08a asserts only the reconciliation row and not `A 50`; G27 asserts that 10 is recouped, but not the split of 7.5 from March and 2.5 from April; G26a–e do not check owner balances.

## 2. Six cases recomputed by hand from the contract rule

| Case | My computation | Test string | Agree |
|---|---|---|---|
| G18 | R top 15 % of 100 = 15 → scaled net 85; rows 25 % × 85 = 21.25 each, label 42.5. M pool 13 % of net = 13, taken from rows pro rata 21.25 : 21.25 → 6.5 each → A, B 14.75. P (bucket, label_share) 10 % × 42.5 = 4.25 → label 38.25. NG 50 % × 38.25 = 19.125, ours 19.125. Q11: P and NG are C `assumption`. B = 15 + 14.75 + 14.75 + 13 = 57.5; C = 4.25 + 19.125 = 23.375; Σ = 100 | A 14.75, B 14.75, R 15, M 13, P 4.25, NG 19.125; B 57.5, C 23.375, ours 19.125, two `q11` assumptions | yes |
| G34 | pool 49.8; M 13 from three equal rows: 13 / 3 = 4.333…; quantised 4.333333333333 × 3 = 12.999999999999; the residue 1e-12 goes to the largest row, a tie broken by the lowest id (A) → A gives 4.333333333334. A = 16.6 − 4.333333333334 = 12.266666666666; B, C 12.266666666667; ours 50.2 | same strings; B 49.8, ours 50.2 | yes |
| G36 | settlement (net, label_share) 15 % of net 100 = 15, paid from the label share 50 → 35; A, B keep 25 each. B = 65, ours 35 | A 25, B 25, S 15; B 65, ours 35 | yes |
| G44 | pool = row A 10; three targets 13 % × 100 = 13 → 39 > 10 → scaled to 10 pro rata 13 : 13 : 13 = 3.333…; quantised ×3 = 9.999999999999; residue to M1 (a tie, the first by id) → 3.333333333334 / 3.333333333333 / 3.333333333333; A 0; shortfall 39 − 10 = 29; B 10, ours 90 | same | yes |
| G26a | line 100, Mechanical, writers W1, W2 both ours → parts 50 / 50 (D-087). W1 untyped 50 → author 25, label 25. W2 has 90 untyped and 50 for Synchronization only, so 90 applies → author 45, label 5 | W1 50 / 50 / 25 / 25 B; W2 50 / 90 / 45 / 5 B | yes |
| G43 | master: row 50 % of 100 = 50. Publishing: a B17 line of 60 to the holder (an alias of A's owner, no co-writers) at a term of 50 → 30. Payable 80. (i) An advance of 40 with scope publishing recoups 30 → remaining 10, payable 80 − 30 = 50. (ii) Scope ISRC list [I(2)], which has no income → recouped 0, payable 80. (iii) A migration payout of 20 with no scope → paid 20, payable 60 | (i) 30 / 10 / 50; (ii) 0 / 80; (iii) 20 / 60 | yes |

## 3. Three real recordings through the API (dev database)

There are no labels in the dev database: `GET /labels` returns `[]`, so even the string `0to8` is unmapped. That is the state 10 §3 layer 1 and E15 describe: the rows and carves run, the label share waits in C `label_unmapped`, and there is no sublabel carve. The data confirms it:

| ISRC | Units | Net | Rows | Label share |
|---|---|---|---|---|
| FRX762590589 (string `0to8`) | 76 | 31,682.164233 | **paid as B**: 15,336.833644 (rows 23 / 7 / 20 under an approved appendix) | 16,345.330589 C `label_unmapped` |
| FRX282688758 (string `NoGhost Records`) | 3 | 11,349.897617 | 5,674.948809 C `split_unconfirmed` | 5,674.948809 C `label_unmapped`; no NG carve |
| DGA062593864 (string `0to8`) | 49 | 28,850.668910 | 14,425.334455 C `split_unconfirmed` (five rows 13 / 13 / 8 / 8 / 8) | 14,425.334455 C `label_unmapped` |

The last two are C because their splits are legacy rows without a document (`documentId: null`), which is the existing document rule. They are not C because of the label.

For all three:
- every unit's last state sums to its net (0 failures);
- the units have no shortfalls.

`GET /reconciliation` for 2026-07 gives `discrepancy 0` on both accounts, with ours 0. Account 1052428 has `label_unmapped` 399,403.59 in C, as D-127 says.

**`explainTrack(FRX762590589)` is traceable.** It returns:
- `splits`: the two periods, each with its document, its note "buyout #4" and `ourShare`;
- `participations` (none);
- per unit: account, UPC, reporting and sales month, the label string, net, the final allocations, and the state after each of the six layers.

Each allocation carries:
- `layer` and `kind`;
- `ruleId`, which is the split id;
- `documentId` and `percent`;
- `amount`, `ownerId`, `category` and `reason`.

Example: the 2026-05 unit, net 0.005277752299, layer `split`, gives:
- rows 23 % = 0.001213883029, 7 % = 0.000369442661, 20 % = 0.00105555046;
- label share 0.002638876149 in `label_unmapped`.

The sum is exact. A reader can go from each amount to its rule and document.

Two observations (findings 5 and 6):
- The response is 4.5 MB for this track, because `breakdown` carries about 19,000 report lines.
- The buy-out split starts on **2026-05-26**, a stored legacy date that is not floored. The layer picks the split by the report date 2026-05-01, so May still pays the seller under the old 23 % row: 227.51 over the 2026-05 units. M52 (G09) says the whole month goes to the new holder. Plan 4.2 normalises the 1,043 mid-month dates, so this is a stage-4 item, not a layer bug. The L 20 row (the Q1 case, G10a) also has no `assumption` document in the dev data yet, which is plan 4.3.

## 4. The ✅ MVP items of `notes/settlement_landscape.md`

| # | Item | Computed by (golden test) or data rule |
|---|---|---|
| 1 | simple split (M1) | G01 |
| 2 | several artists (M2) | G02, G34 |
| 3 | label fixed, MCs from the pool (M3) | G03a, G03b, G03c (data: scaled rows), G34, G44 |
| 4 | remixer off the top (M4) | G04, G32, G15 |
| 5 | sublabel half (M5) | G05a, G05b, G29, G31, G38 |
| 6 | sublabel pass-through (M6) | G06 (data: row to the label owner) |
| 7 | label representative, schedules by date (M7) | G07 plus the date replacement of G13 and G17; M39 conflicts through the `assumptions` signal (G10a) |
| 8 | imprint aliases, Echo8 (M8) | G08a, G08b, G08c, G33, G40 |
| 9 | buy-outs (M9) | G09, G10b |
| 10 | sample or acapella (M11) | G10a (rows), G04 (top) |
| 11 | label-share participation (M12) | G11, G35, G36, G37 |
| 12 | artist-share participation (M13) | G12, G18b |
| 13 | assignment chain (M10) | G13 |
| 14 | rule period by report date (M25) | G14, G09, G25 |
| 15 | negative lines (M26) | G15, G16, G27b |
| 16 | Duetti, withdrawn, brand artist (M28) | G17, G42; withdrawn recordings keep their last split (data) |
| 17 | rates by channel (M18) | data rule "Believe = digital column"; no test needed, but see finding 2 |
| 18 | co-ownership (M14) | G12 layer (routed through #1) or two rows (data) |
| 19 | derivative outside authorisation (M29) | track note plus the `tracksWithNote` signal: **no test**, finding 1 |
| 20 | equal parts of our writers (M17) | G26a, G26c, `publishing.test.ts` "three writers" |
| 21 | co-pub 50 (M15) | G26a (W1), G26d |
| 22 | admin 90 / 50 by operation type (M16) | G26a, G26b |
| 24 | Believe 0to8 and Echo8 | G33, G40 |
| 25 | B17 | G26e |
| 29 | payment history from Main | data, plan 4.5 (D-132): not yet loaded, finding 3 |
| 30 | recoupable advance and scopes (M19) | G27, G27b, G29, G43 (i), G43 (ii) |
| 31 | non-recoupable and one-off payments (M20) | G43 (iii) (data: payouts with no scope) |
| 32 | overpayment becomes a debt (M27) | G28, G39 |

## 5. Claims in D-127 and D-128 compared with the code

**What the code delivers:**
- Layer order and rules: `layers/index.ts`, `carve.ts`, `categorise.ts`, `exact.ts`.
- Unmapped labels: rows run, ours in C, no sublabel (`label-of-record.ts`, and `sublabel()` checks `labelShareCategory`).
- Q11, R1 and the document assumption (`categorise.ts`).
- Ours from the layer state, per account and per label (`reconcile`).
- The new signals (`reports.ts:84–147`).
- The writer parts and author share as pure layers (`writer-parts.ts`, `author-share.ts`, `publishing-categorise.ts`).

**Stale but corrected in place:** D-127's "known limits" says the guard was not changed. The appended line "Guard test adjusted (orchestrator, 2026-11-03)" corrects it.

**Promised by the design, not yet in the balance:** "the balance shows B, recouped and paid per paying label" (10 §5) is not implemented. `balance.ts` has no per-label split. The plan puts it in step 4.4 (D-131), so D-127 does not claim it. See finding 7.

## Findings

1. **should-fix: the M29 signal (MVP item 19) has no test.**
   - Evidence: `signals().tracksWithNote` and `participantsWithoutOwner` (`src/facade/reports.ts:128–139`) are asserted nowhere. `grep -rn tracksWithNote packages/backend/tests` finds nothing. `api-contract.test.ts` only parses `/signals`, and `labels.test.ts:97` checks the note round trip, not the signal.
   - Required change: a test that sets a note on a track and expects it in `signals().tracksWithNote` with that note, without changing any amount. Add a participation whose pseudonym has no owner, with an expected `participantsWithoutOwner` amount.
   - Also: D-129 says the track note has no form on the pages. Until there is one, M29 notes are entered through `PATCH /tracks/:id` only. That is acceptable for the stage-4 load, but say so in 05_doc_drift or in the stage-4 entry.
2. **should-fix: the M18 data rule is not recorded in a D-entry.**
   - Evidence: 09 M18 says "Believe = channel digital, the digital column is the split percent; the other columns are a document note (D-entry)". Neither D-123 nor 10 states it (`grep M18` over 10 and 97 finds nothing).
   - Required change: record it in the stage-4 entry (D-131) before the splits are entered, naming the unequal-column contracts as notes.
3. **note: the stage-2 checks that depend on data are deferred to stage 4.** The 4.5 load log reconciling to 8,045,246.75, and the list of "вычет доли" pairs matched to the participations of 4.3, cannot be checked yet: nothing from Main is loaded (MVP item 29). The stage-4 product review must run both.
4. **note: small assertion gaps compared with 12.** None changes a number, and the sums cover each of them:
   - G08a has no `A 50` allocation assertion;
   - G27 does not assert the 7.5 / 2.5 recoup order by month;
   - G26a–e have no owner-balance check;
   - G42 models the brand pseudonym as a separate label company, not as the label owner.

   Tightening them is optional.
5. **note: `explainTrack` is heavy.** It is 4.5 MB for FRX762590589, most of it the per-line `breakdown`, and the explain page should page or collapse it. It is not a money issue.
6. **note: stored mid-month dates are not floored at read.** The real FRX762590589 buy-out from 2026-05-26 leaves May with the seller (227.51), against M52. The flooring happens only at entry (D-126), and plan 4.2 normalises the 1,043 legacy dates. The stage-5 known differences list already carries "M52 month start (±13,363.21)". Make sure 4.2 actually rewrites them.
7. **note: the balance per paying label is still to be built (10 §5).** It is planned for 4.4 (D-131) together with labelling "one balance across both labels" an assumption. The stage-4 product review will check it.

No blocker. The layers compute every golden number exactly as hand-computed, every ✅ item is either a golden-tested layer or a named data rule (items 17, 19 and 29 with the caveats above), and the real data behaves as the design says while the labels dictionary is empty.
