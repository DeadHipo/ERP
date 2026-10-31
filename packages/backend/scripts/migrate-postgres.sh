#!/usr/bin/env bash
# PostgreSQL migration runner (runs inside the postgres image, which already has psql).
#
# Applies migrations/postgres/NNNN_name.sql in order and records each one in schema_migrations
# (version, name, sha256 of the file, time). An applied file that was edited afterwards is an error.
# PostgreSQL DDL is transactional: a migration and its schema_migrations row are one transaction
# (psql -1), so a failing migration leaves nothing behind and is simply run again next time.
#
# Not safe to run in two processes at once: meant to be the one-shot `postgres-migrate` compose service.
#
# Usage:   migrate-postgres.sh            apply pending migrations
#          migrate-postgres.sh --status   show applied and pending, change nothing
# Env:     PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (standard libpq variables),
#          MIGRATIONS_DIR (default ../migrations/postgres), POSTGRES_WAIT_SECONDS (default 90)
set -euo pipefail

dir="${MIGRATIONS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/migrations/postgres}"
wait_seconds="${POSTGRES_WAIT_SECONDS:-90}"
status_only=false
[[ "${1:-}" == "--status" ]] && status_only=true

psql_q() { PGOPTIONS='-c client_min_messages=warning' psql -X -v ON_ERROR_STOP=1 -qAt "$@"; }
checksum() { tr -d '\r' < "$1" | sha256sum | cut -d' ' -f1; }

# wait for the server (on a first start the image runs a temporary server and restarts it)
for ((i = 0; ; i += 2)); do
  psql_q -c 'SELECT 1' >/dev/null 2>&1 && break
  ((i >= wait_seconds)) && { echo "postgres migrate failed: server is not ready after ${wait_seconds}s" >&2; exit 1; }
  sleep 2
done

psql_q -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null 2>&1 \
  || psql_q -c "SELECT 1 FROM schema_migrations LIMIT 0" >/dev/null

declare -A applied_sum=()
max_applied=0
while IFS='|' read -r v _ c; do
  [[ -z "$v" ]] && continue
  applied_sum[$((10#$v))]="$c"
  ((10#$v > max_applied)) && max_applied=$((10#$v))
done < <(psql_q -c "SELECT version, name, checksum FROM schema_migrations ORDER BY version")

pending=()
declare -A seen=()
shopt -s nullglob
for file in "$dir"/*.sql; do
  base="$(basename "$file")"
  [[ "$base" =~ ^([0-9]{4})_([a-z0-9_]+)\.sql$ ]] || { echo "postgres migrate failed: $base does not match NNNN_name.sql" >&2; exit 1; }
  version=$((10#${BASH_REMATCH[1]}))
  [[ -n "${seen[$version]:-}" ]] && { echo "postgres migrate failed: two migrations have version $version" >&2; exit 1; }
  seen[$version]=1
  sum="$(checksum "$file")"
  if [[ -n "${applied_sum[$version]:-}" ]]; then
    [[ "${applied_sum[$version]}" == "$sum" ]] || { echo "postgres migrate failed: $base was changed after it was applied (checksum differs). Add a new migration instead." >&2; exit 1; }
    $status_only && echo "applied  $base"
  else
    ((version < max_applied)) && { echo "postgres migrate failed: $base has a lower version than the applied $max_applied: renumber it" >&2; exit 1; }
    $status_only && echo "pending  $base"
    pending+=("$file")
  fi
done

$status_only && exit 0
if ((${#pending[@]} == 0)); then
  echo "postgres: up to date (${#applied_sum[@]} applied)"
  exit 0
fi

for file in "${pending[@]}"; do
  base="$(basename "$file")"
  [[ "$base" =~ ^([0-9]{4})_([a-z0-9_]+)\.sql$ ]]
  version=$((10#${BASH_REMATCH[1]}))
  name="${BASH_REMATCH[2]}"
  echo "postgres: applying $base"
  # -1: the file and the schema_migrations row are one transaction
  psql_q -1 -f "$file" \
    -c "INSERT INTO schema_migrations (version, name, checksum) VALUES ($version, '$name', '$(checksum "$file")')" >/dev/null \
    || { echo "postgres migrate failed: $base" >&2; exit 1; }
done
echo "postgres: applied ${#pending[@]}, total $((${#applied_sum[@]} + ${#pending[@]}))"
