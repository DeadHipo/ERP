Verdict: yes

# Frontend stage 3 review: architect (2026-11-03)

Scope: the development of stage 3 on `feature/fable-001` at `d19027e` (steps 3.0–3.9, D-139 … D-149). I read it against
`notes/goal_prompt_frontend.md`, `17_frontend_model.md` (R1–R8 §1, pages §3, actions §6, endpoints §7, states §8,
harness §9) and `18_frontend_plan.md` §2. Code I read:
- frontend: `packages/frontend/{CLAUDE.md,package.json,vite.config.ts,vitest.config.ts,playwright.config.ts}`, all of
  `src/api/**`, `components/**`, the pages under `pages/{work,catalog,owners,operations,reference}`, `routes/paths.ts`,
  and `tests/*`. I skimmed `e2e/**`.
- root and backend: the root `eslint.config.js`; the backend diff `a00ea1a..HEAD` of `facade/{balance,calculation,
  payouts,context,aggregates,queue,payout-gate,search,audit}.ts`, `modules/audit/**`, `api/audit.ts`,
  `connect-sources.ts` and `shared/private-stores.ts`; `scripts/e2e/{seed.ts,start.sh}`. I skimmed the backend tests.

I ran `npm run typecheck` (exit 0), `npm run lint` (exit 0) and `npm test -w @erp/frontend` (10 files, 43 tests,
passed). I did not run e2e, the stack tests or any server. This is the only file I wrote. There is no personal data
below.

The build follows the design. I found no money arithmetic in the client and no change to any layer or money rule.
`cItems` is the one source of C for both the queue and `reconcile()`. `payoutGate` is the one decision behind the
button and the screen. The audit is a proper module, the API hook reaches it only through the facade, and
`connectSources` now uses the ClickHouse database name. Every page makes at most one money call on load. None of the
findings below breaks a rule badly enough to stop stage 4. Several should be fixed before the stage 4 real-data walk,
because the operator would hit them: sorting by money (1), the duplicate dialog (5), free text in the audit (3) and
the close-rule choice (4).

## What I checked

| # | Check | Result |
|---|---|---|
| 1 | R1, no arithmetic on money | Holds. grep finds no `Number(`, `parseFloat`, `toFixed`, `Math.`, unary `+` or decimal library in `src`. `centsToText` (`owners/components/cents.ts`) slices strings. `formatMoney` is the one formatter. Four soft spots: `toInt` (`reference/shared.tsx:33`) is a hand-written `Number`; `BigInt` on `total.keys` (`SourceLinesPage.tsx:210`) is a count, so it is acceptable; the eslint block lacks two promised bans (finding 7); money sorts as text (finding 1) |
| 2 | R1/R4, gates decided by the client | The payout button uses `payout.allowed` and shows `payout.reason` (`BalanceTab.tsx:210-211`). `isPayableHidden` compares `payableShown !== payable` (`BalanceTab.tsx:19`), two fields of one response; that is acceptable (note 13). The payouts view sorts by `amountCents`, an integer. One client rule remains: `CloseRuleDialog` picks the rule itself (finding 4) |
| 3 | R3, routes carry only keys | Holds. `routes/paths.ts` is the one list, and `routes-no-names.test.ts` guards it |
| 4 | R5/R6, one `call()`, `schema.parse`, `X-Operator` | Holds. `client.ts:39-74` is the only `fetch`. It sends the URI-encoded header on every non-GET, refuses an empty operator, and returns `contract_mismatch` when a response fails to parse. Gaps: three operations are parsed with `z.unknown()`, and two pages declare their own response schemas (finding 2) |
| 5 | R5, confirmation on every irreversible action of 17 §6 | Holds. Each of these goes through `ConfirmDialog`: approve, confirm split, contract, replace assumption, merge, split change and buy-out, close participation, close rule, pay, advance/deduction/credit, deactivate, return. I traced every write call in `pages/**` |
| 6 | Money rules unchanged | Holds. `git diff a00ea1a -- facade/layers/` is empty. In `balance.ts` only an optional `index` argument and `ownerIndex()` were added, and the loops are unchanged (`balance.ts:125-129, 165, 231, 400-417`). `reconcile()` now adds C from `cItems()`, which applies the same conditions per allocation, label share and publishing line as before (`calculation.ts:344-363`, `queue.ts:29-74`). The `setImmediate` yield touches no money |
| 7 | `payoutGate` and `createPayout` share one path | Holds. `createPayout` throws by `balance.payout.reason` (`payouts.ts:111-136`). `gateOf()` (`context.ts:169-176`) builds the same object for the balance and for `ownerPayables` (`aggregates.ts:99`). The check order and the error codes are unchanged |
| 8 | Audit module and API hook | Mostly holds. `modules/audit/{schema,repository,service,index}.ts` has its own schema, its SQL is in the repository, and it is listed in `boundaries.test.ts:7`. The hook calls `facade.recordAction` and opens no module, and it awaits the record before it sends the response. But the summary stores free text (finding 3) |
| 9 | `connectSources` and the ClickHouse name | Holds. `clickHouseDatabaseNames(env)` validates the name and passes it with `<name>_stage` (`connect-sources.ts:8-12, 30`) |
| 10 | One money call per screen | Holds for every page of 17 §3 (table below). P17 dropped `ourShareByLabel` (note 14). Only 3 specs count requests (finding 8) |
| 11 | Harness | Mostly holds. Private stores live in `shared/private-stores.ts`. `start.sh` checks Docker, seeds, builds and serves on :3100 with threshold 0. Teardown drops the stores unless `E2E_KEEP=1`. vitest runs only `tests/**`, and `e2e/` has its own tsconfig. `.seed-keys.json` is git-ignored. Two runs at once are not locked out (finding 9) |
| 12 | Simplicity | Many action dialogs are written two or three times (finding 6). There is dead client code (finding 10). The largest file is `pages/work/actions/dialogs.tsx` (893 lines) |
| 13 | D-entries and the guide | Every step has its entry (D-139…D-149) and its index line. The index header is stale. The version claims in `package.json` and `CLAUDE.md` do not quite match (finding 11) |

