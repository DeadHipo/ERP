# Frontend goal, stage 2: the plan (2026-11-03, revision 2 after the council)

Stages 3–6 of `notes/goal_prompt_frontend.md`, built from `17_frontend_model.md`. Every step of stage 3 is one
commit that meets the definition of done of `CLAUDE.md` (typecheck, lint, `REQUIRE_STACK=1 npm test`), plus
`npm run build:client` and, from step 3.4 on, `npm run e2e` green, its D-entry appended to `docs/97_принятые_решения.md`
and indexed in `03_decision_index.md`, and the golden screens of `19_golden_screens.md` that its pages cover turned
into Playwright specs. Baseline at HEAD `7193e37`: 361 tests, typecheck, lint and the client build clean, no frontend
tests.

Agents: sonnet builds the backend endpoints with their tests, the shell, the components and the simple pages from
this plan and `17`; opus builds the complex screens (the track card P6, the C queue P2, the owner card with the
payout P10) and reviews; the orchestrator integrates, writes the D-entries and runs the definition of done. Work is
split by files: steps that share a file run one after the other; the only parallel pair (3.6 and 3.7) works in
separate page folders on files that 3.4 created in advance (per-domain routers, dictionary files, query files).

## 1. Libraries (one D-entry, D-139: refines D-007 (React + Vite + TypeScript + React Router + a typed client stay), supersedes D-062 "minimal UI without a kit", and records the client-side `schema.parse` as a change from D-119)

| Library | Version (pinned exactly) | Why | Not taken |
|---|---|---|---|
| `@heroui/react`, `@heroui/styles` | 3.2.7 (both, together) | the UI kit of zero-erp (stable v3 on npm; react-aria accessibility; compound components; no provider) | HeroUI v2, shadcn |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.4 | HeroUI 3 is built on Tailwind 4; CSS-variable tokens give light and dark for free | a tailwind config file (none needed) |
| `@tanstack/react-query` | 5.105.3 | query keys, invalidation after actions, `useIsFetching` for the "идёт пересчёт" indicator, the only client cache | Refine, SWR, a hand-rolled cache |
| `ag-grid-community`, `ag-grid-react` | 36.2.0 | lists of 1 k – 26 k rows with sorting, filtering, pagination, `getRowId`; `themeQuartz.withParams` on HeroUI variables | ag-grid-enterprise (server-side row model, grouping), ag-charts |
| `@heroicons/react` | 2.2.0 | the icon set of zero-erp | gravity-ui icons, react-icons |
| `react-router-dom` | 7.18.5 (pinned exactly now) | routes and `?tab=` / filter state in the URL | |
| `@playwright/test` | 1.64.1 | e2e on the private test database, one spec per golden screen | vitest + jsdom for pages (kept for the pure helpers only: money format, dictionary, guard tests) |
| `zod` (from `@erp/shared`) | the repo's | response parsing in the client (`schema.parse`) | |
| Not added | | Refine, three.js, charts, i18next, framer-motion, dnd-kit, xlsx, axios (fetch is enough) | |

Stack facts checked in a sandbox (2026-11-03): the set above installs under npm 11 with React 19.3.1, Vite 8.3.5,
`@vitejs/plugin-react` 6.2.1 and TypeScript 6; a page with a HeroUI button, tabs and an AG Grid table builds.
Build rules: react is never split into its own Rollup chunk (React 19 fails at load); AG Grid modules are registered
once (`AllCommunityModule`).

## 2. Stage 3: development, step by step

