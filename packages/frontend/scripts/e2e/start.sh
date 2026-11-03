#!/usr/bin/env bash
# Starts the stack for the Playwright run (one command: `npm run e2e` from the repo root):
# checks Docker, seeds the private stores `erp_e2e` / `believe_e2e`, builds the client, serves it with the API on :3100.
set -euo pipefail

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
else
  echo "e2e: $SEED is missing; the stores will be empty (the smoke specs still run)" >&2
fi

npm run build -w @erp/frontend

mkdir -p data/test-tmp/e2e-data
exec env DB_DATABASE=erp_e2e CLICKHOUSE_DATABASE=believe_e2e PAYOUT_THRESHOLD_CENTS=0 PORT=3100 \
  ERP_DATA_DIR=data/test-tmp/e2e-data \
  npx tsx packages/backend/src/main.ts data/test-tmp/e2e-data
