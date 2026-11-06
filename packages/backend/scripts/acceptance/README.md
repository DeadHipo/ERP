# Acceptance of «label from zero» on a clean stack

`clean-stack.sh` rebuilds the reference data from the files on disk, starting from an **empty** stack, inside one
organization with a password login. It then proves the payroll against the reference API answers. It follows
recipes 9, 11, 12 and 13 of `docs/agents/04_recipes.md` and D-169…D-172.

```
packages/backend/scripts/acceptance/clean-stack.sh [--data data/real] [--base data/pub] [--port 3002]
    [--reference data/backup/2026-11-05-before-org/reference] [--keep] [--skip-believe] [--no-mark-source] [--yes]
    [--private <name> [--replace-private] [--keep-private]]
```

**Destructive** unless `--keep` or `--private` is given. Without them the script runs `docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v`.
That drops the PostgreSQL and ClickHouse volumes: the live `erp` / `believe` stores, `erp_e2e`, and every test database.
Take a snapshot first (recipe 10) and make sure no other session is using the stack. The script asks for `yes` unless
`--yes` is given. To run the acceptance while someone works on the live stack, use `--private` (see below).

Needs: the data archive unpacked (`data/real`, `data/pub`, D-093), `context_data/ERP_data/` (the Believe reports, the
B17 statements, `main_sheet/main.db`), `data/mvp-load/` (the loader's JSON inputs), the reference answers, `npm ci`,
Docker, `openssl`, `python3`, `curl`, and for `--private` also `rsync` and `shasum`. Expect it to take one to two hours: 47 Believe files, the loader, and a
check-owner-scope run of about 10 minutes.

## Private mode

`--private <name>` (`[a-z0-9_]+`, at most 40 characters) runs the **whole** acceptance on an empty private pair of
stores on the servers that are already running. The live stores, the containers and their sessions are not touched,
so a fully scripted pass can run while the owner works.

```
packages/backend/scripts/acceptance/clean-stack.sh --private accept1
```

| what | non-private | `--private <name>` |
|---|---|---|
| PostgreSQL | the database of `.env` | `erp_<name>` |
| ClickHouse | the databases of `.env` | `believe_<name>`, `believe_<name>_stage` |
| step 0 | `docker compose … down -v`, `up -d` | no `docker compose` at all (see below) |
| `--data` default | `data/real` | `data/acceptance/<name>-data`; `data/real` is refused |
| secrets | `data/acceptance/secrets.env` | `data/acceptance/<name>-secrets.env` |
| `MVP_LOAD_DIR` | unset (`data/mvp-load`) | `data/acceptance/<name>-mvp-load` |

- **The names** reach every child process through the exported `DB_DATABASE` and `CLICKHOUSE_DATABASE`. The environment
  wins over `.env`: `process.loadEnvFile` and `node --env-file` do not override, and `stores.py` and `pg.sh` read the
  environment first. The stage database is derived as `<name>_stage` (`clickHouseDatabaseNames`). The script's own
  queries (the row check of step 7, the counts table) use the same names.
- **Step 0** never runs `docker compose`, nor `npm run migrate:pg`, which is `docker compose run`: compose with another
  `DB_DATABASE` recreates the shared postgres container (recipe 12). It creates `erp_<name>` through
  `docker exec royalty-erp-postgres-1 psql`, applies every `migrations/postgres/*.sql` in order, each with its
  `schema_migrations` row in one transaction and the checksum of `migrate-postgres.sh`, and runs `npm run migrate:ch`,
  which creates both ClickHouse databases. (`node --env-file` takes the credentials from `.env`; a bare
  `npx tsx migrate-clickhouse.ts` would not, the script reads no `.env` itself.)
- **Stores that exist are refused** in the inputs step, before the secrets are written. `--replace-private` drops only
  these three names, and only with no session on `erp_<name>`: `DROP DATABASE` without `FORCE`, PostgreSQL first, so a
  refusal leaves ClickHouse as it was. Stored file copies of the old organization stay in `<data>/orgs/<old id>`.
- **Refused names:** `stage` and `*_stage` (`believe_stage` is the live stage database), and names that give the stores
  of `.env`. `--private` is incompatible with `--keep` and `--skip-believe`, and `--yes` is not needed: nothing
  destructive runs, so nothing asks.
- **The loader directory** is a copy of `data/mvp-load` without `log/`, refreshed at step 0, so `extract-main-ads.py`
  does not overwrite the shared `ads/main_ads_mapping.json` and the logs stay apart.
- **At the end** the private stores stay, and the script prints the commands that drop them and the private files
  (also after a failure past step 0). `--keep-private` leaves out the commands of a passing run. Nothing is ever dropped
  automatically.
- **Room:** the private pair holds a second copy of the 75.7 million rows on the same ClickHouse volume, and the
  stored files are copied into `<data>`. The load competes with the live stack for the same servers.

**What it does not prove.** The private stores are new databases on running servers, so a private pass says nothing
about the Docker side of a truly empty stack: `down -v`, the empty volumes, `up -d` and the one-shot migration services.
Those were exercised by the run `20261106T063708Z`, which went from `down -v` up to step 9. The database-side checks
are otherwise the same steps; the only other difference is that the PostgreSQL migrations are applied by this script
and not by `migrate-postgres.sh`.

## Output

Everything goes to `data/acceptance/`, which is git-ignored under `data/`:

- `<UTC stamp>/clean-stack.log` is the whole run.
- `<UTC stamp>/<step>.<command>.log` holds each command's output.
- `<UTC stamp>/server.log` is the API's log.
- `secrets.env` (mode 600; `<name>-secrets.env` with `--private`) holds `AUTH_SECRET`, `SYSTEM_ADMIN_KEY`, the two passwords (`openssl rand`) and the
  organization id. Secrets are never printed. Passwords reach `create-user.ts` through `ERP_NEW_PASSWORD`, and reach
  the login through stdin. The system key reaches curl through a header file. The ClickHouse password from `.env`
  also goes through a header file.

The script stops at the first failure and prints `FAILED at step <name>`. When every step passes it prints a table of
counts (this run against recipe 11) and then `ACCEPTANCE PASSED`.

## Steps

| step | what |
|---|---|
| inputs | Checks the inputs before touching anything: the reference dir, `data/pub`, the two B17 files, `main.db`, and the Believe file lists (34 / 13, one file per account and month). Checks that the port is free. Checks for `--mark-source`. With `--private`: `data/mvp-load`, both servers answer, the private stores do not exist (or `--replace-private` and no session). |
| 0-stack | Runs `down -v` (unless `--keep`), then `up -d`. Waits for the one-shot `postgres-migrate` and `clickhouse-migrate` containers to exit 0. Then runs `npm run migrate:pg` and `npm run migrate:ch`. With `--private`: see Private mode. |
| 1-system-admin | `create-user.ts admin --system` |
| 2-server | `AUTH_MODE=on AUTH_SECRET SYSTEM_ADMIN_KEY PORT=<port> node --import tsx packages/backend/src/main.ts <data>` in the background. Waits for `/health`, then checks that the port's listener is this process. |
| 3-organization | `POST /orgs {"name":"0to8"}` with `X-System-Key` and `X-Operator: admin`, giving the id. Then `export ERP_DEFAULT_ORG=<id>`; every script also gets `--org <id>`. |
| 4-login | `create-user.ts operator --org <id> --role org_admin`, then `POST /auth/login`, giving the `erp_session` cookie. |
| 5-base-data | `migrate-sqlite-to-pg.ts data/pub --org <id>`. It must run **before** `load.ts labels`, because that step creates 15 owners and the import refuses a non-empty `owners.owners`. |
| 6-labels | `load.ts labels --apply --org <id>`, then `POST /labels/:id/accounts`: 0to8 gets 1052428 and Echo8 gets 1055956. |
| 7-believe | `load-believe.ts --data <data> --org <id> --label 0to8 <34 files>`, then `--label Echo8 <13 files>`. Checks: 47 files loaded (`GET /orgs` counts), and ClickHouse holds 75 744 752 rows with Σ net 16 338 476.404666051188. |
| 8-loader | `load.ts <step> --apply --org <id>` for `tracks normalise-dates splits participations exclusions echo8 main terms contracts`. Then the two B17 statements: `DATA_DIR=<data> load-b17.ts <file> --label 0to8 --org <id>` (`0to8_Q22025_Statement.xlsx`, then `0to8_Q42024_Q12025_Publishing_Breakdown.xlsx`). Then `pairs label-fixes lunar b17-holders carves settlement-prestart assumption-rows hygiene`. |
| 9-ads | `python3 -I extract-main-ads.py` (re-run on every rebuild because the pseudonym ids are new), then `load.ts ads --apply --org <id>`. |
| 10-operation-labels | `assign-operation-labels.ts <data> --apply` (D-168). |
| 11-manual-writes | The seven API writes of 2026-11-03 as operator `13` (see below). |
| 12-books | `assign-operation-labels.ts <data> --mark-source --apply --force` if the script has `--mark-source`; the step itself asserts `source default` ∈ {1 314, 1 315} (assumption 4). Then `assign-label-books.ts <data> --apply` (all steps: files, statements, ads, operations-echo8) and a second dry run, which must show no work and no `stop`. Then `derive-track-labels.ts <data> --apply`, and a dry run that must show `ISRCs changed 0`. |
| 13-compare | `compare-reference.ts <reference> --api http://localhost:<port> --cookie erp_session=…` in default mode must give `TOTAL differing: 0`. `check-owner-scope.ts <data> --org <id>` must give `differing owners: 0`. `check-label-books.ts <data> 200 --org <id>` must give `differing: 0` and `(д) … 0`. |
| 14-me | `GET /auth/me` with the cookie must show mode `on`, user `operator`, organization 0to8 (the id), and role `org_admin`. |

The seven manual writes, replayed with the same bodies. Titles and every `fileRef` are synthetic and carry the
marker `acceptance replay 2026-11-03` (the titles) or `acceptance/replay-2026-11-03-…` (the file references):

1. `POST /documents` with `{kind: advance_basis, ownerId: 86940916-1241-41d3-b013-e291aa07f78d, fileRef, requiresApproval: true}`
2. `POST /documents/:id/approve` with `{by: "13"}`
3. `POST /settlements/operations` with `{direction: out, amount: "40.00", artistId: 809a451b-40c7-4f60-8144-93189c7e4652, ownerId: <same owner>, date: 2026-11-03, scope: {kind: isrcs, isrcs: [FRX202604939]}, documentId: <1>, labelId: <0to8>}`
4. `POST /settlements/operations/:id/proof` (this creates the `payment_proof` document)
5. `POST /documents` with `{kind: appendix, fileRef, requiresApproval: true}`, without an owner
6. `POST /documents/:id/approve`
7. `POST /splits/:id/confirm` with `{documentId: <5>}`, for the one split of FRX202537544 with `origin = manual` and `validFrom = 2000-01-01`

## Options

- `--data <dir>`: the original-files directory for the server and the scripts. The stored copies go to
  `<data>/orgs/<id>/files/{sources,publishing}`. The Echo8 July 2026 file is taken from `<data>/stage/`, and from
  `data/real/stage/` when `<data>/stage/` lacks it (the inputs step fails when neither has it). Default: `data/real`
  (`data/acceptance/<name>-data` with `--private`); the 2026-11-06 run used `--data data/real`.
- `--base <dir>`: the SQLite base data. Default: `data/pub`.
- `--port`: the API port. Default: 3002.
- `--reference`: the reference answers. Default: `data/backup/2026-11-05-before-org/reference`.
- `--keep`: no `down -v`. This is meant for an empty, migrated stack. On a rerun over a stack this script already
  filled, the steps that can be repeated are repeated:
  - `secrets.env` is reused.
  - The organization 0to8 is found by name.
  - A user that already exists gets its password reset.
  - The base data is skipped when the organization already has owners.
  - Registered accounts are skipped.
  - An already loaded B17 statement is accepted.
  - The manual writes are skipped when the marker document exists.
  - The loader, `load-believe` (a duplicate file is skipped) and the assign scripts are idempotent.
- `--skip-believe`: does not load the reports. The 47 files and the ClickHouse totals are still checked, so this only
  makes sense with `--keep` after a run that got past step 7.
- `--no-mark-source`: skips `assign-operation-labels --mark-source` even when the script supports it.
- `--yes`: no confirmation before `down -v`, for non-interactive runs.
- `--private <name>`: the whole acceptance on private stores (see Private mode).
- `--replace-private`: with `--private`, drops the existing private stores of that name first.
- `--keep-private`: with `--private`, does not print the drop commands after a passing run. The stores stay either way.

## Assumptions

Where the recipes left a choice open, this is what the script does:

1. **The compose trap.** The script refuses to run when `DB_DATABASE` or `CLICKHOUSE_DATABASE` in the environment
   differs from `.env`. It unsets both, along with `ERP_ORG` and `MVP_LOAD_DIR`, before any `docker compose` or `npm`
   call. A different name recreates the shared postgres container (stage 2 acceptance). If `.env` itself does not say
   `erp` / `believe`, the script only warns. `--private` skips the refusal and exports its own names and
   `MVP_LOAD_DIR` after that `unset`; it runs no `docker compose`.
2. **Migrations.** `up -d` already runs both one-shot migration services, which have no profile. Because
   `migrate-clickhouse.ts` is not safe to run in two processes at once, the script waits for both containers
   (`docker wait royalty-erp-{postgres,clickhouse}-migrate-1`, exit 0) before it runs `npm run migrate:pg` and
   `npm run migrate:ch` by hand, as recipe 12 says. That second run should report nothing pending.
3. **Order of steps 10–12.** The script follows recipe 11 (step 5, then step 6, then step 7):
   `assign-operation-labels --apply`, the manual writes, then `--mark-source`, `assign-label-books` and
   `derive-track-labels`. `assign-operation-labels` comes before `assign-label-books`. Its step `operations-echo8` counts
   exactly the 7 operations that `assign-operation-labels` (D-168) puts under Echo8. Run the other way round, it finds
   0 and stops.
4. **`--mark-source` (stage 5, D-173) and the 1 314.** Detected by grepping the script's source for `--mark-source`.
   These scripts have no `--help`: an unknown flag is ignored and the script does a dry run. It runs as a separate
   `--mark-source --apply --force` call after the manual writes. `assign-operation-labels` expects `default` = 1 315
   (D-168) and stops on another count unless `--force`. That 1 315 was counted over the live history, where the
   manual operation of 2026-11-03 had no label and went under 0to8 by default (mixed advances 68). On a clean rebuild
   step 11 creates that operation with `labelId` 0to8, so its source is `operator`: `default` is 1 314 (mixed advances
   67) plus 1 `operator`. The run of 2026-11-06 stopped there before this fix. The step therefore passes `--force` and
   asserts `source default` ∈ {1 314, 1 315} itself.
5. **Manual writes before the books.** Recipe 11 puts them between steps 5 and 7, and so does the script (step 11,
   before `--mark-source`). The operation is created with `labelId` 0to8; the assign scripts only touch records
   without a label (or the 7 Echo8 operations); and `derive-track-labels` reads only the files.
6. **Replay bodies.**
   - Owner and artist ids are stable because they come from `data/pub`.
   - The split id is not stable (the loader creates the split), so the script finds it by ISRC, `origin = manual` and
     `validFrom = 2000-01-01`, and fails unless exactly one matches.
   - The operation is sent with both `artistId` and `ownerId`, as the stored row has both.
   - Neither document gets a `labelId`, since the originals predate D-169.
   - Both documents are created with a synthetic `fileRef`: `POST /documents/:id/approve` refuses a document without a
     file (`422 document_not_attached`), and the originals of 2026-11-03 carried a file reference too. The run of
     2026-11-06 created the advance basis without one, attached the file (`POST /documents/:id/attach`) and approved
     it; the result is the same.
   - `approve.by` and `X-Operator` are `13`.
   - If the API now refuses the advance (`422 no_contract_for_label`, D-169) or needs a field added by stage 5 (for
     example an operation `kind`, D-173), step 11 fails and names it. Then the body has to be updated.
7. **Believe file lists.** These are glob rules, not a registry query, because there is no database yet:
   - 0to8 is every `*_1052428_*.zip` in `context_data/ERP_data/believe/raw`. That includes the
     `…csv (2).zip` / `…csv (1).zip` names. It excludes the loose `.csv` duplicates of 2023-12 and the unnamed report.
   - Echo8 is every `*_1055956_*.csv.zip` in `believe_echo8`, plus `<data>/stage/2154953_1055956_2026-07-01_2026-07-01.csv`
     (or the same name in `data/real/stage/` when `<data>/stage/` lacks it).
     The `… 2.csv` copy in `believe_echo8` is not taken.
   - Counts are asserted at 34 / 13, with one file per account and month.
8. **Base data from `data/pub`.** Recipe 11 step 2 uses this; it is what the live `erp` holds. It is not `--data`.
9. **B17 stored copies** go to `<data>` through `DATA_DIR`, as recipe 9 says for `compare-common.ts` scripts.
   `load.ts` keeps its own `data/mvp-load` directory (`MVP_LOAD_DIR` with `--private`).
10. **`extract-main-ads.py` overwrites** `data/mvp-load/ads/main_ads_mapping.json`. That is the recipe's own path.
    The old mapping does not match the new pseudonym ids anyway. With `--private` it overwrites the private copy.
11. **`check-label-books` runs with limit 200,** as the task asked. `check-owner-scope` runs over all owners.
    `compare-reference` runs in default mode, not `--strict`: since D-169 the books move by design (recipe 11 step 8).
12. **The counts table is for information only.** It reads PostgreSQL through `scripts/mvp/pg.sh` (`SELECT count(*)`,
    one organization on a clean stack) and ClickHouse over HTTP. The gates are the Believe totals of step 7 and the
    three checks of step 13. Stage 5 may move some counts (for example documents or operations).
13. **The cookie** is passed to `compare-reference.ts` on its command line (`--cookie`), the only way that script takes
    it. The session expires after 12 hours.
14. **Server stop.** The API is started as `node --import tsx main.ts`, so `$!` is the process that listens. On exit
    the script stops that PID only (`SIGTERM`, then `SIGKILL` after 10 seconds): no pattern and no port, because other
    `main.ts` servers run on the machine. The inputs step refuses a busy port.
