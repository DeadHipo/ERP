Verdict: yes

# Frontend stage 2 review: architect (2026-11-03)

Scope: `docs/agents/17_frontend_model.md` (203 lines), `18_frontend_plan.md` (99), `19_golden_screens.md` (456), all
untracked on `feature/fable-001` at `7193e37`. I read them against `notes/goal_prompt_frontend.md`, the accepted
`16_frontend_jobs.md` and the backend code they build on: `facade/{calculation,balance,reports,context,payouts,splits}.ts`,
`api/{app,http,operations}.ts`, `routes/*`, `modules/sources/{columnar,service,believe-format}.ts`, `connect-sources.ts`,
`shared/identifiers.ts`, `tests/{boundaries,api-contract,rules-coverage}.test.ts`, `tests/helpers/sources-stack.ts`, and
the frontend's `SourcesPage.tsx`. Read-only: no script, server or database was run. This is the only file I wrote. No
personal data below.

The design is sound and buildable. None of N1–N18 needs a money-rule change (D-123…D-138). Every endpoint aggregates
one `calculate()` or reads module lists, and composition stays in the facade. Nothing below would make stage 3 build
the wrong product. Several should-fix items would cost stage 3 a red build, a wrong number or a broken harness, so fold
them into D-139…D-141 before or at the step that touches them.

## What I checked

| # | Check | Result |
|---|---|---|
| 1 | 17 §1 implements the goal's idea | Yes. All eight points of the idea are there: computes nothing, money as strings with the exact value on hover, the backend decides, ISRC/UPC keys, the operator trace, confirmations, types from `@erp/shared`, one client. Enforceability is uneven (finding 9). The trace header breaks on Cyrillic names (finding 4) |
| 2 | N1–N18 vs money rules | No rule changes. G48/G49 pin existing balance behaviour (`balance.ts:87-105`, `:336`), which is allowed. The `setImmediate` yield is non-money if it is placed after all reads |
| 3 | Module / facade / API boundaries | Held. The audit hook calls `facade.recordAction()`. `boundaries.test.ts:34-38` forbids only `open*Module` in `api/`, so the hook passes. Two gaps: where the audit SQL lives (finding 5), and search across two modules (finding 12) |
| 4 | `ownerBalances(calc, ops)` keeps `ownerBalance()` exact | Feasible if both use one code path over a per-owner index that keeps `calc.units` order (finding 3). `opDocIds()` is not mentioned (finding 3) |
| 5 | `signalsFrom(calc)` is a safe refactor | Yes: `signals()` is `calculate()` plus pure folding plus four extra reads (`reports.ts:49-202`). The `/signals` shape change breaks the old page (finding 6) |
| 6 | `columnar.breakdown(isrc, month)` vs the sources rules | Fits: a `reporting_month` predicate on `rows` with `file_id IN` and the existing non-colliding aliases (`columnar.ts:250-296`). **N8's `believe.pairs` does not fit** (finding 2) |
| 7 | e2e harness | The design is right: private stores, synthetic keys, one account per case, threshold 0. **The API process ignores the private ClickHouse name** (finding 1). The ISRC pattern is valid for `assertIsrc`, but 17 §9 still names the invalid one (finding 13) |
| 8 | Plan order, file ownership, D-entries | Two parallel pairs share files (finding 7). D-139 supersedes all of D-007 although most of D-007 stays (finding 14) |
| 9 | Simplicity | 18 endpoints can become 15 (finding 10). N5's server paging conflicts with "one money call" (finding 8) |
| 10 | What stage 3 would discover | Labels for id-only lists, URL state of grid filters, the error envelope, the ⚠ id table (finding 11) |

## Findings

1. **should-fix (3.1, harness): the API cannot be pointed at a private ClickHouse database.** `connectSources` builds
   `createBelieveColumnar(ch)` with no names (`connect-sources.ts:22`), and the columnar defaults to `believe` /
   `believe_stage` (`columnar.ts:111-114`). Every query is fully qualified (`${DB}.rows`). `CLICKHOUSE_DATABASE` only
   changes the client's default database, which nothing uses. So the API that `start.sh` launches with
   `CLICKHOUSE_DATABASE=believe_<name>` (17 §9) would:
   - read the dev `believe.rows`, filtered by the private registry's file ids, so every money screen is empty;
   - land an e2e upload (S-sources) in the dev `believe.rows`, which `drop()` never removes.

   The fix is non-money: `connectSources` passes `{ database: CLICKHOUSE_DATABASE, stageDatabase:
   CLICKHOUSE_STAGE_DATABASE ?? `${CLICKHOUSE_DATABASE}_stage` }`. 3.1 needs a test that the API reads the database
   named in the env. The same gap makes the claim in D-121 that "a data set is switched with … `CLICKHOUSE_DATABASE`"
   untrue today (`97`:1625). Record that in D-140.
