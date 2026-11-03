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
- R1 the frontend computes nothing: eslint (`eslint.config.js`, block for `packages/frontend/src`, `src/legacy` exempt) bans
  `Number(`, `parseFloat`, `parseInt`, unary `+`, `Math.*`, `decimal.js`, `big.js`. Money is a decimal string; the only formatter is
  `src/lib/money.ts` (`Intl.NumberFormat('ru-RU', ... roundingMode: 'halfExpand', signDisplay: 'negative')` applied to the string).
- R2 one money call per screen, no server cache: money queries have `staleTime: 0` and keys in `MONEY_KEYS`
  (`src/api/queries/core.ts`); every `useAction` invalidates `money`, `reference` or `all`.
- R3 keys in routes: params are only `isrc`, `upc`, `id`, `reason`, `name` (`tests/routes-no-names.test.ts`).
- R4 the backend decides: a button may be disabled by a gate field of a response, with its reason next to it (`ActionButton`
  `isDisabled` + `reason`); API errors are shown as they are (`code`, `message`).
- R5 every write has a trace: `X-Operator` (URI-encoded) comes from the operator field (`localStorage` key `erp.operator`,
  `useOperator()`); `call()` refuses a write without it (`operator_required`), `ActionButton` and `ConfirmDialog` are disabled while it
  is empty. The legacy client sends the same header.
- R6 types from `@erp/shared` only: `src/api/client.ts` has the one `call()` (fetch + `schema.parse`; a mismatch is
  `ApiError('contract_mismatch', status 0)`) and one function per API operation (`owners.list`, `owners.balance`, `splits.change`, ...). No
  hand-written body types in `src/api/` (`tests/no-dto.test.ts`). `src/api/search-schema.ts` is a temporary local schema for
  `GET /search` until the shared one lands (step 3.3b).
- R7 simplicity: a page answers one operator question; the same components everywhere; strings in `src/i18n/ru/*.ts` merged in
  `src/i18n/ru.ts` (`ru.reasons` and `ru.signals` are typed against the shared enums: a missing label does not compile; `tests/reasons-labels.test.ts`).
- R8 privacy: synthetic data only; `tests/privacy.test.ts` greps `src/`, `e2e/`, `tests/`, `scripts/` for e-mails and `/Users/`.

## Folder layout (`src/`)
`main.tsx` (providers) / `App.tsx` (route table) / `nav.ts` (sidebar, breadcrumbs, active item) / `routes/{work,catalog,rules,money,dev}.tsx`
(arrays of `<Route>`; a page not built yet is a `PlaceholderPage` "Страница в разработке (шаг 3.x)"; later steps replace the element
only) / `pages/` / `components/` (shell and shared parts, `fields/`, `grid/`) / `api/` (`client.ts`, `queries/<domain>.ts`) / `i18n/` /
`lib/` (`money`, `operator`, `storage`, `theme`) / `legacy/` (the pre-3.4 pages with their own client, `ui.tsx` and stylesheet,
mounted under `/legacy/*`, loaded lazily, removed in step 3.9).
New pages go in their own folder (`catalog/`, `owners/`, ...) and replace the placeholder element in the route file; add their
queries to `api/queries/<domain>.ts` and strings to `i18n/ru/<domain>.ts` (register a new file in `i18n/ru.ts`).

## Components (`src/components/`) and their test hooks
| Component | Hooks |
|---|---|
| `AppShell`, `Sidebar` (collapsible, `sessionStorage` `erp.sidebar`), `Breadcrumbs` (from `nav.ts`; a detail page calls `useBreadcrumbLabel(name)`), `GlobalSearch` (Cmd/Ctrl+K, `GET /search?q=`, 404 shows "поиск появится на шаге 3.3b"), `OperatorField`, `RecalcIndicator`, `ThemeToggle` (`html.dark`, `localStorage` `erp.theme`) | `sidebar`, `sidebar-toggle`, `nav-<id>`, `breadcrumbs`, `global-search`, `global-search-dialog`, `global-search-input`, `global-search-results`, `operator-field`, `operator-hint`, `recalc-indicator`, `theme-toggle` |
| `DataGrid` (AG Grid, one theme on HeroUI variables, `locale-ru.ts`, pagination 50/100/500, required `getRowId`, `onRowClicked`, sort/filter in the URL under `gridStateKey`) | `data-grid`; rows are `[row-id="<key>"]` (AG Grid's own attribute on `.ag-row`, from `getRowId`) |
| `Money` (`formatMoney`; exact string in `title`; negative red) | `money` with `title` |
| `StatusChip` (kinds: documentStatus, documentKind, ownerStatus, artistStatus, category, cReason, operationMeaning, fileStatus, signal) | `chip-<value>` |
| `EntityLink`, `entityPath` | |
| `EntityCard` + `CardTabs` (tabs in `?tab=`) | `entity-card`, `tab-<id>` |
| `fields/TextField`, `SelectField` (max 50 options), `DateField` (native date input in HeroUI styles), `EntityPicker` (debounced `/search` restricted to one kind, shows at most 10) | `field-<name>` |
| `ConfirmDialog` (HeroUI AlertDialog + `HiddenRacDialogAnchor`; operator shown; OK disabled while pending) | `confirm-dialog`, `confirm-dialog-ok`, `confirm-dialog-cancel` |
| `PageState` (`empty`, `long`, `error`), `StaleBadge`, `QueryView` (applies the states to a query) | `page-state-empty`, `page-state-long`, `page-state-error`, `error-code`, `error-message`, `action-retry`, `stale-badge` |
| `toast.tsx` (`notifySuccess`, `notifyError(ApiError)`) | `toast` with `data-code` (`ok` or the API code) |
| `ActionButton` (disabled while pending or while no operator) | `action-<name>` |
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
- `e2e/smoke.spec.ts`: shell, search, operator, theme, every route renders without a console error, legacy pages work.

## Legacy
`src/legacy/` keeps the old pages (`/legacy/*`), `legacy/client.ts` (sends `X-Operator` from `erp.operator` on writes), `legacy/ui.tsx` and `legacy/styles.css` (scoped under `.legacy`). They are exempt from the money lint
rules and are deleted in step 3.9.
