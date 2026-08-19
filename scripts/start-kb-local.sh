#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
port="${KB_PORT:-8092}"
owner="$(ss -H -ltnp "sport = :$port" 2>/dev/null || true)"
[[ -z "$owner" ]] || { printf 'Knowledge Base startup aborted: port %s is occupied.\n%s\n' "$port" "$owner" >&2; exit 1; }
export CONCEPT_KB_MANAGED_RUNTIME=1
exec "$REPO_ROOT/services/knowledge-base/start.sh"