| Step | Scope (files) | D-entry | Golden screens (`19`) |
|---|---|---|---|
| 3.0 | Design recorded: `17_frontend_model.md`, `18_frontend_plan.md`, `19_golden_screens.md`; the stack decision | **D-139** Frontend goal: the design (17 §1 rules and their machine checks; the stack with exact versions; the operator trace; no server-side cache; the event loop accepted with `calculatedAt`; the e2e harness on private stores; the money text rule); refines D-007, supersedes D-062, changes D-119 (client parses responses) | — |
| 3.1 | **Backend, trace and stores**: `audit` module (`modules/audit/{schema,repository,service,index}.ts`, migration `0011_audit_search.sql`: schema `audit`, table `audit.actions`, extension `pg_trgm` and the GIN indexes for N10), `boundaries.test.ts` updated; `facade.recordAction()`; the API hook `api/audit.ts` (reads and decodes `X-Operator`, refuses a write without it with 400 `operator_required`, awaits the record before the response); `approveDocument` takes the operator; `GET /audit?entityId`; `operations.ts` declares the header on writes; the contract scenario sends the header and asserts one audit row per write; every existing API test that writes (`api.test.ts`, `api-reasons.test.ts`, `review-*.test.ts`) gets the header through one default in the test helper; the legacy client (`packages/frontend/src/api/client.ts`) sends the header from the operator field too, so the legacy pages keep working until 3.9; `src/shared/private-stores.ts` (`createPrivateStores`, `splitStatements` moved from `scripts/`) used by `tests/helpers/sources-stack.ts`; `connect-sources.ts` passes `CLICKHOUSE_DATABASE` to the columnar (test); `tests/helpers/golden-case.ts` (the case builder of `golden.test.ts` extracted; the test imports it) | **D-140** Operator trace: `X-Operator`, the `audit` module, `GET /audit`; private stores shared by tests and e2e; the ClickHouse database name honoured (corrects D-121 and CLAUDE.md) | — |
| 3.2 | **Backend, the C queue and the overview**: `facade/queue.ts` (`cItems(calc)` iterator shared with `reconcile()`, `cQueue(calc)` groups per 17 N3), `signalsFrom(calc, …)` refactor, `/signals` with `counts` and `limit` on every list (additive), `GET /overview`, `GET /queue/:reason`; schemas; contract calls; tests on golden data (G19, G10a, G08c, G26d, G30 groups; Σ per reason = `C_breakdown`) | **D-141** The C queue as an aggregation of the C items (keys per reason), the overview in one calculation, signals with counts and limits | S-queue, S-overview scenarios |
| 3.3a | **Backend, money aggregates**: `payoutGate` helper used by `createPayout`, `balance.payout`, `payables[].payout` (N19); `GET /owners/payables` (`ownerBalances(calc, ops)` with the per-owner index and the one `ownerBalance()` code path; an equality test for every owner), `GET /tracks/summary` (account, month), `GET /tracks/:isrc/money` (layers, labels), `GET /tracks/:isrc/breakdown/:month` (`columnar.breakdown(isrc, month)` over loaded files), `GET /releases` (units of loaded files), `GET /releases/:upc`, `GET /documents/:id/uses`; the snapshot response schema (checked against stored snapshots); the `setImmediate` yield measured in `calculate()` (kept only under 5 %); golden cases **G48** (deduction and credit in the balance) and **G49** (deactivate and return of a payout) appended to `12` and `golden.test.ts` (balance rule of `10` §5, no new rule) | **D-142** Money aggregates for the screens: the payout gate field, payables, track summary and money by month, releases, document uses; G48, G49; the yield decision with its measurement | S-track, S-owner, S-payout, S-release |
| 3.3b (after 3.3a: shared `api-schemas.ts`, `api-responses.ts`, `operations.ts`, the contract test) | **Backend, lists and search**: `GET /search` (facade, `pg_trgm`), `GET /artists/duplicates`, `OPEN_QUESTIONS` in `packages/shared/src/open-questions.ts` with a test that its ids are the 14 items of `15` §3, filters on `GET /documents` and `GET /settlements/operations` (with `ownerName`, `pseudonym`), `limit` / `offset` / `total` on `/participations`, `offset` and `status` on `/splits`, `storedPath` removed from `/sources/files`; tests | **D-143** Search, duplicate pseudonyms, the open-question list, list filters and labels | S-duplicates, S-documents |
| 3.4 (frontend only; may start after 3.1) | **Frontend foundation**: dependencies (§1), `index.css` (`@import "tailwindcss"; @import "@heroui/styles";` + tokens), `main.tsx` (QueryClientProvider, Toast.Provider, AG Grid modules, router), `nav.ts` with every route of 17 §3 (placeholder pages for the ones not built yet), per-domain route files (`routes/work.tsx`, `catalog.tsx`, `rules.tsx`, `money.tsx`), `AppShell`, `Sidebar`, `Breadcrumbs`, `GlobalSearch`, `OperatorField`, the components of 17 §5 with their test hooks, `api/client.ts` rebuilt (every type and schema from `@erp/shared`, `schema.parse`, `X-Operator` URI-encoded, `ApiError` incl. `contract_mismatch`), `api/queries/<domain>.ts` (key factories, invalidation groups: money, reference), `i18n/ru/<domain>.ts` merged in `i18n/ru.ts`, `lib/money.ts` (`formatMoney` via `Intl.NumberFormat` on the string; unit tests incl. `4.165`, `999.995`, `-0.004`), the eslint money rule set and the guard tests (`no-dto`, `routes-no-names`, `privacy`), `playwright.config.ts`, `scripts/e2e/start.sh` + `globalTeardown`, `e2e/tsconfig.json`, vitest `include` restricted to `tests/`, `e2e/smoke.spec.ts` (shell renders, search opens, operator field saved, a write without an operator is disabled), `e2e/states.spec.ts` (the `S-states` group with `page.route`); `packages/frontend/CLAUDE.md` rewritten; the old pages stay mounted under `/legacy/*` with the old client kept as `legacy/client.ts` until 3.9 so the build is never red | **D-144** The shell and the components; the client contract (types from shared, parse, operator header); the money text rule; the e2e harness as one command | S-smoke, S-states |
| 3.5 | **Pages: Обзор, Очередь ожидания (C), Сигналы, Решения руководителя** (P1, P2, P21, P3) with every action of the queue and of the signal lists (document → confirm split / contract; assign owner; alias / rule; terms; map writer; close and re-create a participation; the assumption wizard) | **D-145** The work pages: overview, the C queue with its actions, the signals page with its actions, the open-question list | S-overview, S-queue (every reason), S-signals |
| 3.6 (parallel with 3.7: `src/catalog/**` only) | **Pages: Треки, Трек, Релизы, Релиз** (P5–P8; the track card by opus): months and allocations with the layer-by-layer expansion and the breakdown of a month, the rules tab (split create / change / buy-out / confirm; participation create / close; the label rule per month), documents, history, the note in the header | **D-146** The catalogue pages: tracks, the track card ("whose is every dollar"), releases | S-track (G01–G47 numbers), S-rules |
| 3.7 (parallel with 3.6: `src/owners/**`, `src/operations/**` only) | **Pages: Владельцы (with the Выплаты view), Владелец, Операции** (P9, P10, P20; the owner card and the payout by opus): balance with the formula fields and the gate, waiting by reason with links, per label, per pseudonym and ISRC, positions, the payout button with the confirmation and the snapshot, operations with proof / deferred / deactivate / return / snapshot, merge, the duplicate dialog | **D-147** The money pages: owners with payable and the gate, the owner card, the payout, operations | S-owner, S-payout, S-operations, S-merge, S-duplicate-dialog |
| 3.8 | **Pages: Псевдонимы, Документы, Документ, Сплиты, Участия, Лейблы, Паблишинг, Отчёты** (P11–P19) | **D-148** The reference pages with input | S-duplicates, S-documents, S-splits, S-labels, S-publishing, S-sources (upload) |
| 3.9 | **Completeness and clean-up**: the legacy pages removed; `tests/coverage.test.ts` asserts that every operation of `operations.ts` appears in `src/api/coverage.ts` with a page (and that the route exists) or a documented refusal; a table test that every C reason and every signal list has an action component or "information only"; `packages/frontend/CLAUDE.md`, `docs/agents/01`, `04`, `05`, `README` refreshed | **D-149** Operation coverage guard; legacy pages removed; guides refreshed | all |
| 3.10 | Council of stage 3 (architect: rules R1–R8 and their checks, boundaries, one client; product: the golden screens and the actions on the e2e database; QA: runs typecheck, lint, tests, build, e2e; states, repeated actions, large lists) → `reviews/frontend_stage3_*.md` | — | all |

