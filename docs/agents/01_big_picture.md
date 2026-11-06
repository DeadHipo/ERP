# The big picture (read this first)

Written 2026-11-01 for AI agents (D-120), refreshed 2026-11-03 for the layered architecture (D-123…D-138). This is a summary: the architecture documents (`docs/01`…`09`, Russian)
and the decision log (`docs/97_принятые_решения.md`) stay the source of truth. If this file disagrees with them,
they win; fix this file.

## 1. What the system is, in one paragraph

A royalty ERP for a music label. The label receives money from distributors (**Believe**: master recordings, monthly
CSV reports) and from a publisher (**B17**: authors' rights, quarterly xlsx statements). For every dollar the system
answers three questions: **whose is it** (artist/owner by contract share, or ours), **is it confirmed** (backed by an
approved document), and **how much can we pay an owner today**. It never stores accruals: every answer is a full
recalculation from the raw report lines plus the current reference data (owners, splits, terms, operations).
A payout freezes a snapshot of that calculation.

## 2. The one idea that explains most of the code

```
 raw report lines          reference data (modules)            facade (recalculated per request)
 ───────────────           ────────────────────────            ─────────────────────────────────
 Believe CSV ──► sources ──► unit = ISRC+UPC+report month+sales month+label string, net
   MASTER LAYERS (src/facade/layers/index.ts, a pure fold per unit):
   1 label of record  label string ─► alias ─► our label (0to8 / Echo8); sublabel rule at the month;
                      unmapped string ─► "ours" waits in C label_unmapped (rows and carves still run)
                      (the BOOK of the money is not the string: it is the label of the unit's file, i.e. the
                       label its Believe account is registered under, D-169 R6; the string decides only the
                       label of record, the sublabel rule and ours / label_unmapped)
   2 perimeter        no ISRC ─► C no_isrc; pair not in tracks ─► C unknown_pair (nothing else runs)
   3 off the top      participations (net, top): remixer etc.; scaledNet = net − Σ top
   4 split            artist rows × scaledNet; label share = scaledNet − Σ rows (no split: all label share)
   5 carves           pool ─► artist share ─► label share ─► sublabel (a fixed order, one base per kind);
                      a carve larger than its bucket takes the bucket, the rest is a signal (unfunded)
   6 categorise       per allocation, first reason wins: assumption ─► split_unconfirmed / rule_unconfirmed
                      ─► artist_without_owner ─► owner_unconfirmed ─► otherwise B (not ours, confirmed)
 B17 xlsx ──► publishing ──► aggregated lines (with operation type)
   PUBLISHING LAYERS: writer parts (equal parts to our mapped writers, else the holder) ─► author share
   (terms by owner, date and operation type; default 50 %) ─► categorise (writer_unmapped,
   owner_unconfirmed, publishing_terms_unconfirmed, else B); the label keeps the rest
 Recoup and balance live in the facade (layers/recoup.ts, balance.ts).

 Every recipient is a pseudonym (artist row): an artist, a participant, a sublabel, a buyer each has one,
 under an owner; money goes to owners only through them. Names never decide money.
 Completeness check per source, ACCOUNT and month:  A (received) = B (not ours) + C (waiting) + ours,
   with ours also split per own label (ourShareByLabel); ours comes from the layer state, not from A − B − C,
   so a layer that loses money shows as a non-zero discrepancy.
 Owner balance:  payable = earned (B) − recouped − payouts with proof + returns + credits (earned/waiting also per label)
   per book since D-173:  payable_L = earned − recouped − paid − adsCharged + returns + credits + adjustments − writtenOff
                          (buyouts and forgiven are outside payable; byArea master / publishing; asOf cuts the inputs)
 Payout button:  pays the whole payable of a book and area (default master: min(payable_area, payable_L)),
                 floored to cents, stores a snapshot (per artist, file hashes, the area)
```

Code: `packages/backend/src/facade/calculation.ts` (`calculate`, `reconcile`; builds the context and runs
`allocateUnit` per unit), `facade/layers/` (the layers, one file each; design in `10_target_model.md`),
`facade/balance.ts` (owner balance), `facade/payouts.ts` (operations, payout button). Read `calculate()` and
`layers/index.ts` once: they *are* the domain.

C reasons (shared enum `C_REASONS`, labels in `packages/shared/src/reasons.ts`): `split_unconfirmed`,
`rule_unconfirmed` (a top, carve or sublabel rule without an approved document), `assumption` (the document is of kind
`assumption`: a council decision that is never approved), `artist_without_owner`, `owner_unconfirmed`,
`label_unmapped`, `unknown_pair`, `no_isrc`, `publishing_terms_unconfirmed`, `writer_unmapped`.

Three consequences that surprise newcomers:
- **Category C is not lost money.** It is calculated per artist but held back until a document is approved.
  Approving a document moves money from C to B on the next request. Nothing is "posted".
- **Names never decide money.** Performer names in reports are metadata. Recipients come only from splits and
  participations (master) and from the `songwriters` → owner mapping (publishing).
- **Payable is not an obligation.** It changes whenever a report, split or document changes. Only the payout
  snapshot is fixed.

## 3. Modules (independent) and the facade (the only composer)

| Module | Owns | Storage | Docs | Key decisions |
|---|---|---|---|---|
| `owners` (module 1) | owners, artists (pseudonyms), tracks (ISRC+UPC, note), documents (incl. kinds `assumption` and `label_decision`), contracts, merges; the catalog: the label history of an ISRC (`track_labels`) and the release registry (`releases`), navigation, not money | PostgreSQL schema `owners` | 02, 99, ADR-001 | D-016…D-024, D-095, D-172 |
| `labels` | our labels (0to8, Echo8), imprint aliases, sublabel rules (percent of the label share to a pseudonym), the Believe accounts of a label (the book of a file, D-169) | PostgreSQL schema `labels` | 10 §1 | D-123, D-125, D-130 |
| `splits` | artist rows per ISRC with validity periods (each row may have its own document), participations (percent of a base, funded from top / artist pool / artist share / label share), buyouts | PostgreSQL schema `splits` | 04, ADR-003, 10 | D-025…D-030, D-126 |
| `sources` | Believe file registry and report lines | PostgreSQL `source_files` + ClickHouse `believe.rows` | 03, 06 | D-031…D-038, D-102…D-114 |
| `publishing` | B17 statements (a statement may be replaced by its «Updated» version: `superseded`, D-173), writers, terms by owner, period and operation type; computes no money | PostgreSQL schema `publishing` | 08 | D-039…D-046, D-083, D-087, D-128, D-173 |
| `settlements` | operations in/out with a stored kind (payout, advance, deduction, credit, return, buyout, forgiveness, writeoff, adjustment; D-173), their label source, channel and area, payouts, scope shape; the recoup algorithm moved to the facade | PostgreSQL schema `settlements` | 07 | D-047…D-056, D-072, D-094, D-127, D-173 |
| `audit` | the trace of every API write (operator from `X-Operator`, route template, entity ids, a summary without free text); decides nothing | PostgreSQL schema `audit` | 17 §7 N16 | D-140, D-150 |
| `ads` | advertising expenses: ISRC (or an allocated pseudonym), month, amount, recovery percent 0–100, scope; computes no money (the allocation is `facade/ads.ts`) | PostgreSQL schema `ads` | `docs/реклама_тз.md` | D-155, D-156 |
| `facade` | nothing stored; composes all modules, runs the layers, recoup (with the forgiveness of an advance, D-173), balance, pays; the split import, the assumption, the catalog derivation and the onboarding checklists (D-172); `asOf`, the payroll export and the import of operations (D-173) | — | 09, 10 | D-012, D-057…D-061, D-127, D-172, D-173 |

Rules (enforced by `packages/backend/tests/boundaries.test.ts`): a module never imports another module, the facade
or the API; the API never opens a module; only `src/facade/` calls several modules.

Request path: React page → `packages/frontend/src/api/client.ts` → (D-170) the session cookie → `resolveOrg` picks the
facade of the session's organization and builds the principal (D-171) → `labelGuard` → `authorize` (the operation's
`ability` against the rule table `src/auth/abilities.ts`) → Express router `src/api/routes/<topic>.ts` (zod schemas
from `@erp/shared`) → `facade.<method>(…, viewerOf(res))` (the facade's `Viewer` decides the label of a record) →
module services → repositories (all SQL, every statement filtered by the organization).

Every module in the table above is opened under one organization (`openModules(db, org)`, D-170): its tables carry
`org_id NOT NULL` and its repository filters through `src/shared/org-scope.ts`; `src/orgs` (organizations, the facade
per organization, support access) and `src/auth` (users, memberships, sessions, the rule table of rights) sit above
the facade and are not modules.

## 4. Money and dates in one table

| Where | Representation | Helper (`packages/backend/src/shared/`) |
|---|---|---|
| Source amounts in modules | pico-USD `bigint` (1e-12), or `Decimal(38,12)` text from ClickHouse | `money.ts`: `parsePico`, `picoToDecimal` |
| Calculations | `Decimal` (decimal.js with high precision) | `money.ts`: `Decimal`, `ZERO`, `sum` |
| Operations, payouts | integer cents | `centsToDecimal`, `floorToCents` (only at payout) |
| JSON | decimal strings | `money()` |
| Months / dates | `YYYY-MM` / `YYYY-MM-DD` text | `dates.ts`: `monthStart`, `inMonthRange` |

**Exactness rule (D-127, D-130):** inside the layers every allocation amount is quantised to 12 decimals (pico-USD,
half-up) right after its multiplication, every remainder is obtained by subtraction, a pro-rata or scale-down gives the
residue to the largest absolute amount. So Σ allocations + label share = net exactly, whatever the decimal.js precision
(`facade/layers/exact.ts`, `tests/layers/exactness.test.ts`).

No floats for money anywhere: `tests/rules-coverage.test.ts` greps `src` for `Number(` and allows only a fixed list.
Splits are chosen by **report date** (first day of the reporting month); `valid_to` is exclusive (D-025). Month-start
rule (M52, D-126, D-130): every `valid_from` / `valid_to` / close date of a split, participation or label rule is
floored to the first day of its month; the part-month goes to the new holder.
Period filters use report date by default, sales date on request (README §5; signals follow the chosen basis, D-061).
Publishing has no sales date: both bases use the statement's quarter-end month.

## 5. State of the project (2026-11-06)

- Iteration 1 is done (`README.md` §2, §5, §8; D-096, D-098). Believe is in PostgreSQL + ClickHouse (D-102…D-114),
  the other modules are PostgreSQL schemas (D-121).
- **The MVP goal, stages 3–7, is built (D-123 … D-138):** layered calculation (D-123, D-127), `labels` module
  (D-125), participations and per-row documents (D-126), publishing by operation type (D-128), API and pages (D-129),
  council fixes (D-130); stage 4 loaded the reference data (D-131…D-134); stage 5 is the verification against the
  owner's workbooks (`scripts/mvp/compare-*.ts`, `decompose-main.ts`; `14`); stage 6 the rework of the errors it
  found (D-135 … D-137); stage 7 the completeness check (`13`), the closing fixes (D-138) and the report (`15`).
- **Loaded in the dev database `erp`** (local, git-ignored data): 17 labels (0to8, Echo8 and 15 sublabels) with aliases
  and sublabel rules; ~24 k splits (Annex 14 registered splits, legacy mid-month dates normalised) and the
  participations; Echo8 tracks and splits; the payment history and advances of `0to8 Main.xlsx` (D-132); B17 for 7
  quarters (2024-Q4…2026-Q2, D-134); the contract registry from the PandaDoc index (D-133). Reconciliation:
  discrepancy 0 on every row. Real data stays local: never copy values into the repo.
- **Open for the product owner:** the list of items (negative payables before stage 5 analysis, B17 payees without a
  contract, ambiguous Echo8 names, XENO XID, a second statement for a loaded quarter, …) is in `15_mvp_report.md`
  (the stage 7 report) and `13_completeness_check.md`.
- **The frontend goal (D-139 ... D-152):** the operator's workplace on HeroUI + Tailwind, AG Grid and TanStack Query; 21 pages
  (`17_frontend_model.md`), e2e on private stores (`npm run e2e`); the old pages removed. Every API operation has a page or a
  documented refusal in `packages/frontend/src/api/coverage.ts` (guard test); notes: `packages/frontend/CLAUDE.md`.
  Stage 5 reworked the backend (D-150) and the screens (D-151: month row key, decimal sorting, one dialog per action, Russian errors); stage 6 clean-up is D-152; the result is `20_frontend_report.md`.
- **The label as a book (D-168) and stage 1 of «label from zero» (D-169, `docs/идеи/лейбл_с_нуля/`):** every sum also
  per own label (0to8, Echo8): the owner balance and the payout are per owner × book, a label switch sits in the header.
  Since D-169 the book of a Believe unit is the label of its file (a file is uploaded under a label, its account must be
  registered under that label), a B17 statement is uploaded under a label and its publishing income sits in that book, an
  advertising record charges its payer's book, a document may carry a label (the payout gate under L needs a contract of
  L or without a label: `no_contract_for_label`) and the audit row records the label. The history was marked by
  `scripts/assign-label-books.ts` (files by account, the six statements and the advertising history → 0to8, the seven
  Echo8 operations → 0to8); `scripts/compare-reference.ts` and recipe 11 prove that only the books moved. Next stages
  (organisation as tenant, operations for the payroll, onboarding, users and roles) are in the brief; the log numbers them differently (D-170 the organization, D-171 roles, D-172 onboarding, D-173 the payroll stage).
