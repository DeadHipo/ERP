# ERP (new architecture): instructions for agents

You are building the first iteration (MVP) of a music-label royalty ERP **from scratch**, following the architecture documents in `docs/`. Those documents are written in Russian; read them in full before writing code. All code, comments, identifiers, docs and commit messages you produce must be in **English**.

## 1. Sources of truth (read in this order)

1. `docs/00_README.md`, `docs/01_принципы.md` (principles)
2. Module docs: `docs/02_модель_данных.md` (module 1: owners, artists, tracks, documents), `docs/04_модуль_сплитов.md` (splits), `docs/06_модуль_источников.md` (sources: Believe), `docs/07_модуль_взаиморасчётов.md` (settlements and payouts), `docs/08_модуль_паблишинга.md` (publishing), `docs/09_фасад.md` (facade)
3. `docs/98_межмодульные_вопросы.md`, `docs/99_открытые_вопросы.md`, `docs/решения/ADR-*.md`
4. `docs/аудит/закрытые_вопросы.md` (decisions already taken during the audit)
5. `docs/97_принятые_решения.md` (decisions you and other agents take during implementation)

If documents conflict, the newer dated statement wins. The old projects under `context_data/data/` (`erp`, `zero-erp`) are an **information source only**: read their documents, code and databases to understand how things worked, but do not run them, do not start their servers or containers, and do not use Docker. Databases are opened strictly read-only. Everything under `context_data/data/` is **reference material only**: never edit it, never import code from it, and do not take it at face value (verify against the architecture documents). It contains two old projects, `context_data/data/erp/` (with `build/`, `docs/`) and `context_data/data/zero-erp/`, the data folder `context_data/data/data/`, and contract examples (`context_data/data/Договора образцы/`, `context_data/data/Паблишинг — отдельные договоры/`, `context_data/data/контракты 0to8/`, `context_data/data/03_контракты/`).

## 2. Scope of iteration 1 (MVP)

- Sources: **Believe** (master) and **B17** (publishing). ASCAP is the second iteration; do not build it.
- Modules (independent): `owners` (module 1), `splits`, `settlements` (settlements and payouts), `publishing` (one SQLite file each), `sources` (Believe: registry in PostgreSQL, lines in ClickHouse, since 2026-10-31, D-110), plus the `facade`.
- A working **JSON API** (Express) and a **minimal React web UI** that shows data and calculations: upload reports, browse owners/artists/tracks/splits, confirm things by document, see the owner balance (earned, paid, waiting for confirmation, payable), create payouts and adjustments.
- Documents: a registry of documents (file reference, uuid, status, "requires manager approval" flag, upload deadline). No PDF parsing in iteration 1; data is entered manually. Example contracts are provided under `context_data/data/Договора образцы/` and `context_data/data/Паблишинг — отдельные договоры/`; for other cases invent **dummy contracts** as fixtures.
- No authentication or roles yet (access rights are postponed).
- Out of scope: production deployment, real payment-service integration (stub it), ASCAP, caches.

### Acceptance scenario
Load the July 2026 Believe report and the B17 statements, import owners/artists/splits, then ask the facade for an owner's totals and create a payout. As a **reference check** compare the result for one month with the accruals of the current ERP (`context_data/data/erp/data/erp.db`). Differences are **expected**: explain each one and log it in `97_принятые_решения.md`; they are not automatic failures.

## 3. Tech stack (fixed)

- Node.js (current LTS), npm, **TypeScript in strict mode**
- **Express** for the API; **zod** for input validation
- **SQLite** via `better-sqlite3`, **Drizzle ORM**; **one database file per module** under `data/` (git-ignored)
- Vitest for tests; ESLint + Prettier
- Money: `decimal.js`
- UI: minimal **React + Vite + TypeScript** single-page app in `packages/frontend/` (React Router, a small typed API client that reuses the zod schemas from `packages/shared/`, plain CSS, no UI kit). Express serves the JSON API and, when the client is built, its static files.

**Not allowed:** Redis, message queues, cloud services or any other infrastructure beyond what is listed here. **Changed 2026-10-31 on the owner's instruction (D-102, D-103, D-110):** the sources module runs on PostgreSQL 18 and ClickHouse 26.8 in Docker (`docker-compose.yml`); the other modules stay on SQLite. Do not reuse the old projects' setups (for example `context_data/data/zero-erp/`).

Keep the data layer **portable to PostgreSQL**: ISO-8601 text dates, integer money where possible, no SQLite-only SQL features, all queries behind repository functions per module.

## 4. Layout (create it)

