Verdict: no

# Frontend stage 6 review: architect (2026-11-03)

Scope: stage 6 (completeness and the final report) on `feature/fable-001` at `12e6e08` (D-139 … D-152). I read the
code and documents against `notes/goal_prompt_frontend.md` (stage 6 and the "Готово" line), `17_frontend_model.md`
§1 (R1–R8) and §7, my stage 3 verdict, the stage 4 walk, and D-150 … D-152. Code I read:
- frontend: `src/api/{coverage,client}.ts`, `api/queries/core.ts`, `lib/money.ts`, `components/grid/DataGrid.tsx`,
  `pages/work/{QueuePage,SignalsPage}.tsx`, `pages/work/actions/*`, `pages/owners/{OwnersPage,BalanceTab}.tsx`,
  `pages/catalog/{TracksPage,ReleasesPage}.tsx`, `pages/reference/{shared.tsx,splits/*,sources/SourceLinesPage.tsx}`,
  `tests/*`, `e2e/helpers.ts` and the `expectMoneyCalls` sites, `package.json`, root `eslint.config.js`;
- backend: `git diff a00ea1a -- facade/layers/ facade/balance.ts`, `git diff d19027e..HEAD` of `api/audit.ts`,
  `facade/{aggregates,calculation,period,queue,reports}.ts`, `api/operations.ts` (counted).

I ran `npm run typecheck` (exit 0), `npm run lint` (exit 0) and `npm test -w @erp/frontend` (11 files, 65 tests,
passed). I did not run e2e, the stack tests or any server. I wrote only this file. There is no personal data below.

The architecture side of the goal is met in the code. Every operation has a screen or a refusal, and every C reason
and signal has an action. R1–R8 hold, and their machine checks are now what D-139 promised. The money rules are
unchanged. My verdict is **no** for one reason only: the report `20_frontend_report.md` makes two claims the
repository contradicts (findings 1 and 2). Both are text fixes: one sentence in 20, and one appended D-entry. With
those two fixed, I would say yes without another code review.

