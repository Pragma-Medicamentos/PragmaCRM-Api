#!/usr/bin/env bash
# Bootstrap local dev environment: Supabase local -> prisma generate -> Api up -> Mobile (Expo).
# Asume que PragmaCRM-Api y PragmaCRM-Mobile son carpetas hermanas dentro de un mismo directorio
# padre. A diferencia de Web, Expo no se levanta en background: su CLI es interactivo (QR, teclas
# a/i/w para abrir Android/iOS/Web), asi que queda en foreground. Api y Supabase si quedan en
# background — pararlos despues con `npm run dev-down`.
# Usage: npm run dev-mobile
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/lib/dev-core.sh"

PARENT_DIR="$(cd "$ROOT/.." && pwd)"
MOBILE_DIR="$PARENT_DIR/PragmaCRM-Mobile"

if [[ ! -d "$MOBILE_DIR" ]]; then
  echo "No encuentro PragmaCRM-Mobile en $MOBILE_DIR — debe ser carpeta hermana de PragmaCRM-Api." >&2
  exit 1
fi

print_banner
start_supabase_and_api
print_common_ports
echo "STAGE                   ${STAGE_VAL}"
run_otp_dry_run

if [[ ! -f "$MOBILE_DIR/.env" && -f "$MOBILE_DIR/.env.example" ]]; then
  cp "$MOBILE_DIR/.env.example" "$MOBILE_DIR/.env"
  echo
  echo "Cree PragmaCRM-Mobile/.env desde .env.example. A diferencia de Api/Web, no apunta al stack"
  echo "local por defecto — completar a mano:"
  echo "  - EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: proyecto real de"
  echo "    Supabase (Dashboard > Project Settings > API Keys), no el stack local de Docker."
  echo "  - EXPO_PUBLIC_API_URL: 10.0.2.2:3000 en el emulador Android, localhost:3000 en el"
  echo "    simulador iOS, o la IP de esta Mac en la LAN para un dispositivo fisico."
  echo "  - EXPO_PUBLIC_API_KEY: el mismo valor que API_KEY en PragmaCRM-Api/.env."
fi

ensure_node_modules "$MOBILE_DIR" "Mobile"

echo
echo "==> Mobile (PragmaCRM-Mobile) — Expo queda en foreground."
echo "    Ctrl+C para salir. Api y Supabase siguen corriendo (npm run dev-down para apagarlos)."
echo
cd "$MOBILE_DIR"
exec npx expo start
