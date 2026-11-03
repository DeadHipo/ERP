Verdict: yes

# Frontend stage 6 council: QA (2026-11-03)

Reviewer: QA member, independent, read-only. HEAD `12e6e08` on `feature/fable-001` (D-139 … D-152). The only file
this review writes is this one. Synthetic pseudonyms, ISRC patterns and amounts only.

The code side is ready for handover. The whole definition of done is green. Two `npm run e2e` runs in a row gave
**132 passed, 0 skipped, 0 failed**, and the per-test outcomes were identical (diffed). Each run seeded fresh stores
and dropped them at the end, and `verify-seed` printed `131 PASS, 0 FAIL` both times. Every scenario S01–S37 and
SS1–SS7 is asserted somewhere. The specs no longer branch on state left by another file. S29 dropped from 19 s to
4.5 s now that the toast sits at the top right. No privacy leak.

The verdict is **no** only because of the rule this council was given: "a false claim in 20". Report `20` contains
two statements that my measurements contradict (blocker 1). Both are documentation-only, one line each. Once they
are corrected this verdict is **yes** and nothing has to be rerun. Everything else below is should-fix or a note for
after the goal.

## What I ran

| Check | Result | Time |
|---|---|---|
| `npm run typecheck` | exit 0 | 8 s |
| `npm run lint` | exit 0 | 5 s |
| `REQUIRE_STACK=1 npm test` | backend **38 files / 406 passed**; frontend **11 files / 65 passed**; 0 skipped | 39 s wall (backend 36.8 s) |
| `npm run build:client` | exit 0; `index` 666.2 kB (184.5 kB gzip), `vendor` 1,558 kB (441.4 kB gzip), CSS 478 kB | 0.4 s build |
| `npm run e2e` run 1 (`DEBUG=pw:webserver` to see the seed) | seed + `verify-seed` **131 PASS, 0 FAIL**; **132 passed**, 0 skipped, 0 failed, 1 worker, retries 0; teardown "dropped erp_e2e, believe_e2e, believe_e2e_stage" | 173 s wall (2.9 m tests) |
| `npm run e2e` run 2 | 131 PASS; **132 passed**, 0 skipped; outcome list identical to run 1 (132 lines, `diff` empty); dropped | 169 s wall (2.8 m tests) |
| Lock | `mkdir data/test-tmp/e2e.lock` taken immediately before each run (09:00, 09:03) and `rmdir`'d after; :3050 / :3160 untouched | |
| Stores (read-only listing before, after run 1, after run 2) | no `erp_e2e` / `believe_e2e*` left. New since my first listing: `erp_council6p`, `believe_council6p(_stage)`, which is another member's private stand, not this harness. Leftovers from earlier vitest runs, unchanged by my runs: **60 `erp_t_*`, 99 `believe_t_*`, 99 `believe_t_*_stage`**, plus `erp_demo` | |
| Git | `git status --short`: `?? .claude/` plus another member's untracked review only. `git check-ignore -v`: `e2e.lock`, `e2e-keys.json`, `e2e-data` (`/data/**`), `e2e/.seed-keys.json`, `test-results/` are all ignored | |

Time per spec file (run 1 / run 2): 20-queue 28.1 / 25.3 s, 28-rules 19.6 / 19.8, 27-operations 16.4 / 16.2, states
14.7 / 14.5, 12-track 12.9 / 12.6, 21-signals 11.1 / 11.1. Every other file takes under 6 s. S29 took 4.7 / 4.2 s
(stage 3: 19.2 s).

## Coverage of 19 (scenario → spec; what is still not asserted)

