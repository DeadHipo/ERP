# Frontend goal, stage 2: the model of the operator's workplace (2026-11-03, revision 2 after the council)

Input: `16_frontend_jobs.md` (accepted, `reviews/frontend_stage1_*.md`), `notes/goal_prompt_frontend.md`. This file is
the design that stage 3 builds: the rules and how each is checked by a machine, the shell, every page in one
sentence, routes and drill-down, the components, the actions and which of them need a confirmation, the endpoints
the screens need and do not have, the states of every page, the e2e harness. The plan with its steps and D-entries
is `18_frontend_plan.md`; the expected numbers are `19_golden_screens.md`. Revision 2 applies the stage 2 council
(`reviews/frontend_stage2_*.md`): a signals page, the payout gate as an API field, the audit as a module, the
ClickHouse database name passed to the API, fewer endpoints, the e2e harness as one command, and machine checks for
every rule. Interface language: Russian; the documents and the code stay English.

## 1. The idea, restated as rules the code can be checked against

| # | Rule | Checked by |
|---|---|---|
| R1 | **The frontend computes nothing.** Every amount, total, remainder, percent sum and gate ("can be paid", "blocked", "assumption cannot be approved") is a field of an API response. The client formats decimal strings, filters, sorts and groups the rows it received, and sends input | an eslint rule set for `packages/frontend/src`: no `decimal.js` / `big.js` import, no `Number(`, `parseFloat`, `parseInt`, `Math.*`, unary `+` and no arithmetic operator on an identifier whose name ends in `amount`, `net`, `payable`, `percent`, `cents` or a money field name (a fixed allow-list for counts and paging in one file); `formatMoney` is the only place that calls `toFixed` or `Intl.NumberFormat` |
| R2 | **One money call per screen**, no server-side cache (D-012). A page that shows money asks one aggregate endpoint once and shows "идёт пересчёт" without blocking navigation; tabs, filters and sorting work on the loaded result in the TanStack Query cache; every mutation invalidates the money queries | the e2e specs count the requests to money endpoints per page (one per load, one per invalidation) |
| R3 | **Keys are ISRC and UPC**; pseudonyms, owner names and titles are labels and search terms; a route never carries a name | a frontend test over the route table: parameters are only `isrc`, `upc`, `id`, `reason`, `name` (a signal list name from the enum) |
| R4 | **The backend decides.** A button may be disabled with the backend's reason next to it (a gate field of the response), and the API error (`code`, `message`, `details.issues` by field) is shown as it is; the client has no rule of its own | code review by the council; the payout gate is `balance.payout` (N19), not a comparison |
| R5 | **Every write has a trace**: the client sends `X-Operator` (URI-encoded; the name typed once, kept in `localStorage`, shown in the header); a write without it is refused (400 `operator_required`); the API records every successful write in the `audit` module; the entity pages show the trail. Irreversible actions (§6) go through one confirmation dialog that says what changes | the contract scenario asserts one audit row per write and the refusal without the header |
| R6 | **Types from `@erp/shared` only**: every request and response type comes from `api-schemas.ts` / `api-responses.ts`; every response is parsed with its zod schema; a parse failure is an error state with the code `contract_mismatch`, never silent | a frontend test that `src/api/` declares no `interface` / `type` of a response body; `client.ts` has one `call()` |
| R7 | **Simplicity.** A page answers one operator question (its sentence in §3 and in `packages/frontend/CLAUDE.md`); the same components everywhere (§5); strings in one typed Russian dictionary split by domain | council review; `tests/coverage.test.ts` lists every page with its sentence |
| R5a | **The label is a parameter of the view, not a header** (D-168): the switch «0to8 / Echo8 / Все» in the header is stored like the operator and mirrored in `?label=` (the URL wins); the money reads carry `label=<id>`, the bodies of an operation, a payout and an ad without an ISRC carry `labelId`. Under a label a page shows the book of that label and the entities visible under it; under «Все» every book and no payout button. No `X-Label` | the contract scenario calls the reads with `label=`; `35-label-switch.spec.ts` |
| R8 | **Privacy.** Owner names are shown to the operator; tests, fixtures, screenshots, logs and docs use synthetic names, stage names, ISRC and amounts only. `storedPath` and `sha256` are not shown | a privacy pattern test over `e2e/`, `scripts/e2e/` and `tests/` (no e-mail, no `/Users/`, names only from the synthetic list) |