## Checks against "Готово" and stage 6 (architecture side)

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | Every operation of `operations.ts` has a screen or a conscious refusal | met | I count 63 operations: 32 GET, 30 POST, 1 PATCH (`method:` entries, two of them on one line, `:145` and `:156`). `coverage.ts` has 63 keys: 60 on a page and 3 refused. `coverage.test.ts` asserts equality with `API_OPERATIONS` and the exact three refusals. It also checks that each route exists and that every page P1–P21 is covered, except P3 and P4, which are documented |
| 1a | The three refusals | sound | `/health` is a probe. `/reconciliation` is a strict subset of `/overview`, so a second calculation would break R2. `/tracks/:isrc/explain` (4.5 MB) is replaced by `money` and `breakdown`. Both are still called by `/dev/states` (`StatesPage.tsx:75,95`), which ships in the bundle (note 8) |
| 1b | The two "lookup" uses | acceptable | `GET /owners` (about 1.1 k rows, a reference list, no calculation) gives the names by id in rows that carry only an id. `GET /tracks` (26 k rows) is fetched only when `NoteDialog` opens without a `trackId` (`dialogs.tsx:689`, `enabled: !props.trackId`). These are honest reference reads, but the second is wasteful (note 6) |
| 2 | Every C reason and every signal has an action on a screen | met | `REASON_ACTIONS` covers 10 of 10 (`no_isrc` is information, ⚠ D-035). `SIGNAL_ACTIONS` covers 11 of 11 (`twoRowsOneOwner` is information). The test pins the key sets to `C_REASONS` and `signalsSchema` and checks that each named dialog is an exported function. The pages use the table only for the information rows, so the table documents the wiring but does not drive it (note 5) |
| 3 | Every open item of `15` §3 is visible | met | `OPEN_QUESTIONS` has 14 ids. `open-questions.test.ts` pins them. P3 links each one |
| 4 | Every library has its D-entry with an exact version | met | `package.json` pins every dependency exactly. The versions match D-139 (HeroUI 3.2.7, Tailwind 4.3.4, TanStack 5.105.3, AG Grid 36.2.0, Heroicons 2.2.0, router 7.18.5, Playwright 1.64.1), D-144 (`react-aria-components` 1.22.1) and D-151 (react, vite, the plugin, vitest and zod pinned). The lock file resolves `@vitejs/plugin-react` to 6.1.2, but D-139 "Checked" says 6.2.1 (note 9) |
| 5 | R1: no money arithmetic | holds | Lint is clean. The R1 block bans `Number(`/`Number.*`, `parseFloat`, `parseInt`, unary `+`, `Math.*`, `.toFixed`, `BigInt(`, `Intl.NumberFormat`, and `-` `*` `/` `-=` `*=` `/=` on money-named operands. There are three overrides, each for one file. `compareDecimal` splits each string into sign, integer digits and fraction, and compares lengths and then text; it creates no number and does no arithmetic, so it is comparison, which R1 allows. It is used on every money column (19 sites), and the 22 unit tests pin it. `BigInt` in `SourceLinesPage.tsx:210` compares a line count with the page end, which is acceptable. `toInt` (`reference/shared.tsx:40`) is a digit fold used only for `limit`/`offset`, which is acceptable; its override lifts `parseInt`, which it does not use (note 9). The payouts view orders by `payout.amountCents`, an API integer, with `>` |
| 6 | R2: one money call per screen | holds | `expectMoneyCalls(page, 1)` runs after `openAs`+`settled` on P1, P2, P5, P6, P8, P9, P10, P14, P21 (`10`, `11`, `12`×2, `14`, `20`, `21`, `24`×2). `MONEY_PATH` lists every calculating endpoint. P7 `/releases` no longer calculates (D-150) |
| 7 | R3: keys in routes | holds | `routes-no-names.test.ts`. Params are only `isrc`, `upc`, `id`, `reason`, `name` |
| 8 | R4: the backend decides | holds | The pay button follows `payout.allowed`/`reason`. The negative banner reads `total.payableNegative` (`BalanceTab.tsx:54`, D-150). `CloseRuleDialog` no longer picks the rule: the operator chooses, and the client preselects only by date when exactly one candidate is in force (`rule-dialogs.tsx:53-54`). The read-only replace for the `q11`/`r1` groups follows the API field `assumptionBasis`. There is no percent sum in the split dialogs |
| 9 | R5: trace and confirmation | holds | `X-Operator` is sent on every write. The audit summary no longer stores `reason` (`api/audit.ts`, D-150). A failed record now answers 2xx with `X-Audit: failed`. The client never reads that header, so the screen does not show a lost trace (note 3) |
| 10 | R6: one client, types from `@erp/shared` | holds | There is one `fetch` (`client.ts:58`). `free(...)` and `z.unknown()` are gone from `operations.ts` and `src`. Page types are all `z.output<…>` or indexed shared types. The only local `z.object` is the `/dev/echo` fixture. `no-dto.test.ts` still scans only `src/api/` (my stage 3 finding 2 asked for `src/pages`); the code is clean, but the guard is narrower than the rule |
| 11 | R7 / R8 | holds | One dialog per action, except the two pairs D-151 records. The privacy test covers `src`, `e2e`, `tests` and the seed |
| 12 | Money rules D-123 … D-138 unchanged | holds | `git diff a00ea1a -- facade/layers/`: D-152 adds `salesMonth: unit.salesMonth` at the three `Shortfall` creation sites (`carve.ts` ×2, `off-the-top.ts`) and the field in `types.ts`. It is a shape change only: no amount, condition or order changed, and the consumers (`reports.ts:94`, `aggregates.ts:203,214`) only pass it through. `balance.ts`: the optional per-owner `index` runs the same loops in calculation order, `payableNegative` is a flag, and `ownerIndex()` is new. The rest of the backend diff since stage 3 is `period.ts` (moved predicates), the `/releases` single pass (byte-identical per D-150), the unfunded recipient fields, and audit |
| 13 | Boundaries | holds | `audit` is in `boundaries.test.ts:7`. The cycle `calculation.ts` ↔ `queue.ts` is gone (both import the leaf `period.ts`) |
| 14 | docs/agents and the index updated | partly | The index header reads D-001 … D-152, and D-139 … D-152 each have a line. The guides contain stale statements (finding 4) |
| 15 | Report 20: closed, open, assumptions | **not** | Findings 1 and 2 |

