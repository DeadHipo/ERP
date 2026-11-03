Verdict: yes

# Stage 7 review: architect (2026-11-03)

Scope: HEAD `9643b34` of `feature/fable-001` ("docs: README line for 15"), read against stage 3 (`ba3ecf8`, accepted)
and D-131 … D-137. Read-only; the only file written is this one. The loader dry runs below wrote their logs to the
git-ignored `data/mvp-load/log/`, and the compare wrote to the session scratchpad.

## Definition of done at HEAD (check 5)

| Check | Result |
|---|---|
| `npm run typecheck` | clean (exit 0) |
| `npm run lint` (`eslint .`; ignores only `node_modules`, `data`, `context_data`, `frontend/dist`, so `scripts/mvp` is linted) | clean (exit 0) |
| `REQUIRE_STACK=1 npm test` | 32 files, **360 tests**, all passed (exit 0) |
| `npm run build:client` | built (315.86 kB JS) |
| Commits | `git status` at session start: clean. No `origin/feature/fable-001` exists (`git branch -r`, `git ls-remote --heads origin`), so nothing is pushed |
| Working tree now | one untracked file `owner_alloc.tsv` in the repo root, created 03:35 during this review. It is not mine and not committed (see finding 9) |

## Check 1: the code still honours the idea

- **The modules compute no money.** I grepped `src/modules/**` for `Decimal`, `.add/.sub/.mul/.div`, `BigInt(`. What is there:
  - percent parsing and validation (`splits/service.ts:84`, `labels/service.ts:46`, `publishing/service.ts:264`);
  - canonical text (`repository.ts` of labels, splits, publishing and `sources/registry.ts`);
  - load checksums: `sources/loader.ts:109-154` compares Σ gross/net with the file total, and `publishing/service.ts:184` checks sum and count;
  - the split view's `ourShare` percent, `splits/service.ts:135` (100 − Σ row percents, a percent and not an amount, the same as at stage 3).

  None of these allocates an amount. Since `ba3ecf8` the only module change is the two deletes of D-137
  (`git diff --stat ba3ecf8..HEAD -- packages/backend/src`: `splits/{service,repository}.ts`, `+39` lines).
- **The D-137 deletes** (`splits/repository.ts:79-102`, `splits/service.ts:504-515`):
  - Placement is correct. They are SQL, and "all SQL lives in the repository". A module that owns `splits` rows is the one that may delete them.
  - Both are marked loader-only in three places: the JSDoc, `modules/splits/CLAUDE.md:14-17` and D-137. No route or facade method calls them: `grep` finds only `scripts/mvp/steps-main.ts:917`, `steps-stage6.ts:241` and `tests/participations.test.ts:440-443`.
  - `deleteEmptySplits` guards itself in the WHERE (`valid_to = valid_from`).
  - `deleteParticipations` has no guard: it deletes any id. See finding 5.
- **No module imports another.** `tests/boundaries.test.ts` (3 tests) is in the green run.
- **The layer order is one list.** `MASTER_LAYERS` and `PUBLISHING_LAYERS` live in `src/facade/layers/index.ts:39-46,70-74`, and nothing else orders layers.
- **Every layer has its test.**
  - Master layers: `tests/layers/{label-of-record,perimeter,off-the-top,split,carve,categorise}.test.ts`.
  - Publishing layers: `tests/layers/publishing.test.ts` runs the chain, with an order test at `:77`. They are tested through `allocateLine`, not one file per layer, the same as stage 3.
  - Recoup: `tests/recoup.test.ts`.
  - Exactness: `tests/layers/exactness.test.ts`.
  - Golden cases: `golden.test.ts` has 124 `it`, including G45 at `:1179` and G46 at `:1212`.
- **The facade stores nothing.**
  - No migration after `0010_participations_overlap_key.sql` (stage 3).
  - The PostgreSQL table list (`information_schema.tables`) is exactly the module tables plus `public.source_files` / `schema_migrations`: no accrual or cache table.
  - The only `Map` in `calculation.ts` is a per-request memo (`:218`).
  - `facade/CLAUDE.md:24` still forbids caches.
  - The D-136 fields (`UnitState.sublabelId/sublabelName`, `UnitResult.ruleId`) are per-request state that no layer reads (diff of `layers/*.ts`).