## 2. The shell

- **Sidebar** (collapsible, state in `sessionStorage`) from one config `nav.ts`: id, Russian label, Heroicon, path,
  optional badge (a count from the overview). Sections: *Работа* (Обзор, Очередь ожидания (C), Сигналы, Решения
  руководителя, Выплаты), *Каталог* (Треки, Релизы, Владельцы, Псевдонимы), *Правила* (Сплиты, Участия, Лейблы,
  Паблишинг, Документы), *Деньги* (Отчёты, Операции).
- **Header**: breadcrumbs derived from `nav.ts` plus the entity label on a detail page; global search (`Cmd+K` /
  `Ctrl+K`, a modal over `GET /search`, results grouped by kind, Enter opens the card); the operator field (name, edit
  in place; empty = every write button disabled with "укажите оператора"); a global "идёт пересчёт" indicator
  (TanStack `useIsFetching` on money query keys); light/dark toggle (`html.dark`, HeroUI tokens).
- **Content**: page title + one-sentence subtitle, a toolbar (filters, actions), the body (grid, card, tabs). Grid
  filters, sort and the tab live in the URL query string, so a reload and a shared link reproduce the state.
- **Entity card** (track, release, owner, artist, label, document): a summary header (key, label, status chip, the
  money headline) and tabs synced to `?tab=`: *Обзор*, *Деньги по месяцам*, *Правила*, *Документы*, *История*.
- **Drill-down chain**: Обзор (A/B/C/ours per account and month) → month row → C reason → queue group → track →
  month → layer → allocation → rule (split / participation / label rule) → document. Every amount on the way is a
  link to the next level; every ISRC, UPC, pseudonym, owner and document id on any page is a link to its card.

## 3. Pages (one sentence each; route; the one money call; the actions)

