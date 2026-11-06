#!/usr/bin/env bash
# The final acceptance of «label from zero»: from an EMPTY stack (docker compose … down -v) with the default database
# names of <repo>/.env, rebuild the reference data inside one organization with a password login, and prove the
# payroll: compare-reference (default mode) TOTAL differing: 0, check-owner-scope 0, check-label-books 0.
# Recipes 9, 11, 12, 13 of docs/agents/04_recipes.md; D-169…D-172. Read README.md next to this file first.
#
#   packages/backend/scripts/acceptance/clean-stack.sh [--data data/real] [--base data/pub] [--port 3002]
#       [--reference data/backup/2026-11-05-before-org/reference] [--keep] [--skip-believe] [--no-mark-source] [--yes]
#
# DESTRUCTIVE without --keep: `docker compose … down -v` drops the PostgreSQL and ClickHouse volumes (the live `erp` /
# `believe` stores and every test database). Asks first unless --yes.
# Writes data/acceptance/<run>/ (log, step outputs, server log) and data/acceptance/secrets.env (mode 600); never prints
# a secret. Prints ids and counts only (no people's names). Exit code non-zero at the first failing step, named.
# Must stay bash 3.2 compatible (macOS /bin/bash).
set -euo pipefail
set -o errtrace

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

# ------------------------------------------------------------------ parameters
DATA="data/real"
BASE="data/pub"
PORT="3002"
REFERENCE="data/backup/2026-11-05-before-org/reference"
KEEP=0
SKIP_BELIEVE=0
MARK_SOURCE=auto
YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --data) DATA="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --reference) REFERENCE="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --skip-believe) SKIP_BELIEVE=1; shift ;;
    --no-mark-source) MARK_SOURCE=off; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