## My stage 3 findings at HEAD

| # | Stage 3 finding | Status | Evidence |
|---|---|---|---|
| 1 | Money columns sorted as text | fixed | `compareDecimal` on every money column (Tracks `:167-170`, Releases `:72`, Queue, Signals, Owners, Sources, Splits), with tests |
| 2 | Unparsed responses, duplicate schemas | fixed (guard partly) | `free` and `z.unknown` removed, `possibleDuplicateDetailsSchema` is shared, and the `SourcesPage` cast is gone. `no-dto.test.ts` is not widened to `src/pages` |
| 3 | Free text in the audit; 500 after a commit | fixed (backend) | `reason` dropped, with a test; `X-Audit: failed` replaces the 500. The client does not show it (note 3) |
| 4 | `CloseRuleDialog` chose the rule | fixed | The operator picks (`close-rule-pick`), with a date-based preselect. The signal still carries no `ruleId` |
| 5 | Assign-by-create skipped the duplicate dialog | fixed | One `DuplicateDialog`, also used from the assign dialog |
| 6 | Dialogs duplicated | mostly fixed | One component per action. Map writer and attach file each remain twice (recorded in D-151 and in 20 §4.4) |
| 7 | eslint narrower than D-139 | fixed | Full R1 set with per-file overrides; `no-floating-promises` for `src`. `toInt` was not renamed (note 9) |
| 8 | Request counts in 3 specs only | fixed | `expectMoneyCalls` on every money page (check 6) |
| 9 | No lock against two e2e runs | partly | A documented manual `mkdir data/test-tmp/e2e.lock` (frontend `CLAUDE.md`, root `CLAUDE.md`, `05`). Neither `seed.ts` nor `start.sh` enforces it |
| 10 | Dead code | partly | Unused client functions and testing-library/jsdom removed. `/dev/states` ships, and with it the client functions and `MONEY_KEYS` entries of the two refused operations (note 8) |
| 11 | Index header, pins, zod | fixed | Header, exact pins and declared `zod`. The frontend `CLAUDE.md` still says "zod from `@erp/shared`" (finding 4) |
| 12 | Import cycle | fixed | `facade/period.ts` |
| 13 | `payableNegative` | fixed | In `balance.total` and the payables items; read by `BalanceTab` |
| 14 | P17 without `ourShareByLabel`, not recorded | not | D-148 still does not record the deviation. P1 shows the value per row, so this costs the operator nothing |
| 15 | Dev server `host: true` with an external host | open, disclosed | `vite.config.ts:13-14` unchanged. 20 §4.5 states it for the owner, which is the right handling |

## Findings

1. **blocker (false claim in 20 §1): "the diff of `facade/layers/` is empty".** It is not. D-152 changed `types.ts`,
   `carve.ts` (twice) and `off-the-top.ts`, and D-152's own text says so. The substance of the sentence, "no money rule
   changed", is true, because the change is shape only (check 12). But a reader who runs the diff the report invites
   will find four files and lose trust in the rest. Reword it to: "the only change in `facade/layers/` is the
   `salesMonth` field on `Shortfall` (D-152, shape only); no amount, condition or order changed".
