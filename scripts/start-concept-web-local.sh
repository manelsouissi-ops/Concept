#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="$REPO_ROOT/.env.local"
[[ -f "$ENV_FILE" ]] || { printf 'CONCEPT web startup aborted: %s is missing.\n' "$ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
port="${CONCEPT_WEB_PORT:-3000}"
owner="$(ss -H -ltnp "sport = :$port" 2>/dev/null || true)"
[[ -z "$owner" ]] || { printf 'CONCEPT web startup aborted: port %s is occupied.\n%s\n' "$port" "$owner" >&2; exit 1; }
if ! command -v npm >/dev/null 2>&1; then
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  [[ -s "$nvm_script" ]] && source "$nvm_script"
fi
command -v npm >/dev/null 2>&1 || { printf 'CONCEPT web startup aborted: npm is unavailable.\n' >&2; exit 1; }
export CONCEPT_WEB_MANAGED_RUNTIME=1
cd "$REPO_ROOT"
exec npm run dev -- --port "$port"
