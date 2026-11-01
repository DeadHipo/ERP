# Documentation drift: what is out of date, and what wins

Written 2026-11-01 (D-120) after reading all top-level docs against the code. The project changed fast on
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
| `README.md` §2 | "Modules … one SQLite file each" | True for 4 modules; `sources` is PostgreSQL + ClickHouse (D-110) |
| `README.md` §8 | `client/src/` | Fixed in D-120: `packages/frontend/src/` (D-116) |
| `README.md` §9 | "start review agents, do not wait for permission" | Was the brief of the build session. In a normal task, follow the user's instructions about agents |
| `HANDOVER.md` | 133 tests; D-001…D-101 | 186 tests on 2026-11-01; D-001…D-120. A banner was added on top (D-120); the body is unchanged |
| `HANDOVER.md` | `npm run demo` works with `data/demo` | No demo mode since the move: demo data has no Believe data and is not maintained (D-112) |
| `HANDOVER.md` | `data/real` holds `sources.sqlite` (~26 GB) | Believe lines live in PostgreSQL/ClickHouse (D-110); see "One Believe store" below |
| `CLAUDE.md` (before D-120) | `npx tsx src/main.ts data/real`; `npm run demo` | `npx tsx packages/backend/src/main.ts data/real`; demo outdated (fixed in D-120) |
| `docs/00_README.md` | "Модули 2–5 … пока не описаны"; link to `docs/СОСТОЯНИЕ_ERP_2026-10-26.md`; `README.md` in `docs/` | All modules are described in 04…09; the state file and `docs/README.md` do not exist (the README is in the root) |
| `docs/09_фасад.md` | Status "обсуждается" | Implemented as described; deviations are in D-057…D-061 |
| `context_data/context/README.md` | opens `новая_архитектура/app`; D-001…D-093 | Repository root is `ERP/` (D-115); log goes to D-120 |
| `.env.example` comment | Postgres for "owners, splits, settlements, publishing" | Those four are still SQLite; only the file registry is in PostgreSQL (D-110, D-112). The comment is the target, not the state |
| D-entries before D-116 | `src/…`, `client/…`, `/api/…`, `../../data/…` | See the path note at the top of `03_decision_index.md` |

The architecture documents and `context_data/` are not edited (README §6); this table is the correction layer.

## Gaps found while writing these guides (not fixed; decide before relying on them)

- **One Believe store for every data directory.** `main.ts <dir>` switches the SQLite files, but PostgreSQL and
  ClickHouse come from `.env` and are the same for `data/real`, `data/demo`, `data/dev` or an empty dir. Running
  on another data directory mixes its owners/splits with whatever Believe files the stack holds. Use a separate
  `DB_DATABASE` / `CLICKHOUSE_DATABASE` (or a separate compose project) per data set.
- **The data archive (D-093) predates the move (D-110).** If it contains only `data/real/*.sqlite`, the Believe
  history must be reloaded through the API (`POST /api/v1/sources/believe`, ~11 min for 47 files, D-111) into
  the local stack before the real numbers appear.
- **No SQLite migrations** (see `04_recipes.md` §3): a new column on an existing table does not reach existing
  databases.
- **No frontend tests** (`packages/frontend` has none; `npm test` passes there with `--passWithNoTests`). UI checks
  are manual or through the API contract test.
