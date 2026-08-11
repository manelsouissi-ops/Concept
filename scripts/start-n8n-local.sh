#!/usr/bin/env bash
set -e

cd "$HOME/Concept"

# Load CONCEPT environment
set -a
source .env.local
set +a

# Allow workflows to read $env
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false

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

exec n8n start