```
ERP/
  docs/              # architecture documents (Russian), decision log 97_*.md
  context_data/      # reference material, git-ignored (see context_data/README.md)
  package.json         # npm workspaces root: `packages/*`; one `npm ci`, one package-lock.json
  docker-compose*.yml  # PostgreSQL + ClickHouse (+ pgAdmin in dev)
  data/                # SQLite files and uploads (git-ignored)
  packages/
    backend/           # @erp/backend: Express API, modules, facade, scripts, migrations, init, config, tests
      src/
        shared/        # money, dates, ids, normalization (ISRC), errors, db wrappers
        modules/
          owners/      # module 1
          splits/
          sources/     # Believe now, others later
          settlements/ # operations in/out, payouts, adjustments
          publishing/  # B17 now
        facade/        # the only place that composes modules
        api/           # Express routes (JSON only)
      tests/           # synthetic test data only
      scripts/  migrations/  init/  config/
    frontend/          # @erp/frontend: React + Vite UI (one folder per module in src/)
    shared/            # @erp/shared: code used by both sides (api-schemas.ts, zod only)
```

Rules: a module never reads another module's database. Modules expose a typed service interface; only the **facade** calls several modules. Modules do not know about the facade.

## 5. Domain rules you must not break

Keys and normalization
- ISRC: no dashes, upper case. A track record is identified by the pair (ISRC, UPC); splits are keyed by **ISRC**. Performer/artist/label names in reports are metadata only: never match people by them.
- Believe line key = account, reporting month, sales month, platform, country, ISRC, UPC, currency, subscription type, sales type, release type. Lines with the same key are **summed** (quantity, gross, net). A second file for an already loaded (reporting month, account) is an **error**; store sha256 and generation date of every file.

Money
- Everything inside the system is **USD**. Source amounts keep full precision (up to 12 decimals); round only when forming a payout. Never use floats.

Splits (module `splits`)
- Store artist and MC shares only; **our share is the remainder** (100 minus the sum); the sum must not exceed 100. One level only: split per track (ISRC). Validity periods per ISRC never overlap; the split is chosen by the **report date**.
- A split without a confirming appendix is calculated but excluded from the totals (category C, "waiting for confirmation").
- A buyout is a split change (seller share becomes 0 on the listed ISRC) confirmed by a document; the buyout payment is not part of the balance.

Documents and owners (module 1)
- Contract is concluded with the **owner**; the artist is a pseudonym of the owner (strictly one owner per artist). Payout is possible only for an owner with an approved document. The artist-to-track link is informational and never decides who gets paid.
- Unknown author in a publishing report: create an owner without documents (status "waiting for documents") and accrue to it; merge later (the unconfirmed one merges into the confirmed one). Unknown ISRC/UPC pair in a Believe report: create nothing, keep the lines, raise a signal; the amount is shown as "unallocated".

Settlements and payouts
- Operations are `in` or `out` with a signed amount and optional fields (artist, period, scope, document, payment proof, operation id). No operation types.
- Any payout that must be recouped (advance, bonus) has a mandatory **scope** (master, publishing, both, specific ISRC, exclusions); it is recouped only from income in scope, after its date, largest first; the unrecouped rest never reduces other income. Settlements are tied to the artist, payouts go to the owner.
- A payout counts once the payment proof exists; a return is a separate operation linked by operation id; a deferred payment blocks new payouts for that owner. Balance may be negative (shown as 0 to the owner).
- Payout on demand: one amount per owner.

Publishing
- B17: use `Total Payable`. Money is accrued to the owner (never to a label). The author gets the contract percentage (usually 50/50), the remainder stays with the label.

Facade
- Everything is recalculated from scratch for the requested period and "today"; the totals reconcile as: A received, B not ours (confirmed artist/owner money), C waiting for confirmation; our share is A minus B minus C. At payout time store a snapshot (per artist breakdown, file hashes). Period filters use either report date or sales date (both stored; default report date).

## 6. Working agreement

- **Never stop to ask.** When something is undefined or contradictory: pick the simplest reasonable option consistent with the documents, implement it, and append the question and your decision to `docs/97_принятые_решения.md` (format inside that file). Do not edit the architecture documents themselves.
- Allowed without asking: create files in the repository (outside `docs/` and `context_data/`), install npm packages, run migrations and tests, create/delete SQLite files under `data/`.
- Not allowed: modifying anything under `docs/` except appending to `docs/97_принятые_решения.md`; deleting or editing anything under `context_data/`; running `git commit` or `git push` unless the user asks.
- **Personal data:** the source folders contain personal data (passports, names, addresses, emails). Never copy it into the repository, fixtures, tests, logs or docs. Use synthetic data in fixtures. Real data may only be read from `context_data/data/` at import time.
- Large files: the Believe CSV files are up to 1 GB each. Stream them; never load a whole file into memory. Develop against one month first (July 2026), full history later.
- Definition of done for a task: types compile (`tsc --noEmit`), tests pass, and the decision log is updated.

## 7. Where the input data is

- Believe reports: `context_data/ERP_data/believe/raw/` (monthly CSV, `;` separated, zipped)
- Splits (Backstage): `context_data/ERP_data/splits/splits.db`, `context_data/ERP_data/splits/raw/`
- Publishing (B17 statements, ASCAP, catalog): `context_data/ERP_data/publishing/`
- Artist/contract reference: `context_data/data/03_контракты/`, `context_data/data/контракты 0to8/`, contract examples in `context_data/data/Договора образцы/` and `context_data/data/Паблишинг — отдельные договоры/` (contains personal data)
- Current ERP database for the reference check: `context_data/data/erp/data/erp.db`; the second old project is `context_data/data/zero-erp/`

## 7a. Provenance of the data and more data coming

- The reference data was exported from the data provider's machine, original location `C:\Users\itvin\Downloads\for claude\data` (Windows). That path is **provenance only**: it does not exist on this computer, never try to open it. In this repository the same material lives under `context_data/data/` (archive name `erp_review_pack_D_2026-10-21`, about 1.5 GB).
- The folder `context_data/data/` mirrors that provider folder one to one (same sub-folders and files), so paths relative to it are the same on both computers. New material will be placed into `context_data/data/` with the same layout.
- `context_data/data/` will contain two archives, `typereal_fronend.zip` (spelled this way; look for similar names) and `typereal.ai.backend.zip`. Use them only as **examples of project structure** (folder layout, module boundaries, conventions, how a frontend and a backend are organized). Do not copy their code and do not use their infrastructure (Docker, Redis, etc.). Extract each into a separate new temporary directory outside the repository and `context_data/data/`, never run their code, install scripts or containers, only read.
- More material will be added to `context_data/data/` later. Do not assume the folder list above is complete: look at what is actually there.
- Notes from the data provider about folders that may appear:
  - `easystaff.I`, `main_sheet.I`, `tipalti.I`: service copies of test stands. They are **not** a source of truth; prefer the plain `easystaff`, `main_sheet`, `tipalti` folders and ignore the `.I` copies unless you need to compare.
  - `bank`, `wio`: bank statements, the founders' financial circuit. **Sensitive**: read only if a task needs it (for example, confirming that publishing money arrived), never copy values into the repository, fixtures, tests, logs or docs, and do not use them in iteration 1.

## 8. Pages (minimal React frontend)

Keep it small: one React page component per page, shared table/form components, data fetched from the JSON API, modular structure (one folder per domain module under `client/src/`). Required pages:

- `/owners`: list of owners, create an owner; `/owners/:id`: the owner, its artists (pseudonyms), tracks with ISRC, documents and their status.
- `/documents`: document registry; attach a document, mark it approved (for documents that require manager approval).
- `/splits`: splits per ISRC with validity periods, our share shown as the remainder; create and change a split with a confirming document.
- `/sources`: uploaded Believe and B17 files (name, sha256, generation date, status); upload a file; the duplicate-period error is shown clearly; unallocated amount for unknown ISRC/UPC pairs.
- `/owners/:id/balance`: the facade view for an owner with a period filter and the report/sales date switch: earned, paid, not ours (B), waiting for confirmation (C), our share, payable; per-artist and per-track breakdown.
- `/settlements`: operations in/out; create a payout or an adjustment with a scope; payout block while a payment proof is missing.

Verification: `vite build` succeeds; for every page show it rendered with real data loaded from the July 2026 report (a screenshot through a browser tool, or a component test asserting the key data); the API responses behind it are shown too.

## 9. Independent review agents

Use separate background agents to raise quality; do not wait for permission.

- After each module, start an independent reviewer agent that reads the module code, its tests and the architecture documents, and returns a list of violations of the rules in section 5 and gaps against the module document. Give it only the file paths, not your own conclusions.
- Use search agents to read the old projects and notes under `context_data/data/` (plans, reports, md files) and report how something worked and what pitfalls were recorded.
- Use a reconciliation agent to compare one month with the current ERP and explain every difference.
- Reviewer and search agents only read; code writing agents work only outside `docs/` and `context_data/`. You verify their findings yourself, fix real problems, and record the outcome in `docs/97_принятые_решения.md`.
# ERP
