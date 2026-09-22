#!/usr/bin/env bash
# Apaga todo lo que levanto npm run dev-up: Api, Web y Supabase local.
# Usage: npm run dev-down
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

stop_pidfile() {
  local name="$1" pidfile="$2" logfile="$3"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "==> Deteniendo ${name} (pid ${pid})"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    else
      echo "==> ${name} no estaba corriendo (pid ${pid} ya no existe)"
    fi
    rm -f "$pidfile" "$logfile"
  else
    echo "==> ${name} no tenia pidfile (${pidfile})"
  fi
}

stop_pidfile "Api" "$ROOT/.dev-up.api.pid" "$ROOT/.dev-up.api.log"
stop_pidfile "Web" "$ROOT/.dev-up.web.pid" "$ROOT/.dev-up.web.log"

echo "==> Supabase local (npx supabase stop)"
npx supabase stop

echo
echo "Listo. Todo apagado."