Money calls on load (from the pages and `api/queries/*`):

| Page | Money calls on load | Other calls |
|---|---|---|
| P1 `/` | `overview` | — |
| P2 `/queue` | `overview` (the cache key it shares with P1) | — |
| P2 `/queue/:reason` | `queue` (a new one per page, filter or `limit`) | — |
| P21 | `signals?limit=500` | — |
| P3 | none | — |
| P5 | `tracks/summary` | — |
| P6 | `tracks/:isrc/money` | ClickHouse `breakdown` when a month is expanded; reference lists on the tabs |
| P7 | `releases` (in `MONEY_KEYS`, no calculation) | — |
| P8 | `releases/:upc` | — |
| P9 | `owners/payables` | — |
| P10 | `balance`, shared by the tabs | `owners/:id`; operations and audit on their tabs |
| P11, P12 | none | — |
| P13 | none | — |
| P14 | `documents/:id/uses` | — |
| P15–P20 | none | — |

The approve dialog adds one `uses` call when it opens, as 17 §6 designed.

## Findings

1. **should-fix (R2/R7, P5 and P7): money columns sort as text.** `TracksPage.tsx:160-163` (net, B, C, ours) and
   `ReleasesPage.tsx:66-70` (net) return the decimal string from `valueGetter` and leave `sortable` at the
   `DataGrid` default (`DataGrid.tsx:10`). AG Grid's default comparator compares strings, so `"9.50"` sorts above
   `"10.00"` and negative amounts land in the wrong place. 17 §4 sends P1's B and ours cells to `/tracks?account&month`
   "sorted by B or ours", which is exactly the use that breaks. The other pages switched money sorting off
   (`OwnersPage.tsx:84`, `SignalsPage.tsx:111`, `QueuePage.tsx:291`), so behaviour is also inconsistent across grids.

   Fix it one of two ways:
   - one `compareDecimalText(a, b)` in `lib/money.ts`: sign, then integer length, then lexical. It compares text and
     does no arithmetic. Test it next to `money.test.ts` and use it from one `moneyColumn()` helper in `components/grid`;
   - or have the API return the rows in the order the operator needs.

2. **should-fix (R6): three responses are not parsed, and two pages declare their own schemas.**
   - `client.ts:77` `free = z.unknown()` is used for `POST /sources/believe` (`:172`), `POST /publishing/writers/:norm/map`
     (`:179`) and `GET …/snapshot` (`:213`; dead, see finding 10). `SourcesPage.tsx:96` then casts
     `r as { fileName?: string }`, which is a hand-written response type.
   - `CreateOwnerDialog.tsx:15-18` and `CreateArtistDialog.tsx:15-18` each declare the same zod schema for the
     `possible_duplicate` details.
   - The backend declares the first two operations as `free(...)` (`operations.ts:425` and the map entry).

   Give them response schemas in `api-responses.ts` (`sourceFileSchema` already exists). Move the duplicate details
   schema to `@erp/shared`. Widen `no-dto.test.ts` from `src/api/` to every `z.object` declared under `src/pages/`.
