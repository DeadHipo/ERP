Verdict: yes

# Stage 2 review: architect, revision 2 (2026-11-02)

Re-read `10_target_model.md`, `11_plan.md` and `12_golden_cases.md` (revision 2). Both blockers are closed, and every
should-fix is closed or answered. What remains are notes for stage 3; none blocks acceptance. Revision 1 is kept
below, unchanged except for its verdict line.

## Fixed

| Rev. 1 finding | Now | Evidence |
|---|---|---|
| 1 blocker: no per-row assumption | `split_shares.document_id NULL` overrides the split's document for that row only; categorise reads the row's own document first, then the split's; Q1/Q5 rewritten; G10a has L 20 C `assumption` under an approved appendix | `10:61,106,154,156`; `12:36`; plan 3.3, 3.6 |
| 2 blocker: compounding order inside a kind | one shared base per kind, taken together and scaled down to the bucket; "inside a kind the order never changes an amount"; G35 (P1 5, P2 7.5 from base 50); shuffled-order test | `10:105`; `12:61,89` |
| 3 explicit base / traceability | `explainTrack` returns the state after every layer, and its test asserts the sum. Carves change the source row in place, so one artist keeps one allocation per unit and `balance.ts` counts the track net only once | `10:97,145-146` |
| 4 off the top as a rescale | `off-the-top` runs before `split`: `scaledNet = net × max(0, 100 − Σp)/100`; no division by net; rows computed on `scaledNet` | `10:103-104`; G04, G15, G18, G32 recomputed and consistent |
| 5 terms per type | overlap and closing checked per (owner, operation type) | `10:71-72`; plan 3.5 |
| 6 recoup per pseudonym | stated in §5; G27 and G29 put the advance on P and on NG; plan 4.5 enters advances "on the earning pseudonym" | `10:129-131`; `12:53,55`; `11:42` |
| 7 plan placement | G25 split between 3.3 (storage) and 3.4b (money); G33 is in 3.4b; 3.4 split into 3.4a (pure layers) and 3.4b (rewiring) | `11:19-21` |
| 8 file totals per account | named in §6 and in 3.4b | `10:137`; `11:21` |
| 9 module `CLAUDE.md` | each one lands in the step that touches its module | `11:8-9`; `10:45` |
| 10 zero rule | one rule: an allocation is emitted when its percent is non-zero, even with amount 0; a percent of 0 is skipped (G09, G16, G31, G41 agree) | `10:104-105` |

## New items in revision 2, checked from the architecture angle

- **`participations.base` (`net` \| `bucket`).** Justified: the settlement takes 15 % of net out of the label share
  (G36: S 15, ours 35). The A&R participation takes 15 % of the label share itself (G11: P 7.5). Percent conversion
  cannot replace the field, because buy-outs move the label share. The allowed combinations are restricted at entry
  (`10:62`). This is one field for a real difference in money. Accepted.
- **Pool quantisation (12 decimals, residue to the last row by artist id).** Deterministic. It is the only inexact step
  and it is closed exactly (G34 recomputed: 12.266666666667 + 12.266666666667 + 12.266666666666 + 13 + 50.2 = 100).
  Accepted.
- **Σ top ≤ 100.** Checked at entry in splits (validation, not money); G23 asserts `top_above_100`. Accepted. See
  note R2-1 for capping in data.
- **`ourShare` from the layer state, with a broken-layer test.** This makes `discrepancy` a real alarm instead of a
  tautology. Accepted.
- **Fixture seeding of the own labels.** Verified: the default fixture label string is `Test Label`
  (`tests/helpers/fixtures.ts:51`, `believe-csv.ts:39`). `api.test.ts:11` and `api-contract.test.ts:41` both build
  their facade through `newFacade`. Seeding `Test Label` → 0to8 there therefore keeps the existing tests out of
  `label_unmapped`. Accepted.
- Hand numbers recomputed: G18 (B 57.5, C 23.375, ours 19.125, total 100), G21, G35, G36, G37, G39, G41, G43.

## Remaining (notes, not blocking)

1. **R2-1. Capping an over-100 top in data.** `10:103` says "capped with the excess recorded as a shortfall" but does
   not say how the top allocations themselves are reduced. For "Σ = net after every layer" to hold, they must be
   scaled down to net, like the other kinds. One sentence in D-126/D-127.
2. **R2-2. artist_share has no over-funding rule.** Pool and label_share scale down to their bucket. Several
   artist_share carves from one row with Σp > 100 are covered neither by a scale-down nor by an entry check. Apply
   the same scale-down (or Σp ≤ 100 per source row at entry).
