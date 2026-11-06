#!/bin/sh
# read-only helper: pg.sh "select ..."
# The database and user: DB_DATABASE / DB_USERNAME from the environment, then the repo .env, then erp.
ENV_FILE="$(dirname "$0")/../../../../.env"
fromenv() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
DB="${DB_DATABASE:-$(fromenv DB_DATABASE)}"
USR="${DB_USERNAME:-$(fromenv DB_USERNAME)}"
exec docker exec royalty-erp-postgres-1 psql -U "${USR:-erp}" -d "${DB:-erp}" -At -F "	" -c "$1"
