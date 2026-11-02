Verdict: yes

## Revision 2 (re-review at `ba3ecf8` "stage 3 council fixes (D-130)", 2026-11-03)

The verdict stays **yes**. Nothing regressed, and both should-fix items are closed.

**Baseline**
- Two full runs of the definition of done: typecheck and lint (mvp ignored) are clean, and `REQUIRE_STACK=1 npm test`
  gives 32 files, **354 / 354** (31.6 s and 31.3 s). No flakiness.
- `npm run build:client` is green.
- `.gitignore` now has `__pycache__/` and `*.pyc`. `git ls-files` lists 0 pyc files.

**Finding 1 (sign at exactly 100): fixed.**
- `capToBase` in `layers/exact.ts` is used by `split.ts` and `off-the-top.ts`.
- `distributeCapped` in `layers/exact.ts` is used by the pool carve in `carve.ts`.
- My harness (`qa3/harness.mts`) now also asserts the sign of `scaledNet` after every layer. It still has the exact-100
  generators (random cut points and thirds, for rows and for tops), pico nets of 0–999 × 1e-12, zero and negative
  nets, every carve kind, artist-share and label-share at 100 %, sublabel percents 50 / random / 100 / 0.000001, and
  shuffled participations and split rows.
- Results, seeds 4242, 99, 2026, 7 and 31337 × 20,000 units (100,000 units):

  | Check | Failures |
  |---|---|
  | Σ ≠ net | **0** |
  | Amount above 12 decimals | **0** |
  | Allocation, label share or scaled net with the opposite sign of the unit | **0** |
  | Non-zero amount on a zero net | **0** |
  | Order dependence | **0** |

  Each seed scales down about 17,000 units, so the shortfall paths really run.
- The stage 3 harness gave about 1,640 wrong-sign failures per seed.
- My five minimal cases now give:

  | Case | Result |
  |---|---|
  | Rows 50/50, net `10.000000000001` | A `5`, B `5.000000000001` (the tie goes by artist id), label `0` |
  | Same unit under NoGhost | NG `0`, label `0` |
  | Thirds | C `3.3333334`, label `0` |
  | Top 15 with rows 50/50 under NoGhost | NG `0` |
  | Tops 50/50 and rows 50/50 | tops `5` / `5.000000000001`, rows `0` / `0`, label `0` |

- `tests/layers/exactness.test.ts` now has "percents summing to exactly 100…" (with sign checks on the label share
  and the scaled net) and "the minimal reproductions…".

**Finding 2 (publishing decimals): fixed.**
- `writer-parts.ts` cuts at `SCALE` (12, `ROUND_DOWN`), and the last writer takes the remainder.
- `author-share.ts` uses `pct()`.
- `tests/layers/publishing.test.ts` asserts ≤ 12 decimals on parts, author amounts and label amounts.
- Every multiplication site in `src/` is now quantised: `q` / `pct` / `distribute*`, cents in `payouts.ts`, and
  conversions in `money.ts`.

**Finding 4 (signals): fixed.** `golden.test.ts` has "tracksWithNote lists a noted track without changing an
amount; participantsWithoutOwner carries the amount". This also pins the E19 signal half. The M51 listing stays in
stage 4.

**Finding 8 (pyc): fixed.**

**Migration 0010.** The overlap key now includes `coalesce(from_artist_id, '')`, and it is covered in
`participations.test.ts`. I read it: the old key holds for every kind except `artist_share`.

**Mutations, re-run** (`qa3/mutation.test.ts` on a private stack): `-15`, `-0.000000000001`, `19.125000000001` and
`9.5625`. The correct chain gives `0`, and `explainTrack` sums to the unit after every layer.

**Still open, all notes**
- N2: `verify()` checks the last layer only.
- N3: there is no end-to-end shuffle test.
- E6: the Echo8 sublabel without a split is not pinned.
- E10 / E22: the M39 signal is not tested.
- E9: there is no advance scope by UPC.
- Performance must be measured again after stage 4.1–4.3. Stage 4 runs the carve and sublabel paths; the dev data has
  no labels or participations.

None of these block the stage.


# Stage 3 review: QA (steps 3.1–3.6, D-124…D-129), 2026-11-03

Reviewed at HEAD `ca23896`. During the review `b0cac58` landed: stage 4 scripts under `packages/backend/scripts/mvp/`,
outside this review. The work was read-only. Throwaway scripts are in the session scratchpad (`qa3/`) and nothing in
the repo changed except this file.

No blockers. Money is exact everywhere: Σ allocations + label share = net held after every layer on 60,000 random
units, and every amount has at most 12 decimals. Every deliberate mutation I tried shows up as a non-zero
`discrepancy`, down to 1 pico. One class of sign error remains. It is 1 pico-USD and appears when percents sum to
exactly 100 (finding 1). Fix it in the next revision, before stage 5 compares against the Annex.