2. **should-fix (N8, N11): `believe.pairs` has no `file_id`** (`migrations/clickhouse/0001_believe.sql:115-122`). It
   sums every row ever inserted, including files that are not `loaded`. That breaks the module rule "a file that is
   not `loaded` must never count" (`modules/sources/CLAUDE.md`). N8's net per UPC and N11's `isrcsWithoutSplit` must
   read `rows` or `units` with `file_id IN (registry.loaded())`, like `pairNames` does (`columnar.ts:300-330`).
   N11's "without split" also differs from the signal of the same name. The signal is unit status `no_split` at the
   report month (`reports.ts:91`); N11's is "no split rows at all". Name it differently or define it once. N11 matches
   the pseudonym to the Believe artist-name string. That is a hint, never a key (17 §1.3), and equality misses
   "A feat. B". Say so on the screen.
3. **should-fix (N4): state how `ownerBalances` stays exact and complete.**
   - `ownerBalance()` scans all of `calc.units` (`balance.ts:152-153`) and all of `calc.publishing` (`:218`) per owner.
     Calling it 1.1 k times is too slow.
   - Exactness is guaranteed only if one function serves both paths. The refactor should be `ownerBalance(calc,
     ownerId, ops, f, index?)`, where `index` = `{ unitsByOwner, publishingByOwner, artistsByOwner }` keeps
     `calc.units` order, because the recoup inputs are order-sensitive (`incomeById` insertion, `recoup()`). Without
     `index`, it builds the index for one owner. The golden tests then pin both paths.
   - The test should compare `ownerBalances` with `ownerBalance` for every owner of the golden data, not "a few".
   - N4 must call `calculate(modules, await opDocIds())` as `balanceWithFiles` does (`context.ts:144-149`).
     Otherwise `documentStatus(paymentProofId)` is `missing` for every proof: every payout is uncounted, and
     `blockingPayouts` lists all of them (`balance.ts:94, 372-380`). The design text never mentions it. Stage 1 raised
     this as finding 4.
   - Group operations from one `settlements.allOperations()` by `ownerId`. Merged owners are resolved the same way
     `listOperations({ ownerId })` resolves them.
4. **should-fix (rule 5): the `X-Operator` header cannot carry a Russian name.** `fetch` throws `TypeError` for a header
   value outside ISO-8859-1. Every write from an operator who types a Cyrillic name fails before it is sent. The client
   must send `encodeURIComponent(name)` and the hook must decode it. Also decide what a write without the header
   records: recommend `operator = null` and no refusal, because the 361 tests and the loader do not send it. Declare
   the header in `operations.ts` / OpenAPI (`ApiOperation` has no header field today).
5. **should-fix (N16): give `audit_log` a home that follows the repo rules.**
   - "All SQL lives in the repository" and "one schema per module" (D-121). `public.audit_log` with SQL in the facade
     breaks both. Make it a small module `modules/audit/{schema.ts, repository.ts, service.ts}` with `pgSchema('audit')`,
     and add it to `MODULES` in `boundaries.test.ts:7`.
   - The hook runs after the handler's commit, so it is not atomic. That is acceptable, because wrapping every write
     in `db.transaction()` would move `payments.send` inside the payout transaction, which `payouts.ts:186` forbids.
     The hook must `await recordAction` before the response is flushed: wrap `res.json`, do not use `res.on('finish')`.
     Otherwise the History tab check (19 §4.4) races.
   - Define `entityIds` per operation: path params, the response `id`, and the body's id fields including `isrc` /
     `upc`, so the track card's History finds split changes. Put the extractor next to each entry in `operations.ts`.
