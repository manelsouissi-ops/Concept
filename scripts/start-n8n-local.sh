#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="$REPO_ROOT/.env.local"

cd "$REPO_ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'CONCEPT n8n startup aborted.\nRequired environment file is missing:\n- %s\n' "$ENV_FILE" >&2
  exit 1
fi

# Load CONCEPT environment
set -a
source "$ENV_FILE"
set +a

# Allow workflows to read $env
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false
export CONCEPT_N8N_MANAGED_RUNTIME=1

# Parser adapter. The legacy variable names are kept because they are the
# published CDC workflow contract.
DOCUMENT_PARSER="${DOCUMENT_PARSER:-marker}"
if [[ "$DOCUMENT_PARSER" == "docling" ]]; then
  PARSER_URL="${DOCLING_SERVICE_URL:-http://127.0.0.1:8010}"
  export MARKER_CONVERT_URL="$PARSER_URL/convert"
  export MARKER_STATUS_URL="$PARSER_URL/status"
  export MARKER_RESULT_URL="$PARSER_URL/result"
elif [[ "$DOCUMENT_PARSER" == "marker" ]]; then
  export MARKER_CONVERT_URL="${MARKER_CONVERT_URL:-http://127.0.0.1:8000/convert}"
  export MARKER_STATUS_URL="${MARKER_STATUS_URL:-http://127.0.0.1:8000/status}"
  export MARKER_RESULT_URL="${MARKER_RESULT_URL:-http://127.0.0.1:8000/result}"
else
  printf 'DOCUMENT_PARSER must be marker or docling.\n' >&2
  exit 1
fi

# Shared n8n/Marker files
export N8N_SHARED_STORAGE_ROOT="${N8N_SHARED_STORAGE_ROOT:-$HOME/Concept/data}"
export N8N_RESTRICT_FILE_ACCESS_TO="${N8N_RESTRICT_FILE_ACCESS_TO:-$HOME/Concept/data}"

# Callback signer
export N8N_CALLBACK_SIGNER_URL="${N8N_CALLBACK_SIGNER_URL:-http://127.0.0.1:8899/sign}"

# Keep compatibility with the FCI variable already used by CONCEPT
export FCI_CALLBACK_SIGNER_URL="${FCI_CALLBACK_SIGNER_URL:-$N8N_CALLBACK_SIGNER_URL}"

required_variables=(
  N8N_WEBHOOK_TOKEN
  PLATFORM_CALLBACK_TOKEN
  GEMINI_API_KEY
)

if [[ "${CDC_AI_PROVIDER:-gemini}" == "local_rag" ]]; then
  required_variables+=(
    LOCAL_RAG_SERVICE_URL
    LOCAL_RAG_SERVICE_TOKEN
    LOCAL_RAG_CONTRACT_VERSION
  )
fi

missing_variables=()
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    missing_variables+=("$variable_name")
  fi
done

if (( ${#missing_variables[@]} > 0 )); then
  printf 'CONCEPT n8n startup aborted.\nMissing required environment variables:\n' >&2
  printf -- '- %s\n' "${missing_variables[@]}" >&2
  exit 1
fi

if [[ "${CONCEPT_N8N_SKIP_PORT_CHECK:-0}" != "1" ]]; then
  n8n_port="${N8N_PORT:-5678}"
  port_owner="$(ss -H -ltnp "sport = :$n8n_port" 2>/dev/null || true)"
  if [[ -n "$port_owner" ]]; then
    printf 'CONCEPT n8n startup aborted.\nPort %s is already occupied. Stop the existing service or process first.\n%s\n' \
      "$n8n_port" "$port_owner" >&2
    exit 1
  fi
fi

if [[ "${CONCEPT_N8N_PREFLIGHT_ONLY:-0}" == "1" ]]; then
  printf 'CONCEPT n8n startup preflight: OK\n'
  exit 0
fi

if ! command -v n8n >/dev/null 2>&1; then
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -s "$nvm_script" ]]; then
    # nvm is needed because a user systemd manager does not inherit the
    # interactive shell's Node PATH.
    # shellcheck disable=SC1090
    source "$nvm_script"
  fi
fi

if ! command -v n8n >/dev/null 2>&1; then
  printf 'CONCEPT n8n startup aborted.\nThe n8n executable is not available in the managed runtime PATH.\n' >&2
  exit 1
fi

exec n8n start