| # | Page | Route | Question it answers | Money call | Actions on the page |
|---|---|---|---|---|---|
| P1 | Обзор | `/` | Did every dollar of every account and month land in B, C or ours, and what waits by reason? | `GET /overview` | none; every number is a link: C cells → `/queue/:reason?account&month`, B and ours cells → `/tracks?account&month`, signal counts → `/signals/:name`, the account and month → `/sources/lines?fileId=` |
| P2 | Очередь ожидания (C) | `/queue`, `/queue/:reason` | What waits, grouped by reason and by the entity that unblocks it, largest first, and what do I do? | `GET /overview` (summary, shared) and `GET /queue/:reason` (groups, paged) | the action of the reason (§6): create document and confirm split, create contract, assign owner, set terms, alias, rule, map writer, replace an assumption; ⚠ rows read-only with the decision id |
| P21 | Сигналы | `/signals`, `/signals/:name` | What looks wrong without being C: shortfalls, no-split ISRCs, unmapped strings, sublabels without a rule, double-pay shapes, notes, participants without an owner, assumptions, ambiguous writers, pairs outside the catalogue? | `GET /signals` (every list with its count) | per list, the action of `16` §2.7: create track (pair with ISRC), create split, map writer, close and re-create a participation, alias or rule, set rule, change split or close rule, assign owner, edit note, replace an assumption; information-only lists link to the entity |
| P3 | Решения руководителя | `/questions` | Which open items wait for a decision of the label's head, with their decision id and where their money sits? | none (the static list `OPEN_QUESTIONS` of `@erp/shared`; each item links to the queue reason, the signal list or the owner that holds its money) | none |
| P9 | Владельцы (incl. the view Выплаты) | `/owners`, `/owners?view=payouts` | Which owners exist, are they confirmed, how much is payable, and who is blocked and why? | `GET /owners/payables` | create owner (duplicate dialog); the view `payouts` is the same grid filtered to `payout.allowed` or blocked, sorted by payable |
| P10 | Владелец | `/owners/:id` | How much has this owner earned, what waits and why, what was paid and recouped, and can I pay now? | `GET /owners/:id/balance` | tabs: Баланс (the payout button, enabled only by `balance.payout.allowed`, with the confirmation and the snapshot; the period filter re-asks the API), Псевдонимы и треки, Документы и договоры (create document, attach, approve, create contract), Паблишинг (terms by type, set terms), Операции (advance with scope, deduction, credit, proof, deferred, deactivate, return, snapshot), История (the audit trail); merge into another owner |
| P5 | Треки | `/tracks`, `?account&month&hasSplit&q` | Which ISRCs earn, how much is B, C and ours per ISRC (optionally for one account and month), and which have no split? | `GET /tracks/summary` (all rows once; the grid filters client-side) | create a track (ISRC + UPC + title) |
| P6 | Трек | `/tracks/:isrc` | Whose is every dollar of this ISRC: by month, by layer, by rule, with the document and the C reason? | `GET /tracks/:isrc/money` (months, allocations with labels, layer states); the breakdown of one month `GET /tracks/:isrc/breakdown/:month` (ClickHouse only) | header: edit the track note; tabs: Деньги по месяцам (default; a month expands into the layer-by-layer table and the platform × country breakdown), Правила (split rows with periods, participations, the label rule at each month; create split, change split from a date, buy-out, confirm split with a document, create / close participation), Документы, История, Строки отчётов (`/sources/lines?isrc=`) |
| P7 | Релизы | `/releases` | Which UPCs earn and what do they contain? | `GET /releases` (net per UPC over the loaded files, no calculation) | none |
| P8 | Релиз | `/releases/:upc` | Whose is the money of this release, track by track and month by month? | `GET /releases/:upc` | links to tracks |
| P11 | Псевдонимы | `/artists`, `/artists/duplicates` | Which pseudonyms have no owner, and which pseudonym is carried by two artists? | `GET /artists/duplicates` (no calculation) | assign owner (`POST /artists/:id/owner`), create artist (duplicate dialog), merge owners |
| P12 | Псевдоним | `/artists/:id` | Which owner, which split rows and participations, which tracks? | `GET /splits?artistId`, `GET /participations?artistId` | assign owner |
| P13 | Документы | `/documents` | Which documents exist by status and kind, and what does each one confirm? | `GET /documents?status&kind&q` | create, attach file, approve (hidden for `assumption`: "допущение заменяется документом"), create contract from a document |
| P14 | Документ | `/documents/:id` | What does this document confirm (split rows, rules, contracts, operations) and how much waits for it? | `GET /documents/:id/uses` | approve; confirm a split with it; create a contract with it; the assumption wizard |
| P15 | Сплиты | `/splits` | Which split rows exist per ISRC and period, with which document? | `GET /splits?isrc&artistId&status&limit&offset` | create, change from a date, buy-out, confirm with a document |
| P16 | Участия | `/participations` | Which participations exist, of what base and funding, with which document? | `GET /participations?isrc&artistId&limit&offset` | create (the base / funding combinations the backend accepts), close |
| P17 | Лейблы | `/labels`, `/labels/:id` | Which label strings map to which label, and which sublabel rule is in force when? | `GET /labels` (+ `ourShareByLabel` from the overview) | create label, add alias, set rule, close rule |
| P18 | Паблишинг | `/publishing` | Which B17 writers map to which owner, and which terms apply by operation type? | `GET /publishing/writers`, terms from `GET /owners/:id` | map writer, resolve writers, set terms |
| P19 | Отчёты | `/sources`, `/sources/lines` | Which files are loaded, and what do the raw lines say? | `GET /sources/files`; `GET /sources/lines` (existing server paging) | upload Believe / B17 |
| P20 | Операции | `/operations` | Which operations exist, which lack a proof, which are deferred or inactive? | `GET /settlements/operations?ownerId&meaning&needsProof&from&to&active` (the response carries owner and pseudonym labels) | proof, deferred, deactivate, return, snapshot |

(P4 of revision 1 is the `payouts` view of P9: one question, one endpoint.)

## 4. Drill-down, in detail