6. **should-fix (3.2 / 3.3b, build never red): changing the response shape breaks the old pages.** N18 turns every
   signal list into `{count, items}`. The old `SourcesPage.tsx:132,157` reads `ambiguousWriters.length` and
   `s.unfunded.length` on arrays. `npm run typecheck` covers all workspaces, so 3.2 goes red, and 3.4 runs in
   parallel in `packages/frontend`. Do one of:
   - make the change additive: keep the arrays and add `counts: Record<list, number>` capped by `limit`;
   - let 3.2 edit the old page;
   - move the shape change after 3.4 replaces the client.

   18 §2 also needs to say how the old pages survive 3.4's client rebuild (a `legacy-client.ts` kept until 3.9, or
   each old page deleted in the step that replaces it).
7. **should-fix (18 §2): "two agents never edit the same file" is not true for the parallel pairs.**
   - 3.3a and 3.3b both edit `api-schemas.ts`, `api-responses.ts`, `operations.ts` and `api-contract.test.ts`.
     `routes/owners.ts` gets `/tracks/summary`, the documents filter and `/documents/:id/uses`. `routes/settlements.ts`
     gets the snapshot schema and the operations filter.
   - 3.6 and 3.7 both touch the router, `nav.ts`, `api/queries.ts`, `api/client.ts` and the single `i18n/ru.ts`.

   Either serialize them, or make 3.4 (and the orchestrator for the backend) pre-create the shared seams: every client
   function, query key, route with a placeholder page, nav entry, and one dictionary section per page in its own file.
   Then the page steps touch only their own folders. New routers (`routes/queue.ts`, `routes/catalog.ts`) instead of
   growing `owners.ts` remove most of the backend overlap.
8. **should-fix (N5 vs rule 2): server paging of a money endpoint recalculates per block.** With the AG Grid infinite
   row model (17 §5), every 100-row block, sort and filter is a new `GET /tracks/summary`, so a new 7–10 s
   `calculate()`. That contradicts 17 §1.2 ("sorting work[s] on the loaded result"). Return all ISRC rows of the one
   calculation, client-side, as in A4. Keep only non-zero `cByReason` entries per row, or the size grows. Keep the
   infinite model only for `/sources/lines` (ClickHouse paging, no calculation). `app.ts` has no response
   compression, so measure the payload in 3.3a. If compression is needed, it is a library and a D-entry.
9. **should-fix (rule 1, rule 6): make the rules checkable by machine, not only by regex.**
   - Strings already make `-`, `*` and `/` a TypeScript error. What the guard must catch is a conversion: eslint on
     `packages/frontend/src`:
     - `no-restricted-imports` for `decimal.js`, `big.js`, `bignumber.js`;
     - `no-restricted-syntax` / `no-restricted-globals` for `Number`, `parseFloat`, `parseInt`, `Math.*` and unary `+`
       (`no-implicit-coercion`);
     - an allow-list file for counts and paging, like `rules-coverage.test.ts:198-213`.
   - String comparison of amounts (`payable > '0'`) is a client gate. Forbid it by review, and expose every gate as a
     field (`canPay`, `payBlockedReason`) so review has a target.
   - Rule 6: a test that `src/api/` declares no `interface` / object `type` and that every client function's return
     type is `z.infer` of a shared schema.
   - Rule 3: a test over the route table (parameters only `:isrc`, `:upc`, `:id`, `:reason`).
   - Rule 2: the e2e counts requests to money endpoints per page.
   - Rule 5: the contract scenario asserts one audit row per 2xx write.
   - `formatMoney` should use `Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2,
     roundingMode: 'halfExpand' }).format(decimalString)`. It formats a string input exactly, with no float, and
     replaces the hand-written carry logic. The specs should then assert the separator Intl produces, not a hard-coded
     U+202F (`19` §1).
10. **note (simplicity): three endpoints can go.**
    - N2 duplicates N1's `cByReason`. Add `isrcs` to N1 and let P2's summary read N1.
    - N17 serves static data from `@erp/shared`. The page can import `open-questions.ts` directly, so drop the
      endpoint and keep the 14-item test.
    - N7 runs a second full `calculate()` per month click. `traceIsrc` is cheap for one ISRC (`calculation.ts`
      `opts.traceIsrc`), and the 4.5 MB explain was mostly the platform × country breakdown. So N6 can return the
      layers of every unit, and N7 becomes the ClickHouse breakdown of one month, with no calculation.
    - N8/N9 and N13 are justified: the per-UPC split of G24 cannot come from per-ISRC N5, and N13 is the document
      card.