abs() { case "$1" in /*) echo "$1" ;; *) echo "$ROOT/$1" ;; esac; }
DATA="$(abs "$DATA")"; BASE="$(abs "$BASE")"; REFERENCE="$(abs "$REFERENCE")"

# ------------------------------------------------------------------ constants (recipe 11, D-169…D-172)
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.dev.yml)
ORG_NAME="0to8"
ADMIN_LOGIN="admin"
OPERATOR_LOGIN="operator"
ACCOUNT_0TO8="1052428"
ACCOUNT_ECHO8="1055956"
RAW_0TO8="$ROOT/context_data/ERP_data/believe/raw"
RAW_ECHO8="$ROOT/context_data/ERP_data/believe_echo8"
B17_DIR="$ROOT/context_data/ERP_data/publishing/raw"
B17_FILES=("$B17_DIR/0to8_Q22025_Statement.xlsx" "$B17_DIR/0to8_Q42024_Q12025_Publishing_Breakdown.xlsx")
STEPS_BEFORE_B17="tracks normalise-dates splits participations exclusions echo8 main terms contracts"
STEPS_AFTER_B17="pairs label-fixes lunar b17-holders carves settlement-prestart assumption-rows hygiene"
EXPECT_FILES_0TO8=34
EXPECT_FILES_ECHO8=13
EXPECT_ROWS="75744752"
EXPECT_NET="16338476.404666051188"
# the seven manual API writes of 2026-11-03 (operator 13), recipe 11 step 6
REPLAY_OPERATOR="13"
REPLAY_OWNER="86940916-1241-41d3-b013-e291aa07f78d"
REPLAY_ARTIST="809a451b-40c7-4f60-8144-93189c7e4652"
REPLAY_SCOPE_ISRC="FRX202604939"
REPLAY_SPLIT_ISRC="FRX202537544"
REPLAY_MARKER="acceptance replay 2026-11-03"

LOADER=(npx tsx packages/backend/scripts/mvp/load.ts)
TSX=(npx tsx)

# ------------------------------------------------------------------ run directory, log, traps
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ACC="$ROOT/data/acceptance"
RUN="$ACC/$STAMP"
SECRETS="$ACC/secrets.env"
mkdir -p "$RUN"
chmod 700 "$ACC" "$RUN"
LOG="$RUN/clean-stack.log"
exec > >(tee -a "$LOG") 2>&1

STEP="init"
SERVER_PID=""
step() { STEP="$1"; echo; echo "==== [$(date -u +%H:%M:%S)] step $STEP"; }
info() { echo "  $*"; }
die() { echo; echo "FAILED at step $STEP: $*"; exit 1; }
on_err() { echo; echo "FAILED at step $STEP (line $1, exit $2); outputs in $RUN"; }
stop_server() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 1; done
  fi
  # npx → tsx → node: make sure nothing of ours still listens on the port
  local pids
  pids="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ] && [ -n "$SERVER_PID" ]; then kill $pids 2>/dev/null || true; fi
  SERVER_PID=""
}
trap 'on_err $LINENO $?' ERR
trap 'stop_server' EXIT

# a step command with its own output file; non-zero exit fails the step (pipefail)
run() { local name="$1"; shift; info "\$ ${name}"; "$@" 2>&1 | tee "$RUN/$STEP.$name.log"; }
expect_line() { # file, fixed text that must appear
  grep -qF -- "$2" "$1" || die "expected «$2» in $(basename "$1")"
}

# ------------------------------------------------------------------ .env and the compose trap
envfile() { sed -n "s/^$1=//p" "$ROOT/.env" | tail -n 1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }
[ -f "$ROOT/.env" ] || die ".env is missing in the repo root"
DB_NAME="$(envfile DB_DATABASE)"
CH_NAME="$(envfile CLICKHOUSE_DATABASE)"
# NEVER pass another DB_DATABASE / CLICKHOUSE_DATABASE to compose: it recreates the shared postgres container
# (POSTGRES_DB and the healthcheck come from ${DB_DATABASE}) and kills every session on it (stage 2 acceptance).
if [ -n "${DB_DATABASE:-}" ] && [ "$DB_DATABASE" != "$DB_NAME" ]; then
  die "DB_DATABASE=$DB_DATABASE in the environment differs from .env ($DB_NAME): unset it"
fi
if [ -n "${CLICKHOUSE_DATABASE:-}" ] && [ "$CLICKHOUSE_DATABASE" != "$CH_NAME" ]; then
  die "CLICKHOUSE_DATABASE=$CLICKHOUSE_DATABASE in the environment differs from .env ($CH_NAME): unset it"
fi
unset DB_DATABASE CLICKHOUSE_DATABASE ERP_ORG MVP_LOAD_DIR
[ "$DB_NAME" = "erp" ] && [ "$CH_NAME" = "believe" ] || info "WARNING: .env names $DB_NAME / $CH_NAME, not the defaults erp / believe"

echo "clean-stack acceptance $STAMP"
info "repo $ROOT ($(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?') $(git rev-parse --short HEAD 2>/dev/null || echo '?'))"
info "data $DATA, base $BASE, reference $REFERENCE, port $PORT, keep $KEEP, skip-believe $SKIP_BELIEVE"
info "stores: PostgreSQL $DB_NAME, ClickHouse $CH_NAME; run directory $RUN"

# ------------------------------------------------------------------ inputs present (fail before touching anything)
step "inputs"
[ -d "$REFERENCE" ] || die "no reference directory $REFERENCE"
[ -f "$BASE/owners.sqlite" ] || die "no base data $BASE/owners.sqlite (the data archive, D-093)"
for f in "${B17_FILES[@]}"; do [ -f "$f" ] || die "missing B17 statement $(basename "$f")"; done
[ -f "$ROOT/context_data/ERP_data/main_sheet/main.db" ] || die "missing context_data/ERP_data/main_sheet/main.db (extract-main-ads.py)"
shopt -s nullglob
# 0to8: every *_1052428_*.zip of the raw folder (the loose .csv duplicates of 2023-12 and the unnamed report are not)
FILES_0TO8=("$RAW_0TO8"/*_"$ACCOUNT_0TO8"_*.zip)
# Echo8: every *_1055956_*.csv.zip, plus July 2026 under its proper name from <data>/stage, else from data/real/stage
# (the copy in believe_echo8 is named «… 2.csv» and is not taken; data/real is the data archive, D-093)
FILES_ECHO8=("$RAW_ECHO8"/*_"$ACCOUNT_ECHO8"_*.csv.zip)
JULY_ECHO8=("$DATA"/stage/*_"$ACCOUNT_ECHO8"_2026-07-01_2026-07-01.csv)
[ "${#JULY_ECHO8[@]}" -gt 0 ] || JULY_ECHO8=("$ROOT"/data/real/stage/*_"$ACCOUNT_ECHO8"_2026-07-01_2026-07-01.csv)
[ "${#JULY_ECHO8[@]}" -gt 0 ] || die "no July 2026 Echo8 report *_${ACCOUNT_ECHO8}_2026-07-01_2026-07-01.csv in $DATA/stage or data/real/stage"
FILES_ECHO8+=("${JULY_ECHO8[@]}")
shopt -u nullglob
[ "${#FILES_0TO8[@]}" -eq "$EXPECT_FILES_0TO8" ] || die "0to8 Believe files: ${#FILES_0TO8[@]}, expected $EXPECT_FILES_0TO8"
[ "${#FILES_ECHO8[@]}" -eq "$EXPECT_FILES_ECHO8" ] || die "Echo8 Believe files: ${#FILES_ECHO8[@]}, expected $EXPECT_FILES_ECHO8"
months_unique() { # one file per account and month
  local dup
  dup="$(for f in "$@"; do basename "$f"; done | sed -E 's/^[0-9]+_([0-9]+)_([0-9]{4}-[0-9]{2})-.*/\1 \2/' | sort | uniq -d)"
  [ -z "$dup" ] || die "two Believe files for one account and month: $dup"
}
months_unique "${FILES_0TO8[@]}"
months_unique "${FILES_ECHO8[@]}"
info "Believe files: 0to8 ${#FILES_0TO8[@]}, Echo8 ${#FILES_ECHO8[@]}"
if lsof -ti "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then die "port $PORT is in use"; fi
MARK_SOURCE_SUPPORTED=0
if [ "$MARK_SOURCE" = auto ] && grep -q -- '--mark-source' packages/backend/scripts/assign-operation-labels.ts; then
  MARK_SOURCE_SUPPORTED=1