- P1 month row: A, B, C, ours (per own label), discrepancy; C cells → `/queue/:reason?account=&month=`; B and
  ours cells → `/tracks?account=&month=` (the track summary filtered to that account and month, sorted by B or
  ours); the account and month → `/sources/lines?fileId=`. The queue total of a reason for an account and month
  equals the P1 cell (N3 has the same filters).
- P2 group row: reason chip, entity (owner / artist / document / split / participation / label rule / label string /
  pair / writer with its link), amount, ISRC count, months from–to, the action button; expanding a group shows its
  ISRCs (links to P6) and months.
- P6 month row: account, UPC, label string, net, then per allocation: pseudonym (→ P12), owner (→ P10), layer, kind,
  percent, amount, category chip, reason, document (→ P14), rule (→ the row in the Правила tab); the unit's "ours"
  and its label of record. Expanding the month shows the layer-by-layer table (state after each layer, the label
  share and the allocations added by that layer; from the same response) and loads the platform × country breakdown
  of that month (`/breakdown/:month`).
- P10 Баланс: payable headline with the formula shown as fields (earned − recouped − paid + returns + credits), the
  gate (`payout.allowed`, `payout.reason`), waiting by reason (each → `/queue/:reason?ownerId=`), per label of
  record, per pseudonym and ISRC (→ P6), positions (advances with recouped and remaining), pending operations with
  their reason, blocking payouts.

## 5. Components (one implementation each, `packages/frontend/src/components/`)

| Component | What it is | Test hooks |
|---|---|---|
| `AppShell`, `Sidebar`, `Breadcrumbs`, `GlobalSearch`, `OperatorField` | the shell of §2 | `operator-field`, `global-search`, `recalc-indicator` |
| `DataGrid` | AG Grid community wrapper: one `themeQuartz.withParams` theme bound to HeroUI CSS variables, Russian `localeText`, defaults (sortable, filterable, resizable, row height), client-side rows with pagination (50 / 100 / 500) for every list (the largest is 26 k tracks), `getRowId` so rows are addressable, `onRowClicked` navigation, filter and sort state in the URL | `[row-id="<key>"]` |
| `Money` | `formatMoney(decimalString)`: `Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2, roundingMode: 'halfExpand' })` applied to the **string** (no float; `4.165` → `4,17`, `999.995` → `1 000,00`, a value that rounds to zero → `0,00` without sign); the exact string in `title`; negative in red | `money` with `title` |
| `StatusChip` | one component, an enum → label / colour table (document status, owner status, artist status, category B/C, C reason, operation meaning, file status, signal name) | `chip-<enum>` |
| `EntityLink` | ISRC / UPC / pseudonym / owner / document / label → its card, with the right label | |
| `EntityCard` + `CardTabs` | header + tabs synced to `?tab=` | `tab-<name>` |
| `Form` + fields | HeroUI `TextField`, `Select`, `DatePicker`, `EntityPicker` (typed search over `/search` restricted to one kind, for owners, artists, documents, labels; never a select of more than 50 options); client validation messages from the shared zod schema; server `details.issues` mapped to fields; other errors as a toast | `field-<name>` |
| `ConfirmDialog` | HeroUI `AlertDialog` with the `HiddenRacDialogAnchor` fix: title, a list of what will change (amounts from the API), the operator name, confirm / cancel; the confirm button is disabled while the request is in flight | `confirm-dialog`, `confirm-dialog-ok` |
| `PageState` | the states of §8 | `page-state-empty`, `page-state-long`, `page-state-error`, `stale-badge` |
| `toast` | HeroUI `Toast.Provider` once; success with what changed (values from the response, e.g. the stored date, the payout `amountCents`), danger with the API code and message | `toast` with `data-code` |
| action buttons | every action button carries `action-<name>` and is disabled while its mutation is in flight (a double click sends one request) | `action-<name>` |

## 6. Actions: operation, confirmation, what the dialog says, what a second request does

