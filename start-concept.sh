#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"
RUN_DIR="$ROOT_DIR/tmp/concept-runtime"
LOG_DIR="$ROOT_DIR/tmp/concept-logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

ok() { printf '[OK] %s\n' "$*"; }
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
have_http() { curl --silent --fail --max-time 3 "$1" >/dev/null 2>&1; }

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE (copy env.example and fill its placeholders)."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for command in node npm python3 curl psql pg_isready n8n; do
  command -v "$command" >/dev/null || fail "Required command not found: $command"
done

APP_PORT="${CONCEPT_APP_PORT:-3000}"
APP_URL="http://127.0.0.1:$APP_PORT"
N8N_URL="http://127.0.0.1:5678"
MARKER_URL="http://127.0.0.1:8000"
DOCLING_URL="${DOCLING_SERVICE_URL:-http://127.0.0.1:8010}"
SIGNER_URL="http://127.0.0.1:8899"
DOCUMENT_PARSER="${DOCUMENT_PARSER:-marker}"
[[ "$DOCUMENT_PARSER" == "marker" || "$DOCUMENT_PARSER" == "docling" ]] || fail "DOCUMENT_PARSER must be marker or docling."

if ! pg_isready -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" >/dev/null 2>&1; then
  printf '[INFO] Starting the system PostgreSQL service...\n'
  if command -v systemctl >/dev/null && sudo -n systemctl start postgresql 2>/dev/null; then :
  elif command -v systemctl >/dev/null && systemctl start postgresql 2>/dev/null; then :
  else fail "PostgreSQL is down and could not be started. Run: sudo systemctl start postgresql"; fi
fi
pg_isready -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" >/dev/null || fail "PostgreSQL did not become ready."
ok "PostgreSQL is reachable"

if [[ "$DOCUMENT_PARSER" == "marker" ]]; then
  if [[ -z "${MARKER_SERVICE_DIR:-}" || ! -f "$MARKER_SERVICE_DIR/marker_api.py" ]]; then
    MARKER_SERVICE_DIR="$(find "$(dirname "$ROOT_DIR")" "$HOME" -maxdepth 4 -type f -name marker_api.py -printf '%h\n' 2>/dev/null | head -n 1 || true)"
  fi
  [[ -n "$MARKER_SERVICE_DIR" && -f "$MARKER_SERVICE_DIR/marker_api.py" ]] || fail "Marker service directory not found; set MARKER_SERVICE_DIR."
  MARKER_PY="$MARKER_SERVICE_DIR/.venv/bin/python"
  [[ -x "$MARKER_PY" ]] || fail "Marker venv missing: $MARKER_SERVICE_DIR/.venv"
  export PATH="$MARKER_SERVICE_DIR/.venv/bin:$PATH"
  PARSER_URL="$MARKER_URL"
else
  MARKER_SERVICE_DIR="${MARKER_SERVICE_DIR:-$HOME/FastMarker-API}"
  MARKER_PY="$MARKER_SERVICE_DIR/.venv/bin/python"
  [[ -x "$MARKER_PY" ]] || fail "Existing Marker FastAPI environment missing: $MARKER_SERVICE_DIR/.venv"
  DOCLING_PYTHON="${DOCLING_PYTHON:-$HOME/.venv-docling/bin/python}"
  [[ -x "$DOCLING_PYTHON" ]] || fail "Docling venv missing: $DOCLING_PYTHON"
  PARSER_URL="$DOCLING_URL"
fi

start_process() {
  local name="$1" pid_file="$2" log_file="$3"; shift 3
  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then ok "$name already started (PID $(cat "$pid_file"))"; return; fi
  nohup "$@" >>"$log_file" 2>&1 &
  printf '%s\n' "$!" >"$pid_file"
  printf '[INFO] Started %s (PID %s)\n' "$name" "$!"
}

export MARKER_DATA_ROOT="${MARKER_DATA_ROOT:-$HOME/.n8n-files}"
export DOCLING_DATA_ROOT="${DOCLING_DATA_ROOT:-$MARKER_DATA_ROOT}"
export DOCLING_PYTHON="${DOCLING_PYTHON:-$HOME/.venv-docling/bin/python}"
if [[ "$DOCUMENT_PARSER" == "docling" ]]; then
  export MARKER_CONVERT_URL="$PARSER_URL/convert"
  export MARKER_STATUS_URL="$PARSER_URL/status"
  export MARKER_RESULT_URL="$PARSER_URL/result"
