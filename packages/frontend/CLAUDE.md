# frontend: notes for agents

The operator's workplace (design: `docs/agents/17_frontend_model.md`, plan: `18_frontend_plan.md`, expected numbers:
`19_golden_screens.md`; decisions D-139 and D-144). Interface strings are Russian, code and comments English.

## Stack (versions pinned exactly in `package.json`)
React 19 + Vite 8 + TypeScript; HeroUI 3 (`@heroui/react`, `@heroui/styles`) on Tailwind 4 (`@tailwindcss/vite`, no config
file); TanStack Query 5; AG Grid Community 36 (modules registered once in `main.tsx`: `AllCommunityModule`);
`react-router-dom` 7; Heroicons; zod from `@erp/shared`; Playwright for e2e, vitest for the pure helpers and guard tests.
Install only from the repo root: `npm i -w @erp/frontend --save-exact <pkg>@<version>`.
Build rule: react and react-dom are never split into a chunk of their own (`vite.config.ts` puts HeroUI/React Aria/AG Grid/
TanStack into one `vendor` chunk and nothing else).

## Rules R1-R8 (17 section 1) and how they are checked here
- R1 the frontend computes nothing: eslint (`eslint.config.js`, block for `packages/frontend/src`) bans
  `Number(`, `parseFloat`, `parseInt`, unary `+`, `Math.*`, `decimal.js`, `big.js`. Money is a decimal string; the only formatter is
  `src/lib/money.ts` (`Intl.NumberFormat('ru-RU', ... roundingMode: 'halfExpand', signDisplay: 'negative')` applied to the string).
- R2 one money call per screen, no server cache: money queries have `staleTime: 0` and keys in `MONEY_KEYS`
  (`src/api/queries/core.ts`); every `useAction` invalidates `money`, `reference` or `all`.
- R3 keys in routes: params are only `isrc`, `upc`, `id`, `reason`, `name` (`tests/routes-no-names.test.ts`).
- R4 the backend decides: a button may be disabled by a gate field of a response, with its reason next to it (`ActionButton`
  `isDisabled` + `reason`); API errors are shown as they are (`code`, `message`).
- R5 every write has a trace: `X-Operator` (URI-encoded) comes from the operator field (`localStorage` key `erp.operator`,
  `useOperator()`); `call()` refuses a write without it (`operator_required`), `ActionButton` and `ConfirmDialog` are disabled while it
  is empty.
- R6 types from `@erp/shared` only: `src/api/client.ts` has the one `call()` (fetch + `schema.parse`; a mismatch is
  `ApiError('contract_mismatch', status 0)`) and one function per API operation (`owners.list`, `owners.balance`, `splits.change`, ...). No
  hand-written body types in `src/api/` (`tests/no-dto.test.ts`).
- R7 simplicity: a page answers one operator question; the same components everywhere; strings in `src/i18n/ru/*.ts` merged in
  `src/i18n/ru.ts` (`ru.reasons` and `ru.signals` are typed against the shared enums: a missing label does not compile; `tests/reasons-labels.test.ts`).
- R8 privacy: synthetic data only; `tests/privacy.test.ts` greps `src/`, `e2e/`, `tests/`, `scripts/` for e-mails and `/Users/`.

## Folder layout (`src/`)
`main.tsx` (providers) / `App.tsx` (route table) / `nav.ts` (sidebar, breadcrumbs, active item) / `routes/{work,catalog,rules,money,dev}.tsx`
(arrays of `<Route>`; the path patterns are the one list `routes/paths.ts`: `ROUTE_PATHS`, `ROUTES`) / `pages/` / `components/` (shell and shared parts, `fields/`, `grid/`) / `api/` (`client.ts`, `queries/<domain>.ts`) / `i18n/` /
`lib/` (`money`, `operator`, `storage`, `theme`). `api/coverage.ts` maps every API operation to a page or a refusal.
New pages: recipe "Add a page" in `docs/agents/04_recipes.md` (own folder, route in `routes/paths.ts` and its route file, queries in `api/queries/<domain>.ts`,
strings in `i18n/ru/<domain>.ts`, entry in `api/coverage.ts`, spec in `e2e/golden/`).
## Pages (P4 of revision 1 is the payouts view of P9) (one sentence each: the operator question)
- **P1 Обзор** `/` (`pages/work/OverviewPage.tsx`, one `GET /overview`, period in the URL): did every dollar of each account and month land
  in B, C or ours, and what waits by reason? A plain table (rows `overview-row-<source>-<account>-<month>`, cells `data-col="A|B|C|ours|noSplit|discrepancy|fileDiscrepancy"`,
  `c-reason-<reason>`, `by-label-<name>`), the queue strip (`queue-chip-<reason>`) and signal counts (`signal-chip-<name>`); no totals row.