- **The loader and the facade.** `scripts/mvp` calls the facade for every multi-module or validated write: `createSplit`, `changeSplit`, `confirmSplit`, `createParticipation`, `createLabelRule`, `closeLabelRule`, `createOperation`, `setPublishingTerms`, `ingestB17`, `reconciliation`. The calls that do not go through a facade method:

| Call | Where | Documented |
|---|---|---|
| raw `UPDATE splits.splits SET valid_from, valid_to` | `steps-annex.ts:354` (`normalise-dates`) | D-131 ("Only `normalise-dates` writes SQL directly"), D-137 (refuses empty periods, `:335`) |
| `splits.deleteParticipations`, `splits.deleteEmptySplits` | `steps-main.ts:917`, `steps-stage6.ts:241` | D-137 |
| `owners.artistIndex` replaced by a run-cached wrapper | `lib.ts:217-229` | D-131 (speed fix) |
| `labels.createLabel/addAlias`, `owners.createTrack/setTrackNote/createContract/createArtist/createOwner/attachFile/approveDocument`, `settlements.deactivate` | `steps-annex.ts:33,57,124,587`; `steps-main.ts:501,795,1028`; `lib.ts:379,409,444,448` | Not named as bypasses. They are the same single-module service calls the API routes make (`routes/labels.ts:13,20`, `routes/owners.ts:27,67,77,84,99,102`, `routes/settlements.ts:27`), so the validation is identical. Acceptable |
| Python extractors: `common.py` queries ClickHouse over HTTP, `echo8.py` opens sqlite, `build_main.py` runs SELECTs on `owners.*` | `scripts/mvp/*.py` | Only in the git-ignored `data/mvp-load/*/README.md`, not in a tracked guide or a D-entry (finding 3) |

- **Data spot-checks** (SELECTs, dev database `erp`):
  - The dry runs are idempotent: `load.ts labels` gives `alias_exists=25 rule_exists=16`; `hygiene` gives `already_done=1`; `carves` gives `already_done=199`, `d135_participations_none_left=1`.
  - `compare-main.ts --out <scratch>` reproduces D-137 exactly: 992 owners, 802 differ, Σ payable −627,471.16, 9.8 s.

## Check 2: do the guides tell the truth

- **`01_big_picture.md` §2–§4** match the code:
  - layer order and the four carve kinds: `carve.ts:162-169`;
  - categorise order: `categorise.ts:5-23`;
  - module table, boundaries, exactness rule.

  §5 has small drifts (finding 2).
- **Root `CLAUDE.md`:**
  - The architecture is current: the labels module, `layers/`, the labels and participations routes, the `scripts/mvp` line.
  - `npm run mvp:load` exists (`packages/backend/package.json:13`).
  - The test count is stale, and "they go through the facade" is too strong (finding 1).
- **`04_recipes.md`:**
  - 2a was followed against the code: `C_REASONS` is in `api-responses.ts:19`, labels in `reasons.ts`, the order in `categorise.ts`, `tests/layers/world.ts` exists.
  - 2b: the four labels routes exist (`routes/labels.ts:11-22`).
  - 2c: the field names match `createParticipationBody` (`api-schemas.ts:213-224`), and the refusal codes match `splits/service.ts`.
  - 9: the step list equals `STEPS` in `load.ts:35-54`. The facade and inputs claims are finding 3.
- **`05_doc_drift.md`:** the rows are true. The last but one names D-131…D-134 where D-137 is now the end (finding 2).
- **Module `CLAUDE.md` files:** each opens with the 10 §1 paragraph:
  - owners, labels and splits word for word, plus small additions;
  - publishing, sources and settlements in substance.

  Notes follow under a heading or a paragraph. labels adds a fourth sentence (`index().labelOf`), and splits adds the error codes. Accepted.
- **`03_decision_index.md`:**
  - The header reads "D-001 … D-137".
  - D-123 … D-137 each have an index line (`:49,71,74,95,105,134-137,149-154`), and every 97 entry D-123 … D-137 has `- Status: accepted`.
  - D-067 is closed at `:142` and is not in the waiting list (`:162-164`). The ⚠ list equals 01 §5.
  - D-135 is not marked as refined by D-137 (finding 4).

## Check 3: the decision log

D-131 … D-137 exist (`docs/97…:1793-1883`) in the format: Date, Question, Decision, References and Status, plus
Checked and Known limits as in D-123 onwards. They are appended in the order of writing, so D-134 stands before D-133
and D-136 before D-135 (note 8). Six claims checked with SELECTs:

