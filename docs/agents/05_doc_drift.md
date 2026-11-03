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
| `HANDOVER.md` demo sections | `npm run demo`, `data/demo` | Outdated (D-112); the working data set is the dev database loaded by `scripts/mvp/load.ts` (D-131…D-138) |
| D-067 (⚠ in the old index) | sub-label rule waits for the owner | Owner decision 2 implemented as sublabel rules (`modules/labels`); other imprints use the half rule under an `assumption` document (D-123 Q12) |

The architecture documents and `context_data/` are not edited (README §6); this table is the correction layer.

## Gaps found while writing these guides (not fixed; decide before relying on them)

- **One store per `.env`.** Since D-121 every module lives in the PostgreSQL database of `.env` (and Believe lines
  in its ClickHouse), whatever directory `main.ts <dir>` gets; the directory only holds original files. Switch data
  sets with `DB_DATABASE` / `CLICKHOUSE_DATABASE` (or a separate compose project).
- **The data archive (D-093) predates the move (D-110).** If it contains only `data/real/*.sqlite`, the Believe
  history must be reloaded through the API (`POST /api/v1/sources/believe`, ~11 min for 47 files, D-111) into
  the local stack before the real numbers appear.
- **No frontend tests** (`packages/frontend` has none; `npm test` passes there with `--passWithNoTests`). UI checks
  are manual or through the API contract test.