- **P2 Очередь ожидания (C)** `/queue` (summary from the same overview query, `queue-reason-<reason>`) and `/queue/:reason` (`GET /queue/:reason`, filters
  and `limit`/`offset` in the URL): what waits, grouped by what unblocks it, and what do I do? Rows `queue-group-<key.kind>-<key.id>`, one action dialog
  per reason (`pages/work/actions/dialogs.tsx`, buttons `action-<name>`, the dialog submit `action-<dialog>-submit` or `action-submit`; the
  document step `actions/DocumentStep.tsx`: `field-document-file`, `action-document-create`, `action-document-approve`, `document-ready`).
- **P21 Сигналы** `/signals` (`signal-list-<name>` with counts) and `/signals/:name` (one `GET /signals?limit=500`): what looks wrong without being C?
  Rows `signal-row-<name>-<key>` (keys in D-145), the actions of 16 §2.7 through the same dialogs.
- **P3 Решения руководителя** `/questions`: which open items wait for the head of the label? The static `OPEN_QUESTIONS` of
  `@erp/shared/open-questions` (rows `question-<id>`, chips `decision-<D-nnn>`, `question-link`).
- **P5 Треки** `/tracks?account&month&hasSplit&q` (`pages/catalog/TracksPage.tsx`, one `GET /tracks/summary`, rows filtered on the client): which ISRCs earn, how much is B, C and ours per ISRC (optionally for one account and month), and which have no split? Rows `track-<isrc>`, `action-create-track`.
- **P6 Трек** `/tracks/:isrc?tab=money|rules|documents|history|lines` (`pages/catalog/track/`, one `GET /tracks/:isrc/money`): whose is every dollar of this ISRC, by month, by layer and by rule, with the document and the C reason? A month row `month-<account>-<upc>-<month>` expands (`action-expand-month`) into `alloc-<ruleId>-<artistId>`, `layer-<name>` and `action-breakdown`; the rules tab (`split-<id>`, `participation-<id>`, `label-rule-<month>`) creates, changes, buys out and confirms splits and creates and closes participations; the header edits the note (`action-edit-note`).
- **P7 Релизы** `/releases?q` (`pages/catalog/ReleasesPage.tsx`, `GET /releases`, no calculation): which UPCs earn and what do they contain? Rows `release-<upc>`.
- **P8 Релиз** `/releases/:upc` (`pages/catalog/ReleasePage.tsx`, `GET /releases/:upc`): whose is the money of this release, track by track (`release-track-<isrc>`) and month by month (`release-month-<month>`)?
- **P9 Владельцы** `/owners` and `/owners?view=payouts` (`pages/owners/OwnersPage.tsx`, one `GET /owners/payables`, period in the URL): which owners exist, are they confirmed, how much is payable, and who is blocked and why? Rows `owner-<id>`, chips `gate-<allowed|reason>`; the payouts view is the same rows filtered to `payout.allowed` or `payout_blocked`, ordered by `payout.amountCents`; `action-create-owner` opens the duplicate dialog (`duplicate-dialog`, `action-duplicate-same|new`) on 409.
- **P10 Владелец** `/owners/:id?tab=balance|artists|documents|publishing|operations|history` (`pages/owners/OwnerPage.tsx`, `GET /owners/:id` plus one `GET /owners/:id/balance` shared by the tabs): how much has this owner earned, what waits and why, what was paid and recouped, and can I pay now? `balance-<field>`, `payable-negative`, `payout-gate`, `action-pay`, `waiting-<reason>`, `by-label-<label>`, `balance-track-<artistId>-<isrc>`, `position-<opId>`; `action-merge` (`field-merge-into`, `field-merge-reason`); `owner-merged` banner on a merged owner.
- **P20 Операции** `/operations?ownerId&meaning&needsProof&active&from&to` (`pages/operations/OperationsPage.tsx`, `GET /settlements/operations` with the URL filters): which operations exist, which lack a proof, which are deferred or inactive? Rows `operation-<id>` with `action-proof|deferred|return|deactivate|snapshot` (shared with the owner's Операции tab), `action-create-operation`; money of operations comes from `amountCents` through `pages/owners/components/cents.ts` (`centsToText`, string slicing, no arithmetic).
- **P11 Псевдонимы** `/artists?q&status` and `/artists/duplicates` (`pages/reference/artists/`, `GET /artists` filtered on the client; `GET /artists/duplicates`): which pseudonyms have no owner, and which pseudonym is carried by two artists? Rows `artist-<id>`, `duplicate-group-<norm>`, `duplicate-artist-<id>`, `candidate-<isrc>`, `action-assign-owner`, `action-create-artist`.
- **P12 Псевдоним** `/artists/:id`: which owner, split rows and participations does this pseudonym have? `artist-owner`.
- **P13 Документы** `/documents?status&kind&q&ownerId` (`pages/reference/documents/`): which documents exist by status and kind, and what can I do with each? Rows `document-<id>`, `action-create-document`, `action-attach`, `action-approve` (hidden for `assumption`: `assumption-note`).
- **P14 Документ** `/documents/:id` (`GET /documents/:id/uses`): what does this document confirm, and how much waits for it? `waiting-amount`, `uses-*`, `action-confirm-split`, `action-create-contract`, `link-assumption-wizard`.
- **P15 Сплиты** `/splits?isrc&artistId&status&limit&offset` and **P16 Участия** `/participations?isrc&artistId&limit&offset` (`pages/reference/splits/`): which split rows / participations exist, for which period, with which document? Rows `split-<id>`, `participation-<id>`, `splits-total`, `page-range`, `action-page-next|prev`; create asks for an ISRC first and reuses the catalogue dialogs.
- **P17 Лейблы** `/labels` and `/labels/:id` (`pages/reference/labels/`): which label strings map to which label, and which sublabel rule is in force when? Rows `label-<id>`, `label-rule-<ruleId>`, `alias-<string>`, `action-add-alias`, `action-set-rule`, `action-close-rule`.
- **P18 Паблишинг** `/publishing` (`pages/reference/publishing/`): which B17 writers map to which owner, and which terms apply by operation type? Rows `writer-<norm>`, `resolution-<value>`, `action-map-writer`, `action-resolve-writers`, `terms-list`, `action-set-terms`.
- **P19 Отчёты** `/sources?q` and `/sources/lines?fileId&isrc&upc&account&month&…` (`pages/reference/sources/`): which files are loaded, and what do the raw lines say? Rows `source-file-<id>`, `statement-<id>`, `field-upload-believe|b17`; lines with the API totals (`lines-totals`), `source-line-<i>`, `slow-hint`.

## Components (`src/components/`) and their test hooks
| Component | Hooks |
|---|---|
| `AppShell`, `Sidebar` (collapsible, `sessionStorage` `erp.sidebar`), `Breadcrumbs` (from `nav.ts`; a detail page calls `useBreadcrumbLabel(name)`), `GlobalSearch` (Cmd/Ctrl+K, `GET /search?q=`), `OperatorField`, `RecalcIndicator`, `ThemeToggle` (`html.dark`, `localStorage` `erp.theme`) | `sidebar`, `sidebar-toggle`, `nav-<id>`, `breadcrumbs`, `global-search`, `global-search-dialog`, `global-search-input`, `global-search-results`, `operator-field`, `operator-hint`, `recalc-indicator`, `theme-toggle` |
| `DataGrid` (AG Grid, one theme on HeroUI variables, `locale-ru.ts`, pagination 50/100/500, required `getRowId`, `onRowClicked`, sort/filter in the URL under `gridStateKey`; `rowTestId` puts a `data-testid` on the row, `autoHeight` keeps every row of the page in the DOM) | `data-grid`; rows are `[row-id="<key>"]` (AG Grid's own attribute on `.ag-row`, from `getRowId`) |
| `Money` (`formatMoney`; exact string in `title`; negative red) | `money` with `title` |
| `StatusChip` (kinds: documentStatus, documentKind, ownerStatus, artistStatus, category, cReason, operationMeaning, fileStatus, signal) | `chip-<value>` |
| `EntityLink`, `entityPath` | |
| `EntityCard` + `CardTabs` (tabs in `?tab=`) | `entity-card`, `tab-<id>` |
| `fields/TextField`, `SelectField` (max 50 options), `DateField` (native date input in HeroUI styles), `EntityPicker` (debounced `/search` restricted to one kind, shows at most 10; `accept` filters the matches) | `field-<name>`, `picker-list-<name>` |
| `ConfirmDialog` (HeroUI AlertDialog + `HiddenRacDialogAnchor`; operator shown; OK disabled while pending) | `confirm-dialog`, `confirm-dialog-ok`, `confirm-dialog-cancel` |
| `PageState` (`empty`, `long`, `error`), `StaleBadge`, `QueryView` (applies the states to a query) | `page-state-empty`, `page-state-long`, `page-state-error`, `error-code`, `error-message`, `action-retry`, `stale-badge` |
| `toast.tsx` (`notifySuccess`, `notifyError(ApiError)`) | `toast` with `data-code` (`ok` or the API code) |
| `ActionButton` (disabled while pending or while no operator) | `action-<name>` |
| `FormDialog` (HeroUI Modal for the fields of an action; its irreversible steps open `ConfirmDialog` on top) | `form-dialog`, `form-dialog-close` |
HeroUI's Toast cannot take attributes on its root, so the hooks sit on a `<span>` inside the toast title. `useAction(fn, { invalidate, success })`
(`api/queries/core.ts`) is the one mutation hook: toasts, invalidation, and a synchronous in-flight guard (a double click sends one request).

## Tests
- `npm test -w @erp/frontend` (vitest, `tests/**/*.test.ts`): money format, nav, dictionary, guard tests. Browser specs are not vitest.
- `npm run e2e` from the repo root (= `npm run e2e -w @erp/frontend`): needs the Docker stack (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`) and, once,
  `npx playwright install chromium`. `scripts/e2e/start.sh` seeds the private stores `erp_e2e` / `believe_e2e` (`packages/backend/scripts/e2e/seed.ts`), builds the client and serves it
  with the API on :3100 (`PAYOUT_THRESHOLD_CENTS=0`); `e2e/teardown.ts` drops the stores unless `E2E_KEEP=1`. One worker, no retries, no `waitForTimeout`; select by the hooks above and roles.
- **The states fixture page** `/dev/states?case=<ss1..ss7|action>` (`src/pages/dev/StatesPage.tsx`, not in the sidebar) hosts the checks SS1-SS7 of `19` until the real pages
  exist: `e2e/states.spec.ts` mocks the API with `page.route` and asserts the empty/long/error/contract-mismatch/stale states, a 26,000-row grid, the picker over 2,100 mocked owners, the
  confirm dialog, the double click and the toasts. Keep it working when pages arrive: the specs of the real pages come in `e2e/golden/`.
- Guard tests (vitest): `coverage.test.ts` (every operation of `operations.ts` is in `src/api/coverage.ts` with a page whose route exists in `routes/paths.ts`, or a refusal with its reason; every page P1-P21 is covered
  except P3 and P4, documented in `PAGES_WITHOUT_OPERATIONS`), `actions-table.test.ts` (every C reason and every signal list has an entry in
  `pages/work/actions/action-table.ts`, and an action names an existing exported dialog), `cents.test.ts`, `routes-no-names`, `no-dto`, `privacy`, `reasons-labels`.
- `e2e/smoke.spec.ts`: shell, search, operator, theme, every route renders a page without a console error.
- `e2e/golden/*.spec.ts`: the golden screens on the seeded stores. `e2e/helpers.ts` reads the seed keys (`e2e/.seed-keys.json`, written by the seed; `E2E_KEYS=<file>`
  for another one) and re-exports the naming of `packages/backend/scripts/e2e/keys.ts` (`isrc`, `upc`, `account`, ...); `openAs` sets the operator, `settled` waits for
  the recalculation and the stale badge, `expectP1` asserts a P1 row as `A / B / C / ours`, `pick` / `choose` fill pickers and selects, `apiPost` sends the second press.
  The specs of step 3.5: `overview` (S01–S11 rows, drill-down, P1 states by mocks), `queue` (S12–S19, S32, S08 read-only, S20 before), `signals` (S20, S21, S35 and
  the P21 rows of other scenarios), `questions` (the 14 items and their links). Files run in alphabetical order on one seed and every scenario owns its data, so an action
  spec never changes another spec's numbers; a spec that acts on a scenario is the only one that asserts its after state.
