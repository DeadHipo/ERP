# Decision index (D-001 … D-138 by topic)

Written 2026-11-01 (D-120). `docs/97_принятые_решения.md` is append-only, so an old entry keeps its old status
even when a later entry replaced it. This index records the **effective** status. When you add a D-entry, add
one line here too.

How to read a decision fast: `awk '/^## D-087:/,/^- Status/' docs/97_принятые_решения.md`.
Paths in entries before D-116 are old: read `src/…`, `tests/…`, `scripts/…` as `packages/backend/…`,
`client/…` as `packages/frontend/…`, `/api/…` as `/api/v1/…` (D-118), `../../data/…` as `context_data/…` (D-115).

Legend: **in force** · *refined by* (read both) · ~~replaced~~ (read the newer one) · ⚠ waits for the product owner.

## Process, layout, infrastructure
- D-001 ORM: Drizzle + better-sqlite3 · *refined by* D-107 (pg + @clickhouse/client), D-121 (SQLite removed: Drizzle pg-core)
- D-004 No git commit/push unless asked · in force
- D-005 Data volume: July 2026 first · historical (full history loaded, D-086, D-111)
- D-006 Reference check vs old ERP · in force
- D-009 Layout and module boundaries, enforced by tests · in force (paths: D-116)
- D-011 Portability to PostgreSQL · in force
- D-013 No auth, stubbed payment service, payout threshold · in force
- D-014 Sensitive sources (bank, wio, payroll, tipalti) not used · in force
- D-015 Start scripts, data directory · *refined by* D-112 (no demo mode), D-116 (paths)
- D-077 Handover package · *refined by* D-093 (two archives)
- D-093 Code archive + data archive · in force
- D-103 Docker Compose (lifts the old "no Docker" rule) · in force
- D-105 PostgreSQL migrations as a one-shot compose service · in force
- D-106 pgAdmin in dev stack · in force
- D-107 pg + Drizzle, @clickhouse/client · in force
- D-115 One repo; docs in `docs/`, reference data in `context_data/` · in force
- D-116 npm workspaces `packages/{backend,frontend,shared}` · in force
- D-117 `repository.ts` in every module, facade split by topic, private test folders · in force
- D-121 Modules owners/splits/settlements/publishing on PostgreSQL (schema per module, soft cross-module refs, async, global write lock, cross-module transactions, data transfer script) · in force
- D-118 Routers per topic, `/api/v1` · in force
- D-119 API contract as data, OpenAPI, Swagger · in force
- D-120 Agent guides in `docs/agents/`, nested CLAUDE.md files · in force

- D-140 Operator trace: `X-Operator` required on writes, the `audit` module and `GET /audit`; private stores shared by tests and e2e; `CLICKHOUSE_DATABASE` honoured by `connectSources` (corrects D-121) · in force; допущение: one operator role

## Money and consistency
- D-002 Exact decimals, cents for operations, round only at payout · *refined by* D-010
- D-010 Pico-USD integers for source amounts · in force (ClickHouse stores `Decimal(38,12)`, D-102)
- D-012 One consistent read per calculation · in force (sources read first, then all modules in one PostgreSQL REPEATABLE READ snapshot, D-121)

## UI
- ~~D-003 Server-rendered pages~~ → D-007
- D-007 Minimal React app · *refined by* D-139 (HeroUI + Tailwind, TanStack Query, AG Grid; React, Vite, TypeScript, the typed client stay)
- ~~D-062 UI scope (minimal UI without a kit)~~ → D-139
- D-076 Payout button disabled when nothing is payable · in force
- D-100 Flows shown in the UI on data/real · in force
- D-113 Lines page `/sources/lines` · in force
- D-129 API and pages for labels, participations, terms by type, track notes; shared `REASON_LABELS` · in force (the pages are replaced by the frontend goal, D-139 …)
- D-144 The frontend foundation: shell, components with test hooks, the client contract (schema.parse, X-Operator), the money text rule, eslint money bans and guard tests, `npm run e2e` on private stores, legacy pages under `/legacy/*` · in force; допущения A4, A7, A8
- D-139 Frontend goal design: rules R1–R8 with machine checks, the stack pinned, operator trace, payout gate as a field, e2e on private stores; the event loop and the money text as допущения · in force; changes D-119 (the client parses responses), corrects D-121 (ClickHouse database name, N20)

