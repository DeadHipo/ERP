#!/bin/sh
# read-only helper: pg.sh "select ..."
# The database and user: DB_DATABASE / DB_USERNAME from the environment, then the repo .env, then erp.
# The container: ERP_PG_CONTAINER from the environment, else the live one.
ENV_FILE="$(dirname "$0")/../../../../.env"
fromenv() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
DB="${DB_DATABASE:-$(fromenv DB_DATABASE)}"
USR="${DB_USERNAME:-$(fromenv DB_USERNAME)}"
exec docker exec "${ERP_PG_CONTAINER:-royalty-erp-postgres-1}" psql -U "${USR:-erp}" -d "${DB:-erp}" -At -F "	" -c "$1"
