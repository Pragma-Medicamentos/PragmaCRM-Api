#!/usr/bin/env bash
# Bootstrap local dev environment: Supabase local -> prisma generate -> Api up -> smoke.
# Solo Api (sin Web). Para levantar Api + Web juntos, usar `npm run dev-web`.
# Usage: npm run dev-api
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/lib/dev-core.sh"

print_banner
start_supabase_and_api
print_common_ports
echo "STAGE                   ${STAGE_VAL}"
run_otp_dry_run

echo
echo "Listo."
echo "Logs en vivo: npm run log-api"