| Action | Operation | Confirm | The dialog states | Second request (backend) |
|---|---|---|---|---|
| Approve a document | `POST /documents/:id/approve` (`by` = operator) | yes | the document, how many split rows / rules / contracts / operations it confirms, the C amount waiting for it (`GET /documents/:id/uses`); a document without a file cannot be approved (`document_not_attached`): the dialog says "сначала приложите файл" | 200, the first approval stands |
| Create a document; attach a file | `POST /documents`, `POST /documents/:id/attach` | no | | |
| Confirm a split with a document | `POST /splits/:id/confirm` | yes | the ISRC, the rows, the period, the document; refused when the split already has a document (`split_document_set`) | the refusal |
| Create a contract | `POST /contracts` | yes | the owner, the pseudonyms it confirms, the document; "владелец становится подтверждённым" | 201, a second contract row (harmless) |
| Replace an assumption | create document → attach → approve → for a row's own assumption document: `POST /splits/change` from a month with the row carrying the new `documentId`; for a split-level document: `POST /splits/:id/confirm`; for a participation or label rule: close and re-create with the new document (a wizard on P14 / P2) | yes (the approve step and the change) | the assumption document, what it covered, the new document, the month the change starts | see each step |
| Assign an owner to a pseudonym | `POST /artists/:id/owner` | no | | 200, idempotent |
| Merge owners | `POST /owners/merge` | yes | from → into, pseudonyms and documents that move, "необратимо" | refused (the source no longer exists) |
| Create / change a split from a date; buy-out | `POST /splits`, `POST /splits/change`, `POST /splits/buyout` | yes for change and buy-out | the ISRC(s), the rows and period that close (the month-start rule stated in words; the stored date comes back in the toast), the new rows | an identical change is accepted and adds an empty-period split plus an identical one (money unchanged; `19` keeps it as an open point for a `split_unchanged` refusal) |
| Create / close a participation | `POST /participations`, `POST /participations/:id/close` | close: yes | the participation, the close month; the month-start rule in words, the stored date in the toast | create: 409 `double_participation` / overlap; close at the same date: 200, no change |
| Create label, alias | `POST /labels`, `POST /labels/:id/aliases` | no | | alias: 409 `alias_taken` |
| Set / close a label rule | `POST /labels/:id/rules`, `POST /labels/rules/:id/close` | close: yes | the rule, the month | set: 409 `rule_overlap`; close same date: no change |
| Set publishing terms | `POST /publishing/terms` | no | | same `validFrom`: 409 `terms_overlap` |
| Map a writer; resolve | `POST /publishing/writers/:norm/map`, `/resolve` | no | | 200 |
| Create a track; set identifiers / note | `POST /tracks`, `PATCH /tracks/:id` | no | | |
| Create an owner / an artist | `POST /owners`, `POST /artists` | the duplicate dialog when `409 possible_duplicate` | the similar records; "тот же" opens it, "новый" repeats with `force` | |
| Pay | `POST /owners/:id/payouts` | yes | the payable and the formula fields from the balance, the pseudonyms and amounts, "снимок будет сохранён"; the button is enabled only when `balance.payout.allowed`, else disabled with `payout.reason` (`owner_not_confirmed`, `payout_blocked`, `nothing_to_pay`, `below_threshold`); after the payout the operation is deferred without a proof: the payable stays until the proof is attached (`classifyOperation`) and the next payout is blocked; the toast shows `amountCents` of the response | 422 `payout_blocked` or `nothing_to_pay` |
| Advance / deduction / credit | `POST /settlements/operations` | yes | direction, amount, pseudonym, scope, basis document | a second operation is created (the dialog warns when an equal operation exists today) |
| Payment proof; deferred | `POST .../proof`, `POST .../deferred` | no | | proof: refused when present; deferred: toggles |
| Deactivate; return | `POST .../deactivate`, `POST .../return` | yes | the operation, the reason, "необратимо" | deactivate: 409; return: 400 "Returns cannot exceed the payout" |
| Upload a report | `POST /sources/believe`, `POST /publishing/b17` | no | | 409 `duplicate_file` / `duplicate_period` |

The UI side of a repeated action is one rule: a button is disabled while its request is in flight. The backend side
is the column above; `19` §4 pins it per scenario.

## 7. Endpoints the screens need and do not have