Order: 3.1 → 3.2 → 3.3a → 3.3b (serial on the backend, shared contract files) ; 3.4 starts after 3.1 (it needs
`X-Operator`) in parallel with 3.2–3.3b (frontend files only) ; then 3.5 → 3.6 ‖ 3.7 → 3.8 → 3.9 → 3.10.

## 3. Stage 4: verification on the real data

- An agent (sonnet) walks the scenarios of `16` §2 in the built-in browser against the dev database `erp` (the API on
  a side port serving the built client): the Believe month jobs, the B17 jobs, a contract entry, the payouts view,
  every queue reason that has money, every signal list; GET only on the dev database (creations happen on the e2e
  database, not on `erp`).
- 10 tracks and 10 owners from `14_verification.md` (§3.2 top ISRCs by |diff|, §4.2 owners by |payable difference|,
  cited by ISRC and owner id prefix): the number on the screen (title attribute) = the API response field = the
  figure in `14` (§9.1 / §10 after D-138 where the figure changed); a table in `20_frontend_report.md`.
- Every C reason with money (six today) leads to an action on the screen; every ⚠ item shows its decision id; every
  item of `15` §3 is found on the queue, a signal list or the open-question list.
- Screenshots stay in the session scratchpad, never in the repo (they show owner names).

## 4. Stage 5: rework

