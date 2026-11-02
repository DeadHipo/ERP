Verdict: yes

# Stage 3 review: architect, revision 2 (2026-11-03)

Scope: commit `ba3ecf8` "stage 3 council fixes (D-130)". It is the HEAD of `feature/fable-001`; the coordinator
named `a4690c7`, but `git log` shows `ba3ecf8`. I read it against revision 1 below. Read-only. Run at `ba3ecf8`:
`npm run typecheck` clean; `npx eslint . --ignore-pattern 'packages/backend/scripts/mvp/**'` clean;
`REQUIRE_STACK=1 npm test` 32 files, 354 tests, all green. The stage 4/5 scripts under `scripts/mvp/`
(commit `b0cac58`) are outside this review.

The blocker is closed, and every should-fix is fixed. What remains is notes; none of them blocks acceptance.

## Revision 1 findings, now

| Rev. 1 finding | Now | Evidence |
|---|---|---|
| 1 **blocker**: M52 floored only start dates | **closed** | See below |
| 2 module `CLAUDE.md` | fixed | `modules/owners/CLAUDE.md` is new: the three sentences of 10 §1 plus a storage line. `publishing/CLAUDE.md` and `sources/CLAUDE.md` now open with their three sentences, with the old notes under "Notes". `facade/CLAUDE.md:4` names the five modules |
| 3 publishing precision | fixed | `writer-parts.ts:126` cuts at `SCALE` (12, ROUND_DOWN), and the last writer takes the remainder. `author-share.ts:31` uses `pct`, and the label amount is still a subtraction. Changed expectations are listed in D-130: only `review-round3` and the pure three-writer test, at the 13th decimal and beyond. G26a–e are unchanged |
| 4 decision index | fixed | See below |
| 5 "paid per label" without storage | fixed | See below |
| 6–10 notes | 6–9 as before; part of 10 addressed | The D-130 overlap key (below) also touches the participation side of note 10 |

**Finding 1 (blocker) in detail.**
- `facade/splits.ts:15-25` adds `floorEnd`. It floors to the month start and refuses `validTo ≤ validFrom` as a 400
  with code `empty_period`. `ValidationError` now takes an optional code (`shared/errors.ts:15`).
- `floorEnd` is applied to:
  - `createSplit.validTo` (`:41`);
  - `createParticipation.validTo` (`:95`);
  - `closeParticipation`, which reads the participation's `validFrom` in the same transaction (`:111-115`);
  - `createLabelRule.validTo` (`:170`);
  - the new `closeLabelRule` (`:183-187`), which `POST /labels/rules/:id/close` now calls instead of the module
    (`routes/labels.ts:17`).
- `changeSplit` and `buyout` close the predecessor at the floored start, as before, so every path into a period is
  now month-granular.
- Tests:
  - the P1/P2 hand-over (P1 closed 2026-06-15, P2 from 2026-06-15: June goes to P2 only) and the split hand-over,
    `tests/participations.test.ts:43-61`;
  - the empty period, `:137,141,251-252`;
  - rule end, close and successor, `tests/labels.test.ts`;
  - the HTTP close and the 400, `tests/api.test.ts`.
- Docs: 10 §2 (lines 88-91) states the rule. Plan 4.2 now moves the predecessor's `valid_to` with the normalised
  start.

**Finding 4 in detail.**
- The index header reads D-001 … D-130.
- D-067 is closed at line 141, and the waiting list no longer names it.
- D-125 gained its `- Status: accepted` line. That edits an old entry in place, which the append-only rule
  forbids. It is one added status line, recorded in D-130, so I accept it; do not repeat it.

**Finding 5 in detail.**
- 10 §5 and §7, and plan 4.4, now promise only what exists: earned (B) and waiting (C) per label of record;
  recouped and paid stay one total.
- `balance.ts:61-66,150,163-166` builds `byLabel` from the allocations' units. Σ `byLabel` = the master part of earned
  and waiting.
- It is in `balanceSchema` (`api-responses.ts:431`) and asserted in `golden.test.ts:420`.
- The model is now consistent with the storage. Stage 5's Main comparison is per owner, and plan and 10 §7 say so.

## New in D-130, checked from the architecture angle