| Scenario | Asserted in | Not asserted (sub-rows of 19) |
|---|---|---|
| S01–S09 | 10-overview (42 P1 rows, by-label, C breakdown, noSplit), 12-track (26 cases as full allocation tuples, G44/G37 shortfalls, G18 layers, rounding, G45–47, G36 now included) | S01 P10 earned/payable `50` |
| S10 | 10-overview (rows, drill-down to the `7` group), 12-track (unknown pair) | P10 A-102 earned `75` |
| S11 | 11-release (P7, P8 both UPCs), 12-track (two UPC rows, breakdown, P5) | P10 A `75`, P `7.5` |
| S12 | 13-splits (before: unconfirmed), 20-queue (P1 before/after, owner `0 → 50`, second press) | P6 C → B |
| S13 | 12-track (05), 14-documents (Q1), 20-queue (P1 both months, P21 `40 → 20`, forced approve 422), 28-rules (after on P6) | P6 03 **before** (`L 20 C`) |
| S14 | 20-queue (P1, balance with waiting, gate before/after, `amountCents 5000`) | P6 |
| S15 | 20-queue (P1, owner earned) | P6 |
| S16 | 12-track (before), 20-queue (P1 + `label_unmapped` cell, P21 before/after, `alias_taken`) | — |
| S17 | 20-queue (P1, P21, P17 rule, P6 NG-171 `25`, `rule_overlap`) | — |
| S18 | 20-queue (P1 b17 before/after, P10 W1/W2/W3 lines and earned, `earnedPublishing` by API, `terms_overlap`), 15-publishing | — |
| S19 | 15-publishing (ambiguous), 20-queue (P1 b17, P21, W4a `0 → 50`) | resolution "manual" on P18 after |
| S20 | 20-queue (before P1, both groups), 21-signals (action, P21, P1 after, noSplit `7`, `duplicate_track`) | P6 no_split after |
| S21 | 21-signals (action, P1, second press), 28-rules (P6) | — |
| S22 | 26-payout (all four steps, P4, P20, snapshot, dblclick → 1 POST, P1 four rows) | — |
| S23, S24 | 24-owner (S24/3 change sent by API, as 19 §6 says) | S24/3 P6 after (balance-track `42.5` and P1 are asserted) |
| S25–S29 | 28-rules (P6, P1, owners, second presses) | — |
| S30 | 21-signals (candidate), 22-duplicates (group, assign, **create split**, P6, P1 before/after) | P6 before |
| S31 | 27-operations (k1–k4, each second press incl. the credit) | — |
| S32 | 13-splits, 14-documents (P14 waiting `5`), 20-queue (P1 before/after) | P6; approve second press checks status only |
| S33 | 25-merge | — |
| S34 | 30-sources (upload, P1 after, `duplicate_period`, `duplicate_file`) | P1 "no row" before; `lineCount` |
| S35 | 21-signals (k1–k4, P1 k4 before/after) | k4 P6 category: only the amount `5` is asserted after (B is implied by P1 `55`) |
| S36 | 23-duplicate-dialog (owners, artists «новый»), 22-duplicates (artists «тот же»), 24-owner (contract) | — |
| S37 | 29-labels (P1, NG-371 `50 → 25`, P21 after) | — |
| SS1–SS3 | states (fixture), 10-overview (real P1) | — |
| SS4–SS7 | states, on `/dev/states` only | not on a real page (stage 3 finding 7) |

**No scenario is unasserted.** The gaps in the right column are sub-rows: mostly a P6 restatement of a number that
the P1 row already pins exactly, plus three read-only P10 earned checks (S01, S10, S11).

**Spot check of 10 action scenarios** (none of them in my stage 3 sample). Each asserts exact `title` strings before
and after, and the second press of 19 §5:

