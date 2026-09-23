#!/usr/bin/env bash
# Bootstrap local dev environment: Supabase local -> prisma generate -> Api up -> Web up -> smoke.
# Asume que PragmaCRM-Api, PragmaCRM-Web (y, cuando exista, PragmaCRM-Mobile) son carpetas
# hermanas dentro de un mismo directorio padre.
# Para levantar solo la Api, usar `npm run dev-api`.
# Usage: npm run dev-web
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/lib/dev-core.sh"

PARENT_DIR="$(cd "$ROOT/.." && pwd)"
WEB_DIR="$PARENT_DIR/PragmaCRM-Web"
MOBILE_DIR="$PARENT_DIR/PragmaCRM-Mobile"

print_banner
start_supabase_and_api

WEB_OK=0
if [[ -d "$WEB_DIR" ]]; then
  echo
  echo "==> Web (PragmaCRM-Web)"

  if [[ ! -f "$WEB_DIR/.env" && -f "$WEB_DIR/.env.example" ]]; then
    cp "$WEB_DIR/.env.example" "$WEB_DIR/.env"
    echo "Cree PragmaCRM-Web/.env desde .env.example — revisa VITE_SUPABASE_ANON_KEY y VITE_API_KEY."
  fi

  ensure_node_modules "$WEB_DIR" "Web"

  WEB_PIDFILE="$ROOT/.dev-up.web.pid"
  WEB_LOGFILE="$ROOT/.dev-up.web.log"

  if [[ -f "$WEB_PIDFILE" ]] && kill -0 "$(cat "$WEB_PIDFILE")" 2>/dev/null; then
    echo "==> Web ya corria (pid $(cat "$WEB_PIDFILE")); la reinicio"
    kill "$(cat "$WEB_PIDFILE")" 2>/dev/null || true
    sleep 1
  fi

  echo "==> Levantando 'npm run dev' (Web) en background"
  (
    cd "$WEB_DIR"
    npm run dev >"$WEB_LOGFILE" 2>&1 &
    echo $! >"$WEB_PIDFILE"
  )

  echo "==> Esperando Web en http://localhost:5173"
  for _ in $(seq 1 60); do
    if curl -sf http://localhost:5173 >/dev/null 2>&1; then
      WEB_OK=1
      break
    fi
    sleep 0.5
  done

  if [[ "$WEB_OK" -ne 1 ]]; then
    echo "Web timeout. Ultimas lineas de ${WEB_LOGFILE}:" >&2
    tail -n 40 "$WEB_LOGFILE" >&2 || true
    exit 1
  fi
else
  echo
  echo "==> PragmaCRM-Web no esta en $WEB_DIR — omito Web (clonala como carpeta hermana de PragmaCRM-Api)."
fi

print_common_ports
if [[ "$WEB_OK" -eq 1 ]]; then
  printf '\033[0;32mWeb (Vite)              http://localhost:5173\033[0m\n'
fi
if [[ ! -d "$MOBILE_DIR" ]]; then
  echo "Mobile                  no clonado aun (esperado en $MOBILE_DIR)"
fi
echo "STAGE                   ${STAGE_VAL}"
run_otp_dry_run

echo
echo "Listo."
echo "Logs en vivo: npm run log-api"