| Claim | Source | SELECT result |
|---|---|---|
| 17 labels (2 own, 15 sublabels), 25 aliases, 16 sublabel rules | D-131 | `labels`: own 2, sublabel 15; `label_aliases` 25; `label_rules` 16 (14 open) |
| rule of `lost` closed at 2025-11-01 | D-135 | `lost`: 2025-10-01 … 2025-11-01 |
| participations = 108 (Annex) + 34 (LUNAR) + 141 (carve2), the 336 D-135 rows gone | D-131, D-135, D-137 | 283 = `participations` 108 + `lunar` 34 + `carve2` 141; notes `mvp:carve:%` 0; carve2 all `net/artist_pool` on 121 ISRC |
| documents of kind assumption never approved: 13 labels + 1 LUNAR + 29 M43 + Q1 + Q5 | D-131, D-135, D-137 | `assumption` 45, all with `approved_at` null; titles "Assumption M43%" 29 |
| operations: 104 in (55 deactivated "replaced by participation", 101,552.83), out 2,371 + 158 + 26 + 3 held | D-132, D-135, D-137 | in: 49 active + 55 deactivated (101,552.83); out 2,558 active |
| 38 settlement-prestart splits; no empty-period split left | D-137 | note `mvp:settlement-prestart:%` 38; `valid_to = valid_from` 0 (of 24,107 splits) |

All six match.

## Check 4: simplicity (added in stages 4–7)

- **No new table, column, migration or library since stage 3.** The last migration is 0010, and `package.json` is unchanged since `ba3ecf8`.
- **The three D-136 signals.**
  - `sublabelWithoutRule` (10 items) and `ruleRecipientIsRow` (0 items, a guard) are justified by M7 and M58 and the double-pay shape.
  - `twoRowsOneOwner` is information only, with 785 ISRC-months on 45 ISRC. It is noise on the sources page with no action attached (note 7).
  - The three state fields exist only for these signals: justified and small.
- **The two splits deletes:** justified, migration-only (finding 5).
- **Scripts.**
  - 9 TypeScript files (3,283 lines), 12 stdlib Python extractors and `pg.sh`.
  - The loader is one-off migration code and allowed by the goal (stage 4: "via API or script").
  - Its in-memory mirror of the splits checks (`lib.ts:125-160`: "Same checks as the splits module", "Mirror of splits.changeSplit") duplicates module rules. It only plans: every write is validated again by the facade. Acceptable for a one-off; do not grow it (note 6).
  - The Python half is the undocumented part (finding 3).

Nothing needs removal for acceptance.

## Findings

1. **should-fix: root `CLAUDE.md` overstates two facts.**
   - `CLAUDE.md:23` says "354 tests on 2026-11-03". The run at HEAD has 360: D-137 added G45, G46 and the deletes test.
   - `CLAUDE.md:49` says the `scripts/mvp` scripts "go through the facade". The exceptions are listed in check 1: the `normalise-dates` SQL, the two module deletes, the cached `artistIndex`, and the Python extractors reading PostgreSQL and ClickHouse.

   Required: set 360, and name the exceptions in one clause ("…through the facade, except `normalise-dates` (SQL, D-131), the two loader deletes (D-137) and the read-only Python extractors").
2. **should-fix: `01_big_picture.md` §5 and `05_doc_drift.md` lag D-136/D-137.**
   - 01 line 3 says "refreshed … (D-123…D-135)".
   - §5 says "stage 5 compares …; stage 6 is the verification (`14`). Stage 7 writes the report", and 15 is "written at the end of stage 7". By the goal and D-137, stage 5 is the verification (`14`) and stage 6 the rework. 15 now exists.
   - 05's row "HANDOVER demo sections" names D-131…D-134.

   Required: correct the stage labels and the ranges to D-137, and make the 15 sentence present tense.
3. **should-fix: the extraction stage is undocumented in the tracked guides.**
   - Recipe 9 says "Inputs live in git-ignored `data/mvp-load/`" and that all scripts "go through the facade". The JSON inputs are produced by the 12 tracked Python scripts.
   - The git-ignored `data/mvp-load/annex/README.md:4-5` and `echo8/README.md:3` say those scripts read "dumps in the session scratchpad". The annex and echo8 inputs therefore cannot be rebuilt from the repository alone. Only Main has a rebuild command (`main/README.md:3`).
   - No D-entry names Python as a tool of the project. It is stdlib only, so no library entry is needed, but a runtime is added.

   Required: one paragraph in recipe 9 (and a line in D-138 or the next entry):
   - the extractors, what each reads and which ones read the store directly;
   - the rebuild command where one exists;
   - the limit that the annex and echo8 dumps came from a session scratchpad, so the loaded database (or the data archive) is the record.
