Verdict: yes

# Stage 7 council: QA (2026-11-03)

Reviewer: QA member, independent, read-only. HEAD `9643b34` on `feature/fable-001`. Database `erp`. The only file
this review writes is this one. Scratch output is in
`/private/tmp/claude-501/-Users-nearlydeadhipo-Desktop-0to8-ERP/441975a6-0f8b-4dbd-b984-d2856fc5b0b0/scratchpad/qa7/`.
This verdict uses stage names, ISRC, owner id prefixes and amounts only.

## What I ran

| Check | Result |
|---|---|
| `npm run typecheck` (backend, frontend, shared) | exit 0 |
| `npm run lint` | exit 0 |
| `REQUIRE_STACK=1 npm test`, run 1 | 32 files, **360 passed**, 0 failed, 0 skipped (36.2 s) |
| `REQUIRE_STACK=1 npm test`, run 2 | 32 files, **360 passed**, 0 failed, 0 skipped (28.2 s) |
| `tests/golden.test.ts` alone | 1 file, 64 passed |
| `tests/layers/` alone | 9 files, 77 passed |
| `npm run build:client` | exit 0 (315.86 kB JS) |
| `load.ts all`, dry run (no `--apply`) | exit 0. Every step reports `already_done`, `skipped_*`, `*_not_loaded` or `(nothing)`. No step reports anything to write. See finding 3 for one misleading counter |
| `compare-annex.ts --out qa7/annex.md` | the same as `data/mvp-load/verify/annex.md` except the timestamp lines |
| `compare-main.ts --out qa7/main.md` | `main.md` and `main_owners.csv` are the same as `data/mvp-load/verify/` except the timestamp lines |
| Owner decomposition (`stage5/owner_dump.mts`, `stage6/carve_take.mts`, `stage6/decomp2.py … noE1`, output to qa7) | the same as `stage6/after/decomp2.txt` |
| API on port 3014, `GET /reconciliation?from=2024-01&to=2026-08`, `GET /signals`, `GET /owners/:id/balance` | reconciliation answered in 7.96 s. The server is stopped |

## Reproduced numbers

| Headline (`14` §9.1 / `15` §2) | Documented | Reproduced | Δ |
|---|---|---|---|
| Reconciliation rows; rows with discrepancy ≠ 0 | 52; 0 | 52 (32 + 13 + 7); 0 | — |
| Rows with A − B − C − ours ≠ 0 (exact decimals) | 0 | 0 | — |
| `fileDiscrepancy` ≠ 0 on Believe rows; null on B17 rows | 0 of 45; 7 | 0 of 45; 7 | — |
| 1052428 A / B / C / ours | 15,280,793.42 / 6,622,334.45 / 869,880.94 / 7,788,578.04 | same | — |
| 1052428 ours by label: 0to8 / Echo8 | 7,656,729.75 / 131,848.28 | same | — |
| 1052428 ours without a split | 469,642.73 | 469,642.73 | — |
| 1052428 C: owner_unconfirmed / split_unconfirmed / assumption / artist_without_owner / no_isrc | 591,391.69 / 133,582.80 / 138,272.57 / 4,360.20 / 2,273.68 | same | — |
| 1055956 A / B / C / ours | 1,050,945.10 / 53,363.50 / 330,354.64 / 667,226.96 | same | — |
| 1055956 C: split_unconfirmed / assumption / owner_unconfirmed / artist_without_owner / no_isrc | 320,636.21 / 5,922.83 / 2,770.16 / 936.43 / 89.00 | same | — |
| B17 A / B / C / ours | 2,496,581.91 / 682,348.36 / 845,990.25 / 968,243.31 | same | — |
| B17 C: owner_unconfirmed / publishing_terms_unconfirmed | 520,584.25 / 325,405.99 | same | — |
| `15` §2 master C owner_unconfirmed (both accounts) | 594,153 | **594,161.85** | **+8.85** (finding 1) |
| `15` §2 master C split_unconfirmed | 454,217 | **454,219.01** | **+2.01** (finding 1) |
| `15` §2 master C assumption / artist_without_owner / no_isrc | 144,195 / 5,297 / 2,362 | 144,195.40 / 5,296.63 / 2,362.68 | rounding |
| `15` §2 net on ISRC without a split, 2024-01…2026-08 | 596,725 (79 ISRC above 1,000: 495,276) | **622,047.62** (ours 620,565.88; 2,500 ISRC; **81** above 1,000: **519,882.96**) | **+25,322.92** (finding 1) |
| Annex cells compared; within 0.01 | 107,006; 91,364 | 107,006; 91,364 | — |
| Annex receipts whose label share matches | 92.37 % (92.81 % without "no share") | same | — |
| Σ ERP label share − Σ Annex NLS | 411,847.85 | 411,847.85 (7,653,407.29 − 7,241,559.44) | — |
| Main: owners matched; differ > 1.00 (Σ\|diff\|) | 992; 802 (2,124,352.00) | 992; 802 (2,124,352.03 decomposition) | rounding |
| Main: Σ ERP B / C (matched owners) | 6,656,398.37 / 984,739.93 | same | — |
| Main: Σ ERP payable / Σ Main balance | −627,471.16 / 584,418.47 | −627,471.16 / 584,418.47 (decomposition −627,471.25, rounding per owner) | — |
| Main: explained / not explained, max(1.00, 2 %) | 640 / 162 (346,014.05) | 640 / 162 (346,014.05) | — |
| Main: explained / not explained, 1.00 | 513 / 289 (373,414.03) | 513 / 289 (373,414.03) | — |
| Golden suite | 32 files, 360 tests | 32 files, 360 tests, twice | — |

