#!/bin/sh
# read-only helper: pg.sh "select ..."
exec docker exec royalty-erp-postgres-1 psql -U erp -d erp -At -F "	" -c "$1"