A number that differs between the screen, the API and `14` or a dead end in a scenario becomes a golden screen (a
row in `19` and a spec) first; then the fix: a frontend defect in its page, an endpoint defect with its test; the loop
2 → 3 → 4 until the agent's walk and the specs agree. Each rework is a commit with its D-entry when it changes
behaviour.

## 5. Stage 6: completeness and the report

- `tests/coverage.test.ts` (3.9) green: every operation of `operations.ts` has a page or a refusal recorded in
  `src/api/coverage.ts` with the reason (expected refusals: `GET /health`; `GET /tracks` and `GET /owners` superseded
  on the screens by the summaries but kept for API users; `GET /tracks/:isrc/explain` kept for API users, the pages use
  `/money`).
- Every C reason and every signal: an action component or "information only" per `17` §6 and `16` §2.7.
- Every open item of `15` §3 visible (queue, signal or the open-question list; the `OPEN_QUESTIONS` test).
- Guides: `01_big_picture.md` (state and the frontend), `04_recipes.md` (a page recipe), `05_doc_drift.md`,
  `packages/frontend/CLAUDE.md`, the README of `docs/agents`.
- `20_frontend_report.md`: closed, open, assumptions (each assumption in its D-entry marked "допущение"), the
  real-data table of stage 4, the e2e list, performance per page.
- Council of stage 6 → `reviews/frontend_stage6_*.md`; three "yes"; commit.

## 6. Assumptions recorded as decisions (each marked "допущение" in its D-entry)

| # | Assumption | Where |
|---|---|---|
| A1 | One operator role; the trace is a typed name in a header, required on every write, no login | D-140 |
| A2 | The event loop block of the 4 s fold is accepted; `calculatedAt` and the "идёт пересчёт" state make it visible | D-139 / D-142 |
| A3 | The open-question list is data in `@erp/shared` maintained by hand from `15` §3, with a test on the ids | D-143 |
| A4 | Every list is client-side in AG Grid (the largest is 26 k tracks, loaded once); only source lines page on the server | D-144 |
| A5 | The payout confirmation shows the balance the page already holds and its gate; the backend recalculates at the press (D-051); the toast shows the response's `amountCents` | D-147 |
| A6 | Reference lists (`/documents`, `/settlements/operations`) keep their array shape with filters, no paging | D-143 |
| A7 | Money text: `Intl.NumberFormat('ru-RU')` on the decimal string, two decimals half-expand, the exact string in `title`; specs normalise the no-break space (`19` §1) | D-144 |
| A8 | The e2e seed gives every golden case its own synthetic Believe account and ISRC range `QZTST27…`; the API runs with `PAYOUT_THRESHOLD_CENTS=0` for the e2e | D-144 |
| A9 | A second identical split change is accepted by the backend today (an empty-period split plus an identical one, money unchanged); a `split_unchanged` refusal is decided in 3.6 with the council | D-146 |