| # | Scenario, file:line | Before → after | Second press |
|---|---|---|---|
| 1 | S14 `20-queue.spec.ts:176` | P1 `100 / 0 / 50 / 50` → `100 / 50 / 0 / 50`; earned `0`, waiting `50` → `50`, `0`; gate owner_not_confirmed → allowed | contract 201 (money unchanged not asserted) |
| 2 | S15 `:202` | group `50`; P1 → `100 / 50 / 0 / 50`; owner `50` | 200 / `[422, artist_owner_fixed]` |
| 3 | S16 `:220` | P1 `100 / 50 / 50 / 0`, C cell `50`, P21 net `100` → P1 `100 / 50 / 0 / 50`, 0to8 `50`, P21 gone | `[409, alias_taken]` |
| 4 | S18 `:276` | b17 `400 / 170 / 50 / 180`, W3 T-D C → `400 / 220 / 0 / 180`, B, W3 `50`; W1 `100` and W2 `70` unchanged | `[409, terms_overlap]` |
| 5 | S19 `:316` | b17 2025-12 `100 / 0 / 100 / 0` → `100 / 50 / 0 / 50`; W4a `0 → 50` | map again 200 |
| 6 | S32 `:159` | P1 `100 / 50 / 5 / 45`; dialog «ждёт этого документа: 5,00», «участий 1» → `100 / 55 / 0 / 45` | approve 200 (`approvedAt` not compared) |
| 7 | S20 `21-signals.spec.ts:56` | P21 net `7`, D-035 read-only → P1 `9 / 0 / 2 / 7`, noSplit `7`, queue group gone | `[409, duplicate_track]` |
| 8 | S35/4 `21-signals.spec.ts:150` | P1 `100 / 50 / 5 / 45`, P21 `5` → `100 / 55 / 0 / 45`, row gone, P6 `5` | none in 19 §5 |
| 9 | S30 split `22-duplicates.spec.ts:58` | P1 `100 / 0 / 0 / 100` → candidate gone, P6 `50`, ours `50`, P1 `100 / 50 / 0 / 50` | none in 19 §5 (assign: 200 / 422) |
| 10 | S26 `28-rules.spec.ts:124` | A `100`, A2 `0`; 05/06 `A-261 50` → 06 `A2-261 50`; P1 both months; A/A2 `50`/`50`; G17 `DU-262 100`, ours `0` | none in 19 §5 |

Every number in these is `toHaveAttribute('title', '<exact>')` or an equality on a sorted list of `title` values.
No `toBeVisible` stands in for a number. `grep` of `e2e/` and `tests/` finds no `test.skip`, `fixme`, `.only`,
`waitForTimeout` or retries. **`expectMoneyCalls(page, 1)`** is asserted on every money page type that 19 §6
lists: P1 (`10-overview:73`), P8 (`11-release:21`), P6 and P5 (`12-track:17,279`), P14 (`14-documents:70`), P2
(`20-queue:90`), P21 (`21-signals:16`), P10, P9 and P4 (`24-owner:14,25`). The acting specs 25–30 open the same
pages without re-counting, which is enough for R2 (it is a property of the page, not of the scenario).

## Stage 3 findings at HEAD

| # | Stage 3 finding | Status | Evidence |
|---|---|---|---|
| 1 | Coverage gaps (before rows, §5.3, P21, S18 P10, S30 split, G36) | **fixed** (sub-rows remain, table above) | `20-queue.spec.ts:87,113,162,179,205,221,241,280,318,339`; S18 P10 `:282-291`; S30 `22-duplicates.spec.ts:58-80`; G36 `12-track.spec.ts:89` |
| 2 | Specs branching on state | **fixed** | no data branch left; `13-splits.spec.ts:36` branches on a seed-fixed total, `28-rules.spec.ts:30` on whether a row is expanded (UI state); order documented in 19 §6 and `packages/frontend/CLAUDE.md:117-119` |
| 3 | Always-skipped queue merge test | **fixed by removal** (0 skipped) | the queue-row entry `owner_unconfirmed.also: MergeOwnerDialog` (`action-table.ts:18`) has no e2e now (note 6) |
| 4 | Shared mutations beyond 19 §1 | **fixed** | 19 §1 lists exactly four; the specs match (`20-queue:236`, `29-labels:75`, `14-documents:43`, `15-publishing:49`) |
| 5 | 19 §6 and CLAUDE.md stale | **fixed** | 19 §6 numbered file table and dependencies; CLAUDE.md "Tests" names the 18 files and their order |
| 6 | Error toast blocks the dialog | **fixed** | `src/components/toast.tsx:8` top-right placement; S29 4.7 / 4.2 s |
| 7 | SS4–SS7 only on `/dev/states`; `RulesTab` label list without state | **not fixed** | `states.spec.ts:60-124` only; `RulesTab.tsx:148` `useQuery(labelQueries.list())` still without `QueryView` |
| 8 | eslint R1 misses `toFixed`, `BigInt`, `window.parseFloat` | **fixed** | `eslint.config.js:12,15,16`, with per-file overrides `:93-105` |
| 9 | Privacy test does not scan the backend seed | **fixed** | `tests/privacy.test.ts:11` adds `../backend/scripts/e2e` |
| 10 | `verify-seed` not in `start.sh`; leftover test stores | **partly**: `verify-seed` fixed; leftovers unchanged | `scripts/e2e/start.sh:23`, 131 PASS in both logs; 60 + 99 + 99 `*_t_*` and 46 `data/test-tmp/run-*` still there |
| 11 | Bundle size | unchanged (note) | `index` 666 kB, `vendor` 1.56 MB |