Every headline number of `14` §9.1, and the account table of `15` §2, reproduces to the cent. Only three
secondary figures in `15` §2 differ beyond rounding. They were copied from `13` §2, which was measured on another
state (finding 1).

## Findings

### 1. should-fix: three figures in `15` §2 (from `13` §2) do not match the final database

- C owner_unconfirmed:
  - `13` gives 591,383.06 + 2,770.16 = 594,153.22.
  - The reconciliation now gives 591,391.69 + 2,770.16 = 594,161.85.
- C split_unconfirmed:
  - `13` gives 133,581.25 + 320,636.21 = 454,217.47.
  - The reconciliation now gives 133,582.80 + 320,636.21 = 454,219.01.
- The C cross-check total of `13` is 1,200,224.59. Now 869,880.94 + 330,354.64 = 1,200,235.58, which is +10.99.
- The `no_split` net:
  - `13` and `15` give 596,724.70 on 2,497 ISRC, with 79 ISRC above 1,000 = 495,276.03.
  - I recomputed it with a read-only `calculate()` (`qa7/nosplit.mts`, `status = 'no_split'`, report months
    2024-01…2026-08, both accounts): 622,047.62 on 2,500 ISRC, with 81 ISRC above 1,000 = 519,882.96.
  - The label share of those units is 620,565.88. This equals 469,642.73 + 150,923.15, the reconciliation's
    `ourShareNoSplit`, and that value is unchanged since 14 §2 run 2.
  - So `13` measured this figure on an earlier, intermediate state.
- No money identity is affected. The account table of `15` §2 is right.
- Fix: re-measure these figures, or mark them "as of the `13` run".

### 2. should-fix: the owner counts "explained / not explained" cannot be reproduced from the repo

- The figures 640 / 162 and 513 / 289, and Σ|residual| 346,014.05, come from three scripts outside the repo:
  `scratchpad/stage5/owner_dump.mts`, `scratchpad/stage6/carve_take.mts` and `scratchpad/stage6/decomp2.py`.
- These scripts hard-code absolute paths.
- `decomp2.py` hard-codes the E1 amounts by owner prefix, unless a positional `noE1` argument is given.
- The repo's `compare-main.ts` produces only the 802 owners that differ by more than 1.00.
- I reproduced 640 / 162 exactly, but only because the session scratchpad still exists.
- Fix: move the decomposition into `packages/backend/scripts/mvp/`, for example as a `compare-main.ts --decompose`
  flag without the E1 constant, and name it in `14` §9.3. Otherwise the stage 5 acceptance criterion "each
  owner's balance agrees with Main or the difference is explained" cannot be re-checked after the scratchpad is
  cleaned.

### 3. note: the loader dry run of `main` prints `owner_created_for_nickname=18` while there is nothing to do

- `holderOf` logs this event every time it resolves a holder.
- `Ctx.ownerWithPseudonym` finds the existing owner first (`lib.ts:417`), so nothing is created. The applied run
  and every later dry run show the same 18.
- SQL confirms there are no duplicates: 20 owners with origin `mvp:main`, 20 distinct names.
- The counter's name says "created", so a reader of a dry-run log is misled. Rename it, for example to
  `owner_for_nickname`.

### 4. note: verification method checked, sound

