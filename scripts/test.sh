#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# PocketBase local test harness
#
# Usage:
#   ./scripts/test.sh              # reuse existing volume
#   ./scripts/test.sh --fresh      # destroy volume first
#   ./scripts/test.sh --keep       # leave container running after test
#   ./scripts/test.sh --fresh --keep
# ---------------------------------------------------------------------------

cd "$(dirname "$0")/.."

FRESH=false
KEEP=false
CONTAINER="web-db-sage-pb-pocketbase-1"
PB_URL="http://localhost:8090"
ADMIN_EMAIL="admin@test.local"
ADMIN_PASS="testpass123"

for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=true ;;
    --keep)  KEEP=true ;;
    *)       echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# --- Helpers ---------------------------------------------------------------

log()  { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

# Update or append a key=value in .env (preserves quotes around value)
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key} *=" .env 2>/dev/null; then
    sed -i.bak "s|^${key} *=.*|${key} = \"${val}\"|" .env && rm -f .env.bak
  else
    # Ensure file ends with newline before appending
    [ -s .env ] && [ -n "$(tail -c 1 .env)" ] && echo "" >> .env
    echo "${key} = \"${val}\"" >> .env
  fi
}

wait_for_pb() {
  log "Waiting for PocketBase to be ready..."
  local tries=0
  while ! curl -sf "${PB_URL}/api/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 30 ]; then
      fail "PocketBase did not become healthy after 30s"
    fi
    sleep 1
  done
  log "PocketBase is healthy"
}

# --- Main ------------------------------------------------------------------

if [ "$FRESH" = true ]; then
  log "Fresh mode: removing volume..."
  docker compose down -v 2>/dev/null || true
fi

log "Starting PocketBase..."
docker compose up -d

wait_for_pb

# Create superuser (idempotent — upsert)
log "Ensuring superuser exists..."
docker exec "$CONTAINER" pocketbase superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASS" --dir=/app/pb_data

set_env "PB_ADMIN_EMAIL" "$ADMIN_EMAIL"
set_env "PB_ADMIN_PASS"  "$ADMIN_PASS"

# Authenticate and get token
log "Authenticating..."
AUTH_RESPONSE=$(curl -sf -X POST "${PB_URL}/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\": \"${ADMIN_EMAIL}\", \"password\": \"${ADMIN_PASS}\"}" 2>&1) \
  || fail "Auth failed: ${AUTH_RESPONSE}"

TOKEN=$(echo "$AUTH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null) \
  || fail "Could not parse auth token from response"

set_env "PB_ADMIN_TOKEN" "$TOKEN"
log "Auth token saved to .env"

# Submit test order
log "Submitting test order..."
ORDER_RESPONSE=$(curl -sf -X POST "${PB_URL}/api/collections/orders/records" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User",
    "organization": "Acme Corp",
    "config": {
      "deploy": "local",
      "platform": "AMD Ryzen 9",
      "compute": "16 cores",
      "memory": "128 GB DDR5",
      "storage": "2 TB NVMe",
      "software": "pro",
      "support": "priority",
      "access": {"ssh": true, "vpn": false, "web": true}
    },
    "monthly_total": 299,
    "annual_total": 3050,
    "status": "new"
  }' 2>&1) \
  || fail "Order creation failed: ${ORDER_RESPONSE}"

ORDER_NUMBER=$(echo "$ORDER_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('order_number','(none)'))" 2>/dev/null)
RECORD_ID=$(echo "$ORDER_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','(none)'))" 2>/dev/null)

echo ""
log "Order created!"
echo "    Order Number: ${ORDER_NUMBER}"
echo "    Record ID:    ${RECORD_ID}"
echo ""

# Show relevant container logs
log "Container logs (last 20 lines):"
docker logs "$CONTAINER" --tail 20 2>&1
echo ""

if [ "$KEEP" = true ]; then
  log "Container left running (--keep). Admin UI: ${PB_URL}/_/"
  log "Credentials: ${ADMIN_EMAIL} / ${ADMIN_PASS}"
else
  log "Stopping container..."
  docker compose down
fi

log "Done."