## Findings

### Blocker

1. **Two claims in `20` are contradicted by measurement** (`docs/agents/20_frontend_report.md`).
   - `:157` says "406 backend tests in **36 files**". `REQUIRE_STACK=1 npm test` reports `Test Files 38 passed (38)`,
     and `find packages/backend/tests -name '*.test.ts'` also counts 38.
   - `:50-51` says "132 tests, 0 skipped, … identical on two consecutive runs **(stage 3 QA)**". Stage 3 QA measured
     130 tests, 129 passed and 1 skipped (`frontend_stage3_qa.md:7,18-19`). The 132 / 0-skipped double run is this
     review. Point the reference at `frontend_stage6_qa.md`, or drop it.
   - "about 2.7 minutes" is fine (2.8–2.9 m measured).

   **Update after my runs:** uncommitted D-153 edits appeared in the working tree after my second e2e run ended
   (09:06). They change `20` and also `CLAUDE.md`, `01`, `03`, `05`, `packages/frontend/CLAUDE.md`,
   `src/api/client.ts` (an `X-Audit: failed` toast), `queries/core.ts` (a comment) and
   `facade/layers/carve.ts:106` (indentation only). The edited `20:158` now says "38 files", so that half is fixed.
   `20:52` still says "(stage 3 QA)". All my measurements are of the clean HEAD `12e6e08`. The D-153 client change
   has not been through the definition of done that I ran, so commit it only after typecheck, lint, test and e2e
   pass.

   The fix is two edits. Every other figure in `20` §1 and §6 that I could check holds: 63 operations, 60 with a page
   and 3 refusals (`coverage.test.ts` passes); 10 reasons and 11 signal lists; 14 open questions; 65 frontend tests;
   20 spec files; 131 PASS. I did not re-measure the real-data figures in §2 and §3 (stage 4 walk, outside a
   QA-on-synthetic run).

### Should-fix (after handover is acceptable; none weakens a golden screen)

2. **Sub-rows of 19 not asserted** (coverage table, right column). Most are P6 restatements of a P1 row that is
   already pinned exactly, so a wrong number would still fail on P1. The exceptions are S01, S10 and S11 on P10 (no
   balance check at all for those owners) and S13 P6 03 **before** (the C state of the row, which only P1 implies).
   Each is one `expectOwner` / `expectMonth` line.
3. **Weak second presses** (unchanged since stage 3): S32 approve (`20-queue.spec.ts:172`) checks 200 but not that
   the first `approvedAt` / `approvedBy` is kept. S14 contract (`:198`) and S36 contract (`24-owner.spec.ts:153`)
   check 201 but not "money unchanged". S12 (`:103`) checks the no-op status only. 19 §5 asks for those facts.
4. **Stage 3 finding 7 is still open.** SS4 (contract mismatch), SS5 (stale badge), SS6 (26 k rows) and SS7 (2,100
   owners) run only on the fixture page (`states.spec.ts:60-124`). `RulesTab.tsx:148` and `DocumentsTab.tsx:17` read
   the label list without a page state. A failed label list shows rules without names, silently.
5. **R1 lint still misses**: `arr.map(Number)` (Number as a value, not a call), binary `+` and `+=` on money names,
   unary `-`, `<` / `>` / `localeCompare` on decimal strings, and money names outside the regex (`ours`, `total`,
   `labelShare`, `received`, `notOurs`). `MONEY_NAME`, `eslint.config.js:5`, covers only names *ending* in
   amount|net|payable|percent|cents|earned|waiting|paid|recouped|credits|returns. My grep of `src/` found none of
   these in use. The only comparisons are `QueuePage.tsx:227` (a count) and `OwnersPage.tsx:38` (integer
   `amountCents`, allowed by 19). Today this is a gap in the guard, not a defect.

### Notes

6. The queue-row merge entry for `owner_unconfirmed` (`action-table.ts:18`, `also: ['MergeOwnerDialog']`) has no e2e
   since the skipped test was deleted. The dialog itself is covered from P10 (`25-merge.spec.ts:34-60`).
