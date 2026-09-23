#!/usr/bin/env bash
# Smoke test against a running local Api: health check + optional OTP dry-run.
# Usage: npm run smoke
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

read_env() {
  local key="$1"
  grep -E "^${key}=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true
}

PORT="$(read_env PORT)"
PORT="${PORT:-3000}"
BASE="http://127.0.0.1:${PORT}"

echo "GET ${BASE}/api/health"
curl -sfS "${BASE}/api/health"
echo

STAGE_VAL="$(read_env STAGE)"
STAGE_VAL="${STAGE_VAL:-dev}"

if [[ "$STAGE_VAL" == "dev" && -f scripts/dev-otp.mjs ]]; then
  EMAIL="${DEV_UP_OTP_EMAIL:-dev@pragma.local}"
  echo "OTP dry-run -> ${EMAIL}"
  node scripts/dev-otp.mjs "$EMAIL" || echo "OTP dry-run fallo (no bloqueante)."
fi