## Baseline

| Run | typecheck | lint (mvp ignored) | `REQUIRE_STACK=1 npm test` | Duration |
|---|---|---|---|---|
| 1 | clean | clean | 32 files, **346 / 346** | 34.2 s |
| 2 | failed in `scripts/mvp/lib.ts` only (other agents' WIP at that moment, `.items` on `ParticipationView[]`) | clean | 346 / 346 | 24.4 s |
| 3 | same as run 2 | clean | 346 / 346 | 24.7 s |
| re-check at `b0cac58` | clean | — | — | — |

- With `scripts/mvp/**` excluded (a scratch tsconfig), the backend typecheck was clean during runs 2 and 3. So the
  committed stage 3 code was clean throughout. The run 2/3 failures came from uncommitted WIP, which was fixed by the
  time `b0cac58` landed.
- No flakiness: 3 × 346 green. The `sources-loader` flake of stage 2 is gone (D-124 adds the `ORDER BY`).
- Golden file alone: `tests/golden.test.ts` 57 / 57 (18.7 s). Layer tests alone: `tests/layers/` 9 files,
  74 / 74 (1.3 s, no stack).
- `npm run build:client`: built, 314 kB JS.

## Findings

### 1. should-fix: a 1-pico wrong-sign allocation when percents sum to exactly 100

**Evidence.** My harness (`qa3/harness.mts`) runs 20,000 units per seed, seeds 4242, 99 and 2026. It has 6-decimal
percents and nets up to 1e5 with 12 decimals, plus pico nets, zero nets and negative nets. It covers every carve kind,
tops above 100, pool, artist-share and label-share shortfalls, and shuffled participations and split rows. It found
**0** failures of Σ = net, **0** amounts above 12 decimals, **0** non-zero amounts on a zero net and **0**
order-dependence. It found about 1,640 sign failures per seed, and all of them are cases where the top percents or
the row percents sum to exactly 100. Breakdown for seed 4242:

| Cause | label share | split row | sublabel | label_share carve | artist_share carve |
|---|---|---|---|---|---|
| Σ rows = 100 | 519 | — | 198 | 73 | — |
| Σ tops = 100 | 497 | 136 | 157 | 47 | 30 |

Minimal reproductions (pure, `qa3/minimal.mts`):
- Rows A 50, B 50, net `10.000000000001`, label Test Label: A `5.000000000001`, B `5.000000000001`, label share
  **`-0.000000000001`** on a positive unit.
- Same unit with label NoGhost: sublabel NG **`-0.000000000001`**, ours 0. The negative label share is halved, and
  half-up rounding takes it away from zero.
- Rows 33.333333 / 33.333333 / 33.333334, net `10.000000000002`: label share `-0.000000000001`.
- Top 15 with rows 50/50 (the shape of E24 / G32), net `10.000000000001`, NoGhost: NG `-0.000000000001`.
- Tops 50/50, rows 50/50, net `10.000000000001`: tops `5.000000000001` each, scaled net `-0.000000000001`, rows A and
  B **`-0.000000000001` each**, label share `+0.000000000001`. This is the E3 rule "rows never go negative on a
  positive unit".

**Cause.** `split.ts` and `off-the-top.ts` quantise each `pct()` half-up and take the remainder by subtraction. When
the percents sum to exactly 100, Σ q(...) can exceed the base by up to ⌊k/2⌋ pico. `labelShare` or `scaledNet` then
crosses zero, and the later layers (sublabel, label-share carves with base bucket, artist-share) carry the wrong sign
on.

**Why the committed test misses it.** `tests/layers/exactness.test.ts` checks the sign of `rows` only, not of
`labelShare`. Its generator draws each row from `percent(100 / nRows)` and each top from `percent(30 | 80)`, so
neither sum hits exactly 100. The realistic case does exactly that: 09 E4 counts 87 splits whose rows sum to 100, and
any of them under a sublabel imprint pays the sublabel −1 pico.

**Required change.**
- In `split` and `offTheTop`, when the summed quantised amounts exceed the base in absolute value, take the excess off
  the largest allocation (the residue rule of 10 §3). The remainder then has the sign of the unit or is zero.
- Add two things to the exactness test: generators with Σ rows = 100 and Σ tops = 100 (cut points and thirds), and a
  sign assertion on `labelShare` and `scaledNet`.
- Pin one case as a golden or layer case: rows 50/50, NoGhost, net `10.000000000001`, expecting NG 0 or positive.

### 2. should-fix: publishing amounts are not quantised to 12 decimals

**Evidence.**
- `layers/writer-parts.ts:124` cuts equal parts at **20** decimals.
- `layers/author-share.ts:29` computes `authorAmount = payable × percent / 100` with no quantisation, so a 3-writer
  line gives author amounts of about 26 decimals.
- These are the only multiplication sites outside `exact.ts`, apart from `payouts.ts` (cents, `toDecimalPlaces(2)`)
  and `money.ts` (conversions). Every master site goes through `q` / `pct` / `distribute`.
- D-128 part 2 says "no new rounding" on purpose. The stage 2 note asked for "every amount ≤ 12 decimals", and 10 §3
  states the rule "for every layer".

**Effect.** No money is lost (`labelAmount = part − authorAmount`, and reconciliation is still exact). But JSON money
for B17 carries more than 12 decimals, which breaks the uniform format the guard expects.

**Required change.** Either quantise both publishing sites with `q` and give the residue to the label amount, adding a
≤ 12-decimal assertion to `tests/layers/publishing.test.ts`, or record the exception explicitly in a D-entry and in
10 §4.

### 3. note: N2 and N3 are only partly realised

- N2 (`explainTrack` sum): `golden.test.ts` `verify()` checks Σ allocations + label share = net only on the
  **last** layer, and it does not assert that every allocation has `layer` and `ruleId`. My scratch mutation test
  checked every layer of the G18-shaped unit (net `100.000000000003`), and it holds. All allocations there carry
  `layer` and `ruleId`.
- N3 (order independence): there is a pure test (shuffled participations). There is no end-to-end test over
  `calculate()` with a different unit order from ClickHouse. My harness also shuffled the split row order: 0
  differences.
- Suggested: extend `verify()` to every layer and to `layer`/`ruleId`.

### 4. note: some new signals have no behavioural test

- `signals().tracksWithNote` and `participantsWithoutOwner` are only parsed by the contract scenario. No test asserts
  their content: which tracks, which participations, the amount.
- `assumptions`, `labelUnmapped` and `unfunded` are asserted (G10a, G08c, G22, G37, G44).

### 5. note: mutation checks

Results from the scratch vitest on a private stack (`qa3/mutation.test.ts`, run with a scratch config). The case is
one unit, NoGhost, top 15, rows 25/25, pool 13, label-share 10, net `100.000000000003`.

| Mutation (wrapped layer list passed to `calculate`) | discrepancy |
|---|---|
| none | `0` |
| off-the-top does not subtract from the label share | `-15` |
| split adds 1 pico to a row | `-0.000000000001` |
| carve drops the sublabel allocation | `19.125000000001` |
| categorise halves the label share | `9.5625` |
| label of record sets `ourLabelId` null and keeps "ours" | `0` (no money moves; the amount goes under `ourShareByLabel['?']`, which no guard flags; low risk) |

- `explainTrack` summed to the unit after every layer.
- The API contract would fail if an operation were removed from `operations.ts`, which I reasoned from the test
  without editing it:
  - `call()` throws "Operation … is not in the contract" in "every operation answers…";
  - "the contract lists exactly the routes Express has" fails, because Express still has the route;
  - the OpenAPI count is consistent, so that check does not catch it.

### 6. note: performance

`LOG_TIMINGS=1 PORT=3004 main.ts data`. The data: 47 files, 721,975 units, 24,754 split rows, 0 participations and 0
labels in the dev database. The owner with the most split rows (588) was found with a read-only query.
- `GET /owners/:id/balance`: **4.82 / 4.74 / 4.74 s**, against the budget of 10 s.
- Breakdown: `calculate` 4.63 s; ClickHouse units 0.83 s; `parsePico` 0.28 s; layers 2.33 s;
  `publishing.snapshotForCalculation` 0.94 s; publishing layers 0.12 s; `ownerBalance` 0.09 s.
- This matches the D-127 measurement.
- Caveat: with no labels or participations loaded, every unit is `label_unmapped` and the carve and sublabel paths do
  not run. **Measure again after stage 4.1–4.3.**

### 7. note: frontend

- The new pages `LabelsPage.tsx` and `ParticipationsPage.tsx` are typed through `api/client.ts` against the shared
  response types. Field use matches: `rules[].recipientPseudonym`, `documentStatus`, the paginated `items` / `total`
  for participations. No obvious runtime errors.
- Reasons go through `REASON_LABELS` from `@erp/shared/reasons`.
- Minor: both pages cap the recipient list at 2,000 artists with `slice(0, 2000)` and say nothing. The dev database
  has 1,107, but a larger catalogue would hide recipients.
- `SourcesPage` formats breakdown amounts with `Number(v).toFixed(2)`. This is display only.

### 8. note: repository hygiene (outside stage 3)

`b0cac58` committed `scripts/mvp/__pycache__/*.pyc` (3 files), and `.gitignore` has no `__pycache__` rule. Remove
them and add the ignore rule.

## Edge cases E1–E25 (09 §7) → tests now

| E | Pinned by | Status |
|---|---|---|
| E1 negative | `golden` G15; `layers/carve` "G15 (E1)…"; `layers/off-the-top` "a top on a negative unit…"; G27b | pinned |
| E2 zero | `golden` G16; `layers/carve` "G16 (E2)…" | pinned |
| E3 above bucket / top > 100 | `golden` G22, G37, G44; `layers/carve` "artist-share carves above 100 %…", "…without its source row"; `layers/off-the-top` "over-100 tops…" (×2); G23 (entry refusal) | pinned; finding 1 is the 1-pico sign residue at exactly 100 |
| E4 label share 0 | `golden` G31; `layers/carve` "G31 (E4)…" | pinned for the sublabel; a label-share carve on 0 is only random-tested, and finding 1 affects it |
| E5 label share 100 | `golden` G41 (all-zero split → sublabel B), G21 (no split, R1) | pinned |
| E6 sublabel imprint, no split | `golden` G21 (NoGhost); `layers/categorise` "G21 (R1)…" | pinned for a 0to8 sublabel; **an Echo8 sublabel (qaraqshy) without split is not pinned** |
| E7 rule mid-history / window | `golden` G09, G13, G14, G39 (retro start); `layers/label-of-record` "a rule outside its period does not apply"; `layers/carve` G14 | pinned; a participation whose start falls after earlier loaded units is covered only by the sublabel-rule twin |
| E8 mid-month instrument | `golden` G09, G25 | pinned |
| E9 two UPC | `golden` G24; `layers/carve` "G24 (E9)…"; G43(ii) scope by ISRC | pinned for allocation; **advance scope by UPC is not designed** (open since stage 2) |
| E10 Echo8 unit, 0to8 paper | `golden` G08b, G33 | partial: **signal M39 not asserted** |
| E11 unknown pair | `golden` G30, G40 (per account, Echo8 account) | pinned |
| E12 split unconfirmed, carve confirmed | `golden` G19; `layers/categorise` "G19 (E12)…" | pinned |
| E13 same ISRC + month in two accounts | `golden` G40 | pinned |
| E14 label_name over time | `golden` G38; `layers/label-of-record` "G38 (E14)…" | pinned |
| E15 unmapped imprint | `golden` G08c (with `signals().labelUnmapped`); `layers/label-of-record` "an unmapped string…"; `layers/carve` "the sublabel never runs on an unmapped string" | pinned |
| E16 double participation | `golden` G23 | pinned |
| E17 rounding chain | `golden` G02, G03a, G03c, G34, G44; `layers/exactness` (10,000 seeded + shuffle) | pinned; see finding 1 for the gap in the generator |
| E18 all layers | `golden` G18, G18b; `layers/carve` G18, G18b | pinned |
| E19 interest not per recording | track `note` round-trip (`labels.test` "a track note round-trips"; contract PATCH `/tracks/:id`) | **not pinned**: there is no test of `signals().tracksWithNote`, and the M51 listing belongs to stage 4 |
| E20 retro rule after payout | `golden` G39, G28; `facade.test` "balance may be negative after a split change" | pinned |
| E21 advance from participation / sublabel; zero or negative month | `golden` G27, **G27b** (negative April), G29 | pinned |
| E22 licence rate ≠ registered | `golden` G10a (the assumption document mechanism, `signals().assumptions`) | partial: **no M39 delta signal** |
| E23 window ends mid-history | `golden` G14 | pinned |
| E24 top on rows = 100 | `golden` G32, G23 (cap at entry); `layers/off-the-top` "G32…" | pinned; finding 1 applies when the unit has an odd pico |
| E25 sold recording | `golden` G17 (2026-05 old split, 2026-06 buyer 100) | pinned |

Totals: 20 pinned, 3 partial (E6 Echo8 variant, E10, E22), 2 not pinned or not designed (E19 signal, the E9 UPC
scope). Stage 2 had 9 / 13 / 3.

The five cases the stage 2 QA left partial:
- **E4** is pinned (G31).
- **E7** is pinned (sublabel-rule twin, G39).
- **E19** is still open.
- **E10** is still partial (M39).
- **E6** is still partial (Echo8 variant).

Before stage 5: E10 and E22 need M39 named and tested, or deferred explicitly in 11 to the stage that takes M39. E19
needs a `tracksWithNote` assertion.

## Required for the next revision (should-fix)

1. Finding 1: the residue cap in `split` and `offTheTop`, plus the exact-100 generators and the label-share sign
   assertion.
2. Finding 2: quantise the publishing amounts, or record the exception in a D-entry.