fi
info "assign-operation-labels --mark-source: $([ $MARK_SOURCE_SUPPORTED = 1 ] && echo 'present, will run' || echo 'skipped')"

# ------------------------------------------------------------------ secrets (generated, never printed)
if [ "$KEEP" = 1 ] && [ -f "$SECRETS" ]; then
  # shellcheck disable=SC1090
  . "$SECRETS"
  info "secrets: reused $SECRETS"
else
  umask 077
  {
    echo "AUTH_SECRET=$(openssl rand -hex 32)"
    echo "SYSTEM_ADMIN_KEY=$(openssl rand -hex 24)"
    echo "ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
    echo "OPERATOR_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  } > "$SECRETS"
  umask 022
  # shellcheck disable=SC1090
  . "$SECRETS"
  info "secrets: generated into $SECRETS (mode 600)"
fi
chmod 600 "$SECRETS"
export AUTH_SECRET SYSTEM_ADMIN_KEY
export AUTH_MODE=on
export ERP_DATA_DIR="$DATA"
BASE_URL="http://localhost:$PORT/api/v1"
COOKIES="$RUN/cookies.txt"; : > "$COOKIES"; chmod 600 "$COOKIES"
SYSHDR="$RUN/system.headers"; ( umask 077; printf 'X-System-Key: %s\n' "$SYSTEM_ADMIN_KEY" > "$SYSHDR" )

# ------------------------------------------------------------------ HTTP helpers (secrets go through files / stdin)
API_CODE=""; API_BODY=""
# api METHOD PATH [JSON] [operator]: the operator session (cookie); sets API_CODE and API_BODY
api() {
  local method="$1" path="$2" body="${3-}" op="${4:-acceptance}" out
  out="$RUN/.api.out"
  if [ -n "$body" ]; then
    API_CODE="$(printf '%s' "$body" | curl -sS -o "$out" -w '%{http_code}' -X "$method" -b "$COOKIES" \
      -H 'Content-Type: application/json' -H "X-Operator: $op" --data-binary @- "$BASE_URL$path")"
  else
    API_CODE="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -b "$COOKIES" -H "X-Operator: $op" "$BASE_URL$path")"
  fi
  API_BODY="$(cat "$out")"; rm -f "$out"
}
# sysapi METHOD PATH [JSON]: the system key (X-System-Key from a file, not argv)
sysapi() {
  local method="$1" path="$2" body="${3-}" out
  out="$RUN/.api.out"
  if [ -n "$body" ]; then
    API_CODE="$(printf '%s' "$body" | curl -sS -o "$out" -w '%{http_code}' -X "$method" -H @"$SYSHDR" \
      -H 'Content-Type: application/json' -H "X-Operator: $ADMIN_LOGIN" --data-binary @- "$BASE_URL$path")"
  else
    API_CODE="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H @"$SYSHDR" "$BASE_URL$path")"
  fi
  API_BODY="$(cat "$out")"; rm -f "$out"
}
want() { # the expected HTTP codes, space separated
  case " $1 " in *" $API_CODE "*) ;; *) die "$2: HTTP $API_CODE $(printf '%s' "$API_BODY" | cut -c1-400)" ;; esac
}
# jq-like extraction with python3 (stdlib): jget '<python expression over d>'
jget() { printf '%s' "$API_BODY" | python3 -I -c 'import json,sys; d=json.loads(sys.stdin.read()); r=eval(sys.argv[1]); print("" if r is None else r)' "$1"; }

