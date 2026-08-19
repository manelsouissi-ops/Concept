#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="$REPO_ROOT/.env.local"
[[ -f "$ENV_FILE" ]] || { printf 'Docling startup aborted: %s is missing.\n' "$ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
port="${DOCLING_PORT:-8010}"
owner="$(ss -H -ltnp "sport = :$port" 2>/dev/null || true)"
[[ -z "$owner" ]] || { printf 'Docling startup aborted: port %s is occupied.\n%s\n' "$port" "$owner" >&2; exit 1; }
python_bin="${DOCLING_PYTHON:-$REPO_ROOT/../FastMarker-API/.venv/bin/python}"
[[ -x "$python_bin" ]] || { printf 'Docling startup aborted: Python runtime is unavailable at %s.\n' "$python_bin" >&2; exit 1; }
export CONCEPT_DOCLING_MANAGED_RUNTIME=1
cd "$REPO_ROOT"
exec "$python_bin" -m uvicorn scripts.document_parser_service:app --app-dir "$REPO_ROOT" --host 127.0.0.1 --port "$port"
