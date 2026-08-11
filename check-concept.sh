#!/usr/bin/env bash
set -u
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"
failures=0
pass() { printf '[PASS] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*" >&2; failures=$((failures + 1)); }
check_url() { curl --silent --fail --max-time 4 "$2" >/dev/null 2>&1 && pass "$1: $2" || fail "$1: $2"; }

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  pass ".env.local exists"
else
  fail ".env.local is missing"
fi

required=(DATABASE_URL AUTH_SECRET N8N_WEBHOOK_URL N8N_WEBHOOK_TOKEN PLATFORM_CALLBACK_TOKEN N8N_CALLBACK_SECRET PLATFORM_PUBLIC_BASE_URL FCI_N8N_WEBHOOK_URL FCI_N8N_WEBHOOK_TOKEN FCI_CALLBACK_BEARER_TOKEN FCI_CALLBACK_HMAC_SECRET FCI_GENERATION_MODEL GEMINI_API_KEY)
for key in "${required[@]}"; do
  value="${!key:-}"
  if [[ -z "$value" || "$value" == *CHANGE_ME* ]]; then fail "Required variable $key is missing or still a placeholder"; else pass "Variable $key is set"; fi
done

pg_isready -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" >/dev/null 2>&1 && pass "PostgreSQL accepts connections" || fail "PostgreSQL is unreachable"
if [[ -n "${DATABASE_URL:-}" ]] && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'select 1' >/dev/null 2>&1; then pass "DATABASE_URL login/query works"; else fail "DATABASE_URL login/query failed"; fi

APP_PORT="${CONCEPT_APP_PORT:-3000}"
check_url "CONCEPT" "http://127.0.0.1:$APP_PORT/login"
check_url "n8n" "http://127.0.0.1:5678/healthz"
DOCUMENT_PARSER="${DOCUMENT_PARSER:-marker}"
if [[ "$DOCUMENT_PARSER" == "docling" ]]; then
  check_url "Docling parser" "${DOCLING_SERVICE_URL:-http://127.0.0.1:8010}/health"
else
  check_url "Marker" "http://127.0.0.1:8000/docs"
fi
if [[ -n "${FCI_CALLBACK_SIGNER_URL:-${N8N_CALLBACK_SIGNER_URL:-}}" ]]; then check_url "Callback signer" "http://127.0.0.1:8899/health"; fi
check_url "Ollama" "http://127.0.0.1:11434/api/tags"

if (( failures )); then printf '\n%d check(s) failed.\n' "$failures" >&2; exit 1; fi
printf '\nAll CONCEPT checks passed.\n'