# ClickHouse totals over HTTP (credentials from .env through a header file)
ch_totals() {
  local hdr="$RUN/.ch.headers"
  ( umask 077; printf 'X-ClickHouse-User: %s\nX-ClickHouse-Key: %s\n' "$(envfile CLICKHOUSE_USERNAME)" "$(envfile CLICKHOUSE_PASSWORD)" > "$hdr" )
  printf 'SELECT count(), toString(sum(net_revenue)) FROM %s.rows FORMAT TabSeparated' "$CH_NAME" |
    curl -sS -H @"$hdr" --data-binary @- "http://$(envfile CLICKHOUSE_HOST):$(envfile CLICKHOUSE_HTTP_PORT)/"
  rm -f "$hdr"
}
pg() { packages/backend/scripts/mvp/pg.sh "$1"; } # read-only SELECT inside the postgres container

# ================================================================== 0. the stack
step "0-stack"
if [ "$KEEP" = 0 ]; then
  if [ "$YES" = 0 ]; then
    [ -t 0 ] || die "down -v drops the volumes of the stack: rerun with --yes (or --keep)"
    printf '  docker compose down -v drops the PostgreSQL and ClickHouse volumes (all data, all test databases). Type yes: '
    read -r answer
    [ "$answer" = "yes" ] || die "not confirmed"
  fi
  run down "${COMPOSE[@]}" down -v
else
  info "--keep: the volumes stay (an empty migrated stack is expected)"
fi
run up "${COMPOSE[@]}" up -d
# the one-shot migrations run with up -d; migrate-clickhouse.ts is not safe in two processes: wait for both first
for c in royalty-erp-postgres-migrate-1 royalty-erp-clickhouse-migrate-1; do
  code="$(docker wait "$c" 2>/dev/null || echo missing)"
  [ "$code" = 0 ] || [ "$code" = missing ] || die "compose one-shot $c exited $code (docker logs $c)"
  info "$c: exit $code"
done
run migrate-pg npm run migrate:pg
run migrate-ch npm run migrate:ch

# ================================================================== 1. the system administrator
step "1-system-admin"
create_user() { # login, password, args… : create, or (a rerun on a kept stack) reset the password
  local login="$1" pw="$2"; shift 2
  if ERP_NEW_PASSWORD="$pw" "${TSX[@]}" packages/backend/scripts/create-user.ts "$login" "$@" > "$RUN/$STEP.create-user.log" 2>&1; then
    info "user $login: created $(tail -n 1 "$RUN/$STEP.create-user.log")"
  elif [ "$KEEP" = 1 ]; then
    info "user $login: create refused ($(tail -n 1 "$RUN/$STEP.create-user.log" | cut -c1-120)); --keep: resetting the password"
    ERP_NEW_PASSWORD="$pw" "${TSX[@]}" packages/backend/scripts/create-user.ts "$login" --reset-password > "$RUN/$STEP.reset.log" 2>&1 ||
      die "reset-password $login: $(tail -n 1 "$RUN/$STEP.reset.log")"
  else
    die "create-user $login: $(tail -n 1 "$RUN/$STEP.create-user.log")"
  fi
}
create_user "$ADMIN_LOGIN" "$ADMIN_PASSWORD" --system

# ================================================================== 2. the API (AUTH_MODE=on)
step "2-server"
PORT="$PORT" "${TSX[@]}" packages/backend/src/main.ts "$DATA" > "$RUN/server.log" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 120); do
  if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || die "the server exited: $(tail -n 5 "$RUN/server.log")"
  [ "$i" = 120 ] && die "no /health after 120 s"
  sleep 1
done
info "$(head -n 1 "$RUN/server.log")"