3. **should-fix (R5/R8, D-140): the audit summary stores free text.** `api/audit.ts:25-36` copies `reason` into the
   summary. In `deactivateBody` and `mergeOwnersBody` that field is free text the operator types
   (`api-schemas.ts:151, 157`). D-140 and 17 N16 both say "never names, titles, comments". Drop `reason` from
   `SUMMARY_FIELDS`, or keep it only when it is one of the enums. Add a test that a free-text field never reaches
   `audit.actions.summary`.

   Related: when the record fails after the handler has committed, the hook answers 500 `audit_failed`
   (`audit.ts:107-114`). The operator sees an error for a write that happened, and pressing again can duplicate an
   advance. Put the code in the danger toast's text ("действие выполнено, след не сохранён"). Do not offer a retry.
4. **should-fix (R4): `CloseRuleDialog` chooses the rule on the client.** `pages/work/actions/dialogs.tsx:544-549`
   takes the first open label rule (`validTo === null`) whose recipient is the artist, across every label. The
   `ruleRecipientIsRow` signal carries no rule id (`api-responses.ts:377-379`). If the artist receives rules from two
   labels, or a rule in force at the month was closed later, the dialog shows and closes the wrong rule. Add `ruleId`
   (and `labelId`) to the signal row and pass it into the dialog.

   A milder case of the same thing: `splitAt()` (`catalog/track/types.ts:17-21`) works out which split a change
   closes, but only for the dialog text; the backend does the change. Keep it, but take the in-force split from the
   `money` response if the API ever exposes it.
5. **should-fix (17 §6): assigning an owner by creating one skips the duplicate dialog.** `AssignOwnerDialog`
   (`dialogs.tsx:345-351`) calls `owners.create` without handling 409 `possible_duplicate`. The operator gets an error
   toast and no "тот же / новый" choice. `CreateOwnerDialog` already handles it. Reuse that component, or extract its
   duplicate step (see finding 6).
6. **should-fix (R7, simplicity): action dialogs exist two or three times.**
   - create contract: `work/actions/dialogs.tsx:55`, `owners/components/ContractDialog.tsx`,
     `reference/documents/DocumentDialogs.tsx:151`;
   - merge: `dialogs.tsx:103` and `owners/components/MergeDialog.tsx`;
   - confirm split: `dialogs.tsx:154` and `DocumentDialogs.tsx:98`;
   - create document and attach: `DocumentDialogs.tsx:23,66`, `owners/DocumentsTab.tsx:104,120`, `DocumentStep.tsx`;
   - close label rule: two components both named `CloseRuleDialog` (`dialogs.tsx:544`, `labels/LabelPage.tsx:48`);
   - map writer: `dialogs.tsx:624` and `publishing/PublishingPage.tsx:28`;
   - publishing terms: `dialogs.tsx:662` and `PublishingPage.tsx:56`;
   - create split: `dialogs.tsx:714`, `catalog/track/SplitDialogs.tsx:115`, `CreateSplitForArtistDialog.tsx`;
   - participation close and re-create: `dialogs.tsx:785` and `ParticipationDialogs.tsx`;
   - create track and create label: also twice each;
   - the duplicate list: in both create dialogs.

   This is the residue of the parallel steps 3.6, 3.7 and 3.8. Each copy has its own confirmation text and its own
   test hooks, so a fix lands in one copy only. Finding 5 is an example. Fold them into one folder of action
   dialogs, one per operation, parameterised by what the caller already knows. `dialogs.tsx` (893 lines) then splits
   by domain. Do it before stage 5 adds more actions.
7. **should-fix (R1 check, D-139): the eslint block is narrower than D-139 says.** D-139 and 17 §1 promise a ban on
   "arithmetic on money-named identifiers" and say `formatMoney` is the only caller of `toFixed` /
   `Intl.NumberFormat`. Neither is in `eslint.config.js:37-60`. `BigInt` is not banned either.
   - `toInt` (`reference/shared.tsx:33`, 10 uses) rebuilds `Number` with `reduce` to avoid the ban. That is honest
     for paging, but it is exactly the per-file allow-list 17 §1 asked for. Rename it `pagingInt` and allow-list that
     file and `SourceLinesPage.tsx:210` (`BigInt`).
   - Add `BigInt`, `.toFixed` and `Intl.NumberFormat` outside `lib/money.ts` to `no-restricted-syntax`.
   - The frontend also lacks the type-aware `no-floating-promises` that the backend has (`eslint.config.js:21-27`).
     `void query.refetch()` is fine, but a forgotten `await` inside an `async` `useAction` would go unseen.
8. **should-fix (R2 check): request counting covers 3 specs, not every money page.** `page.on('request')` is only in
   `payout.spec.ts:43`, `track.spec.ts:254` and `operations.spec.ts:73,145`. 17 §1 R2 says "the e2e specs count the
   requests to money endpoints per page". Add one helper in `e2e/helpers.ts` (`expectMoneyCalls(page, path, 1)`) and
   call it once per page in `overview`, `queue`, `signals`, `owner`, `documents`, `release` and `tracks`.
