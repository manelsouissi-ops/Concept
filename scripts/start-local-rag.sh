#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="$REPO_ROOT/.env.local"
[[ -f "$ENV_FILE" ]] || { printf 'Local RAG startup aborted: %s is missing.\n' "$ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
[[ -n "${LOCAL_RAG_SERVICE_TOKEN:-}" ]] || { printf 'Local RAG is not configured: LOCAL_RAG_SERVICE_TOKEN is missing.\n' >&2; exit 1; }
port="${LOCAL_RAG_PORT:-8091}"
owner="$(ss -H -ltnp "sport = :$port" 2>/dev/null || true)"
[[ -z "$owner" ]] || { printf 'Local RAG startup aborted: port %s is occupied.\n%s\n' "$port" "$owner" >&2; exit 1; }
python_bin="$REPO_ROOT/.venv-rag/bin/python"
[[ -x "$python_bin" ]] || { printf 'Local RAG is not configured: %s is unavailable.\n' "$python_bin" >&2; exit 1; }
export CONCEPT_LOCAL_RAG_MANAGED_RUNTIME=1
cd "$REPO_ROOT"
exec "$python_bin" services/local-rag/server.py --host 127.0.0.1 --port "$port"
