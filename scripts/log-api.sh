#!/usr/bin/env bash
# Sigue en vivo el log de la Api levantada por dev-api.sh / dev-web.sh / dev-mobile.sh.
# Usage: npm run log-api
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/lib/dev-core.sh"

LOGFILE="$ROOT/.dev-up.api.log"

if [[ ! -f "$LOGFILE" ]]; then
  echo "No hay $LOGFILE — la Api no esta corriendo (levantala con dev-api, dev-web o dev-mobile)." >&2
  exit 1
fi

follow_logs "$LOGFILE"
