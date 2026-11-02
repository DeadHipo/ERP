# The big picture (read this first)

Written 2026-11-01 for AI agents (D-120), refreshed 2026-11-03 for the layered architecture (D-123…D-135). This is a summary: the architecture documents (`docs/01`…`09`, Russian)
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
 Payout button:  pays the whole payable, floored to cents, stores a snapshot (per artist, file hashes)
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
| `owners` (module 1) | owners, artists (pseudonyms), tracks (ISRC+UPC, note), documents (incl. kind `assumption`), contracts, merges | PostgreSQL schema `owners` | 02, 99, ADR-001 | D-016…D-024, D-095 |
| `labels` | our labels (0to8, Echo8), imprint aliases, sublabel rules (percent of the label share to a pseudonym) | PostgreSQL schema `labels` | 10 §1 | D-123, D-125, D-130 |
| `splits` | artist rows per ISRC with validity periods (each row may have its own document), participations (percent of a base, funded from top / artist pool / artist share / label share), buyouts | PostgreSQL schema `splits` | 04, ADR-003, 10 | D-025…D-030, D-126 |
| `sources` | Believe file registry and report lines | PostgreSQL `source_files` + ClickHouse `believe.rows` | 03, 06 | D-031…D-038, D-102…D-114 |
| `publishing` | B17 statements, writers, terms by owner, period and operation type; computes no money | PostgreSQL schema `publishing` | 08 | D-039…D-046, D-083, D-087, D-128 |
| `settlements` | operations in/out, payouts, scope shape; the recoup algorithm moved to the facade | PostgreSQL schema `settlements` | 07 | D-047…D-056, D-072, D-094, D-127 |
| `facade` | nothing stored; composes all modules, runs the layers, recoup, balance, pays | — | 09, 10 | D-012, D-057…D-061, D-127 |

Rules (enforced by `packages/backend/tests/boundaries.test.ts`): a module never imports another module, the facade
or the API; the API never opens a module; only `src/facade/` calls several modules.

Request path: React page → `packages/frontend/src/api/client.ts` → Express router `src/api/routes/<topic>.ts`
(zod schemas from `@erp/shared`) → `facade.<method>` → module services → repositories (all SQL).

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

## 5. State of the project (2026-11-03)

- Iteration 1 is done (`README.md` §2, §5, §8; D-096, D-098). Believe is in PostgreSQL + ClickHouse (D-102…D-114),
  the other modules are PostgreSQL schemas (D-121).
- **The MVP goal, stages 3–6, is built:** layered calculation (D-123, D-127), `labels` module (D-125), participations
  and per-row documents (D-126), publishing by operation type (D-128), API and pages (D-129), council fixes (D-130);
  stage 4 loaded the reference data (D-131…D-134); stage 5 compares with the owner's workbooks
  (`scripts/mvp/compare-*.ts`); stage 6 is the verification (`14`). Stage 7 writes the report.
- **Loaded in the dev database `erp`** (local, git-ignored data): 17 labels (0to8, Echo8 and 15 sublabels) with aliases
  and sublabel rules; ~24 k splits (Annex 14 registered splits, legacy mid-month dates normalised) and the
  participations; Echo8 tracks and splits; the payment history and advances of `0to8 Main.xlsx` (D-132); B17 for 7
  quarters (2024-Q4…2026-Q2, D-134); the contract registry from the PandaDoc index (D-133). Reconciliation:
  discrepancy 0 on every row. Real data stays local: never copy values into the repo.
- **Open for the product owner:** the list of items (negative payables before stage 5 analysis, B17 payees without a
  contract, ambiguous Echo8 names, XENO XID, a second statement for a loaded quarter, …) is in `15_mvp_report.md`
  (written at the end of stage 7) and `13_completeness_check.md`.
- **Out of scope until asked:** ASCAP, authentication and roles, a real payment-service integration (stubbed in
  `facade/payment-service.ts`), caches, PDF parsing, deployment (D-112, D-114 postponed items stand).
- **Waiting for the product owner** (do not "fix" these silently; see `03_decision_index.md`): D-018, D-032, D-035,
  D-041, D-043, D-045, D-049 ("largest"), D-068, D-083 (writer merge), D-087 (equal parts), D-096. D-067 (sub-label)
  is closed by D-123/D-127.

## 6. Where to go next

- Terms in Russian docs ↔ code: `02_glossary.md`.
- Which decisions are in force, by topic: `03_decision_index.md`.
- How to make a typical change without breaking the guard tests: `04_recipes.md`.
- Statements in README/HANDOVER/docs that are out of date, and what wins: `05_doc_drift.md`.
- The MVP goal, in order: `09_settlement_cases.md` (the contract mechanics), `10_target_model.md` (the design as
  built), `11_plan.md` (stages 3–7), `12_golden_cases.md` (hand-computed scenarios = `tests/golden.test.ts`),
  `13_completeness_check.md`, `14_verification.md`, `15_mvp_report.md`.