## Module 1: owners, artists, tracks, documents
- D-016 Document status · in force
- D-017 When an owner/artist is confirmed (payout gate) · in force
- ⚠ D-018 Contract record without personal data
- D-019 Owner of an existing artist is fixed · in force until 99/11 is decided
- D-020 Merge rules · in force
- D-021 Possible duplicates shown, never merged · in force
- D-022 Tracks and the artist-track link · in force
- D-023 Unknown ISRC/UPC pair in Believe · in force
- D-024 Upload deadline (display only) · in force
- D-080 Zero catalogue as a second catalogue source · in force
- D-095 Merged artists in splits and buyouts · in force

## Splits
- D-025 Report date, exclusive end · in force
- D-026 Split change semantics · in force
- D-027 Buyout · in force
- D-028 Split confirmation, percent format · in force
- D-029 ISRC without split → our share · in force
- D-030 Base split templates not implemented · in force
- D-126 Participations, per-row documents, month-start rule dates · *refined by* D-130 (end dates floored too, `empty_period`; overlap key with the source artist)

## Labels
- D-125 Labels module (own labels, aliases, sublabel rules); tracks.note; document kind assumption · in force

## Sources (Believe)
- D-031 File name, account, month, generation date · in force
- D-032 Line key, summing, control check · in force; ⚠ which fields to store
- D-033 Duplicates and the original file · in force
- D-034 Upload robustness (serialized per module) · in force (plus one advisory lock over all writes, D-121)
- ⚠ D-035 Lines without ISRC and negative lines (M10)
- D-036 Unit of calculation · in force
- D-037 Performance target · historical (measurements: D-111)
- D-038 Other accounts and sources · in force
- ~~D-088 `source_units` aggregate in SQLite~~ → retired by D-110 (ClickHouse views)
- D-102 ClickHouse storage design · in force (its "needs measurement" was done in D-111, closed in D-114)
- D-104 Registry in PostgreSQL, load order · in force
- D-108 Loader for ClickHouse + registry · in force
- D-109 Sources service on PG + CH · in force
- D-110 Facade/API on new sources, SQLite sources code removed · in force
- D-111 Whole history loaded, measurements · in force
- D-112 Scope and accepted limits of the move (no demo mode, no replace/delete API, manual recovery of `loading`) · in force
- D-114 Move closed; publishing is next · in force
- D-122 Aggregate projection `units` in `believe.rows` (the `units` view reads it; not a MV: ATTACH does not trigger one); step timings with `LOG_TIMINGS=1` · in force
- D-124 Believe unit carries the label string: projection `units_by_label` replaces `units` (migration 0003), `SourceUnit.labelName`, deterministic `ORDER BY` in `columnar.units()` · in force