11. **note (gaps stage 3 would hit).**
    - Labels for id-only lists: `operationSchema` (`api-responses.ts:560-588`) and the N14 array carry `ownerId` /
      `artistId` only. State one rule: either the response carries the label (as N6, N3 and N4 do), or the client
      joins on a cached reference query (`/owners`, `/artists`). Joining by id is labelling, not arithmetic.
    - URL state: toolbar filters and `?tab=` go to the query string. AG Grid column filters and sort do not persist by
      default. Say whether they go to the URL or to `sessionStorage`.
    - Error envelope: `{ error: { code, message, statusCode, details } }`, with zod `issues` (path arrays) for
      `validation_error` (`http.ts:13-16`). Map `issues[].path[0]` to the form field. A client-side parse failure is a
      separate code (`contract_mismatch`).
    - The ⚠ decision ids for `assumptionBasis` q11 / r1 / D-035 need a table in `@erp/shared` (like `reasons.ts`), not
      page literals.
    - N3 has `month` but no `account`. A P1 cell is per account, so the clicked amount and the group total can differ
      when two accounts share a month. Add `account` or say so on screen.
    - N13 `waiting`: name it "ждёт этого документа", not "releases". Categorise gives one reason per allocation, so
      approving does not always move all of it to B. When a contract is about to be created (S14), its dialog takes
      `waitingBreakdown.owner_unconfirmed` from the balance, because the contract does not exist yet at approve time.
    - N15: existing stored snapshots (D-053, D-100, migrations) must parse. Make optional fields optional and run the
      schema read-only over the dev snapshots in stage 4 before `schema.parse` turns them into error states.
12. **note (N10).** Search spans `owners.*` and `labels.*`, so it is a facade method composing `owners.search` and
    `labels.search`, not one SQL statement. A btree `lower(col)` index does not serve `ILIKE '%q%'`. At 26 k tracks a
    sequential scan takes milliseconds. Drop the index from migration 0011, or use `pg_trgm` (an extension, so a
    D-entry and a privilege check).
13. **note (harness details).**
    - `QZTST27<nn><k>0<j>` satisfies `^[A-Z]{2}[A-Z0-9]{3}\d{7}$` (`identifiers.ts:14`).
    - Account `27<nn><k>0<a>` satisfies the file-name pattern `(\d+)` (`believe-format.ts:50`). One file per
      account-month avoids `duplicate_period`.
    - 17 §9 still says `QZTSTE<nn>…`: replace it with 19's pattern.
    - `private-stores.ts` in `src/shared` would import `splitStatements` from `scripts/migrate-clickhouse`
      (`sources-stack.ts:4`). Move it to `src/shared`.
    - Reuse `golden.test.ts`'s case builder in the seed rather than re-seeding 47 cases by hand.
    - Set Playwright `retries: 0` and `test.describe.serial` inside an action spec. A retried action spec starts from
      the "after" state.
    - `npx playwright install` downloads a browser, so name it in 3.4.
    - E2E is in the definition of done from 3.1, but the harness exists only from 3.4: say "from 3.4".