- **Stage 2 «Граница арендатора» (D-170, 2026-11-06):** the organization is the isolation boundary (variant A, the
  owner's decision of 2026-11-05): one database, `org_id NOT NULL` on every module table (migration 0016; the live `erp`
  is organization №1 with a fixed id), every module opened under an organization through one helper, one facade per
  organization; a minimal login (`/auth/login`, a JWT in the cookie `erp_session`, `AUTH_MODE` on by default), the
  organization only from the session (`X-Org` for the system administrator), `/orgs*` for the system administrator,
  `scripts/create-user.ts`, the constant 500 with a `requestId`. Labels (0to8, Echo8) stay books inside the
  organization. Clean stack: recipe 12.
- **Stage 3 «Пользователи и роли» (D-171, the brief's «D-172», 2026-11-06):** memberships in several organizations
  (the login asks to choose, `409 org_choice_required`), roles `org_admin` (everything in the organization, «Все») and
  `label_manager` (its own labels only, no approvals, payouts or settings, no money of the whole organization), the
  system administrator without money (organizations and users; an organization only as support under a grant of its
  `org_admin`, ≤ 7 days); revocable sessions (`auth.sessions`, migration 0017), a limit of failed logins, the `Origin`
  rule on writes, scrypt 2^15; an `ability` on every API operation checked by one `authorize` against one rule table,
  `me.abilities` for the UI; record-dependent rights in the facade's `Viewer`. Users of the organization, system users
  and support grants (commit 4) and the frontend (commit 5) were in progress on 2026-11-06.
- **Stage 4 «Онбординг через UI» (D-172, the brief's «D-171», 2026-11-06):** a new label is set up through the UI
  (recipe 13): splits from a csv / xlsx template with a preview and an all-or-nothing apply through the facade
  (`POST /splits/import`), «accept as an assumption» (`POST /splits/assume`: one `assumption` document, money in C
  `assumption`), the document kind `label_decision` (approved = confirms like a contract, money in B), the label history
  of an ISRC derived from the loaded files (`owners.track_labels`, `scripts/derive-track-labels.ts`: 2 436 ISRCs moved
  0to8 → Echo8 from 2025-08) with operator corrections, the release registry from the Believe export
  (`owners.releases`), four information signals, and the onboarding checklists (`GET /onboarding?label=`, the
  organization's for its administrator). The catalog is navigation: no money moves (`tests/catalog.test.ts`). Starting
  balances are out (a later «company accounts» entity). Frontend: P28 import, AssumeDialog, TrackLabelsDialog, the catalog column, the releases registry, the P1 checklist, UploadForm shared.
- **Stage 5 «Ведомость» (D-173, the brief's «D-170», 2026-11-06; committed 2026-11-06 as the backend, the frontend and the docs commits):**
  every operation has a stored kind (`payout`, `advance`, `deduction`, `credit`, `return` as before, plus `buyout` —
  the payment for a buyout, outside `paid` / `payable`, never blocking —, `forgiveness` of an advance, `writeoff` of
  publishing and `adjustment` with a signed amount; migration 0019, the history has no buyouts so no balance moved);
  where the label of an operation came from (`label_source`, 1 315 `default` of D-168) and a reason for every label
  change; the one layer change: the forgiveness in `layers/recoup.ts`; the book fields `buyouts`, `forgiven`,
  `writtenOff`, `adjustments` and the areas master / publishing (the button pays `master` by default); `asOf` (the
  books as of a month, nothing stored); the payroll export per label (`GET /owners/payroll`, json / csv: payroll,
  waiting, buyouts, control); the import of operations from our template (recipe 14); the replacement of a B17
  statement (recipe 15; the Q2 2026 «Updated» run waits for the owner). Starting balances as an entity («company
  accounts»), `legal_name` and `currency` are later.
- **Out of scope until asked:** ASCAP, a password policy and fine-grained rights of managers (D-171), a real payment-service integration (stubbed in
  `facade/payment-service.ts`), caches, PDF parsing, deployment (D-112, D-114 postponed items stand).
- **Waiting for the product owner** (do not "fix" these silently; see `03_decision_index.md`): D-018, D-032, D-035,
  D-041 (only the Q2 «Updated» run, the mechanism is D-173), D-043, D-045, D-049 ("largest"), D-068, D-083 (writer merge), D-087 (equal parts), D-096. D-067 (sub-label)
  is closed by D-123/D-127.

## 6. Where to go next

- Terms in Russian docs ↔ code: `02_glossary.md`.
- Which decisions are in force, by topic: `03_decision_index.md`.
- How to make a typical change without breaking the guard tests: `04_recipes.md`.
- Statements in README/HANDOVER/docs that are out of date, and what wins: `05_doc_drift.md`.
- The MVP goal, in order: `09_settlement_cases.md` (the contract mechanics), `10_target_model.md` (the design as
  built), `11_plan.md` (stages 3–7), `12_golden_cases.md` (hand-computed scenarios = `tests/golden.test.ts`),
  `13_completeness_check.md`, `14_verification.md`, `15_mvp_report.md`.
- The frontend goal, in order: `16_frontend_jobs.md` (the operator's jobs, every reason and signal with its action),
  `17_frontend_model.md` (rules R1-R8, pages P1-P21, components, actions), `18_frontend_plan.md` (libraries, steps, D-entries),
  `19_golden_screens.md` (expected numbers = the Playwright specs in `packages/frontend/e2e/golden/`),
  `20_frontend_report.md` (what is closed and open, the assumptions, the real-data walk, performance).