# ================================================================== 3. the organization
step "3-organization"
sysapi GET /orgs
want 200 "GET /orgs"
ORG="$(jget "next((o['id'] for o in d if o['name'] == '$ORG_NAME'), '')")"
if [ -n "$ORG" ]; then
  [ "$KEEP" = 1 ] || die "organization $ORG_NAME exists on a stack that was just dropped"
  info "organization $ORG_NAME exists: $ORG (--keep)"
else
  sysapi POST /orgs "{\"name\":\"$ORG_NAME\"}"
  want 201 "POST /orgs"
  ORG="$(jget "d['id']")"
  info "organization $ORG_NAME created: $ORG"
fi
grep -q '^ORG=' "$SECRETS" && sed -i.bak '/^ORG=/d' "$SECRETS" && rm -f "$SECRETS.bak"
echo "ORG=$ORG" >> "$SECRETS"
export ERP_DEFAULT_ORG="$ORG" # overrides the .env value for every script (loadEnvFile does not override)

# ================================================================== 4. the operator (org_admin) and the login
step "4-login"
create_user "$OPERATOR_LOGIN" "$OPERATOR_PASSWORD" --org "$ORG" --role org_admin
login_body="$(LOGIN="$OPERATOR_LOGIN" OPERATOR_PASSWORD="$OPERATOR_PASSWORD" python3 -I -c 'import json,os; print(json.dumps({"login": os.environ["LOGIN"], "password": os.environ["OPERATOR_PASSWORD"]}))')"
code="$(printf '%s' "$login_body" | curl -sS -o "$RUN/.login.out" -w '%{http_code}' -c "$COOKIES" -X POST \
  -H 'Content-Type: application/json' --data-binary @- "$BASE_URL/auth/login")"
unset login_body
[ "$code" = 200 ] || die "POST /auth/login: HTTP $code $(cut -c1-300 "$RUN/.login.out")"
rm -f "$RUN/.login.out"
SESSION="$(awk '$6 == "erp_session" { print $7 }' "$COOKIES" | tail -n 1)"
[ -n "$SESSION" ] || die "no erp_session cookie after the login"
info "login $OPERATOR_LOGIN: ok (cookie erp_session)"

# ================================================================== 5. the base reference data (before `labels`!)
step "5-base-data"
sysapi GET /orgs
want 200 "GET /orgs"
OWNERS_BEFORE="$(jget "next(o['counts']['owners'] for o in d if o['id'] == '$ORG')")"
if [ "$OWNERS_BEFORE" != 0 ] && [ "$KEEP" = 1 ]; then
  # nothing before this step creates owners, and the owners module is copied in one transaction
  info "--keep: the organization already has $OWNERS_BEFORE owners; the base data is taken as loaded"
else
  run migrate-sqlite-to-pg "${TSX[@]}" packages/backend/scripts/migrate-sqlite-to-pg.ts "$BASE" --org "$ORG"
fi

# ================================================================== 6. the labels and the two accounts
step "6-labels"
run load-labels "${LOADER[@]}" labels --apply --org "$ORG"
api GET /labels
want 200 "GET /labels"
LABEL_0TO8="$(jget "next((l['id'] for l in d if l['kind'] == 'own' and l['name'] == '0to8'), '')")"
LABEL_ECHO8="$(jget "next((l['id'] for l in d if l['kind'] == 'own' and l['name'] == 'Echo8'), '')")"
[ -n "$LABEL_0TO8" ] && [ -n "$LABEL_ECHO8" ] || die "own labels 0to8 / Echo8 not found after load.ts labels"
info "labels: $(jget 'len(d)') (0to8 $LABEL_0TO8, Echo8 $LABEL_ECHO8)"
register_account() { # label id, account
  api GET /labels
  if [ "$(jget "any('$2' in l['accounts'] for l in d if l['id'] == '$1')")" = True ]; then
    info "account $2: already registered"; return
  fi
  api POST "/labels/$1/accounts" "{\"account\":\"$2\"}"
  want 201 "POST /labels/$1/accounts $2"
  info "account $2 → label $1: registered"
}
register_account "$LABEL_0TO8" "$ACCOUNT_0TO8"
register_account "$LABEL_ECHO8" "$ACCOUNT_ECHO8"

# ================================================================== 7. Believe (47 files under their labels)
step "7-believe"
if [ "$SKIP_BELIEVE" = 1 ]; then
  info "--skip-believe: not loading; checking that the files are there"