- **`capToBase` / `distributeCapped`** (`exact.ts:53-121`). These are pure, live in `exact.ts`, and are used only by
  `split.ts:29`, `off-the-top.ts:23` and `carve.ts:67`. This is one residue rule with a sign cap, not a second
  implementation.
  - `capToBase` acts only when the remainder would cross the sign of the base. That can happen only at Σ percent
    = 100 with half-up rounding. It takes the excess off the largest amount, so Σ = base still holds by
    construction.
  - `distributeCapped` terminates: when no room is left, the whole overflow goes to one item in a single step, and
    the sum stays exact.
  - It is covered by the new exactness runs (Σ percent = 100, 6-decimal thirds, 1-pico nets, every kind; the
    identity, ≤ 12 decimals and no wrong sign after every layer).
  - Every multiplication site of revision 1 is still `pct` or `distribute`. The publishing sites are now too.
- **Overlap key with the source artist.**
  - It is migration `0010_participations_overlap_key.sql`, a new file, with 0008 untouched. It uses
    `coalesce(from_artist_id, '')`, so the key of every other kind is unchanged.
  - The service check at `splits/service.ts:412-418` matches the constraint.
  - It is justified by G12 (one recipient carving from two different artists).
  - It is validation, not money, so it stays in the module.
- **M18 channel rule.** This is a data convention recorded in D-130. It adds no field, which fits "a case closed by
  data gets no new field".
- **Boundaries unchanged:** still no `.mul(`/`.div(` in `src/modules`; `boundaries.test.ts` passes.

## Notes for stage 4/5 (not blocking)

1. Notes 6–9 of revision 1 stand as written:
   - the comment on `rules-coverage.test.ts:261`;
   - a grep guard for money math in modules (suggested);
   - stage 5 must read `GET /reconciliation`, not `reconcile()`, to get `fileDiscrepancy`;
   - the publishing layers share one test file.
2. `byLabel` is all-time and master only (D-130 known limit). That is fine for stage 5's per-owner comparison. If
   the product later needs a period view, add it there, not in a module.
3. The overlap check still compares stored ids (D-126 limit). Stage 4 should enter every participation through the
   facade, which canonicalises merged ids (`facade/splits.ts:100-104`).
4. The label string normalisation still collapses only white space (rev. 1 note 10). Plan 4.1 enters every distinct
   string, so this is harmless. Align 10 §2 or the function in stage 7.
5. `scripts/mvp/` (stage 4 loader, commit `b0cac58`) was not reviewed here. Plan 4.2 says "the loader already
   does" the `valid_to` normalisation. The stage 4 review should check that the scripts go through the facade
   methods above (`createSplit`, `createParticipation`, `createLabelRule`, `closeLabelRule`), not the module
   services directly, or the M52 end-date rule is bypassed.

---

# Revision 1 (kept as written; its verdict was "no")


# Stage 3 review: architect (2026-11-03)

Scope: steps 3.1–3.6 (`git log 06b025d..ca23896`, D-124…D-129) against `10_target_model.md`, `11_plan.md`, the
stage 2 notes R2-1…R2-9 and `CLAUDE.md`. Read-only. Run at HEAD `ca23896`: `npm run typecheck` clean;
`npx eslint . --ignore-pattern 'packages/backend/scripts/mvp/**'` clean; `REQUIRE_STACK=1 npm test` 32 files,
346 tests, all green.

Overall, the architecture is right and small. Modules compute no money. The layer chain is one ordered list of
pure functions. `calculate()` is a thin fold over `allocateUnit` / `allocateLine`. Recoup moved cleanly, and
reconciliation now reports a real discrepancy. One blocker is left: the month-start entry rule (M52) floors only
start dates. A mid-month end date therefore keeps the old holder for the whole month while the floored successor
also holds it. With that, stage 4 either fails on an overlap or pays the month twice.

## Checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1a | Modules compute no money | yes | `grep '.mul(\|.div(' src/modules` returns nothing. The only `Decimal` arithmetic in modules is on percents: `splits/service.ts:135,615` (`100 − Σ percent`, a view field, not stored), and percent parsing in `labels/service.ts:46-53` and `publishing/service.ts:264`. `publishing/repository.ts` only sums (`aggregatedLines`). `accruals()` is gone (no hit in `src`) |
| 1b | No module imports another module, the facade or the API | yes | `tests/boundaries.test.ts:7` lists `labels`. Line 47 requires `pgSchema('labels')`, and the no-FK query covers the schema. The test passes |
| 1c | Three-sentence `CLAUDE.md` per module | **partly** | finding 2 |
| 2a | Order in one place | yes | `layers/index.ts:38-45` (`MASTER_LAYERS`), `:71-75` (`PUBLISHING_LAYERS`). The order matches 10 §3 (label of record before perimeter, R2-3) |
| 2b | Pure layers, each with a test | yes for master, one shared file for publishing | `tests/layers/{label-of-record,perimeter,off-the-top,split,carve,categorise,exactness,index}.test.ts`. The publishing layers share `tests/layers/publishing.test.ts`, and recoup stays in `tests/recoup.test.ts` (note 9) |
| 2c | Only `allocateUnit` / `allocateLine` used | yes | `calculation.ts:182,236`. No other import of `layers/` in `src` except `balance.ts:4` (`recoup`) |
| 2d | No second implementation of a rule | yes | `balance.ts` only sums allocations and runs `recoup` (diff vs `06b025d`: imports only). `reports.ts` sums for signals and explain. The API has no money logic. `payouts.ts:162` (`shareOfPayout`, pro rata of a payout for the snapshot) predates this stage and is payout-side presentation (note 10) |
| 2e | 12-decimal rule at every multiplication site | master: yes; publishing: **no** | finding 3 (full list there) |
| 2f | recoup moved cleanly | yes | rename at 73 % similarity. Only the type block left, into `modules/settlements/recoup-types.ts`. The algorithm is unchanged (`git diff -M`). `Scope`/`ScopeKind` stay in settlements (R2-6) |
| 3 | Simplicity / justified schema | yes | every table and column of 10 §2 exists and is read: `labels.*` by `labels.index()`, `participations` and `split_shares.document_id` by `splits.index()`, `pub_terms.operation_type` by `author-share.ts`, `tracks.note` by `signals()`. Nothing beyond 10 §2. Migrations per schema (R2-5: `0007` is its own owners file) |
| 4 | Guard tests | yes | finding 6 |
| 5 | Decision log | mostly | finding 4 |
| 6 | Stage 4/5 risks | **blocker** | findings 1, 5, 7 |

Stage 2 notes R2-1…R2-9: all done. R2-1: `off-the-top.ts:22-37`. R2-2: `carve.ts:118-120` via `fund`. R2-3:
`index.ts:38`. R2-4: `owners.documentInfo` returns the kind, and `approveDocument` refuses `assumption`
(`owners/service.ts:660-663`). R2-5: `0007`. R2-6: as above. R2-7: `tests/helpers/sources-stack.ts:55`. R2-8 and
R2-9 are in `golden.test.ts`.

Exactness, master layers: every multiplication goes through `pct` = `q(amount × p / 100)` (`exact.ts:10`) or
`distribute` = `q(total × w / W)` with the residue to the largest absolute weight (`exact.ts:24-41`).
- Sites: `off-the-top.ts:21` (pct), `:24` (distribute); `split.ts:24` (pct); `carve.ts:21` (distribute in
  `fund`), `:58` (pct), `:63` (distribute, pool pro rata), `:118` (pct), `:135` (pct), `:150` (pct).
- Every remainder is a subtraction: `off-the-top.ts:53-54`, `split.ts:30`, `carve.ts:70,120,140,152`.
- `recoup.ts` has no multiplication or division.
- `categorise.ts`, `label-of-record.ts` and `perimeter.ts` do no arithmetic.

## Findings

1. **blocker. M52 floors start dates only, so a mid-month end date double-pays or blocks the month.**
   - Evidence: `facade/splits.ts:8` floors `createSplit.validFrom` (`:22`), `changeSplit.from` (`:43`),
     `buyout.effectiveFrom` (`:71`), `createParticipation.validFrom` (`:76`) and `createLabelRule.validFrom`
     (`:143`). Nothing floors `validTo`:
     - `createSplit` passes `input.validTo` raw (`:29`);
     - `closeParticipation` passes it raw (`:90-91`);
     - `createLabelRule` spreads `input.validTo` raw (`:146`);
     - `POST /labels/rules/:id/close` calls the module directly with no facade step (`api/routes/labels.ts:16-18`).
   - Rules are chosen by `covers`: `validFrom <= date && date < validTo`, with date = the first day of the report
     month (`splits/service.ts:113`, `labels/service.ts:55`). D-126 records "`validTo` is not [floored]" but does
     not look at what follows from it.
   - Consequences:
     - (a) Participation P1 (`top` 15) is closed on 2026-06-15. P2 for another pseudonym (`top` 15) starts on
       2026-06-15, floored to 06-01. In June both are in force and both are paid. Σ top = 30 passes the check, so
       no error stops it. The model lies.
     - (b) The same with one recipient and kind, or with a split given an explicit mid-month `validTo` followed by
       a split from that date, or with a label rule closed mid-month and the next one set: the exclusion
       constraints (`participations_no_overlap`, `splits_no_overlap`, `label_rules_no_overlap`) refuse the second
       entry. Stage 4 fails.
   - Stage 4.3 enters "per ISRC window" participations from contracts and 4.1 enters rule periods, so these dates
     will occur. This also contradicts 10 §2 M52 ("the whole month goes to the new holder").
   - Required: in the facade, apply the same entry rule to every end date: `validTo` of `createSplit`,
     `createParticipation` and `createLabelRule`, and the date of `closeParticipation` and of the rule close.
     Move the rule close behind a facade method. Flooring the end date gives the part-month to the new holder and
     keeps `[from, to)` consistent. Refuse a period that becomes empty after flooring. Add one golden or facade
     test: P1 closed mid-month plus P2 from the same mid-month date gives June to P2 only, Σ = net. Add the
     D-entry line (D-126 refined).
   - The plan should also say that 4.2, when it normalises the 1,043 legacy mid-month `valid_from`, moves the
     predecessor's `valid_to` with it. Otherwise the same overlap appears in data.

