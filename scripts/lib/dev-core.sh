#!/usr/bin/env bash
# Funciones compartidas por dev-api.sh y dev-web.sh. No se ejecuta directo: se importa con `source`.
# Asume que el caller ya hizo `cd "$ROOT"` (raiz de PragmaCRM-Api) antes de invocar estas funciones.

print_banner() {
  # Banner "PRAGMA" en bloque solido (trazo grueso), letras alternando verde y blanco.
  local G='\033[1;32m' W='\033[1;37m' N='\033[0m'
  printf "${G}██████████${N}  ${W}██████████${N}  ${G}..██████..${N}  ${W}..████████${N}  ${G}██......██${N}  ${W}..██████..${N}\n"
  printf "${G}██......██${N}  ${W}██......██${N}  ${G}██......██${N}  ${W}██........${N}  ${G}████..████${N}  ${W}██......██${N}\n"
  printf "${G}██████████${N}  ${W}██████████${N}  ${G}██████████${N}  ${W}██..██████${N}  ${G}██..██..██${N}  ${W}██████████${N}\n"
  printf "${G}██........${N}  ${W}██....██..${N}  ${G}██......██${N}  ${W}██......██${N}  ${G}██......██${N}  ${W}██......██${N}\n"
  printf "${G}██........${N}  ${W}██......██${N}  ${G}██......██${N}  ${W}..████████${N}  ${G}██......██${N}  ${W}██......██${N}\n"
  echo
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "Falta: $1" >&2; exit 1; }; }

read_env() {
  local key="$1"
  grep -E "^${key}=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true
}

# Instala dependencias en $1 (una carpeta hermana como Web o Mobile) si le falta node_modules.
ensure_node_modules() {
  local dir="$1" label="$2"
  if [[ ! -d "$dir/node_modules" ]]; then
    echo "==> ${label}: no hay node_modules, corriendo 'npm install'"
    (cd "$dir" && npm install)
  fi
}

ensure_env_file() {
  if [[ ! -f .env ]]; then
    if [[ -f .env.template ]]; then
      cp .env.template .env
      echo "Cree .env desde .env.template — revisa SUPABASE_SERVICE_ROLE_KEY y API_KEY tras 'npx supabase start'."
    else
      echo "No hay .env ni .env.template" >&2
      exit 1
    fi
  fi
}

# Levanta Supabase local, genera el cliente de Prisma y arranca la Api en background.
# Deja PORT, STAGE_VAL, BASE, PIDFILE y LOGFILE como variables globales para el caller.
start_supabase_and_api() {
  need npx
  need node
  need curl
  ensure_env_file

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
  echo $! >"$PIDFILE"

  echo "==> Esperando ${BASE}/api/health"
  local ok=0
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
}

print_common_ports() {
  echo
  printf '\033[0;32mSupabase Studio         http://127.0.0.1:54323\033[0m\n'
  printf '\033[0;32mSupabase Mail (OTP)     http://127.0.0.1:54324\033[0m\n'
}

# Sigue en vivo los archivos de log que existan entre los pasados como argumento.
# Los procesos siguen en background aunque se corte con Ctrl+C; usar `npm run dev-down` para apagarlos.
follow_logs() {
  local files=() f
  for f in "$@"; do
    [[ -f "$f" ]] && files+=("$f")
  done

  if [[ ${#files[@]} -eq 0 ]]; then
    echo "No hay logs para seguir."
    return
  fi

  echo "==> Logs en vivo (Ctrl+C para dejar de ver — los procesos siguen corriendo en background)"
  echo "    'npm run dev-down' para apagarlos."
  echo
  tail -n 20 -f "${files[@]}"
}

# Requiere STAGE_VAL ya seteado por start_supabase_and_api.
run_otp_dry_run() {
  if [[ "$STAGE_VAL" != "dev" ]]; then
    echo
    echo "==> STAGE=${STAGE_VAL} — omito OTP dry-run (solo corre en STAGE=dev)"
  else
    echo
    echo "==> OTP dry-run (STAGE=dev)"
    local EMAIL="${DEV_UP_OTP_EMAIL:-dev@pragma.local}"
    if [[ -f scripts/dev-otp.mjs ]]; then
      node scripts/dev-otp.mjs "$EMAIL" || echo "OTP dry-run fallo (¿el correo existe en auth.users? ver supabase/seed.sql). Health ya paso, continuo."
    else
      echo "No existe scripts/dev-otp.mjs — omito OTP dry-run."
    fi
  fi
}