else
  run believe-0to8 "${TSX[@]}" packages/backend/scripts/load-believe.ts --data "$DATA" --org "$ORG" --label 0to8 "${FILES_0TO8[@]}"
  run believe-echo8 "${TSX[@]}" packages/backend/scripts/load-believe.ts --data "$DATA" --org "$ORG" --label Echo8 "${FILES_ECHO8[@]}"
fi
sysapi GET /orgs
want 200 "GET /orgs"
FILES_LOADED="$(jget "next(o['counts']['files'] for o in d if o['id'] == '$ORG')")"
[ "$FILES_LOADED" = $((EXPECT_FILES_0TO8 + EXPECT_FILES_ECHO8)) ] || die "loaded Believe files: $FILES_LOADED"
CH="$(ch_totals)"
CH_ROWS="$(printf '%s' "$CH" | cut -f1)"; CH_NET="$(printf '%s' "$CH" | cut -f2)"
[ "$CH_ROWS" = "$EXPECT_ROWS" ] || die "ClickHouse rows $CH_ROWS, expected $EXPECT_ROWS"
python3 -I -c 'import sys; from decimal import Decimal as D; sys.exit(0 if D(sys.argv[1]) == D(sys.argv[2]) else 1)' "$CH_NET" "$EXPECT_NET" ||
  die "ClickHouse Σ net $CH_NET, expected $EXPECT_NET"
info "Believe: $FILES_LOADED files, $CH_ROWS rows, Σ net $CH_NET"

# ================================================================== 8. the stage 4 loader and the two B17 statements
step "8-loader"
for s in $STEPS_BEFORE_B17; do run "load-$s" "${LOADER[@]}" "$s" --apply --org "$ORG"; done
for f in "${B17_FILES[@]}"; do
  name="b17-$(basename "$f" .xlsx)"
  info "\$ $name"
  if DATA_DIR="$DATA" "${TSX[@]}" packages/backend/scripts/mvp/load-b17.ts "$f" --label 0to8 --org "$ORG" > "$RUN/$STEP.$name.log" 2>&1; then
    tail -n 2 "$RUN/$STEP.$name.log" | cut -c1-300
  elif [ "$KEEP" = 1 ] && grep -q 'already loaded' "$RUN/$STEP.$name.log"; then
    info "already loaded (--keep)"
  else
    die "load-b17 $(basename "$f"): $(grep -v '^[[:space:]]*at ' "$RUN/$STEP.$name.log" | tail -n 3)"
  fi
done
for s in $STEPS_AFTER_B17; do run "load-$s" "${LOADER[@]}" "$s" --apply --org "$ORG"; done

# ================================================================== 9. advertising
step "9-ads"
run extract-main-ads python3 -I packages/backend/scripts/mvp/extract-main-ads.py
run load-ads "${LOADER[@]}" ads --apply --org "$ORG"

# ================================================================== 10. the labels of the operations
step "10-operation-labels"
# assign-operation-labels first: the step operations-echo8 of assign-label-books needs its 7 Echo8 operations (D-168)
run operation-labels "${TSX[@]}" packages/backend/scripts/assign-operation-labels.ts "$DATA" --org "$ORG" --apply

# ================================================================== 11. the seven manual API writes of 2026-11-03
# Before --mark-source (recipe 11's order: step 6 before the books). The replayed operation is created with
# labelId 0to8, so its label_source is `operator` and assign-operation-labels never counts it as `default`.
step "11-manual-writes"
api GET "/documents?ownerId=$REPLAY_OWNER&kind=advance_basis"
want 200 "GET /documents"
if [ "$(jget "sum(1 for x in d if '$REPLAY_MARKER' in x['title'])")" != 0 ]; then
  [ "$KEEP" = 1 ] || die "the replay is already there on a dropped stack"
  info "--keep: the replay exists (a document titled «$REPLAY_MARKER…»); not repeated"
