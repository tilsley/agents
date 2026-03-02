#!/usr/bin/env bash
set -uo pipefail

C_CONDUCTOR='\033[0;34m'  # blue
C_UI='\033[0;32m'         # green
C_RESET='\033[0m'
C_BOLD='\033[1m'
C_DIM='\033[2m'

PIDS=()

prefix() {
  local label="$1" color="$2"
  while IFS= read -r line; do
    printf "${color}${C_BOLD}%-11s${C_RESET} ${C_DIM}│${C_RESET} %s\n" "$label" "$line"
  done
}

cleanup() {
  printf "\n${C_BOLD}Shutting down…${C_RESET}\n"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  printf "${C_BOLD}Done.${C_RESET}\n"
  exit 0
}

trap cleanup INT TERM

cd "$(dirname "$0")"

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Validate required vars
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "Error: GITHUB_TOKEN not set. Add to .env or export it." >&2; exit 1
fi
if [ ! -f conductor.pem ]; then
  echo "Error: conductor.pem not found. Download your GitHub App private key." >&2; exit 1
fi

export GITHUB_APP_ID="${GITHUB_APP_ID:-2920581}"
export GITHUB_INSTALLATION_ID="${GITHUB_INSTALLATION_ID:-111664943}"
export GITHUB_WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-whs_t1ls3y_4g3nts_l0c4l}"
export PORT="${PORT:-3000}"
export COPILOT_GITHUB_TOKEN="${COPILOT_GITHUB_TOKEN:-$GITHUB_TOKEN}"
export GITHUB_PRIVATE_KEY="$(cat conductor.pem)"

printf "${C_BOLD}agents dev${C_RESET}\n"
printf "  ${C_CONDUCTOR}conductor${C_RESET}  → http://localhost:${PORT}\n"
printf "  ${C_UI}ui${C_RESET}         → http://localhost:5173\n\n"

# 1. Conductor
GITHUB_PRIVATE_KEY="$GITHUB_PRIVATE_KEY" \
  bun run apps/conductor/src/main.ts 2>&1 \
  | prefix "conductor" "$C_CONDUCTOR" &
PIDS+=($!)

# 2. UI dev server
(cd apps/ui && bun run dev) 2>&1 \
  | prefix "ui" "$C_UI" &
PIDS+=($!)

wait