2. **should-fix. Module `CLAUDE.md` files do not meet the goal rule ("description: three sentences").**
   - `src/modules/owners/CLAUDE.md` does not exist. Plan `11:8` puts it in step 3.3, and 10 §1 says every module
     gets one in stage 3.
   - `publishing/CLAUDE.md` is five bullets, and `sources/CLAUDE.md` is a long list of agent notes.
   - `labels` and `splits` keep the three sentences of 10 §1 plus a storage paragraph. That is acceptable.
   - Required: add `owners/CLAUDE.md` (the three sentences of 10 §1). Open `publishing` and `sources` with their
     three sentences from 10 §1, then keep the notes under a heading such as "Notes".
   - Also, `facade/CLAUDE.md:4` says "opens the 4 PostgreSQL modules". There are 5 now (labels).

3. **should-fix. The publishing layers do not follow the one exactness rule.**
   - `author-share.ts:31` computes `authorAmount = p.payable.mul(percent).div(100)` without quantising. With
     12-decimal payables and 6-decimal percents this gives up to 18 decimals.
   - `writer-parts.ts:120` cuts equal parts at 20 decimals (ROUND_DOWN), not 12.
   - 10 §3 states the rule for "every layer", and the task's DoD says the same. D-128 part 2 keeps "the arithmetic
     the module used, no new rounding" on purpose, and 10 §4 says "unchanged arithmetic" for writer parts.
   - The sums still close, because the label amount and the last writer part are subtractions
     (`publishing-categorise.ts:23`, `writer-parts.ts:126`), so no money is lost. But the publishing money has
     another precision than the master money in the same balance and JSON. The exactness test does not cover it.
   - Required: use `q`/`pct` from `exact.ts` in `author-share.ts` and quantise the equal part to 12 decimals
     (the last writer keeps the remainder). Recheck G26a–e and record it in a D-entry. Alternatively, write in
     10 §4 and the D-entry that publishing is exempt, and why.

4. **should-fix. The decision index has a stale header and a contradictory ⚠ status for D-067.**
   - `03_decision_index.md:1` reads "D-001 … D-128", but D-129 exists (line 49).
   - D-067 is closed at line 134 ("closes D-067 ⚠ by owner decision 2", also D-123 in 97), yet line 140 still
     reads "⚠ sub-label (NoGhost) rule". The waiting list at line 153 also still names "D-067 (sub-label)". An
     agent following `CLAUDE.md` ("⚠ … do not change that behaviour without asking") gets two answers.
   - D-125 in 97 has no `- Status:` line, unlike D-124/D-126…D-129. 97 is append-only, so note it in the index or
     in the next entry, without editing D-125.
   - Required: fix the index header. Mark D-067 "closed by D-123 (owner decision 2)" at line 140 and remove it
     from line 153.
   - Five claims spot-checked, all true:
     - D-125: `approveDocument` refuses `assumption`, `owners/service.ts:660-663`;
     - D-126: `double_participation` from both sides, `splits/service.ts:165-169` and `:419-431`;
     - D-127: `balance.ts` changed only its imports (`git diff`);
     - D-127: the broken split layer shows 20, `golden.test.ts:1135-1159`;
     - D-128 part 2: `accruals()` removed, no hit in `src`.

