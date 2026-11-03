Verdict: yes

# Frontend stage 3 council: QA (2026-11-03)

Reviewer: QA member, independent, read-only. HEAD `d19027e` on `feature/fable-001` (D-139 … D-149, steps 3.1–3.9).
The only file this review writes is this one. Synthetic pseudonyms, ISRC patterns and amounts only.

The definition of done is green and repeatable: two `npm run e2e` runs in a row gave the same 129 passed / 1 skipped
with identical per-test outcomes, fresh stores each time, dropped at the end. The golden specs assert exact decimal
strings in `title` (never presence where a number is expected), press the second request of 19 §5 for every action
row but one, and use no `waitForTimeout`, `test.fixme` or retries. No privacy leak. I found no blocker. The gaps are
coverage: several "before" P1 rows, most P10 "earned" checks of 19 §5.3, five P21 rows and two golden screens (S18 on
P10, S30's split) are not asserted anywhere; four specs branch on the state another file left behind; one skipped test
never runs in a full run; an error toast blocks dialog buttons for its lifetime. All are should-fix for stage 5.

## What I ran

| Check | Result | Time |
|---|---|---|
| `npm run typecheck` (backend, frontend, shared) | exit 0 | 8 s |
| `npm run lint` | exit 0 | 6 s |
| `REQUIRE_STACK=1 npm test` | backend 38 files / **402 passed**; frontend 10 files / **43 passed**; 0 skipped | 35 s |
| `npm run build:client` | exit 0; JS `index` 652.5 kB (179.3 kB gzip) + `vendor` 1,558 kB (441.4 kB gzip), CSS 477.8 kB | 0.4 s build |
| `npm run e2e` run 1 | **130 tests: 129 passed, 1 skipped**, 0 failed, 0 flaky, 1 worker, retries 0 | 165 s wall (2.7 m tests, ~15 s seed + build + start) |
| `npm run e2e` run 2 | **129 passed, 1 skipped**; per-test outcomes identical to run 1 (diffed) | 163 s wall |
| `playwright test -g "S29 refusals"` with `DEBUG=pw:api` (one extra isolated run, to explain its 18–19 s) | 1 passed | 34 s |
| Stores after each run (`docker exec … psql`, `clickhouse-client SHOW DATABASES`) | no `erp_e2e`, `believe_e2e`, `believe_e2e_stage`; teardown printed "dropped" every time | |
| `git status --short` after all runs | `?? .claude/` and another council member's untracked review only; `test-results/`, `.seed-keys.json`, `data/test-tmp/*` ignored (`git check-ignore -v`) | |
| Lock | `data/test-tmp/e2e.lock` taken before and removed after every e2e run; ports :3050 / :3140 untouched | |
| Not run | the "Docker stopped" run promised in the stage 2 QA verdict: other agents share the stack, so I did not stop it | |

The skipped test is `queue.spec.ts:151` "owner_unconfirmed: the merge dialog asks for the target and the reason". It
calls `test.skip(...)` when S33's owner Y is gone, which is always the case in a full run, because `merge.spec.ts`
merges Y first (alphabetical order). The skip is honest (a runtime condition with a reason), and the dialog itself is
asserted from P10 in `merge.spec.ts:34-60`, but the queue-row entry point to it is dead code in `npm run e2e`
(finding 3).

Spec time per file (run 1; run 2 within 1.3 s on every file): rules 32.2 s, queue 18.4, operations 15.3, states 14.4,
track 12.4, signals 10.5, the other 14 files 1.2–5.5 s each; 149 s in tests. Typical money page on the seeded stand:
`settled()` returns in 0.1–0.5 s; the P1 test asserting 42 rows takes 1.9 s; an action scenario 1–3 s. The one slow
test is S29 (19.2 s / 17.8 s): the `DEBUG=pw:api` log shows `action-split-submit` and `form-dialog-close` retried for
~7 s each because the danger toast intercepts pointer events (finding 6). No expect came close to its 20 s timeout.

## Spec quality: ten action scenarios sampled

| # | Scenario, file:line | Before | After | Second press |
|---|---|---|---|---|
| 1 | S12 `queue.spec.ts:55` | group `title` `50`, months `2026-03 – 2026-03` | group count 0; P1 `100 / 55 / 0 / 45` (each cell `toHaveAttribute('title', …)`, discrepancy `0`) | same doc 200; other doc `[409, 'split_document_set']` |
| 2 | S13 `queue.spec.ts:76` | group `20`, dialog «[допущение]», from `2026-03` | P1 03 `100 / 50 / 0 / 50`, 05 `100 / 7 / 20 / 73`; the 05 group stays (count 1) | forced approve `[422, 'assumption_not_approvable']`; identical change 201 |
| 3 | S17 `queue.spec.ts:196` | group `50` | P1 `100 / 75 / 0 / 25` | `[409, 'rule_overlap']` |
| 4 | S21 `signals.spec.ts:76` | `missing` `10`, «корзины не хватает» | no unfunded row; P1 `100 / 10 / 0 / 90` | close 200; re-create `[409, 'participation_overlap']` |
| 5 | S22/1 `payout.spec.ts:27` | earned `15`, recouped `10`, paid `0`, payable `5`, position remaining `0`, gate allowed | paid `0`, payable `5`, gate `payout_blocked`, blocking + pending rows, P4 blocking `1`; body `[500, true]` | dblclick → `posts` 1; direct `[422, 'payout_blocked']` |
| 6 | S25 `rules.spec.ts:49` | 02/03/05 `A-251 50`, ours `50` | 03/05 `A-251 25` / `75`; 05 after buy-out `[]` / `100`; P1 three months | change 201; buy-out `[200,201]` with body `[]` |
| 7 | S27 `rules.spec.ts:144` | 03/04 `A-271 50`, `P-271 7.5`, ours `42.5` | period `2026-01-01 → 2026-04-01`; 04 `A-271 50` / `50`; P1 03 and 04 | close same date 200 |
| 8 | S31/4 `operations.spec.ts:140-240` | earned `50`, payable `50` | `10/40`, credits `5`/`45`, `0`/`55`, paid `55`/`0`, returns `55`/`55`; return body `[-5500, 'return', date]` | deactivate 409, return 400, deduction 201 with two rows in P20 |
| 9 | S33 `merge.spec.ts:16-80` | X earned `50`; Y earned `0`, waiting `50`; P1 `200 / 50 / 50 / 100` | X earned `100`, waiting `0`; P1 `200 / 100 / 0 / 100`; history operator `e2e-operator` | `[422, 'owner_merged']` |
| 10 | S37 `labels.spec.ts:29` | P1 03, 04 `100 / 75 / 0 / 25` | 04 `100 / 50 / 0 / 50`, 03 unchanged; period shows the end | close same date 200 |

Every money assertion I read in `e2e/golden/` is `toHaveAttribute('title', '<exact string>')` or an equality on
`title` lists (`track.spec.ts:30-38` compares sorted `[pseudonym amount category reason]` tuples, so a missing or
extra allocation fails). Text rounding is asserted where 19 asks (`33,33`, `16,67`, `12,27`, `1,48`, `4,17`,
`-21,25` red). No `toBeVisible` stands in for a number. `grep` finds no `waitForTimeout`, `test.fixme`, `.only`,
`test.fail` or `retries` in `e2e/` or `tests/`; `setTimeout` appears only inside `page.route` mocks (states, P1 long).
The second press of 19 §5 is sent for 20 of its 21 rows; missing: the credit (only the deduction is re-sent). Weak
spots in the second press: S32 approve and S14 contract check the status only, not "first `approvedAt` kept" or
"money unchanged"; proof / deactivate / return check the status, not the message.

## Coverage of 19

| Scenario | Asserted in | Not asserted |
|---|---|---|
| S01 | overview (P1, by-label), track (P6 G01, G42), splits, documents, duplicates (P12) | P10 earned/payable `50` |
| S02, S03 | overview, track | **S03/7 G36 P6** (`track.spec.ts:51-77` skips case 3,7) |
| S04, S05, S06, S07 | overview, track | — |
| S08 | overview, track (G18 layers, G18b, G20, G21), queue (read-only Q11/R1 groups), signals (q11 rows) | S08/4 `assumptions` r1 `50` |
| S09 | overview, track (G34, G44 shortfalls) | — |
| S10 | overview (rows, drill-down to the `7` group), track (unknown pair) | P10 Owner A-102 earned `75` |
| S11 | overview, release, track (two UPCs, breakdown), P5 | P10 A `75`, P `7.5` |
| S12 | queue | P1 before `100 / 5 / 50 / 45`; P6; P10 A earned 0 → `50` |
| S13 | queue, rules (05 month, P1 both months), track (05) | P21 `assumptions` Q1 `40` → `20` |
| S14 | queue | P1 before; P10/P4 `confirmed`, waiting, `payout` gate before/after |
| S15 | queue | P1 before; owner earned `50` |
| S16 | queue, track (state-dependent, finding 2) | P21 `labelUnmapped` before/after; P1 before |
| S17 | queue | P1 before; P17 shows the rule; P6 NG-171 `25` |
| S18 | queue (group `50`, P1 b17 after) | **P10 W1 / W2 / W3 Паблишинг (G26a–c: `100`, `70`, W3 `50`)**; P1 b17 before `400 / 170 / 50 / 180` |
| S19 | queue, publishing (state-dependent) | P21 `ambiguousWriters`; P1 b17 2025-12 before; W4a earned `50` |
| S20 | queue (before), signals (action, P1 after, noSplit `7`, `duplicate_track`) | P1 before `9 / 0 / 9 / 0` |
| S21 | signals, rules (P6) | — |
| S22 | payout | P1 2722100 / 2722200 rows (k2 04 `-100 / -57.5 / 0 / -42.5`) |
| S23 | owner | P1 2723100 |
| S24 | owner | S24/3 action sent by API, not P16; S24/3 after P6 / P1 |
| S25 | rules | P1 before; P10 A earned `150 → 100 → 75` |
| S26 | rules | P10 A / A2 earned |
| S27 | rules | P earned `15 → 7.5` |
| S28 | rules (M52 toast, period, P6, P1) | — |
| S29 | rules (three refusals through the UI, direct 422) | — |
| S30 | duplicates (P11 group, assign owner, second press), signals (`isrcsWithoutSplit` `100`) | **the create-split action and its after state** (`duplicates.spec.ts:32` opens and closes the dialog, saying the numbers "belong to the signals spec", which does not do it); P1 2730100 |
| S31 | operations | P1 rows |
| S32 | queue, documents (P14 waiting `5`), splits (P16) | P1 before `100 / 50 / 5 / 45` |
| S33 | merge | — |
| S34 | sources (upload, P1 after, `duplicate_period`, `duplicate_file`) | — |
| S35 | signals (k1 two lists, k2, k3 note, k4 assign + P1 after) | k4 P1 before `100 / 50 / 5 / 45`; k4 P6 |
| S36 | duplicate-dialog (owners), duplicates (artists «тот же» only) | artists «новый» with `force` |
| S37 | labels | P21 `sublabelWithoutRule` after; NG-371 earned `50 → 25` |
| SS1, SS3 | states (fixture page) and overview (real P1) | — |
| SS2 | states, overview | delay is 3–4 s, not 8 s (fine for the assertion) |
| SS4, SS5, SS6, SS7 | states, on `/dev/states` only | not on a real page (finding 7) |
| Double click | states (`calls` 1), payout (`posts` 1 on the real Pay dialog) | — |

19 §5 checks across scenarios: §5.1 (the spec sums A = B + C + ours with decimal.js) is not implemented, but every
cell and `discrepancy` `0` are asserted exactly, which implies it; §5.2 holds through the full allocation tuples;
§5.3 (P10 earned/waiting of **every** scenario owner) is asserted only in S22–S24, S31, S33; §5.4 (History with
`e2e-operator`) only for S33 and the S28 note. Reserved for stage 4 / real data: none of S01–S37 is; the 10 tracks
and 10 owners of `14_verification.md` are stage 4 by design.

## Findings

### Blockers

None.

### Should-fix

1. **Coverage gaps against 19 (table above).** The specs assert what they assert exactly, but 19's "before" P1 rows
   are missing for S12–S20, S32, S35/4; §5.3 owner checks are missing for most action scenarios; P21 rows for S13
   (`assumptions` Q1), S16/S17 (`labelUnmapped`), S19 (`ambiguousWriters`), S08/4 (r1), S37 (after) are missing.
   Two golden screens have no assertion at all: S18 on P10 (G26a–c per writer and `earnedPublishing`) and S30's
   create-split (`duplicates.spec.ts:32-35`). S03/7 (G36) is missing from `track.spec.ts:51-77`. A seed or page error
   in any of these would go unnoticed. Add them in stage 5; they are mostly one `expectP1` / `expectTotals` line each.
2. **Order-dependent specs that accept either state.** Files run alphabetically on one seed. Four specs read the
   current state and branch: `track.spec.ts:221-241` (S16, chooses by the API's `labelShareCategory`),
   `rules.spec.ts:282-307` (S13, acts only if C is still `40`), `documents.spec.ts:65-82` (S32, by the approved chip),
   `publishing.spec.ts:11-28` (S19, ambiguous or manual), plus `splits.spec.ts:53-56` (S12 presence from the API).
   In `npm run e2e` one branch of each is dead (queue runs before rules and track, after documents and publishing).
   The numbers asserted in the live branch are exact, so no wrong number passes, but adding a file that sorts
   between them (e.g. `r*.spec.ts` acting on S13) silently flips which branch runs. Make each state deterministic:
   either the spec that acts is the only one that asserts that scenario (as the CLAUDE.md rule says), or the reading
   spec gets its own scenario copy. Document the remaining order dependencies in `packages/frontend/CLAUDE.md`:
   merge before queue (S33), queue before rules/splits/track, documents and publishing before queue.
3. **The skipped test never runs in a full run** (`queue.spec.ts:151-165`). Seed a second unconfirmed owner for the
   queue-row merge dialog (no submit), or delete the test; a test that is always skipped is not coverage.
4. **Shared reference data mutated beyond 19 §1.** 19 allows one shared mutation (S16 alias). `labels.spec.ts:66-73`
   creates the sublabel `Ref Spec Sublabel` under 0to8, `documents.spec.ts:40-63` a document, `publishing.spec.ts:39`
   terms of W1 (`Print`, chosen not to move S18). Harmless today (no spec asserts the 0to8 label list), but either
   add them to 19 §1 or give them their own scenario keys.
5. **19 §6 and the frontend CLAUDE.md are stale.** 19 §6 lists `master-rows.spec.ts`, `labels-and-signs.spec.ts`, …;
   the files are `overview`, `track`, `queue`, `signals`, `rules`, … (18 files). CLAUDE.md "Tests" still names "the
   specs of step 3.5" and says the states fixture page hosts SS1–SS7 "until the real pages exist". Replace 19 §6 with
   the real file → scenario map (the coverage table above can serve) via a D-entry.
6. **An error toast blocks the open dialog for ~7 s.** In S29 (`rules.spec.ts:239-252`) the danger toast
   (`data-slot="toast"`, bottom placement) intercepts pointer events on `action-split-submit` and `form-dialog-close`;
   Playwright retries the click until the toast expires (pw:api log: "… intercepts pointer events", ~14 s per test).
   An operator who gets a refusal cannot correct and resubmit, or close the dialog, until the toast goes. Place toasts
   outside the modal's controls or make them non-blocking; then S29 drops to ~3 s. The refusal text shows a raw
   artist id (`double_participation: Artist 13c6…`): acceptable under R4, a label would help the operator.
7. **SS4–SS7 are asserted only on the `/dev/states` fixture page.** The contract-mismatch, stale-badge, 26,000-row
   grid and 2,100-owner picker checks never touch P6, P5, P9 or a real dialog's `EntityPicker`. The pages use the
   same `QueryView` / `DataGrid` / `EntityPicker`, so the risk is low, but one mocked real-page case each (P6 with a
   wrong field type, P5 with 26 k rows) would close it. All real pages use `QueryView` (grep: every `*Page.tsx` and
   tab with its own query); the owner tabs take data from the owner page's `QueryView`; `RulesTab.tsx:148` reads
   `useQuery(labelQueries.list())` with `labels.data?` and no state (a failed label list shows rules without names,
   silently).

### Notes

8. **Guard tests run and pass.** Read: `money` (9 cases + `1.005`, `0.125`, 17 digits), `cents`, `no-dto` (one
   `fetch` site), `routes-no-names` (only `src/routes/paths.ts`), `privacy`, `reasons-labels`, `actions-table`,
   `coverage` (every operation of `operations.ts`, three refusals with reasons), `nav`, `open-questions`.
   The eslint R1 ban (`eslint.config.js` frontend block) misses `.toFixed(`, `BigInt(`, `window.parseFloat`, binary
   arithmetic on fields. Grep of `src/`: no `.toFixed`, no money arithmetic; `BigInt` once for line counts
   (`SourceLinesPage.tsx:210`, not money); `toInt` (`pages/reference/shared.tsx:33`) is a hand-written digit parser
   for paging values, a deliberate way around the `Number(` ban (not money; fine, but say so in R1); the P4 sort
   compares integer `amountCents` (`OwnersPage.tsx:37`), as 19 allows. Consider adding `BigInt` and `toFixed` to the
   ban with an allow-list.
9. **Privacy.** `privacy.test.ts` greps e-mails and `/Users/` in the frontend only; it does not scan
   `packages/backend/scripts/e2e/`. My grep of the seed, the specs and the tests: no e-mail, no home path, no
   person-like name pair; writers are `HOLDER H-181`, `HOLDER W4`, `OWNER, A-31k`; no real account or company name.
   Extend the test's file list to the backend e2e seed.
10. **Harness hygiene.** Fresh stores per run (`seed.ts` drops first), dropped in `globalTeardown`; checked after
    both runs. `data/test-tmp/e2e-data` and `e2e-keys.json` stay after the run by design (overwritten next run,
    git-ignored). `verify-seed.ts` exists but `start.sh` does not run it; running it before the server would turn a
    seed error into one clear failure instead of many red specs. Leftovers that are **not** from this harness: 60
    `erp_t_*` and 99 `believe_t_*` (+ `_stage`) databases from backend vitest runs between 2026-11-01 and 06h today
    (crashed or killed runs; none added by my run), and 48 `data/test-tmp/run-*` directories. Worth a
    `scripts/drop-test-stores` sweep; not a stage 3 defect.
11. **The bundle.** `vendor` is 1.56 MB (441 kB gzip) and `index` 652 kB; Vite does not warn here, the stand is local.
    Fine for an internal tool; route-level splitting is an option if the first load matters.

## What QA needs from stages 4–6

- Stage 4 (real data): for each of the 10 tracks and 10 owners of `14_verification.md`, record screen `title` = API =
  reconciliation report, with the API call and the page URL; no SQL. Report the money page load time on the real
  stand (19 expects 7–10 s with the "идёт пересчёт" panel) and that navigation stays usable meanwhile.
- Stage 5: findings 1–3 in the specs (the before rows, §5.3 owner checks, P21 rows, S18 P10, S30 split, G36, a
  deterministic S13/S16/S19/S32), finding 6 fixed and S29 under 5 s, finding 7 on at least P6 and P5. Every
  real-data discrepancy becomes a golden screen first.
- Stage 6: 19 §6 rewritten as the real file → scenario map with no unasserted scenario; `npm run e2e` twice with
  identical outcomes and 0 skipped; the guard extensions of notes 8 and 9; `verify-seed` in `start.sh`.