7. History with `e2e-operator` (19 §5.4) is asserted for S33 (`25-merge.spec.ts:75-76`) and the S28 note
   (`28-rules.spec.ts:238-239`) only. The audit module is tested in the backend (`audit.test.ts`).
8. **Privacy.** I grepped `packages/frontend/e2e`, `tests`, `packages/backend/scripts/e2e`, `docs/agents/19`, `20`
   and the frontend reviews for e-mails, `/Users/` and capitalised name pairs. The only hits are synthetic (`Mystery
   Records`, `Synthetic Artist`, CSV column headers). One `/Users/` path is in the generated, git-ignored
   `e2e/.seed-keys.json` (the `dataDir` field), and the privacy test skips dot-files on purpose. `20` §2 shows stage
   names and 8-hex owner id prefixes from the real data. Those names are pseudonyms already published in `14` and
   the stage 4 walk; there are no legal names.
9. **Harness.** Fresh stores every run (`seed.ts` drops first), dropped by `globalTeardown`. Playwright hides the
   web server output, so `131 PASS` shows only with `DEBUG=pw:webserver`. A seed failure still fails the run,
   because `start.sh` is `set -e`. Leftovers not from this harness: 60 `erp_t_*`, 99 `believe_t_*`, 99
   `believe_t_*_stage` (the same counts as stage 3; my two vitest runs added none) and 46 `data/test-tmp/run-*`.
   A `drop-test-stores` sweep is still worth one script. The `erp_council6p` stand belongs to another council member
   and should be dropped by them (`scripts/e2e/drop.ts council6p`).

## Handover notes (what QA would still want)

- Fix blocker 1 (the "(stage 3 QA)" reference at `20:52`; "38 files" is already fixed in the working tree). After
  that this verdict stands as yes for HEAD `12e6e08`. The D-153 working-tree edits need their own DoD run before
  they are committed.
- Before the next feature: rows 2 and 3 above (about ten one-line assertions) and one real-page mock each for SS4 on
  P6 and SS6 on P5.
- Keep the double run in the ritual (`npm run e2e` twice, diff the outcome list). It costs about 6 minutes and is
  the only flakiness check there is: one worker, no retries.
- A test-store sweep before the stack is handed over, and the owner should hear about the `host: true` dev server
  (`20` §4.5) before a real-data session.

## Revision 2 (HEAD `a208aa5`, D-153)

**Verdict: yes.** Blocker 1 is fixed and the definition of done is green at the new HEAD.

- **Blocker 1 is closed.** `20:52` now says the two identical 132 / 0-skipped runs come from this verdict, and that
  stage 3 QA measured 130 tests with 1 skipped. `20:158` says "406 backend tests in 38 files".
- **The D-153 code edits** (the `X-Audit: failed` warning toast in `api/client.ts`, `main.tsx`, `toast.tsx`,
  `i18n/ru/toast.ts`, and the `carve.ts` indentation) are committed. I re-ran the definition of done on them:

| Check at `a208aa5` | Result | Time |
|---|---|---|
| `npm run typecheck` / `npm run lint` | exit 0 / exit 0 | 9 s / 6 s |
| `REQUIRE_STACK=1 npm test` | backend 38 files / 406 passed; frontend 11 files / 65 passed | 32 s |
| `npm run build:client` | exit 0 | 1 s |
| `npm run e2e` run 3 (under the lock, taken and released) | `verify-seed` 131 PASS, 0 FAIL; **132 passed, 0 skipped**; outcome list identical to runs 1 and 2 (diffed); stores dropped | 166 s (2.8 m tests) |
| Stores and git after | no `erp_e2e` / `believe_e2e*`; `git status`: `.claude/` and another member's review edit only | |

- **Should-fixes 2–5 are not fixed in this stage.** They are the unasserted sub-rows, the weak second presses,
  SS4–SS7 on real pages and the lint gaps. They stay handover follow-ups. None of them weakens a golden screen,
  because every number they concern is either asserted elsewhere (P1) or absent from the code (the lint gaps; my
  grep of `src/` found none in use).
- **Notes 6–9 stand as written.**