14. **note (D-139).**
    - D-007 is still mostly true: React, Vite, TypeScript, router, a typed client on the shared zod schemas, and
      Express serving `dist`. D-139 should *refine* D-007 (the UI kit, Tailwind, the stack) and *supersede* D-062 (the
      page scope), and update both index lines.
    - D-139 should also carry: client `schema.parse` (a change from D-119's "unused at run time"), the money text format
      and the event-loop decision.
    - The goal says "каждая библиотека — D-запись". One D-139 with a row and a reason per library meets it, provided
      every row names its version pin. `react-router-dom` is `^7.18.5` today, not pinned exactly.

## Recommendations for stage 3

- 3.0: amend 17 §9 (ISRC pattern, ClickHouse names), 17 §7 (N2, N7 and N17 folded; N8 on `rows`; N4 with `opDocIds`;
  N5 client-side), 18 §2 (file ownership, the old pages' fate, e2e from 3.4), then write D-139.
- 3.1: the audit module, the encoded header, `connectSources` honouring the ClickHouse names, and a test that an API on
  private stores reads only them.
- 3.2: `cQueue` must reproduce `reconcile()`'s C rules, not just C allocations. Label share C comes from
  `u.labelShareCategory` (`calculation.ts:344`): `label_unmapped`, `unknown_pair`, `no_isrc`. `writer_unmapped` is the
  full `payable` (`:350`). Share one C-item iterator between `reconcile` and `cQueue`. Test: Σ queue per reason =
  Σ `C_breakdown` per reason over all rows.
- 3.3a: the `ownerBalance` index refactor with an every-owner equality test. Measure the yield after the snapshot
  reads.
- 3.4: the eslint money rules, the route-param test, `formatMoney` on `Intl.NumberFormat` with a string input, and the
  shared seams of finding 7.

## Revision 2 (re-read 2026-11-03)

Verdict unchanged: **yes**. I re-read revision 2 of `17_frontend_model.md` (214 lines), `18_frontend_plan.md` (101) and
`19_golden_screens.md` (474), read-only. I re-checked the error codes the new §6 column cites against the code:
`alias_taken`, `rule_overlap`, `terms_overlap`, `document_not_attached` and "Returns cannot exceed the payout" all exist
(`labels/service.ts:121,152`, `publishing/service.ts:276`, `owners/service.ts:668`, `settlements/service.ts:146`).

Resolved:

| Finding | Where in revision 2 |
|---|---|
| 1 ClickHouse database name | N20 and step 3.1, with a test. D-140 corrects D-121 and CLAUDE.md. `start.sh` uses `believe_e2e` |
| 2 `believe.pairs` | N8 and N11 read the `units` of loaded files. N11's field is renamed `candidateIsrcs` |
| 3 `ownerBalances` | N4: `calculate(modules, opDocIds())`, a per-owner index that keeps unit order, one `ownerBalance()` code path, an equality test for every owner |
| 4 `X-Operator` | URI-encoded, declared in `operations.ts`, 400 `operator_required` without it (R5) |
| 5 audit home | an `audit` module (schema `audit`, repository SQL, boundaries test). The hook awaits the record before the response. `route` is the template. `entityIds` include `isrc` / `upc` / `isrcs` |
| 6 old pages | `/signals` is additive (`counts`). The legacy pages stay under `/legacy/*` until 3.9 |
| 7 file ownership | 3.1 → 3.2 → 3.3a → 3.3b run serially. 3.6 ‖ 3.7 are limited to their folders, on per-domain route, query and dictionary files created in 3.4 |
| 8 N5 paging | all rows once, client-side grid. The infinite model is gone |
| 9 machine checks | 17 §1 is a table of rule × check: eslint ban list, the no-DTO test, the route-params test, money-request counts in e2e, one audit row per write, a privacy test. `formatMoney` is `Intl.NumberFormat` on the string |
| 10 simplicity | N2 is folded into N1. N17 is dropped (`OPEN_QUESTIONS` in shared). N6 carries the layer states. N7 is a ClickHouse-only month breakdown |
| 11 gaps | labels on N14 and N3. N3 has `account`. N13 is "ждёт этого документа". N15 is checked against stored snapshots. Grid filter, sort and tab are in the URL. `contract_mismatch` |
| 12 search | a facade method over two modules, `pg_trgm` GIN indexes |
| 13 harness | valid ISRC pattern, `splitStatements` in `src/shared`, a shared `tests/helpers/golden-case.ts`, `retries: 0`, e2e in the DoD from 3.4, the browser install named |
| 14 D-139 | refines D-007, supersedes D-062, records `schema.parse` against D-119. `react-router-dom` pinned to 7.18.5 |

The new N19 (`payoutGate` shared by `createPayout` and both responses) is a good addition: it turns the payout gate
into a field (R4). It restates the existing checks in their order, so it is not a money-rule change. The 3.3a test
should pin each of the four reason codes through both the button and the field.

Remaining notes (no blockers):
- **The 400 `operator_required` rule reaches beyond the new client.**
  - Every existing API test that writes through supertest needs the header, not only the contract scenario: `api.test.ts`, `api-reasons.test.ts`, `review-*.test.ts`. A default header in one test helper is enough. Put that in 3.1's scope.
  - The `/legacy/*` pages use the old client, so their writes fail until 3.9 unless the old client also sends the header. Either let the legacy client send it, or declare the legacy pages read-only in D-144.
- **3.4 rebuilds `api/client.ts` while the legacy pages still import the old client and its hand-written types.** Keep the old file as `legacy/client.ts` (deleted in 3.9), so the "build never red" promise holds.
- **The R1 rule "no arithmetic on identifiers named like money" is a name heuristic.** It catches the common slips. The strong guarantees are the conversion bans (`Number`, `parseFloat`, unary `+`, decimal.js imports), together with TypeScript refusing `-`, `*` and `/` on strings. Keep both.