3. **R2-3. Layer order text.** The table still runs `label-of-record` before `perimeter` (`10:101-102`; `12:15`).
   This is harmless, because perimeter ends the chain for C units, but the list in `layers/index.ts` must match 10.
4. **R2-4 (rev. 1 note 11). Categorise needs the document kind.** The context still lists only "document statuses"
   (`10:94`); `owners.documentStatuses` must also return the kind. "Nothing approves it" should be a guard in
   `approveDocument`, not a convention.
5. **R2-5 (rev. 1 note 12). Migrations per schema.** `tracks.note` and the documents CHECK still ride in
   `0006_labels.sql` (`10:74`; `11:18`). Prefer a file of their own for schema `owners`.
6. **R2-6 (rev. 1 note 15).** When `recoup.ts` moves (3.4a), keep `Scope`/`ScopeKind` in the settlements module
   (`settlements/service.ts:7`).
7. **R2-7.** `resetModules()` in the test stack must also truncate schema `labels` before `newFacade` seeds it.
   Otherwise the seeded aliases collide on the `alias_norm` primary key.
8. **R2-8.** G43 lists three scenarios, each starting from payable 80. Write them as three separate tests, not one
   cumulative one.
9. **R2-9.** The 3.4a column says "layer halves of G01–G43", but the G26 publishing layers land in 3.5. Exclude G26
   from 3.4a.

---

# Revision 1 (kept as written; its verdict was "no")


# Stage 2 review: architect (2026-11-02)

Scope: `10_target_model.md`, `11_plan.md`, `12_golden_cases.md` against `notes/goal_prompt.md`, `09_settlement_cases.md`
and the code at HEAD `e2524f4`. Read-only; SQL run read-only against the local stack.

Overall: the module split is right and small (labels on its own, participations in splits, money out of the modules),
the layer chain is close to minimal, the ClickHouse change is feasible. Two gaps in the money rules of the design must
be closed before stage 3: one has no storage, one gives an arbitrary result.

## Claims verified against code

| Claim of the design | Evidence | Result |
|---|---|---|
| `pub_terms` has no operation type; lines keep it | `src/modules/publishing/schema.ts:68-76`; `migrations/postgres/0005_publishing.sql:49` (`pub_lines.operation_type`); `repository.ts:128-132` groups without it | true: only the GROUP BY and the terms need changing |
| `units` projection has no `label_name` | `migrations/clickhouse/0002_units_projection.sql:7-13`; `0001_believe.sql:58-66` | true. Read-only check: 0 unit keys (file, isrc, upc, months) carry more than one `label_name`; 25 distinct strings. Adding `label_name` to the key does not split any unit |
| `DOCUMENT_KINDS` lacks `assumption` | `src/modules/owners/service.ts:16-25`; CHECK in `0003_owners.sql:74-75` | true; both must change (the design says so) |
| `Position.artistId` is required; master recoup is per artist | `src/modules/settlements/recoup.ts:31,58`; `balance.ts:281` | true; see finding 6 |
| 1,043 of 13,610 splits start mid-month | `SELECT … FROM splits.splits` | true |
| Exclusion constraints already used | `0002_splits.sql:6,24` (`btree_gist`, `splits_no_overlap`) | true: the new ones follow the existing pattern |

## Findings