## Publishing (B17)
- D-039 B17 format · *refined by* D-087
- D-040 xlsx reading, precision · in force
- ⚠ D-041 Second statement for the same quarter is an error ("Updated" statements)
- D-042 Writer → owner resolution · in force
- ⚠ D-043 Author percent (default 50 %) and its confirmation
- D-044 Publishing dates · in force
- ⚠ D-045 Publishing buyouts
- D-128 Publishing terms by operation type (part 1: module; migration 0009, `setTerms({ operationType })`, typed term wins; part 2: writer parts, author share and B/C as pure facade layers `PUBLISHING_LAYERS`, the module only returns `snapshotForCalculation()`, G26a–e) · in force · *refined by* D-130 (12 decimals in the publishing layers)
- D-046 Merge and publishing · in force
- ~~D-082 Real B17 not loaded~~ → D-083
- D-083 Real B17 loaded into data/real · in force; ⚠ merge of writers into confirmed owners
- D-086 Full history in data/real, writer legal names as aliases · in force (8 rights-holders: operator maps them)
- D-087 Line belongs to our writers in `songwriters`, equal parts · in force; ⚠ equal parts until contract shares
- D-090 Handover contains name links (owner's instruction) · in force

## Settlements and payouts
- D-047 Operations: direction, sign, meaning · in force
- D-048 What counts in the balance · in force
- D-049 Recoupment rules · *refined by* D-072 (cap, order) and D-094 (negative lines); ⚠ "largest" = position amount
- D-050 Payable formula, negative balance · in force
- D-051 Payout button · in force
- D-052 Blocking, deferral, returns · in force
- D-053 Payout snapshot · in force (B17 hashes too: D-100)
- D-054 Settlements kept on the artist's owner at creation · in force
- D-055 Bad-debt write-off not implemented · in force
- D-056 Soft rollback of operations · in force
- D-072 Recoupment capped by net income in scope · in force
- D-073 Operations follow merged artists; document kinds; deferral checks · in force
- D-094 Negative lines use up the income they cancel · in force

## Facade
- D-057 Completeness check A/B/C and alarms · *refined by* D-127 (per account, ours from the layer state, discrepancy = A − B − C − ours)
- D-058 Owner view figures · in force
- D-059 Split artist without an owner → C · in force
- D-060 API composes modules only through the facade · in force
- D-061 Signals use the chosen date basis · in force
- D-123 Layered calculation of the master money (MVP goal design: labels module, participations, layer order, C reasons `assumption` / `rule_unconfirmed` / `label_unmapped`, council decisions Q1…Q12) · in force (design); closes D-067 ⚠ by owner decision 2 of 2026-11-02
- D-127 Master layers in `facade/layers/` (label of record → perimeter → off the top → split → carves → categorise; 12-decimal quantisation, remainders by subtraction, residue to the largest), reconciliation per account with `ourShare` from the layer state and `ourShareByLabel`, new C reasons as one shared enum, new signals, explain per layer, recoup moved to the facade · in force
- D-130 Stage 3 council fixes: end dates floored to the month start (`empty_period`, facade `closeLabelRule`), sign-safe rounding at exactly 100 (`capToBase`, `distributeCapped`), 12 decimals in the publishing layers, participation overlap key with the source artist (migration 0010), `ownerBalance().byLabel` (B and C per label of record; paid is one total), the M18 channel rule · in force
- D-141 The C queue (`cItems` shared with `reconcile()`, groups per reason), `GET /queue/:reason`, `GET /overview` in one calculation, signals with `counts` and `limit` on every list, `storedPath` dropped · in force
- D-136 Signals `sublabelWithoutRule`, `ruleRecipientIsRow`, `twoRowsOneOwner` (no amount changes); catalogue M53–M58 and the out-of-scope list completed · in force

## Data import, demo, reference checks
- D-008 Reconstructed files for the demo · *refined by* D-079 (real reports exist), D-112 (no demo mode)
- D-063, D-064, D-065, D-066 Legacy import (owners, tracks/splits, buyouts, reconstructed B17) · in force for the import script
- D-067 Reference check master July 2026 · *refined by* D-081; closed by D-123/D-127: sublabel rule (owner decision 2)
- D-068 Reference check B17 2026-Q2 · in force; ⚠ publishing buyout/override modelling
- D-079 Real July 2026 report loaded · in force
- D-081 Reference check on the real July report · in force
- D-089, D-092, D-097 Acceptance and end-to-end checks on real data · historical records

## Data of the MVP goal
- D-131 Reference data of the MVP loaded through the facade (`scripts/mvp/load.ts`, idempotent by `mvp:<step>:<key>` markers): labels dictionary and sublabel rules, 9k tracks, Annex 14 registered splits (211 created, 80 changed), legacy mid-month dates normalised, 108 participations, Duetti buy-out splits, Echo8 splits (9,772, 387 with an RSA document) · in force · open: XENO XID (Schedule A), 17 pp buy-outs, 22 empty Annex records, M51 (196 ISRC), 415 Echo8 ISRC with an ambiguous name
- D-132 Payment history and advances of `0to8 Main.xlsx` loaded (2,555 payouts/advances out, 104 deductions/carves in, 30 documents only), cash reconciled to 8,045,246.75; publishing terms by type for the exclusive administration agreement (90 % general, 50 % Synchronization) · in force · open: 25 rows of three ambiguous nicknames, 3 held credit rows, 3 carve rows covered by a participation
- D-133 Contract registry loaded from the PandaDoc index (`load.ts contracts`: 440 contract documents with contracts rows, 61 appendices) and 3,504 legacy splits equal to the owner's Annex 14 registry confirmed by it · in force · open: B17 payees (legal-name owners) have no contract, 123 index documents without a stage-name match, 320,636.21 of account 1055956 without a split document
- D-134 B17 statements 2024-Q4, 2025-Q1 (one file) and 2025-Q2 loaded through `facade.ingestB17` (`scripts/mvp/load-b17.ts`): 39,654 and 68,703 lines, b17 reconciliation 7 quarters at discrepancy 0 · in force · open: the Updated Q2 2026 file stays refused (D-041 ⚠)
- D-135 Stage 6 data fixes (`load.ts pairs|label-fixes|lunar|b17-holders|carves`): 44 Believe pairs of known ISRC registered (unknown_pair 150k -> 0), rule of `lost` closed, LUNAR MEDIA 10 % as 34 assumption participations, 13 B17 holders confirmed by their own contracts, 336 carve participations (55 deductions deactivated) and 3 held payouts · in force, *refined by* D-137 (the 336 artist-share carves replaced by 141 pool participations of net; the 336 deleted) · open: 24 carve groups without a stated percent, 19 B17 holders unmatched, D-083 ⚠
- D-137 Stage 6 rework (`load.ts settlement-prestart|carves|assumption-rows|hygiene`): settlement share before 2026-02 to the paid artist (38 splits, participant −137,982.02, LDRR +137,982.02), Main carves as 141 pool participations of net from the first report month (336 D-135 participations deleted; carved 4,967.80 → 107,914.94), Q1/Q5 assumption row documents (68 splits, 19,439.80 B → C), 50 empty-period splits deleted and `normalise-dates` refuses them; splits service `deleteEmptySplits` / `deleteParticipations` (loader only); golden cases G45, G46 · in force, *refined by* D-138 (settlement share pro rata) · open: carve groups 7, 17, 41, the 24 groups without a percent, owner confirmation of the assumption documents
- D-138 Stage 7 closing (`load.ts settlement-prestart`): the settlement participant's legacy percent before 2026-02 spread pro rata over the other legacy rows (Main payment fact; a bought-out 0 row takes nothing, its part stays ours); 20 splits re-entered under owner decision 6, 20 empty periods removed by `hygiene`; DJ Ikeraus +7,886.93, RD12 and DJ MRCL +136.56, ours +165.80, LDRR −8,325.86; golden case G47; `scripts/mvp/decompose-main.ts` (owner decomposition, 641 / 161 at max(1.00, 2 %)); report figures of 13 §1 and 15 refreshed incl. report month 2024-01; held-payout nickname replaced in the docs · in force · open: the 165.80 after the buy-out (Annex differs), owner check

## Review rounds (history; read when touching the reviewed area)
- D-069, D-070 First reviews · D-071 verification (counts → D-078)
- D-073, D-074, D-075 Second round · D-078 verification
- D-084 Round 3 · D-085, D-091 Final reviews · D-096 Second final round (⚠ company-payee owner for B17)
- D-098 README §5 coverage: every rule has a test · D-099, D-100, D-101 Pages and last review items

## Waiting for the product owner (do not change silently)
D-018, D-032 (stored fields), D-035, D-041, D-043, D-045, D-049 ("largest"), D-068 (override),
D-083 (writer merge), D-087 (equal parts), D-096 (company payee). Cross-module open questions: `docs/98_*.md`
(M2, M5, M7, M8, M10…M13); module 1: `docs/99_*.md`.