2. **blocker (false claim in 20 §5; the goal's rule on open questions): "each marked 'допущение' in its D-entry".**
   The goal says an open question that the sources do not answer becomes "D-запись с пометкой «допущение»". At HEAD:

   | Assumption | Entry | Marked «допущение» in the entry? |
   |---|---|---|
   | A1 | D-140 | yes |
   | A2 | D-139 | yes |
   | A4, A7, A8 | D-144 | yes |
   | A3, A6 | D-143 | no: called "Assumptions of `18`", in English |
   | A5 | D-147 | no: not called an assumption |
   | A9 | D-146 | no: only "A9 of `18` §6 stands" |
   | the `X-Audit: failed` row | D-150 | no: a plain decision |

   Old entries cannot be edited, so append one D-153 that marks A3, A5, A6, A9 and the D-150 audit-failure behaviour as
   «допущение», with the reason for each (`18` §6 has them). Index it. Then the table in 20 §5 is true as written.
3. **should-fix (R5, D-150): the operator never sees a lost trace.** The backend answers 2xx with `X-Audit: failed`,
   but `client.ts` never reads response headers. The write is reported as done, which is correct. The fact that it has
   no trace, though, exists only in a server log, while the goal says "каждое действие оставляет след". Read the
   header in `call()` for writes and add a sentence to the success toast ("действие выполнено, след не сохранён"),
   with no retry. This is a few lines, and it closes the loop D-150 opened.
4. **should-fix (guides): stale statements.**
   - Root `CLAUDE.md` "Architecture in one screen" and `01_big_picture.md` §3 (the module table) do not list the
     `audit` module (D-140). Neither says that every write to the API needs `X-Operator`, otherwise 400
     `operator_required`, which bites anyone who scripts against the API. The root file also lists none of the new facade
     files (`queue`, `aggregates`, `payout-gate`, `search`, `audit`, `period`) or the new routes (`/overview`, `/queue`,
     `/search`, `/audit`).
   - `05_doc_drift.md:61` says that `04_recipes.md` quotes 360/361 tests. `04:10` now says 406 + 65.
   - `packages/frontend/CLAUDE.md` says "zod from `@erp/shared`", but `zod` 4.6.7 is a direct dependency since D-151.
   - `api/queries/core.ts:9` still says "endpoints that do not exist yet (steps 3.2/3.3)". D-152 says that this wording
     was removed.
   - The `03` index line for D-140 says "in force" without noting that D-150 changed its failure path (no 500).
5. **note (action table):** `action-table.ts` is a declaration. The test proves only that the named dialogs exist, not
   that the page opens them for that row. One drift already exists: `SIGNAL_ACTIONS.assumptions` names
   `ReplaceDocumentDialog`, but the P21 row is a link to `/queue/assumption` (`SignalsPage.tsx:429`). That is
   reasonable, so record it in the table as `link` (or `also`), or have the pages pick the dialog from the table.
6. **note (lookups):** `NoteDialog` fetches 26 k tracks to turn the picked ISRC into a track id. Add `id` to the
   track kind of `GET /search`, or accept an ISRC in the note endpoint, and `GET /tracks` leaves the screens.
7. **note (report figures):** 20 §6 says "406 backend tests in 36 files". I count 38 `*.test.ts` files under
   `packages/backend/tests` (I could not run them). "16–20 s" for the old overview has no source in the stage 4 walk
   (stage 1 measured 20 s). "The 21 pages" lists 20 pages plus the payouts view; that is right by id (P4 is a view)
   but reads oddly. None of these changes a conclusion.
8. **note (`/dev/states`):** it ships in the production bundle, and with it the only callers of the two refused
   operations (`reconciliation`, `explain`) and their `MONEY_KEYS`. The comment in `coverage.ts` says a refusal means
   "no screen calls the operation". Either gate the route on `import.meta.env.DEV` plus an e2e flag, or say in the
   refusal text that the fixture page calls it.
9. **note (cosmetics):**
   - `carve.ts:106`: the added `salesMonth` line is indented two spaces less than its siblings.
   - The override for `reference/shared.tsx` lifts `parseInt`, which `toInt` does not use. Either use `parseInt` there
     or drop the override.
   - D-139 "Checked" says `@vitejs/plugin-react` 6.2.1, but the pin is 6.1.2. Mention it in D-153.
10. **note (P17):** record in D-153 that P17 omits `ourShareByLabel` and that P1 shows it (my stage 3 note 14).

## What to hand over to the operator

- After findings 1 and 2 (text only), the architecture side is ready. The client computes nothing, gates are API
  fields, the 63 operations are accounted for, and every reason and signal leads to a dialog or to a documented
  read-only state.
- Before a real-data session with writes: tell the owner about the dev server's `host: true` and the external host
  name, because there is no login and the write API is reachable (20 §4.5). Also fix finding 3, so that a lost trace
  is visible on the screen, not only in the log.
- For the next agent: findings 4 and 5. The root `CLAUDE.md` is what a new agent reads first, and today it misses the
  audit module and the `X-Operator` requirement.
- Known and accepted: the 4 s synchronous fold that serialises money calls (A2), the client-side lists up to 26 k rows
  (A4), the two remaining duplicate dialog pairs, and the manual e2e lock.