4. **should-fix: `03_decision_index.md:153` D-135 reads "in force · … 336 carve participations (55 deductions deactivated)".**
   - D-137 replaced its carve part: those 336 rows are deleted, and the SELECT finds 0.
   - Required: add "*refined by* D-137 (carves re-entered as 141 pool participations of net; the 336 deleted)", as the index does for D-126/D-130.
5. **note: `splits.deleteParticipations(ids)` deletes any participation by id, even one under an approved document.**
   - The loader-only rule lives in docs and in the caller's marker filter (`steps-main.ts:908`). Placement and documentation are right, and no route reaches it.
   - If a later change ever wires it to the API, it must first get a guard like `deleteEmptySplits` has. Better still, leave the migration deletes out of the API surface for good.
   - Nothing to do now. Recorded so that the next agent does not treat it as a general delete.
6. **note: the loader carries a mirror of module rules and patches a module method at run time.**
   - The mirror is `lib.ts:125-160`. The run-cached `owners.artistIndex` wrapper is `lib.ts:217-229`.
   - Both are in D-131 and process-local, and every write is still validated by the facade.
   - They are migration scaffolding. Do not reuse them in `src/`.
7. **note: `twoRowsOneOwner` (D-136) has 785 items on real data and is "information only".**
   - A signal with no action becomes noise on the sources page.
   - If the owner gives no use for it, reduce it to a count or remove it at the next touch of `reports.ts`. Not required for the MVP.
8. **note: D-entries out of numeric order** (D-134 before D-133, D-136 before D-135 in 97). This is harmless under append-only, and the index is ordered by topic. Keep numbering in order from now on.
9. **note: working tree.**
   - An untracked `owner_alloc.tsv` (1,729 lines of owner id / category / reason / account / amount) appeared in the repo root at 03:35, during this review. It is probably from a parallel council member.
   - It is real data and must not be committed. Whoever wrote it should move it to a scratchpad.
   - HEAD itself is clean and unpushed.
10. **note: process.** `docs/agents/reviews/` holds verdicts for stages 1–3 only. The goal asks for three "yes" per stage. Stages 4–6 were not reviewed separately, so this council's acceptance of stage 7 is in practice the acceptance of 4–6 as well. The coordinator should say so in the stage 7 record.
11. **note: a held-payout nickname** quoted in D-135 and D-137 (the third of the three held payouts) reads like a personal name rather than a stage name. Check it against the owner's registry. If it is a legal name, the append-only log cannot be edited: record the fact in the next entry and stop repeating it in new docs.

## Summary

The architecture is intact at the end of the MVP:
- the modules compute no money and do not import each other;
- the layer order is one list, and every layer is tested;
- the facade stores nothing, and no table, migration or library was added after stage 3;
- the loader writes through the facade except for three documented, migration-only paths;
- the decision log matches the database on every claim I checked.

There are no blockers. Findings 1–4 are documentation corrections that should land with the stage 7 record.

## Revision 2 (HEAD `6b53a3c`, D-138)

Revision 2: the verdict stays **yes**.
- Findings 1–4 are fixed:
  - `CLAUDE.md:23` says 361, and `:49` names the three bypasses and the Python extractors;
  - `01` §5 has the right stage labels and D-123…D-138, and `05:43` says D-131…D-138;
  - recipe 9 lists the extractors and says the annex/echo8 inputs cannot be rebuilt from the repo alone;
  - `03:153` reads "refined by D-137".
- Note 9 is closed: `owner_alloc.tsv` is gone.
- Note 11 is closed: `git grep` finds the nickname nowhere in HEAD. The edit of D-132 and D-135 in place is recorded as a privacy-only exception in D-138, and I accept it. The settlement participant's pseudonym is now read from the git-ignored `data/mvp-load/private_names.json` (`participations.py:6`).
- No regression:
  - D-138 changes no `src` file, and its loader change (`steps-stage6.ts`) goes through the same `ctx`/facade paths;
  - typecheck and lint are clean;
  - `REQUIRE_STACK=1 npm test` passes: 32 files, 361 tests;
  - `build:client` builds;
  - nothing is pushed.
- Working tree: the only change is `docs/agents/reviews/stage7_product.md`, edited by another reviewer.