Every new or changed operation: an entry in `operations.ts` (with the `X-Operator` header declared for writes), request
schema in `api-schemas.ts`, response schema in `api-responses.ts`, a call in the contract test scenario, a unit test
on golden data, a D-entry. Money rules (D-123 … D-138) are not touched: every endpoint below reads one `calculate()`
and aggregates its results, or reads a module list; every aggregate is tested equal to the existing figure it
restates (`reconcile()`, `ownerBalance()`, `explainTrack()`).

| # | Operation | Response (fields) | Facade |
|---|---|---|---|
| N1 | `GET /overview?from&to&basis` | `{ calculatedAt, reconciliation: ReconciliationRow[], queue: { reason, amount, groups, isrcs }[], signals: { name, count }[], files: { believe: number, b17: number } }` | one `calculate()` with `opDocIds()`; `reconcile()`, `cQueue(calc).summary`, `signalsFrom(calc, …).counts` (refactor of `signals()` into a function of a calculation) |
| N3 | `GET /queue/:reason?account&month&ownerId&q&limit&offset` | `{ calculatedAt, total, amount, items: QueueGroup[] }`, `QueueGroup = { key: { kind: owner \| artist \| split \| participation \| labelRule \| labelString \| pair \| writer \| ownerTerms, id, label }, ownerId, ownerName, artistId, pseudonym, documentId, documentStatus, ruleId, amount, isrcCount, months: { from, to }, isrcs: { isrc, amount }[] (top 20), assumptionBasis? }` sorted by |amount| desc | `cQueue(calc)`: one iterator over the C items shared with `reconcile()` (C allocations of the units, the label-share C of `label_unmapped` / `unknown_pair` / `no_isrc`, the publishing C incl. the whole payable of `writer_unmapped`), keyed per `16` §2.6; a test asserts Σ per reason = `C_breakdown` per reason for every account and month |
| N4 | `GET /owners/payables?from&to&basis` | `{ calculatedAt, items: { ownerId, name, kind, status, earned, waiting, waitingBreakdown, recouped, paid, returns, credits, payable, payableShown, confirmed, payout: PayoutGate, blockingPayouts: number, pendingOperations: number, lastPayoutDate }[] }` | one `calculate(modules, opDocIds())`; `ownerBalances(calc, allOps)`: a per-owner index of the units' allocations that keeps the unit order (recoup depends on it) and the operations grouped by owner, then **the same** `ownerBalance()` code path per owner (it takes the prebuilt index as an optional argument); a test compares every owner with `ownerBalance()` on golden data |
| N19 | `balance.payout` and `payables[].payout` | `PayoutGate = { allowed: boolean, reason: 'owner_not_confirmed' \| 'payout_blocked' \| 'nothing_to_pay' \| 'below_threshold' \| null, amountCents: number }` | one helper `payoutGate(balance, blocking, threshold)` used by `createPayout` (the same order of checks) and by both responses |
| N5 | `GET /tracks/summary?account&month` | `{ calculatedAt, items: { isrc, upcs, title, artistName, net, B, C, ours, cByReason, months: { from, to, count }, hasSplit, hasParticipations }[] }` (all tracks; the grid pages and filters client-side) | one `calculate()` grouped by ISRC (optionally only the units of one account and month) joined with `owners.listTracks()` and `sources.pairAttributes()` |
| N6 | `GET /tracks/:isrc/money` | `{ isrc, tracks: Track[], title, artistName, splits: SplitListItem[], participations: ParticipationListItem[], totals: { net, B, C, ours, cByReason }, months: { account, upc, reportingMonth, salesMonth, labelName, ourLabelName, sublabelName, rule, net, labelShare, labelShareCategory, ours, status, allocations: (Allocation & { pseudonym, ownerName, documentStatus })[], shortfalls, layers: LayerState[] }[] }` (no breakdown) | `calculate(modules, [], { traceIsrc })` filtered by ISRC (tracing one ISRC is cheap), labels from `calc.artistIndex` and the owners list |
| N7 | `GET /tracks/:isrc/breakdown/:month` | `{ rows: platform × country rows of that report month }` | `sources.breakdown(isrc, month)` over the loaded files (a month filter in `columnar.breakdown`); no calculation |
| N8 | `GET /releases?q` | `{ items: { upc, title, artistName, trackCount, net }[] }` | `owners.listTracks()` grouped by UPC + `sources.pairAttributes()` + net per pair from the `units` of the **loaded** files (`file_id IN (...)`, never the `pairs` view); no calculation |
| N9 | `GET /releases/:upc` | `{ upc, title, artistName, tracks: { isrc, title, net, B, C, ours }[], months: { reportingMonth, net, B, C, ours }[] }` | one `calculate()` filtered by UPC |
| N10 | `GET /search?q&kinds` | `{ owners: { id, name, status }[], artists: { id, pseudonym, ownerId }[], tracks: { isrc, upc, title }[], documents: { id, title, kind, status }[], labels: { id, name, kind }[] }` (≤ 10 each) | a facade method (two modules): PostgreSQL `ILIKE '%q%'` on owners (name, aliases), artists, tracks (isrc, upc, title), documents (title), labels (name, aliases) with `pg_trgm` GIN indexes (migration 0011, extension `pg_trgm`) |
| N11 | `GET /artists/duplicates` | `{ groups: { pseudonym, artists: { id, ownerId, ownerName, status, splitRows, participations }[], candidateIsrcs: { isrc, upc, net }[] }[] }` | `owners.artistIndex()` grouped by normalised pseudonym (2+ artists), `splits` counts, `candidateIsrcs` = ISRCs without any split whose Believe artist name equals the pseudonym, from the `units` of the loaded files; no calculation |
| N12 | `GET /documents?status&kind&q&ownerId` | the existing array filtered in the repository | `owners.listDocuments(filter)` |
| N13 | `GET /documents/:id/uses` | `{ document, splits, rowsOnly: { splitId, isrc, artistId }[], participations, labelRules, contracts, operations, waiting: { amount, cByReason } }` ("ждёт этого документа") | module lists by `documentId` + one `calculate()`: the C allocations whose `documentId` is this one plus, for a contract document, the `owner_unconfirmed` C of the owners its contracts confirm |
| N14 | `GET /settlements/operations?ownerId&artistId&meaning&direction&needsProof&active&from&to` | the existing array filtered in the repository, each item with `ownerName` and `pseudonym` | `settlements.listOperations(filter)` + labels from owners |
| N15 | `GET /settlements/operations/:id/snapshot` | a response schema (checked against the stored snapshots) instead of free-form | the stored snapshot |
| N16 | `X-Operator` and `GET /audit?entityId&limit` | `{ items: { id, at, operator, method, route, entityIds, summary }[] }`; an API hook awaits `facade.recordAction()` after every 2xx write before the response is sent; `route` is the template (`/documents/:id/approve`), never the concrete path (a writer's name can be a path segment); `entityIds` = the ids of the params and of the known body fields (`ownerId`, `artistId`, `documentId`, `isrc`, `upc`, `isrcs`); `summary` = ids and amounts, never names or free text | a small **`audit` module** (schema `audit`, table `audit.actions`, migration 0011; SQL in its repository), added to `boundaries.test.ts`; `approveDocument` receives the operator as `by`; a write without the header → 400 `operator_required` |
| N18 | Fixed parameters (additive) | `/participations` honours `limit` / `offset` and returns `total`; `/splits` honours `offset` and `status=unconfirmed`; `/signals?limit` caps every list and the response gains `counts: Record<name, number>` (the lists keep their shape); `/sources/files` drops `storedPath` | repositories |
| N20 | The ClickHouse database name | `connectSources()` passes `CLICKHOUSE_DATABASE` (and `<name>_stage`) to `createBelieveColumnar`, so an API started on private stores reads and writes them (today it falls back to `believe`; D-121's claim is corrected) | `connect-sources.ts`, a test |

Folded or dropped against revision 1: N2 (the queue summary is in N1), N17 (the open-question list is a static
`OPEN_QUESTIONS` in `@erp/shared` with a test that its ids are the 14 items of `15` §3; the client imports it).
`GET /tracks`, `GET /owners` and `GET /tracks/:isrc/explain` stay for API users; the pages use N4, N5, N6.

The event loop (k of `16`): the 4 s layer fold is synchronous. Decision: accept it (one operator; 7–10 s per
recalculation is the norm) and make it visible: every money response carries `calculatedAt`, and the client shows
"идёт пересчёт" while a money query is in flight; stage 3 measures a `setImmediate` yield every 50,000 units in
`calculate()` and keeps it only if the total cost is below 5 % (a non-money change, recorded in D-142).

## 8. States of every page

| State | Rule |
|---|---|
| empty | one sentence in Russian saying why (no files loaded; no items waiting; no owner found) and the action that fills it, when there is one |
| long | the "идёт пересчёт" panel with the expected 7–10 s; the shell, the sidebar and the other pages stay usable; a refetch after an action keeps the old numbers visible with a "устарело, пересчёт" badge until the new ones arrive |
| error | the API `code` and `message`, a retry button; a contract parse failure shows `contract_mismatch` |
| large list | AG Grid pagination 50 / 100 / 500 on client-side rows (26 k tracks load once); server paging only for `/sources/lines`; pickers search by typing |
| repeated action | the button is disabled while the mutation is in flight; the backend's answer to a second request is shown as a toast with its code |

`19` has an `S-states` scenario group that mocks the API (`page.route`) for each state.

## 9. The e2e harness (Playwright) and the test database: `npm run e2e` from the root, one command

- `packages/backend/src/shared/private-stores.ts`: `createPrivateStores(name)` creates `erp_<name>` (PostgreSQL) and
  `believe_<name>` / `believe_<name>_stage` (ClickHouse) with every migration applied (`splitStatements` moves from
  `scripts/` to `src/shared/`), and `drop()`; `tests/helpers/sources-stack.ts` and the e2e seed both use it. The dev
  database `erp` is never touched.
- `packages/backend/scripts/e2e/seed.ts <name>`: opens a facade on the private stores and builds the scenarios of
  `19_golden_screens.md` through the facade with the case builder shared with `golden.test.ts`
  (`tests/helpers/golden-case.ts`), each scenario with its own ISRC range (`QZTST27<nn><k>0<j>`, which passes
  `assertIsrc`), UPC, Believe account (P1 rows are keyed by account and month), pseudonyms, owners and documents, so
  one database holds every scenario and the actions of one spec never change another's numbers; the shared reference
  data (the two own labels, their aliases, `NoGhost Records` and its recipient) is read-only except the one alias
  that S16 adds to 0to8; the B17 statement is loaded last with a file name that names no quarter. Synthetic data only.
- `packages/frontend/playwright.config.ts`: `webServer` runs `scripts/e2e/start.sh`: checks Docker, drops and
  creates the stores with fixed names (`e2e`), seeds, builds the client, starts the API on `:3100` with
  `DB_DATABASE=erp_e2e`, `CLICKHOUSE_DATABASE=believe_e2e`, `PAYOUT_THRESHOLD_CENTS=0`, a temp data dir, and serves
  the built client itself (no Vite in e2e); `webServer.timeout` 300 s, test timeout 120 s (money calls take 7–10 s),
  `retries: 0` (an action spec cannot be retried on its post-action state), `workers: 1`, `reuseExistingServer:
  false`, `locale: 'ru-RU'`; `globalTeardown` drops the stores unless `E2E_KEEP=1`; `test-results/` and
  `playwright-report/` git-ignored; `e2e/` has its own tsconfig and is excluded from vitest.
- Specs: `packages/frontend/e2e/*.spec.ts` as listed in `19` §5, asserting the exact decimal strings (`title`) before
  and after each action, the second request per action, and the states; selectors by the test hooks of §5 and roles;
  no `waitForTimeout`.
- `npm run e2e` (root) = `npm run e2e -w @erp/frontend`; `npx playwright install chromium` is a one-time step named in
  `packages/frontend/CLAUDE.md`. The definition of done of every stage 3 step from 3.4 on adds `npm run build:client`
  and `npm run e2e`.

## 10. Out of the model (consciously)

Authentication and roles (the operator field is a trace, not a login); ads and the payout side (M21, M23, M30, M31);
artist statements by mail; platform and country analytics beyond the source lines facets; charts; a server-side
cache; changes to any money rule.