else
  # 1-2. an approved advance_basis document of the owner (with a file: approve refuses a document without one,
  # document_not_attached; the originals of 2026-11-03 carried a file reference too)
  api POST /documents "{\"kind\":\"advance_basis\",\"title\":\"$REPLAY_MARKER: advance basis\",\"fileRef\":\"acceptance/replay-2026-11-03-advance-basis\",\"ownerId\":\"$REPLAY_OWNER\",\"requiresApproval\":true}" "$REPLAY_OPERATOR"
  want 201 "POST /documents advance_basis"
  DOC_ADVANCE="$(jget "d['id']")"
  api POST "/documents/$DOC_ADVANCE/approve" "{\"by\":\"$REPLAY_OPERATOR\"}" "$REPLAY_OPERATOR"
  want 200 "approve advance_basis"
  # 3-4. the operation out 40.00 under 0to8 on the pseudonym, scope one ISRC, with that document; its payment proof
  api POST /settlements/operations "{\"direction\":\"out\",\"amount\":\"40.00\",\"artistId\":\"$REPLAY_ARTIST\",\"ownerId\":\"$REPLAY_OWNER\",\"date\":\"2026-11-03\",\"scope\":{\"kind\":\"isrcs\",\"isrcs\":[\"$REPLAY_SCOPE_ISRC\"]},\"documentId\":\"$DOC_ADVANCE\",\"comment\":\"$REPLAY_MARKER: operation out 40.00\",\"labelId\":\"$LABEL_0TO8\"}" "$REPLAY_OPERATOR"
  want 201 "POST /settlements/operations"
  OPERATION="$(jget "d['id']")"
  api POST "/settlements/operations/$OPERATION/proof" "{\"fileRef\":\"acceptance/replay-2026-11-03-payment-proof\",\"title\":\"$REPLAY_MARKER: payment proof\"}" "$REPLAY_OPERATOR"
  want 200 "POST /settlements/operations/:id/proof"
  # 5-6. an approved appendix document (no owner)
  api POST /documents "{\"kind\":\"appendix\",\"title\":\"$REPLAY_MARKER: appendix\",\"fileRef\":\"acceptance/replay-2026-11-03-appendix\",\"requiresApproval\":true}" "$REPLAY_OPERATOR"
  want 201 "POST /documents appendix"
  DOC_APPENDIX="$(jget "d['id']")"
  api POST "/documents/$DOC_APPENDIX/approve" "{\"by\":\"$REPLAY_OPERATOR\"}" "$REPLAY_OPERATOR"
  want 200 "approve appendix"
  # 7. confirm the manual split of the ISRC (ids are not stable across rebuilds: found by ISRC, origin and date)
  api GET "/splits?isrc=$REPLAY_SPLIT_ISRC&limit=100"
  want 200 "GET /splits"
  SPLIT="$(jget "(lambda m: m[0] if len(m) == 1 else '')([s['id'] for s in d['items'] if s['isrc'] == '$REPLAY_SPLIT_ISRC' and s['origin'] == 'manual' and s['validFrom'] == '2000-01-01'])")"
  [ -n "$SPLIT" ] || die "not exactly one manual split of $REPLAY_SPLIT_ISRC from 2000-01-01: $(jget "[(s['origin'], s['validFrom'], s['documentStatus']) for s in d['items']]")"
  api POST "/splits/$SPLIT/confirm" "{\"documentId\":\"$DOC_APPENDIX\"}" "$REPLAY_OPERATOR"
  want 200 "POST /splits/:id/confirm"
  info "replayed: documents $DOC_ADVANCE, $DOC_APPENDIX (+ the payment proof), operation $OPERATION, split $SPLIT confirmed"
fi

# ================================================================== 12. the books and the catalog
step "12-books"
if [ "$MARK_SOURCE_SUPPORTED" = 1 ]; then
  # D-168 recorded `default` = 1 315 over the live history, where the manual operation of 2026-11-03 had been put
  # under 0to8 by default (mixed advances 68). On a clean rebuild that operation is replayed by step 11 WITH a label
  # (`operator`), so the mixed advances are 67 and `default` is 1 314 (+ 1 `operator`). The script's own check expects
  # 1 315 and stops; --force passes it, and this step asserts the count itself: 1 314 (clean rebuild) or 1 315.
  run operation-label-source "${TSX[@]}" packages/backend/scripts/assign-operation-labels.ts "$DATA" --org "$ORG" --mark-source --apply --force
  DEFAULTS="$(sed -n 's/^[[:space:]]*source default: \([0-9][0-9]*\)$/\1/p' "$RUN/$STEP.operation-label-source.log" | tail -n 1)"
  case "$DEFAULTS" in
    1314|1315) info "label source default: $DEFAULTS (1 314 on a clean rebuild, 1 315 in the D-168 history)" ;;
    *) die "label source default: «$DEFAULTS», expected 1314 (clean rebuild) or 1315 (D-168)" ;;
  esac