9. **note (harness): no lock against two runs at once.** The store name is fixed (`e2e`) and `seed.ts` drops first
   (`createPrivateStores(name, { dropFirst: true })`). Playwright refuses a second server on :3100, but only once the
   first API is listening. A second `npm run e2e` started while the first is still seeding, or a manual
   `seed.ts e2e`, drops the first run's databases with `WITH (FORCE)`. Two council members share this stack today.
   Add an advisory lock in `seed.ts` (`pg_try_advisory_lock` on a fixed key, refused with a message), or a name from
   `E2E_NAME`.
10. **note (dead code):**
    - `client.ts:202-214` `settlements.operations` and `settlements.snapshot` (the latter with `z.unknown()`) are
      unused, because `api/money.ts` has the parsed versions.
    - `reports.reconciliation` and `tracks.explain` are used only by `/dev/states`.
    - `@testing-library/react`, `@testing-library/jest-dom` and `jsdom` are unused (`vitest.config.ts` runs in `node`).
    - `/dev/states` ships in the production bundle. Keep it if the e2e needs it, but leave it out of `coverage.ts`
      as a page.
    - `NoteDialog` loads the whole `GET /tracks` (26 k rows) when it gets no `trackId` (`dialogs.tsx:868`). Its only
      caller already has one.
11. **note (D-entries and the guide):**
    - The header of `03_decision_index.md:1` still reads "D-001 … D-138".
    - `packages/frontend/CLAUDE.md` says "versions pinned exactly in `package.json`", but `react`, `react-dom`, `vite`,
      `vitest` and the `@types` packages use `^` ranges. D-139 names exact versions only for the new libraries, so
      either pin these or reword the guide.
    - `zod` is imported directly by the frontend (`client.ts:1`, the two create dialogs) but is a dependency of
      `@erp/shared` only, so it works by hoisting. Declare it, or import `z` through `@erp/shared`.
    - `react-aria-components` 1.22.1 is pinned in D-144, not in D-139. That is fine as recorded.
    - Otherwise the guide matches the code: pages, hooks, `useAction`, `MONEY_KEYS`, `coverage.ts` and `paths.ts`.
12. **note (backend):** `calculation.ts:28` imports `cItems` from `queue.ts`, which imports from `calculation.ts`.
    The cycle works because only functions are used at call time, but the next top-level constant in `queue.ts` would
    break it. Move `unitInPeriod`, `pubInPeriod` and the types to a small `period.ts`, or put `cItems` in
    `calculation.ts`. Separately, `ownerPayables` reads operations in a second snapshot after `calculate()`
    (`aggregates.ts:72-76`). `balanceWithFiles` does the same, so this is not new.
13. **note (R4):** `isPayableHidden` relies on `Decimal.max(payable, 0)` returning the same instance, and so the same
    string, when payable ≥ 0 (`balance.ts:376`). That holds today. A field `payableNegative: boolean` would make the
    gate explicit, and the review target would be a field, not a comparison.
14. **note (17 §3 P17):** the labels page does not show `ourShareByLabel` from the overview, as 17 designed. That
    saves a recalculation, and P1 shows it per row (`OverviewPage.tsx:218`), but D-148 does not record the
    deviation. Record it in D-148, or link the label card to the overview.
15. **note (outside stage 3, `dbd285a` Init):** `vite.config.ts` sets `host: true` and `allowedHosts` to an external
    KeenDNS name, so the dev server proxies the unauthenticated write API to the outside network. `X-Operator` is a
    trace, not a login (17 §10). Flag it for the owner before any real-data session runs through that host.

## Recommendations for stages 4–6

- **Stage 4 (real data walk):**
  - Fix 1, 4 and 5 first; the operator meets them in the first hour.
  - Measure what the real data costs: one `GET /queue/:reason` per page click (7–10 s each), the `/owners/payables`
    payload for 1.1 k owners, and `/tracks/summary` for 26 k rows (17 §7 asked for this in 3.3a; check that D-142 has
    the numbers).
  - If a queue page click is too slow, return all groups of one reason and page on the client, as P5 does.
- **Stage 5 (action completeness):**
  - Consolidate the dialogs (6) before adding any action.
  - Make `coverage.test.ts` also assert that every action of 17 §6 marked "confirm: yes" opens `ConfirmDialog`: an
    action table like `action-table.ts`, keyed by operation.
  - Close 2 and 3 in the backend contract (schemas for the `free` responses, a privacy test on the audit summary).
- **Stage 6 (rules as checks):**
  - Widen the R1 lint (7), the R6 test to `src/pages` (2) and the R2 request counts (8). Then each of R1–R8 has a
    machine check that matches what D-139 promises.
  - Remove the dead code (10) and add the seed lock (9).