else
  export MARKER_CONVERT_URL="${MARKER_CONVERT_URL:-$PARSER_URL/convert}"
  export MARKER_STATUS_URL="${MARKER_STATUS_URL:-$PARSER_URL/status}"
  export MARKER_RESULT_URL="${MARKER_RESULT_URL:-$PARSER_URL/result}"
fi
export N8N_CALLBACK_SIGNER_URL="${N8N_CALLBACK_SIGNER_URL:-$SIGNER_URL/sign}"
export FCI_CALLBACK_SIGNER_URL="${FCI_CALLBACK_SIGNER_URL:-$N8N_CALLBACK_SIGNER_URL}"
export N8N_SHARED_STORAGE_ROOT="${N8N_SHARED_STORAGE_ROOT:-$ROOT_DIR/data}"
export N8N_RESTRICT_FILE_ACCESS_TO="${N8N_RESTRICT_FILE_ACCESS_TO:-$ROOT_DIR/data}"
export N8N_BLOCK_ENV_ACCESS_IN_NODE="${N8N_BLOCK_ENV_ACCESS_IN_NODE:-false}"

if ! have_http "$PARSER_URL/docs"; then
  if [[ "$DOCUMENT_PARSER" == "marker" ]]; then
    start_process marker "$RUN_DIR/marker.pid" "$LOG_DIR/marker.log" bash -c "cd \"$MARKER_SERVICE_DIR\" && exec \"$MARKER_PY\" -m uvicorn marker_api:app --host 127.0.0.1 --port 8000"
  else
    start_process docling-parser "$RUN_DIR/docling-parser.pid" "$LOG_DIR/docling-parser.log" "$MARKER_PY" -m uvicorn scripts.document_parser_service:app --app-dir "$ROOT_DIR" --host 127.0.0.1 --port 8010
  fi
fi
if ! have_http "$SIGNER_URL/health"; then
  start_process callback-signer "$RUN_DIR/signer.pid" "$LOG_DIR/signer.log" python3 "$ROOT_DIR/scripts/callback-signer.py"
fi
if ! have_http "$N8N_URL/healthz"; then
  start_process n8n "$RUN_DIR/n8n.pid" "$LOG_DIR/n8n.log" bash -c "cd \"$ROOT_DIR\" && exec n8n start"
fi
if ! have_http "$APP_URL/login"; then
  start_process concept "$RUN_DIR/concept.pid" "$LOG_DIR/concept.log" bash -c "cd \"$ROOT_DIR\" && exec npm run dev -- --port \"$APP_PORT\""
fi

for attempt in {1..60}; do
  have_http "$PARSER_URL/docs" && have_http "$SIGNER_URL/health" && have_http "$N8N_URL/healthz" && have_http "$APP_URL/login" && break
  sleep 1
done

if ! have_http "$PARSER_URL/docs"; then
  if [[ "$DOCUMENT_PARSER" == "marker" ]]; then
    fail "Marker failed; see $LOG_DIR/marker.log"
  else
    fail "Docling parser failed; see $LOG_DIR/docling-parser.log"
  fi
fi
have_http "$SIGNER_URL/health" || fail "Signer failed; see $LOG_DIR/signer.log"
have_http "$N8N_URL/healthz" || fail "n8n failed; see $LOG_DIR/n8n.log"
have_http "$APP_URL/login" || fail "CONCEPT failed; see $LOG_DIR/concept.log"

printf '\nCONCEPT stack is ready:\n  App:     %s\n  n8n:     %s\n  Parser:  %s (%s/docs)\n  Signer:  %s/health\n  Logs:    %s\n' "$APP_URL" "$N8N_URL" "$DOCUMENT_PARSER" "$PARSER_URL" "$SIGNER_URL" "$LOG_DIR"
if ! curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  printf '[WARN] Ollama is not reachable on :11434; CDC anonymization will fail. Start it and pull llama3.1.\n' >&2
fi
