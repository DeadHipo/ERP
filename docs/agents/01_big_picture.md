# The big picture (read this first)

Written 2026-11-01 for AI agents (D-120). This is a summary: the architecture documents (`docs/01`…`09`, Russian)
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
 Believe CSV ──► sources ──► unit = ISRC+UPC+report month+sales month, net
                               │
                               ├─ ISRC empty?               ──► C "no_isrc"        (unallocated)
                               ├─ ISRC+UPC not in owners?   ──► C "unknown_pair"   (unallocated)
                               ├─ no split for ISRC?        ──► all of it is OUR share
                               └─ split at report date ──► per share: amount = net × percent
                                                              ├─ split doc not approved ─► C split_unconfirmed
                                                              ├─ artist has no owner    ─► C artist_without_owner
                                                              ├─ owner not confirmed    ─► C owner_unconfirmed
                                                              └─ otherwise              ─► B (not ours, confirmed)
                                                            our share = net − Σ shares
 B17 xlsx ──► publishing ──► Total Payable × author percent ─► B or C (writer_unmapped,
                                                                owner_unconfirmed, publishing_terms_unconfirmed)
                                                            label keeps the rest

 Completeness check per source and month:   A (received) = B (not ours) + C (waiting) + our share
 Owner balance:  payable = earned (B) − recouped − payouts with proof + returns + credits
 Payout button:  pays the whole payable, floored to cents, stores a snapshot (per artist, file hashes)
```

Code: `packages/backend/src/facade/calculation.ts` (`calculate`, `reconcile`), `facade/balance.ts`
(owner balance, recoupment), `facade/payouts.ts` (operations, payout button). Read `calculate()` once: it is
about 150 lines and it *is* the domain.

Three consequences that surprise newcomers:
- **Category C is not lost money.** It is calculated per artist but held back until a document is approved.
  Approving a document moves money from C to B on the next request. Nothing is "posted".
- **Names never decide money.** Performer names in reports are metadata. Recipients come only from splits (master)
  and from the `songwriters` → owner mapping (publishing).
- **Payable is not an obligation.** It changes whenever a report, split or document changes. Only the payout
  snapshot is fixed.

## 3. Modules (independent) and the facade (the only composer)

| Module | Owns | Storage | Docs | Key decisions |
|---|---|---|---|---|
| `owners` (module 1) | owners, artists (pseudonyms), tracks (ISRC+UPC), documents, contracts, merges | `owners.sqlite` | 02, 99, ADR-001 | D-016…D-024, D-095 |
| `splits` | shares per ISRC with validity periods, buyouts | `splits.sqlite` | 04, ADR-003 | D-025…D-030 |
| `sources` | Believe file registry and report lines | PostgreSQL `source_files` + ClickHouse `believe.rows` | 03, 06 | D-031…D-038, D-102…D-114 |
| `publishing` | B17 statements, writers, publishing terms | `publishing.sqlite` | 08 | D-039…D-046, D-083, D-087 |
| `settlements` | operations in/out, payouts, scopes, recoupment | `settlements.sqlite` | 07 | D-047…D-056, D-072, D-094 |
| `facade` | nothing stored; composes all modules, calculates, pays | — | 09 | D-012, D-057…D-061 |

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

No floats for money anywhere: `tests/rules-coverage.test.ts` greps `src` for `Number(` and allows only a fixed list.
Splits are chosen by **report date** (first day of the reporting month); `valid_to` is exclusive (D-025).
Period filters use report date by default, sales date on request (README §5; signals follow the chosen basis, D-061).
Publishing has no sales date: both bases use the statement's quarter-end month.

## 5. State of the project (2026-11-01)

- Iteration 1 is done: everything in `README.md` sections 2, 5 and 8, with tests for every rule in section 5
  (D-096, D-098). Believe moved to PostgreSQL + ClickHouse (D-102…D-114). Monorepo, `/api/v1`, OpenAPI (D-116…D-119).
- Real data: all 47 Believe files (two accounts, ~76M lines) and the B17 statements load through the API into
  `data/real` (D-086, D-111). Reconciliation with the old ERP for July 2026: every difference explained (D-067, D-081,
  D-092).
- **Next, according to the log:** publishing (B17) is the next module to move/review (D-114). Postponed on purpose
  (D-112, D-114): replacing/deleting a loaded file via API/UI, app deployment (no Dockerfile), backups, server memory
  during a calculation, the 5–6 s recalculating pages, the slow split list, demo mode.
- **Out of scope until asked:** ASCAP (iteration 2), authentication and roles, a real payment-service integration
  (stubbed in `facade/payment-service.ts`), caches, PDF parsing.
- **Waiting for the product owner** (do not "fix" these silently; see `03_decision_index.md`): D-018, D-032, D-035,
  D-041, D-043, D-045, D-049 ("largest"), D-067 (sub-label), D-068, D-083 (writer merge), D-087 (equal parts), D-096.

## 6. Where to go next

- Terms in Russian docs ↔ code: `02_glossary.md`.
- Which of the 119 decisions are in force, by topic: `03_decision_index.md`.
- How to make a typical change without breaking the guard tests: `04_recipes.md`.
- Statements in README/HANDOVER/docs that are out of date, and what wins: `05_doc_drift.md`.