5. **should-fix (stage 4/5). The promise "the balance shows B, recouped and paid per paying label" has no storage.**
   - 10 §5 and plan 4.4 (D-131) promise this per-label view.
   - `OwnerBalance` (`balance.ts:31-80`) has no per-label figures. Earned per label could be derived from
     `UnitResult.ourLabelId`. But "paid per paying label" needs the paying label on the operation, and
     `settlements` operations have no such field. 10 §2 adds none.
   - Stage 4.4/4.5 load Echo8 and 0to8 payments into one owner's balance, and stage 5 compares balances with
     Main, which is the 0to8 ledger. Without the paying label, the Main comparison cannot separate Echo8 payouts.
   - Required before 4.4: either add the field to 10 §2 and the settlements module (justified by the two legal
     entities), or drop the promise from 10 §5 / D-131 and state how stage 5 separates Echo8 money.

6. **note. Guard tests.**
   - `rules-coverage.test.ts:263` now expects `333.433329999`. This is the right fix.
     - The guard checks that money is a decimal string, never a float. Its old expectation was the unquantised
       product, which D-123 abolished.
     - Recomputed: q(0.1 × 0.33333333) + q(0.2 × 0.33333333) + q(1000.000000000001 × 0.33333333)
       = 0.033333333 + 0.066666666 + 333.33333 = 333.433329999. The same result comes from one unit.
     - The test comment on line 261 ("exact: (…) x 0.33333333") should say "quantised to 12 decimals (D-123)".
   - The `Number(` allow-list is untouched (no diff besides that line).
   - `api-contract.test.ts` calls every new operation and passes.
   - `api-reasons.test.ts` plus the `Record<CReason, string>` type in `shared/src/reasons.ts` meet the
     "every reason has a label" guard of 10 §8.
   - `boundaries.test.ts` covers `labels`.
   - There is no guard that `src/modules/**` stays free of money math. A grep-based test, e.g. no `.mul(`/`.div(`
     in `src/modules`, would make check 1a permanent. Suggested, not required.

7. **note (stage 5).** `reconcile()` takes `A_received` from the units (`calculation.ts:327`). The per-account
   file totals and `fileDiscrepancy` are only added in `reports.reconciliation` (`reports.ts:14-35`), and only on
   the report basis. That is correct, but stage 5 must read `GET /reconciliation` (the endpoint), not
   `reconcile()`, to catch a unit lost between ClickHouse and the layers. `explainTrack` recalculates everything
   for one ISRC (`reports.ts:150`). That is acceptable under the 10–30 s budget, but stage 5's "one SQL over
   explainTrack-style output" should use `calculate()` once, not one call per ISRC.

8. **note. API surface.** Beyond 10 §8 there are `POST /labels/rules/:id/close` and the `artistId` filter on
   `GET /participations`. Both are minimal and used by the pages. Keep them, but route the close through the
   facade (finding 1). Routes calling `facade.modules.<m>` directly for single-module writes follow the existing
   pattern (`routes/owners.ts:10`, `publishing.ts:9`). The frontend adds plain tables and forms only
   (`labels/LabelsPage.tsx`, `splits/ParticipationsPage.tsx`, 4 lines in `components/ui.tsx`): no design work.

9. **note. Test files per layer.** The three publishing layers share `tests/layers/publishing.test.ts`, and recoup
   is tested in `tests/recoup.test.ts`. That is acceptable as long as each layer has its own `describe`, but it
   is not "its own test file". Split the file if a fourth publishing layer appears.

10. **note. Small items.**
    - `normalizeLabelString` (`labels/service.ts:41`) collapses white space but not separators. 10 §2 says
      "spaces and separators collapsed" (`0to8/Echo8` vs `0to8 / Echo8`). Stage 4.1 enters every distinct string
      as an alias, so this is harmless now. Fix 10 or the function so they agree.
    - The double-participation check compares stored ids, not canonical ones (D-126 known limit). Stage 4 should
      load through the facade, which canonicalises.
    - `balance.ts:196` adds `u.net` to `t.net` once per allocation of the artist. If one pseudonym gets two
      allocations in one unit (a row and the sublabel recipient), the track net on the owner page doubles. That
      is display only.
    - `payouts.ts:162` (`shareOfPayout`, two decimals) is money math outside `layers/`. It predates this stage and
      is presentation of a payout, but it belongs in the stage 7 list.

## Required for "yes"

- Finding 1: floor the end dates in the facade, and route the rule close through the facade, with a test and a
  D-entry line.
- Findings 2 to 5: fix them or answer each one in the next revision. None of them blocks alone.
