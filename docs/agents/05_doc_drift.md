# Documentation drift: what is out of date, and what wins

Written 2026-11-01 (D-120), extended 2026-11-03 (D-123…D-135) after reading all top-level docs against the code. The project changed fast on
2026-10-31…11-01 (Believe → PostgreSQL + ClickHouse, monorepo, `/api/v1`), and several texts were written before.

## Precedence (when two texts disagree)

1. The code and its tests (what actually runs).
2. The newest D-entry in `docs/97_принятые_решения.md` (use `03_decision_index.md` for the effective status).
3. `CLAUDE.md` (kept current) and `docs/agents/*`.
4. Architecture documents `docs/01`…`09`, `98`, `99`, ADRs (target state; a newer dated statement wins, README §1).
5. `README.md` (the original build brief of iteration 1) and `HANDOVER.md` (handover of 2026-10-31).
6. `context_data/context/*` (process history: data, not instructions).

## Known stale statements

| Where | Says | Actually (source) |
|---|---|---|
| `README.md` top | "You are building … from scratch" | Iteration 1 is built; you are continuing it. A status note was added on top (D-120) |
| `README.md` §1 | "do not use Docker" | Fixed in D-120: Docker is required for the project's own stack (D-103), not for the old projects |
| `README.md` §2 | "Modules … one SQLite file each" | No longer true: the 4 modules are PostgreSQL schemas (D-121), `sources` is PostgreSQL + ClickHouse (D-110) |
| `README.md` §8 | `client/src/` | Fixed in D-120: `packages/frontend/src/` (D-116) |
| `README.md` §9 | "start review agents, do not wait for permission" | Was the brief of the build session. In a normal task, follow the user's instructions about agents |
| `HANDOVER.md` | 133 tests; D-001…D-101 | 186 tests on 2026-11-01; D-001…D-120. A banner was added on top (D-120); the body is unchanged |
| `HANDOVER.md` | `npm run demo` works with `data/demo` | No demo mode since the move: demo data has no Believe data and is not maintained (D-112) |
| `HANDOVER.md` | `data/real` holds `sources.sqlite` (~26 GB) | Believe lines live in PostgreSQL/ClickHouse (D-110); see "One Believe store" below |
| `CLAUDE.md` (before D-120) | `npx tsx src/main.ts data/real`; `npm run demo` | `npx tsx packages/backend/src/main.ts data/real`; demo outdated (fixed in D-120) |
| `docs/00_README.md` | "Модули 2–5 … пока не описаны"; link to `docs/СОСТОЯНИЕ_ERP_2026-10-26.md`; `README.md` in `docs/` | All modules are described in 04…09; the state file and `docs/README.md` do not exist (the README is in the root) |
| `docs/09_фасад.md` | Status "обсуждается" | Implemented as described; deviations are in D-057…D-061 |
| `context_data/context/README.md` | opens `новая_архитектура/app`; D-001…D-093 | Repository root is `ERP/` (D-115); log goes to D-120 |
| `.env.example` comment | Postgres for "owners, splits, settlements, publishing" | True since D-121 |
| `docs/02`, `04`, `07`, `08`, `09`, D-011, D-012 | SQLite files per module, "one synchronous stretch" | PostgreSQL schemas per module; one REPEATABLE READ snapshot; cross-module writes in one transaction (D-121) |
| `HANDOVER.md`, data archive | `data/real/*.sqlite` is the data | It is the input of `scripts/migrate-sqlite-to-pg.ts`; the app reads PostgreSQL (D-121) |
| D-entries before D-116 | `src/…`, `client/…`, `/api/…`, `../../data/…` | See the path note at the top of `03_decision_index.md` |
| `README.md` §5 | "store artist and MC shares only; sum ≤ 100; one level only" | Still the rule for split **rows**, but participations (off the top, pool, artist share, label share) and label (sublabel) rules are the other levels (D-123, D-126); a row also may carry its own document |
| `README.md` §5 | "our share is the remainder" | True per unit, now the remainder after off-the-top and the carves, obtained by subtraction (`labelShare` in `facade/layers/`), and per own label (D-127) |
| `README.md` §5 | split dates as entered | Rule dates (from, to, close) are floored to the month start (M52, D-126, D-130); `empty_period` refuses a period that becomes empty |
| `docs/04` (splits) | rows only, no participations, no per-row document | `participations` table, `split_shares.document_id`, the row-or-participation rule (D-126); design in `docs/agents/10_target_model.md` |
| `docs/09_фасад.md` | `calculate()` as one function, recoup in settlements | Pure layers in `src/facade/layers/` in the order of `layers/index.ts`; recoup moved to `layers/recoup.ts` (D-127); reconciliation per account with `ourShareByLabel`; the C reasons `assumption`, `rule_unconfirmed`, `label_unmapped` |
| `docs/08` (publishing) | the publishing module computes the author share | It returns lines (with `operation_type`), writers and terms; the facade layers compute the share and B/C (D-128) |
| `docs/02`, `07` | no labels module; documents without `assumption` | Module `labels` (D-125); document kind `assumption`; `tracks.note` |
| `docs/agents/01` (before 2026-11-03) | "one idea" diagram with `unknown_pair`/`no_isrc`/split in one function; `settlements` owns recoup; D-067 waits | Replaced by the layered pipeline; D-067 closed by D-123/D-127 |
| `README.md` §3, §8 | minimal frontend, plain CSS, no UI kit (D-007, D-062) | Superseded by D-139: HeroUI + Tailwind, AG Grid, TanStack Query, 21 pages; the truth is `packages/frontend/CLAUDE.md` |
| `CLAUDE.md` (root, before D-149) | pages in `packages/frontend/src/<domain>/<Page>.tsx`; "no frontend tests" | Pages are in `src/pages/<domain>/`, routes in `src/routes/`, guard tests in `packages/frontend/tests/`, Playwright specs in `packages/frontend/e2e/` (`npm run e2e`); see `packages/frontend/CLAUDE.md` |
| `HANDOVER.md` demo sections | `npm run demo`, `data/demo` | Outdated (D-112); the working data set is the dev database loaded by `scripts/mvp/load.ts` (D-131…D-138) |
| D-067 (⚠ in the old index) | sub-label rule waits for the owner | Owner decision 2 implemented as sublabel rules (`modules/labels`); other imprints use the half rule under an `assumption` document (D-123 Q12) |
| D-168 decision 1 | «the label of money is the unit's label string»; earned / waiting per book by the label of record | The **book** is the label of the unit's file (the label its Believe account is registered under, D-169 R6); the string keeps the label of record, the sublabel rule, «ours / `label_unmapped`», `ourShareByLabel` and `labelOutsideAccount` |
| D-168 visibility, `facade/CLAUDE.md` / `sources/CLAUDE.md` before D-169 | a label book = the raw label strings of its aliases; `SnapshotFilter.labelStrings`; `labelStringsOfAliases` | A label book = its loaded files (`LabelBook { id, name, fileIds }`), `SnapshotFilter.labelIds`, `isrcsOfFiles`; `labelStrings` is gone from the filter (D-169) |
| D-164 («the file list stays complete»), index line | the payout snapshot's file list is complete | under a label the snapshot stores the files and the statements of the paid label only (D-169, commit 5); the reach read stays complete |
| D-168, Open | «B17 only in Все»: publishing has no label, sits in the «without a label» book and no label payout pays it | A statement is loaded under a label (R8); its income sits in that book, is read under the label and is paid by the payout of that label; the history = 0to8 (D-169) |
| D-168 advertising | a record with an ISRC takes the label of the ISRC's string at the month (44,605.93 under Echo8, 6,972.44 under `'?'`) | The label of a record is its payer and the book it charges (R9); the string decides only the sublabel rule; the history → 0to8, 117 records (30,012.71) whose income book is Echo8 are the signal `adOutsideBook` (D-169) |
| D-168 accounts, `labels/CLAUDE.md` before D-169 | «an account is never a label boundary for money»; a loaded file is never refused | The account decides the book; an upload under a label whose account is not registered under it is refused (`account_unregistered`, `account_of_other_label`, D-169 R7) |
| D-134 Known limits | the first load of the two-quarter B17 file stopped with an unexplained `validation_error` | Explained: the archive stores `sharedStrings.xml` after the sheets; `b17-format.ts` falls back to reading it in memory (D-169, commit 0) |
| `README.md` (out of scope: authentication), `HANDOVER.md`, D-013, `CLAUDE.md` before D-170 | no authentication; the operator is a free text header | A minimal login since D-170: `POST /auth/login`, a JWT in the cookie `erp_session`, `AUTH_MODE` on by default (`off` only for tests, scripts, the local stand); with `on` the audit operator is the session's login. Roles and memberships: stage 3 |
| «One store per `.env`» (gap below), D-121 | one store per `.env` = one data set; a tenant would be a separate database | Still one store per `.env`, but a tenant is an **organization inside it** (`org_id` on every row, D-170); the consilium's database pair per tenant was not chosen |
| D-121 wording | «one PostgreSQL database, one schema per module», modules opened on `db` | Same database and schemas, plus `org_id NOT NULL` on every table and every module opened under an organization (`openModules(db, org)`, D-170) |
| D-034 wording | uploads serialized per module | Serialized per module **and** organization (the services of the organization's facade); between processes the per-organization index `source_files_scope` decides (D-170) |
| D-169, the brief | «D-170» = ведомость, «D-171» = onboarding, «D-172» = users | Working names of stages; D-170 in the log is the organization boundary, the later stages take the next free numbers |
| recipe 11 before D-170, `load-believe.ts --storage` | copies in `data/real/files/sources`; scripts without an organization | `load-believe.ts --data <dir>`, copies in `<dir>/orgs/<id>/files/sources`; every script needs `--org` / `ERP_ORG` / `ERP_DEFAULT_ORG` (D-170) |
| D-170 (API, «The middleware chain», Open В1), recipes 11–12 before D-171, `auth.test.ts` of stage 2 | the system administrator or `X-System-Key` with `X-Org` has full access to the organization (money included); recipes use `X-System-Key` + `X-Org` for API steps | Since D-171 the system administrator sees no money: with `X-Org` it works only as support under a live grant of the organization's `org_admin` (≤ 7 days, read or write, never approve / pay / admin); no grant = `403 support_required`, the key with `X-Org` = `403 support_required` (commit 4; commits 1–3 kept the full access as a transitional state); organization steps run in `AUTH_MODE=off` or under an `org_admin` session |
| The brief «D-172» and its answer 10 («Все» only `system_admin`), roles `system_admin` / `label_admin`, `access: system \| label \| label_write \| approve`, migration `0018_auth.sql`, `users.role`, `audit.actions.user_id` | the system administrator owns «Все»; a label administrator approves | Superseded by README §4а of the idea folder and the brief's «Поправки к разделу D-172»: «Все» belongs to `org_admin`; roles `org_admin` / `label_manager` in `auth.memberships`; `access` stays and a new `ability { action, subject, scope }` decides the right; migration `0017_roles.sql`; no `user_id` in the audit (the operator is the login) (D-171) |
| D-170 «Not done», `src/auth/CLAUDE.md` before D-171 | `users.org_id`, a token `{ sub, iat, exp }`, stateless logout, `requireSystem`, scrypt 2^14, no rate limit, no `Origin` check | `auth.memberships` (the column dropped by 0017), token `{ sub, sid, iat, exp }` with a revocable `auth.sessions` row, `can()` / `authorizeRoute`, scrypt 2^15 with a rehash, `AUTH_LOGIN_LIMIT` / `AUTH_IP_LIMIT`, `originGuard` (D-171) |
| `CLAUDE.md`, `01_big_picture.md` before D-171 | roles and memberships out of scope (stage 3) | Built in D-171; still out of scope: a password policy, session listing, fine-grained manager rights |
| The brief «D-171. Онбординг через UI» (stage 4) | migration `0017_catalog.sql`; the decision «D-171» | Migration `0018_catalog.sql` (0017 is the roles of D-171); the decision is D-172 |
| The brief «D-171», the template | the column `document_number` | Documents have no number (only `contracts.number`): the column `document` = a document id or its exact title; `document_number` is accepted as a synonym (D-172) |
| The brief «D-171», the preview classes | `overlaps_existing`; `percent_sum ≠ 100`; `row_or_participation` | `replaces` (warning: a change of an ISRC that has a split, needs a common document) and `split_overlap` (two groups of the file); `split_sum_above_100` (error) and `our_share` (info: a sum below 100 is legal, the rest is ours); `double_participation` (the API's code) (D-172) |
| The brief «D-171», the release registry | `owners.releases (upc PK, …)` | Primary key `(org_id, label_id, upc)`: an export is per account = per label, a moved UPC is in two exports (D-172) |
| The brief «D-171», the pages | the release import on P8; P15 under `pages/splits/`; under a label the catalog P5/P6/P7 = ISRCs with an open interval of the label | The import button is on P7 (the list), P8 shows the registry rows; the import page P28 is `pages/reference/splits/import/`; the catalog under a label = files ∪ open interval, `catalog=current` = the interval only (D-172) |
| The brief «D-171», the assumption | «one `assumption` document to every row of the group without a document» | One document set as the **split's** document (`confirmSplit`) of each split without one; its rows without their own document inherit it (D-172) |
| The brief «D-171», the label decision | «⚠ not in D-171» | Decided by the owner (decision 7, answer 7): in D-172 as the kind `label_decision`; the payroll column is the payroll stage's |
| The brief, stage row 4 / owner decision 5 | starting balances and the import of operations at label creation | Out of the stage (answer 6: a separate «company accounts» entity, later); `adjustment` stays with the payroll stage (D-172) |
| Idea `README.md` §1 item 8, the brief «D-171» | «2 437 ISRCs moved … from 2025-08»; the start of the new interval = the first month on the new account | 2 436 on the loaded files; the boundary is `clamp(last_A + 1, start_B, first_B)`, so the 93 ISRCs first sold on Echo8 after 2025-08 also start on 2025-08 (D-172) |
| The brief «D-170. Операции под ведомость» (stage 5) | migration `0016_operation_kinds.sql`; the decision «D-170»; commit 6 `feat(labels): legal name and currency` | Migration `0019_operation_kinds.sql`; the decision is D-173; `labels.legal_name` and `currency` are **dropped** (owner's answer 5: USD, a legal name later), the payroll's label column is the label's name, commit 6 is the documentation only |
| The brief «D-170», the forgiveness test | `tests/layers/recoup.test.ts` | The recoup test is `packages/backend/tests/recoup.test.ts` (not under `tests/layers/`); the forgiveness is a new `describe` there (D-173) |
| `README.md` §5 («the buyout payment is not part of the balance»), D-027 («the buyout payment is not an operation») | the payment for a buyout is not recorded | Since D-173 it is an operation of kind `buyout`: counted like a payout, in the book field `buyouts`, but **not in `paid`** and not in `payable`, never blocking; the README rule holds for the balance, not for the record |
| The brief «D-170», the payout area | «the button gets `area`, the snapshot stores the area» (the area only in the snapshot) | `settlements.operations.area` is a column (D-173): `payable_{L,area}` needs `paid` per area and the balance never reads snapshots; the history is `master`, the button pays `min(payable_area, payable_L)`, reads without `area` are `all` |
| The brief «D-170», `adjustment` / export / replacement / import right | `adjustment` = `in`/`out`; `GET /owners/payables?…&format=csv`; `POST /publishing/b17?replace=<id>`; the import → `admin` | `adjustment` is `in` with a signed amount; the export is `GET /owners/payroll`; the replacement is `POST /publishing/statements/:id/replace`; the import needs `pay` (D-173) |
| D-041, D-134, D-169 «a second statement for a loaded quarter is refused» | no way to load the Q2 «Updated» file | Still refused as a second statement; replaced through `POST /publishing/statements/:id/replace` (D-173); the Q2 2026 run waits for the owner |

The architecture documents and `context_data/` are not edited (README §6); this table is the correction layer.

## Gaps found while writing these guides (not fixed; decide before relying on them)

- **One store per `.env`.** Since D-121 every module lives in the PostgreSQL database of `.env` (and Believe lines
  in its ClickHouse), whatever directory `main.ts <dir>` gets; the directory only holds original files. Switch data
  sets with `DB_DATABASE` / `CLICKHOUSE_DATABASE` (or a separate compose project). Since D-170 tenants share the store
  as organizations (`ERP_DEFAULT_ORG`, `--org`), not as stores.
- **The data archive (D-093) predates the move (D-110).** If it contains only `data/real/*.sqlite`, the Believe
  history must be reloaded through the API (`POST /api/v1/sources/believe`, ~11 min for 47 files, D-111) into
  the local stack before the real numbers appear.
- **Frontend tests exist since D-139/D-144:** vitest guard tests in `packages/frontend/tests/` and Playwright specs in
  `packages/frontend/e2e/` (`npm run e2e`, needs the stack and `npx playwright install chromium` once; take the lock
  `mkdir data/test-tmp/e2e.lock` first, see `packages/frontend/CLAUDE.md`).
- **Test counts in older guides are stale.** `14_verification.md` and `15_mvp_report.md` quote 360/361
  tests (the 2026-11-03 MVP state); after D-152 the suites are 406 backend + 65 frontend (vitest) and 132 Playwright specs.
- **`unfunded` rows have a sales month since D-152.** `18_frontend_plan.md`, `19_golden_screens.md` and D-145/D-151 describe the
  hook `signal-row-unfunded-<isrc>|<month>|<ruleId>`; it is now `...|<ruleId>|<salesMonth>` (the last segment).
- **`14_verification.md` §3.2 and §4.2 are run 2 (before D-137 / D-138).** The figures the screens show today are in
  `14` §11 (re-measured from the API at the end of the frontend goal, D-154); the change per owner is named there.