- `compare-annex.ts` compares the right number:
  - It takes Σ `u.labelShare` per ISRC and report month.
  - That is the layer state after the label-share carves and after the sublabel (`carve.ts` subtracts the
    sublabel amount from `labelShare`), before categorisation. It is the plan's "label remainder after the
    sublabel".
  - It compares that sum with Annex "Monthly NLS by ISRC".
  - It uses only account 1052428, and excludes the Sch1B Echo8 ISRC list and units whose label of record is Echo8.
  - It uses the Annex months only, with a tolerance of 0.01 per cell.
  - Cells that are only on one side are kept: ERP-only cells count as ERP − 0, Annex-only cells as 0 − Annex.
  - The cause classification uses the pre-load `splits_diff.json`. `14` §3 already re-classifies two of its
    buckets, which are stale.
- `compare-main.ts` compares the right things:
  - Earned B by report month against Main Royalties / Publishing Income per nickname.
  - Counted out operations (payouts and advances) against Main Expense.
  - `ownerBalance().total.payable` against Main Σ Income − Σ Expense.
  - It maps nicknames to the current owners through `artistIndex`, so merges are followed.
- Hand check, owner `58e576a9` (stage name Yippes), done end to end:
  - SQL: 24 single-row splits at 50 % (split document, no row documents), no participations on those ISRC.
  - ClickHouse, loaded files only, label `0to8`: Σ net of the 24 ISRC is 2,436.248718758938 over all time.
    Half of that is 1,218.124359.
  - The API gives earned 1,218.124359379789, waiting 0, by label {0to8}.
  - The difference is 3.2e-10. It is the per-unit 12-decimal quantisation, which is expected.
  - Operations (SQL): an advance of 1,000.00 with scope any, document and proof, plus 3 migration payouts of 61.89,
    66.45 and 62.65.
  - Payable = 1,218.12 − 1,000.00 recouped − 190.99 paid = 27.13. The API gives 27.134359…
  - `main_owners.csv`: Main income 1,217.71, expense 1,190.99, balance 26.72, ERP payable 27.13, diff 0.41. That is
    within 1.00.

### 5. note: stage 3 open notes and edge cases still open

- None of these blocks the stage.
- N2 is partly done:
  - The golden `verify()` still checks Σ = net only on the last layer (`golden.test.ts:233`).
  - The invariant after every layer is pinned at layer level by `layers/exactness` "10,000 seeded random units: Σ
    allocations + label share = net after every layer, ≤ 12 decimals".
  - No test asserts that every allocation has `layer` and `ruleId`.