fi
run label-books "${TSX[@]}" packages/backend/scripts/assign-label-books.ts "$DATA" --org "$ORG" --apply
run label-books-dry "${TSX[@]}" packages/backend/scripts/assign-label-books.ts "$DATA" --org "$ORG"
grep -q 'stop' "$RUN/$STEP.label-books-dry.log" && die "assign-label-books dry run after --apply stops"
grep -E '^[[:space:]]+(applied|→ 0to8: [1-9])' "$RUN/$STEP.label-books-dry.log" && die "assign-label-books dry run after --apply still has work"
run track-labels "${TSX[@]}" packages/backend/scripts/derive-track-labels.ts "$DATA" --org "$ORG" --apply
run track-labels-dry "${TSX[@]}" packages/backend/scripts/derive-track-labels.ts "$DATA" --org "$ORG"
expect_line "$RUN/$STEP.track-labels-dry.log" "ISRCs changed 0,"

# ================================================================== 13. the proofs
step "13-compare"
run compare-reference "${TSX[@]}" packages/backend/scripts/compare-reference.ts "$REFERENCE" --api "http://localhost:$PORT" --cookie "erp_session=$SESSION"
expect_line "$RUN/$STEP.compare-reference.log" "TOTAL differing: 0"
run check-owner-scope "${TSX[@]}" packages/backend/scripts/check-owner-scope.ts "$DATA" --org "$ORG"
expect_line "$RUN/$STEP.check-owner-scope.log" "differing owners: 0"
run check-label-books "${TSX[@]}" packages/backend/scripts/check-label-books.ts "$DATA" 200 --org "$ORG"
expect_line "$RUN/$STEP.check-label-books.log" "differing: 0"
expect_line "$RUN/$STEP.check-label-books.log" "(д) owners with a non-empty book '?': 0"

# ================================================================== 14. the login proves the organization and the role
step "14-me"
api GET /auth/me
want 200 "GET /auth/me"
ME="$(jget "'%s|%s|%s|%s|%s' % (d['authMode'], d['user']['login'] if d['user'] else '', d['org']['id'] if d['org'] else '', d['org']['name'] if d['org'] else '', d['role'])")"
[ "$ME" = "on|$OPERATOR_LOGIN|$ORG|$ORG_NAME|org_admin" ] || die "/auth/me: $ME"
info "/auth/me: mode on, user $OPERATOR_LOGIN, organization $ORG_NAME ($ORG), role org_admin, labels $(jget "','.join(l['name'] for l in d['labels'])") (all: $(jget "d['allLabels']"))"

# ================================================================== summary
step "summary"
row() { printf '  %-28s %14s %14s  %s\n' "$1" "$2" "$3" "$( [ "$2" = "$3" ] && echo ok || echo '≠ (information)')"; }
cnt() { pg "SELECT count(*) FROM $1" 2>/dev/null || echo '?'; } # the clean stack holds one organization
printf '  %-28s %14s %14s\n' "count" "this run" "recipe 11"
row "owners" "$(cnt owners.owners)" 1151
row "artists" "$(cnt owners.artists)" 2134
row "tracks" "$(cnt owners.tracks)" 26305
row "documents" "$(cnt owners.documents)" 1400
row "contracts" "$(cnt owners.contracts)" 803
row "splits" "$(cnt splits.splits)" 24107
row "split shares" "$(cnt splits.split_shares)" 42070
row "participations" "$(cnt splits.participations)" 283
row "operations" "$(cnt settlements.operations)" 2663
row "B17 statements" "$(cnt publishing.pub_statements)" 6
row "B17 lines" "$(cnt publishing.pub_lines)" 1162586
row "labels" "$(cnt labels.labels)" 17
row "ads" "$(cnt ads.expenses)" 2686
row "track label rows" "$(cnt owners.track_labels)" 23121
row "Believe files (loaded)" "$FILES_LOADED" 47
row "Believe rows" "$CH_ROWS" "$EXPECT_ROWS"
row "Believe Σ net" "$CH_NET" "$EXPECT_NET"
echo
info "compare-reference: $(grep -F 'TOTAL differing' "$RUN/13-compare.compare-reference.log")"
info "check-owner-scope: $(grep -F 'differing owners' "$RUN/13-compare.check-owner-scope.log" | tail -n 1)"
info "check-label-books: $(grep -E '^differing: ' "$RUN/13-compare.check-label-books.log")"
info "organization $ORG_NAME $ORG; login $OPERATOR_LOGIN (org_admin); secrets in $SECRETS; log $LOG"
echo
echo "ACCEPTANCE PASSED ($STAMP)"