1. **blocker. A single row cannot carry an assumption document, yet the design relies on it (Q1, Q5).**
   Evidence: `10_target_model.md:136,138` ("assumption document on the licensor's row"; "the other document's rows
   carry an assumption document"); `09_settlement_cases.md:257,330`; but a split row has no document:
   `migrations/postgres/0002_splits.sql:31-37` (`split_shares` = split_id, artist_id, percent; the document is per
   split, line 16). `12_golden_cases.md:58-60` (G10 note) contradicts §7 Q1 and says "on a participation", but no
   `funded_from` kind equals a plain row of net (`top` rescales the others, `artist_pool` takes from the rows,
   `label_share` is a percent of a moving label share, see G10b where it would give 29.2 instead of 20). Plan 4.2 enters
   these rows. Under the goal rule "money that depends on an assumption stays in C", the 30 Lost Label titles cannot be
   entered. Required: choose one storage and write it into §2, §3 (categorise) and a golden case. Smallest fix:
   `splits.split_shares.document_id text NULL` (null = the split's document; when set, it decides the category of that row
   only), justified by Q1 and Q5. Add a golden case: rows A 23 (split document approved) and X 25 (row document of kind
   `assumption`) → A B, X C `assumption`, ours 52.

2. **blocker. Carves of one kind compound in an arbitrary order.** Evidence: `10_target_model.md:95`: `label_share`
   is "percent of the **current** label share", `artist_share` of the "current amount", order "inside a kind by
   `valid_from`, then id"; ids are random UUIDs (`src/shared/identifiers.ts:4`). Two `label_share` participations
   (the settlement 15 and a per-ISRC window, plan 4.3) with the same `valid_from`: P1 10, P2 15 on label share 50 gives
   P1 5 / P2 6.75 or P1 4.25 / P2 7.5 depending on the UUIDs. Money per recipient then depends on an id. Required:
   state that carves of one kind share one base (the amount at the start of that kind: the label share before the
   label-share carves, the artist's amount before the artist-share carves), so the order inside a kind does not matter;
   keep the order only between kinds (the documented Q11 rule). Add a golden case with two `label_share` participations.
   If the contracts really compound, say so in D-123 and order by a stored, meaningful key, not the id.

3. **should-fix. The allocation has no explicit base, and carves rewrite earlier allocations.** The goal is "layers
   with an explicit base". `Allocation` (`10:87`) has `percent` and `amount`, but after off-the-top and a pool carve the
   row "A 25 %" carries 14.75 (G18): neither the base nor the deduction is visible, so `explainTrack()` (§6) cannot
   trace a number to its rule. Required: add `base` (the amount the percent was applied to) and record a carve as an
   explicit move (a negative allocation on the source with the carve's `ruleId`, plus the recipient's allocation), or
   keep a `deductions: {ruleId, amount}[]` on the row. If negative entries are used, fix `balance.ts:157-195`: `t.net`
   is added once per allocation, so two allocations of one artist on a unit double the track net.

4. **should-fix. Off the top is a rescale of the split layer; put it first and drop the division.** `10:94` computes
   rows, then multiplies them by `(net − Σtop) / net` (a division by net with a guard). Equivalent and simpler:
   `off-the-top` before `split`, `base = net × (100 − Σp) / 100`, and `split` computes rows and the label share on that
   base. No layer then rewrites another's output; the zero guard disappears; G04, G15, G16, G18, G32 keep their numbers.
   Same for `perimeter`: run it before `label-of-record` (it ends the chain; the label is irrelevant for C units).

5. **should-fix. Terms by operation type change `setTerms`, not only the schema.** `publishing/service.ts:282-310`
   refuses any term starting on or after an existing one of the owner and closes the owner's single open term. A
   Synchronization 50 term would close the general 90 term or be refused. Required in §2 / step 3.5: overlap,
   "open term" and closing are per (owner, operation type); a typed term never closes the untyped one. A golden or
   unit case: set 90 (null) then 50 (Synchronization) on the same date → both in force (G26a/b need this).

6. **should-fix. Recoup is per pseudonym for master income; §5 says "per owner".** `10:116-118` says an advance scoped
   `any` "on that owner" recoups only from the participation. In code master income recoups only positions of the same
   artist (`recoup.ts:58`), and a position without an artist cannot take master income at all (`balance.ts:281`). This
   is what makes M19 participation-only work, but G27, G29 and plan 4.5 must say the advance is entered on the
   participation's / sublabel's pseudonym (P, NG). Otherwise NoGhost's advance entered on another pseudonym recoups 0.

7. **should-fix. Plan order: two golden cases are in the wrong step or missing.** G25's money assertion ("the 2026-03
   unit carries P 7.5") needs the layers of 3.4 but is listed in 3.3 (`11_plan.md:16`); keep only the stored date in
   3.3. G33 (reconciliation per account) is in no step (`11_plan.md:17` lists G01–G24, G27–G32): add it to 3.4. Step
   3.4 is one commit covering seven layer files, the rewiring, reconcile, signals, explain, the recoup move and 30 golden
   cases; split it into 3.4a (pure layers + `tests/layers/*`, nothing wired; DoD holds) and 3.4b (rewire, old loop
   deleted, golden end-to-end).

8. **should-fix. Reconciliation per account also needs the file totals per account.** `src/facade/reports.ts:14-22`
   keys `believeTotals` by `reportingMonth` only; with rows per account (§6) the `fileDiscrepancy` of a month with both
   accounts is wrong. Name it in step 3.4.

9. **should-fix. Every module's three sentences belong in its `CLAUDE.md` (goal prompt).** Only `sources` and
   `facade` have one today; the plan creates one for `labels` only (3.2) and leaves the rest to stage 7. Add
   `modules/{owners,splits,publishing,settlements}/CLAUDE.md` with the §1 text in the step that changes each module
   (3.2 owners, 3.3 splits, 3.4 settlements, 3.5 publishing). Publishing's §1 text has two sentences.

10. **note. Zero allocations: one rule.** G16 expects zero allocations to exist ("all allocations 0"), G31 expects no
    row for a zero carve. Today a zero percent is skipped (`calculation.ts:149`), a zero net is not. State: skip when
    the percent is 0; emit (with amount 0) otherwise; adjust G31 or G16.

11. **note. Categorise needs the document kind.** The context has document statuses only (`calculation.ts:107`,
    `owners.documentStatuses` returns a status). `assumption` is a kind; the owners API must return kind with status.
    Also `approveDocument` should refuse kind `assumption` ("nothing approves it" is otherwise only a convention).

12. **note. Migrations per schema.** `tracks.note` and the documents CHECK belong to schema `owners`; give them their
    own file (e.g. `0006_owners_assumption_note.sql`) and number `labels` next, not "same file as 0006" (`10:67`).

13. **note. New fields and tables against "no field when data closes the case".**
    - `labels.*` (3 tables): justified by M5, M8, E13–E15, Q12; the goal names the module. Keep.
    - `splits.participations`: justified by M3b, M4, M12, M13, M35, M43 (base and percent cannot be expressed as rows).
      Keep. `origin`, `note` mirror `splits.splits`; acceptable.
    - `pub_terms.operation_type`: justified by M16 (Synchronization 292,421.36 at a different rate). Keep.
    - `documents.kind = assumption`: the smallest marker for the goal's C "assumption" rule. Keep.
    - Exclusion constraints: the existing pattern (`splits_no_overlap`), not over-engineering. Keep.
    - `tracks.note`: moves no money (M29 is a signal); acceptable as the smallest flag, but call it a flag in the D-entry
      and list only notes the signals page understands. Could be dropped from the MVP without loss of money.
    - `SourceUnit.labelName` + projection: required by M8, minimal (finding on uniqueness above). Keep.
    - Missing: the per-row document of finding 1.

14. **note. ClickHouse migration order and idempotence.** In `0003_units_by_label.sql`: ADD PROJECTION IF NOT EXISTS
    `units_by_label` → MATERIALIZE (mutations_sync = 1) → CREATE OR REPLACE VIEW → DROP PROJECTION IF EXISTS `units`,
    so reads never lose their projection; `tests/sources-loader.test.ts:111,117` must expect `units_by_label` and
    `ReadFromMergeTree (units_by_label)`. A leftover stage table from before the migration lacks the new projection:
    the loader recreates stage tables per load (`columnar.ts:144`), so it is fine; say so in D-124.

15. **note. Moving `recoup` and `accruals()` to the facade is right and cheap.** Both compute money (`recoup.ts:69`,
    `publishing/service.ts:333-420`); the facade already composes them (`balance.ts:3,293`, `calculation.ts:108`).
    Keep `Scope`/`ScopeKind` in the settlements module (`settlements/service.ts:7` validates with them) and move only
    the function and `IncomeItem`/`Position`; update `tests/recoup.test.ts:3`, `tests/review-round2.test.ts:3`.
    `parseSongwriters`/`normalizeName` stay exported by publishing; the facade's one snapshot replaces
    `repo.snapshot` in `accruals()`.

16. **note. M52 is a code rule in 10 but "without a code change" in 09 (`09:317`).** Either is fine; say which in
    D-126. Order for stage 4: normalise the 1,043 legacy `valid_from` (4.2) before any floored change is entered on
    the same ISRC, or `splits_no_overlap` will refuse it (a floored 03-01 against an open 03-15).

17. **note. Guard tests.** `boundaries.test.ts:7` must list `labels` (planned); `rules-coverage.test.ts` scans only
    `src` for `Number(` (scripts of stage 4 are outside); `api-contract.test.ts` needs every new route in
    `operations.ts` and the scenario (planned in 3.6). None needs a justified change beyond the list.

## Module boundaries (check 1)

Agree: labels is its own module (keyed by a label string, not an ISRC; the goal names it); participations belong in
splits (per ISRC and period with a document, and the row-or-participation rule needs both tables in one transaction);
no new module imports another; the payer is always "us" in 09, so no payer field is needed. Labels module three
sentences hold; settlements and publishing lose their money code as the goal requires.

## Required to accept

Findings 1 and 2 fixed in 10/12 (with their golden cases); findings 3–9 either fixed or answered in 10/11.
