# Acceptance of «label from zero» on a clean stack

`clean-stack.sh` rebuilds the reference data from the files on disk, starting from an **empty** stack, inside one
organization with a password login. It then proves the payroll against the reference API answers. It follows
recipes 9, 11, 12 and 13 of `docs/agents/04_recipes.md` and D-169…D-172.

```
packages/backend/scripts/acceptance/clean-stack.sh [--data data/real] [--base data/pub] [--port 3002]
    [--reference data/backup/2026-11-05-before-org/reference] [--keep] [--skip-believe] [--no-mark-source] [--yes]
```

**Destructive.** Without `--keep` the script runs `docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v`.
That drops the PostgreSQL and ClickHouse volumes: the live `erp` / `believe` stores, `erp_e2e`, and every test database.
Take a snapshot first (recipe 10) and make sure no other session is using the stack. The script asks for `yes` unless
`--yes` is given.

Needs: the data archive unpacked (`data/real`, `data/pub`, D-093), `context_data/ERP_data/` (the Believe reports, the
B17 statements, `main_sheet/main.db`), `data/mvp-load/` (the loader's JSON inputs), the reference answers, `npm ci`,
Docker, `openssl`, `python3`, `curl`. Expect it to take one to two hours: 47 Believe files, the loader, and a
check-owner-scope run of about 10 minutes.

## Output

Everything goes to `data/acceptance/`, which is git-ignored under `data/`:

- `<UTC stamp>/clean-stack.log` is the whole run.
- `<UTC stamp>/<step>.<command>.log` holds each command's output.
- `<UTC stamp>/server.log` is the API's log.
- `secrets.env` (mode 600) holds `AUTH_SECRET`, `SYSTEM_ADMIN_KEY`, the two passwords (`openssl rand`) and the
  organization id. Secrets are never printed. Passwords reach `create-user.ts` through `ERP_NEW_PASSWORD`, and reach
  the login through stdin. The system key reaches curl through a header file. The ClickHouse password from `.env`
  also goes through a header file.

The script stops at the first failure and prints `FAILED at step <name>`. When every step passes it prints a table of
counts (this run against recipe 11) and then `ACCEPTANCE PASSED`.

## Steps

| step | what |
|---|---|
| inputs | Checks the inputs before touching anything: the reference dir, `data/pub`, the two B17 files, `main.db`, and the Believe file lists (34 / 13, one file per account and month). Checks that the port is free. Checks for `--mark-source`. |
| 0-stack | Runs `down -v` (unless `--keep`), then `up -d`. Waits for the one-shot `postgres-migrate` and `clickhouse-migrate` containers to exit 0. Then runs `npm run migrate:pg` and `npm run migrate:ch`. |
| 1-system-admin | `create-user.ts admin --system` |
| 2-server | `AUTH_MODE=on AUTH_SECRET SYSTEM_ADMIN_KEY PORT=<port> npx tsx packages/backend/src/main.ts <data>` in the background. Waits for `/health`. |
| 3-organization | `POST /orgs {"name":"0to8"}` with `X-System-Key` and `X-Operator: admin`, giving the id. Then `export ERP_DEFAULT_ORG=<id>`; every script also gets `--org <id>`. |
| 4-login | `create-user.ts operator --org <id> --role org_admin`, then `POST /auth/login`, giving the `erp_session` cookie. |
| 5-base-data | `migrate-sqlite-to-pg.ts data/pub --org <id>`. It must run **before** `load.ts labels`, because that step creates 15 owners and the import refuses a non-empty `owners.owners`. |
| 6-labels | `load.ts labels --apply --org <id>`, then `POST /labels/:id/accounts`: 0to8 gets 1052428 and Echo8 gets 1055956. |
| 7-believe | `load-believe.ts --data <data> --org <id> --label 0to8 <34 files>`, then `--label Echo8 <13 files>`. Checks: 47 files loaded (`GET /orgs` counts), and ClickHouse holds 75 744 752 rows with Σ net 16 338 476.404666051188. |
| 8-loader | `load.ts <step> --apply --org <id>` for `tracks normalise-dates splits participations exclusions echo8 main terms contracts`. Then the two B17 statements: `DATA_DIR=<data> load-b17.ts <file> --label 0to8 --org <id>` (`0to8_Q22025_Statement.xlsx`, then `0to8_Q42024_Q12025_Publishing_Breakdown.xlsx`). Then `pairs label-fixes lunar b17-holders carves settlement-prestart assumption-rows hygiene`. |
| 9-ads | `python3 -I extract-main-ads.py` (re-run on every rebuild because the pseudonym ids are new), then `load.ts ads --apply --org <id>`. |
| 10-books | `assign-operation-labels.ts <data> --apply`, then `--mark-source --apply` if the script has it. Then `assign-label-books.ts <data> --apply` (all steps: files, statements, ads, operations-echo8) and a second dry run, which must show no work and no `stop`. Then `derive-track-labels.ts <data> --apply`, and a dry run that must show `ISRCs changed 0`. |
| 11-manual-writes | The seven API writes of 2026-11-03 as operator `13` (see below). |
| 12-compare | `compare-reference.ts <reference> --api http://localhost:<port> --cookie erp_session=…` in default mode must give `TOTAL differing: 0`. `check-owner-scope.ts <data> --org <id>` must give `differing owners: 0`. `check-label-books.ts <data> 200 --org <id>` must give `differing: 0` and `(д) … 0`. |
| 13-me | `GET /auth/me` with the cookie must show mode `on`, user `operator`, organization 0to8 (the id), and role `org_admin`. |

The seven manual writes, replayed with the same bodies. Titles and the proof's `fileRef` are synthetic and carry the
marker `acceptance replay 2026-11-03`:

1. `POST /documents` with `{kind: advance_basis, ownerId: 86940916-1241-41d3-b013-e291aa07f78d, requiresApproval: true}`
2. `POST /documents/:id/approve` with `{by: "13"}`
3. `POST /settlements/operations` with `{direction: out, amount: "40.00", artistId: 809a451b-40c7-4f60-8144-93189c7e4652, ownerId: <same owner>, date: 2026-11-03, scope: {kind: isrcs, isrcs: [FRX202604939]}, documentId: <1>, labelId: <0to8>}`
4. `POST /settlements/operations/:id/proof` (this creates the `payment_proof` document)
5. `POST /documents` with `{kind: appendix, requiresApproval: true}`, without an owner
6. `POST /documents/:id/approve`
7. `POST /splits/:id/confirm` with `{documentId: <5>}`, for the one split of FRX202537544 with `origin = manual` and `validFrom = 2000-01-01`

## Options

- `--data <dir>`: the original-files directory for the server and the scripts. The stored copies go to
  `<data>/orgs/<id>/files/{sources,publishing}`. The Echo8 July 2026 file is taken from `<data>/stage/`.
  Default: `data/real`.
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

## Assumptions

Where the recipes left a choice open, this is what the script does:

1. **The compose trap.** The script refuses to run when `DB_DATABASE` or `CLICKHOUSE_DATABASE` in the environment
   differs from `.env`. It unsets both, along with `ERP_ORG` and `MVP_LOAD_DIR`, before any `docker compose` or `npm`
   call. A different name recreates the shared postgres container (stage 2 acceptance). If `.env` itself does not say
   `erp` / `believe`, the script only warns.
2. **Migrations.** `up -d` already runs both one-shot migration services, which have no profile. Because
   `migrate-clickhouse.ts` is not safe to run in two processes at once, the script waits for both containers
   (`docker wait royalty-erp-{postgres,clickhouse}-migrate-1`, exit 0) before it runs `npm run migrate:pg` and
   `npm run migrate:ch` by hand, as recipe 12 says. That second run should report nothing pending.
3. **Order of step 10.** The task listed `assign-label-books` before `assign-operation-labels`. The script follows
   recipe 11 instead (step 5 before step 7): `assign-operation-labels` first. Its step `operations-echo8` counts
   exactly the 7 operations that `assign-operation-labels` (D-168) puts under Echo8. Run the other way round, it finds
   0 and stops.
4. **`--mark-source` (stage 5, D-173).** Detected by grepping the script's source for `--mark-source`. These scripts
   have no `--help`: an unknown flag is ignored and the script does a dry run. It runs as a separate
   `--mark-source --apply` call right after the plain `--apply`, before the manual writes. If D-173 classifies an
   operation created through the API on its own (`operator`), the order makes no difference. If not, run the dry run
   again after step 11 and look at the counts.
5. **Manual writes after step 10.** Recipe 11 puts them between steps 5 and 7. The script follows the task's order
   instead. This is equivalent: the operation is created with `labelId` 0to8; the assign scripts only touch records
   without a label (or the 7 Echo8 operations); and `derive-track-labels` reads only the files.
6. **Replay bodies.**
   - Owner and artist ids are stable because they come from `data/pub`.
   - The split id is not stable (the loader creates the split), so the script finds it by ISRC, `origin = manual` and
     `validFrom = 2000-01-01`, and fails unless exactly one matches.
   - The operation is sent with both `artistId` and `ownerId`, as the stored row has both.
   - Neither document gets a `labelId`, since the originals predate D-169.
   - `approve.by` and `X-Operator` are `13`.
   - If the API now refuses the advance (`422 no_contract_for_label`, D-169) or needs a field added by stage 5 (for
     example an operation `kind`, D-173), step 11 fails and names it. Then the body has to be updated.
7. **Believe file lists.** These are glob rules, not a registry query, because there is no database yet:
   - 0to8 is every `*_1052428_*.zip` in `context_data/ERP_data/believe/raw`. That includes the
     `…csv (2).zip` / `…csv (1).zip` names. It excludes the loose `.csv` duplicates of 2023-12 and the unnamed report.
   - Echo8 is every `*_1055956_*.csv.zip` in `believe_echo8`, plus `<data>/stage/2154953_1055956_2026-07-01_2026-07-01.csv`.
     The `… 2.csv` copy in `believe_echo8` is not taken.
   - Counts are asserted at 34 / 13, with one file per account and month.
8. **Base data from `data/pub`.** Recipe 11 step 2 uses this; it is what the live `erp` holds. It is not `--data`.
9. **B17 stored copies** go to `<data>` through `DATA_DIR`, as recipe 9 says for `compare-common.ts` scripts.
   `load.ts` keeps its own `data/mvp-load` directory.
10. **`extract-main-ads.py` overwrites** `data/mvp-load/ads/main_ads_mapping.json`. That is the recipe's own path.
    The old mapping does not match the new pseudonym ids anyway.
11. **`check-label-books` runs with limit 200,** as the task asked. `check-owner-scope` runs over all owners.
    `compare-reference` runs in default mode, not `--strict`: since D-169 the books move by design (recipe 11 step 8).
12. **The counts table is for information only.** It reads PostgreSQL through `scripts/mvp/pg.sh` (`SELECT count(*)`,
    one organization on a clean stack) and ClickHouse over HTTP. The gates are the Believe totals of step 7 and the
    three checks of step 12. Stage 5 may move some counts (for example documents or operations).
13. **The cookie** is passed to `compare-reference.ts` on its command line (`--cookie`), the only way that script takes
    it. The session expires after 12 hours.
14. **Server stop.** On exit the script stops `npx tsx main.ts` and anything still listening on the port. Do not
    choose a port another server uses; the inputs step refuses a busy port.
