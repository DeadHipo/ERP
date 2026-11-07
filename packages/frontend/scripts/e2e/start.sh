#!/usr/bin/env bash
# Starts the stack for the Playwright run (one command: `npm run e2e` from the repo root):
# checks Docker, seeds the private stores `erp_e2e` / `believe_e2e`, verifies the seed (verify-seed.ts), builds the client, serves it with the API on :3100.
set -euo pipefail
# D-189: the seeded stores load B17 through the old module, so the e2e API runs on the source v1
export PUBLISHING_SOURCE=v1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

running="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
for service in postgres clickhouse; do
  if ! grep -q "$service" <<<"$running"; then
    echo "e2e: the $service container is not running. Start the stack first:" >&2
    echo "  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d" >&2
    exit 1
  fi
done

SEED=packages/backend/scripts/e2e/seed.ts
if [ -f "$SEED" ]; then
  npx tsx "$SEED" e2e
  # fail fast: a seed that disagrees with docs/agents/19 would show up as many red specs; this is one clear failure
  npx tsx packages/backend/scripts/e2e/verify-seed.ts e2e
else
  echo "e2e: $SEED is missing; the stores will be empty (the smoke specs still run)" >&2
fi

npm run build -w @erp/frontend

mkdir -p data/test-tmp/e2e-data
# the login is on (D-170): the specs sign in with the users of the seed (passwords in the keys file, e2e/global-setup.ts).
# The secret of the session and the system key are random per run and live only in the environment of this process.
AUTH_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
SYSTEM_ADMIN_KEY=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")
# the organization of the seed stays the default one (only AUTH_MODE=off would use it)
ERP_DEFAULT_ORG=$(node -p "require('./data/test-tmp/e2e-keys.json').orgId")
exec env DB_DATABASE=erp_e2e CLICKHOUSE_DATABASE=believe_e2e PAYOUT_THRESHOLD_CENTS=0 PORT=3100 ERP_DEFAULT_ORG="$ERP_DEFAULT_ORG" \
  AUTH_MODE=on AUTH_SECRET="$AUTH_SECRET" SYSTEM_ADMIN_KEY="$SYSTEM_ADMIN_KEY" AUTH_COOKIE_SECURE= AUTH_LOGIN_LIMIT=0 AUTH_IP_LIMIT=0 \
  ERP_DATA_DIR=data/test-tmp/e2e-data \
  npx tsx packages/backend/src/main.ts data/test-tmp/e2e-data