- N3 is partly done:
  - Order independence is pinned only on the pure layers (`layers/exactness` "a shuffled order of units and of
    participations gives identical results").
  - There is no shuffle test over `calculate()`.
- E6: an Echo8 sublabel imprint without a split has no asserted golden answer. It is reached only by the random
  generator (`exactness.test.ts:64`, `qaraqshy records`). The 0to8 variant is pinned (G21).
- E10 and E22: there is no M39 "conflict / rate delta" signal in `signals()`.
  - `10` §6 says M39 conflicts are carried by the `assumptions` signal, and G10a asserts that signal.
  - The licence-rate delta of E22 itself is never flagged.
  - `13` lists M39 as partial.
- E9: an advance scope by UPC is out of scope by design (`10` §9). Allocation for two UPC is pinned.

### 6. note: privacy sweep, tracked files only (`git ls-files`, 277 files)

- 10 sampled multi-word legal names from `context_data/contract_index/people.json`: 0 hits.
- All 485 multi-word legal names in that file: 0 hits.
- Email addresses: 2 in total.
  - One is `example.com`.
  - The other is an npm package maintainer's address in `package-lock.json`. It is public package metadata.
  - 0 are personal.
- IBAN-like patterns: 0. There is 1 false positive, an ISRC in `09`.

### 7. note: hygiene

- `git status`: no change from this review. One untracked file belongs to another council member:
  `docs/agents/reviews/stage7_architect.md`.
- Python bytecode: 0 `.pyc` files are tracked. Three `.pyc` files exist on disk in
  `packages/backend/scripts/mvp/__pycache__/`, which is git-ignored (`.gitignore:5`).
- `data/` is untracked. Only three `.gitkeep` files under it are tracked.
- Ports 3001–3014 at the end: mine (3014) is stopped.
  - Port 3013 is held by a `tsx` node process started about 6 minutes before my check, by another council member.
  - I left it running. Whoever owns it should stop it.
- The database: SELECT only. 0 empty-period splits remain (E4), 283 participations, 2,607 active operations.

## Edge cases E1–E25 and stage 3 notes → tests at HEAD

| E | Pinned by (file: test name) | Status |
|---|---|---|
| E1 negative | `golden.test.ts` "G15 (E1, M26): a negative unit", G27b; `layers/carve.test.ts` "G15 (E1)…"; `layers/off-the-top.test.ts` "a top on a negative unit…"; `layers/exactness.test.ts` sign checks | pinned |
| E2 zero | `golden` "G16 (E2): a zero unit"; `layers/carve` "G16 (E2)…" | pinned |
| E3 above bucket | `golden` G22, G37, G44; `layers/carve` "artist-share carves above 100 %…", "…without its source row"; `layers/off-the-top` "over-100 tops…" ×2 | pinned |
| E4 label share 0 | `golden` "G31 (E4)…"; `layers/carve` "G31 (E4)…"; `layers/exactness` "percents summing to exactly 100…" | pinned |
| E5 label share 100 | `golden` "G41 (E5)…", G21 | pinned |
| E6 sublabel, no split | `golden` "G21 (R1, D-029)…" (0to8); `layers/categorise` "G21 (R1)…" | **partial**: Echo8 variant only random-tested |
| E7 rule mid-history / window | `golden` G09, G13, G14, G39, G45; `layers/label-of-record` "a rule outside its period does not apply"; `layers/carve` G14 | pinned |
| E8 mid-month instrument | `golden` G09, "G25 (M52)…" | pinned |
| E9 two UPC | `golden` "G24 (E9)…"; `layers/carve` "G24 (E9)…"; G43(ii) | pinned for allocation; UPC scope out of scope (`10` §9) |
| E10 Echo8 unit, 0to8 paper | `golden` G08b, "G08b (D-130)…", G33 | **partial**: no M39 signal |
| E11 unknown pair | `golden` G30, "G40 (E13, E11)…"; `layers/perimeter` "G30: unknown pair…" | pinned |
| E12 split unconfirmed, carve confirmed | `golden` "G19 (E12)…"; `layers/categorise` "G19 (E12)…" | pinned |
| E13 same ISRC + month, two accounts | `golden` G40 | pinned |
| E14 label_name over time | `golden` "G38 (E14)…"; `layers/label-of-record` "G38 (E14)…" | pinned |
| E15 unmapped imprint | `golden` "G08c (E15)…"; `layers/label-of-record` "G08c (E15)…"; `layers/carve` "the sublabel never runs on an unmapped string" | pinned |
| E16 double participation | `golden` "G23 (E16, E24)…"; "G21b (D-136)…" (`ruleRecipientIsRow`); "G21c (D-136)…" (`twoRowsOneOwner`) | pinned |
| E17 rounding chain | `golden` G02, G03a, G03c, G34, G44, G46; `layers/exactness` (10,000 seeded + exact-100 + pico reproductions) | pinned |
| E18 all layers | `golden` "G18 (E18, Q11)…", G18b; `layers/carve` G18, G18b | pinned |
| E19 interest not per recording | `golden` "tracksWithNote lists a noted track without changing an amount…" | pinned (new since stage 3); data listing in the loader (`splits` m51 = 196) |
| E20 retro rule after payout | `golden` "G39 (E20)…", G28; `facade.test` | pinned |
| E21 advance from participation / sublabel | `golden` G27, G27b, "G29 (Q10, E21)…" | pinned |
| E22 licence rate ≠ registered | `golden` "G10a / G10b (Q1, E22)…" (`signals().assumptions`) | **partial**: no rate-delta signal |
| E23 window ends | `golden` "G14 (M25, M36)…" | pinned |
| E24 top on rows = 100 | `golden` "G32 (E24)…", G23; `layers/off-the-top` "G32…" | pinned |
| E25 sold recording | `golden` "G17 (M28, E25)…" | pinned |
| N2 every-layer verify | `layers/exactness` "…after every layer…" (pure) | **partial**: the end-to-end `verify()` checks the last layer only; `layer`/`ruleId` not asserted |
| N3 shuffled order | `layers/exactness` "a shuffled order of units and of participations…" (pure) | **partial**: no end-to-end shuffle |

Totals: 21 pinned, 3 partial (E6, E10, E22), 1 out of scope by design (E9 UPC scope), plus N2 and N3 partial. At
stage 3 it was 20 pinned, 3 partial and 2 open. E19 has moved to pinned since then.

## Why yes

- The definition of done holds at HEAD: typecheck, lint, 360 tests twice with no change, and the client build.
- The loader dry run of `all` finds nothing to apply.
- A = B + C + ours holds exactly on all 52 rows.
- Every headline number of `14` §9.1 reproduces to the cent from the repo scripts and the API, including the
  owner decomposition, though that one needs the scratchpad.
- The hand check of one owner agrees from raw lines to payable.
- No legal name, personal email or IBAN appears in the tracked files.
- The open items are secondary report figures (finding 1), reproducibility of the decomposition (finding 2), and
  the coverage notes carried from stage 3 (finding 5). None of them changes money.

Blockers: none.
