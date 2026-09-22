#!/usr/bin/env bash
# Bootstrap local dev environment: Supabase local -> prisma generate -> Api up -> smoke.
# Usage: npm run dev-up
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Falta: $1" >&2; exit 1; }; }
need npx
need node
need curl

if [[ ! -f .env ]]; then
  if [[ -f .env.template ]]; then
    cp .env.template .env
    echo "Cree .env desde .env.template — revisa SUPABASE_SERVICE_ROLE_KEY y API_KEY tras 'npx supabase start'."
  else
    echo "No hay .env ni .env.template" >&2
    exit 1
  fi
fi

read_env() {
  local key="$1"
  grep -E "^${key}=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true
}

echo "==> Supabase local (npx supabase start)"
npx supabase start

echo "==> Cliente de Prisma (npx prisma generate)"
npx prisma generate

PORT="$(read_env PORT)"
PORT="${PORT:-3000}"
STAGE_VAL="$(read_env STAGE)"
STAGE_VAL="${STAGE_VAL:-dev}"
BASE="http://127.0.0.1:${PORT}"

PIDFILE="$ROOT/.dev-up.api.pid"
LOGFILE="$ROOT/.dev-up.api.log"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "==> Api ya corria (pid $(cat "$PIDFILE")); la reinicio"
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 1
fi

echo "==> Levantando 'npm run dev' en background"
npm run dev >"$LOGFILE" 2>&1 &
API_PID=$!
echo "$API_PID" >"$PIDFILE"

echo "==> Esperando ${BASE}/api/health"
ok=0
for _ in $(seq 1 60); do
  if curl -sf "${BASE}/api/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 0.5
done

if [[ "$ok" -ne 1 ]]; then
  echo "Health timeout. Ultimas lineas de ${LOGFILE}:" >&2
  tail -n 40 "$LOGFILE" >&2 || true
  exit 1
fi

echo "==> Smoke health"
curl -sS "${BASE}/api/health"
echo

api_key_status="no"
[[ -n "$(read_env API_KEY)" ]] && api_key_status="yes"
service_role_status="no"
[[ -n "$(read_env SUPABASE_SERVICE_ROLE_KEY)" ]] && service_role_status="yes"

cat <<MAP

==> Mapa de puertos y variables (nombres, sin secretos)
  Api                     ${BASE}   (PORT=${PORT}, pid ${API_PID}, log ${LOGFILE})
  Supabase API            http://127.0.0.1:54321  (SUPABASE_URL)
  Postgres (Supabase)     127.0.0.1:54322          (DATABASE_URL)
  Supabase Studio         http://127.0.0.1:54323
  Supabase Mail (OTP)     http://127.0.0.1:54324
  STAGE                   ${STAGE_VAL}
  API_KEY set:                    ${api_key_status}
  SUPABASE_SERVICE_ROLE_KEY set:  ${service_role_status}

  Web (VITE_*):           VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL, VITE_API_KEY
  Mobile (EXPO_PUBLIC_*): EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, EXPO_PUBLIC_API_URL, EXPO_PUBLIC_API_KEY

  Detalle completo: docs/dx-ports-env.md
MAP

if [[ "$STAGE_VAL" != "dev" ]]; then
  echo
  echo "==> STAGE=${STAGE_VAL} — omito OTP dry-run (solo corre en STAGE=dev)"
else
  echo
  echo "==> OTP dry-run (STAGE=dev)"
  EMAIL="${DEV_UP_OTP_EMAIL:-dev@pragma.local}"
  if [[ -f scripts/dev-otp.mjs ]]; then
    node scripts/dev-otp.mjs "$EMAIL" || echo "OTP dry-run fallo (¿el correo existe en auth.users? ver supabase/seed.sql). Health ya paso, continuo."
  else
    echo "No existe scripts/dev-otp.mjs — omito OTP dry-run."
  fi
fi

echo
echo "Listo."
