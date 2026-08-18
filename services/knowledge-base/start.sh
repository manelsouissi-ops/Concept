#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a
source ../../.env.local
set +a
export KB_PG_DSN="${KB_PG_DSN:-${DATABASE_URL:-}}"
export KB_DOCLING_ENDPOINT="${KB_DOCLING_ENDPOINT:-http://127.0.0.1:8010}"
export KB_OLLAMA_ENDPOINT="${KB_OLLAMA_ENDPOINT:-http://127.0.0.1:11434}"
export KB_QDRANT_ENDPOINT="${KB_QDRANT_ENDPOINT:-http://127.0.0.1:6333}"
export KB_QDRANT_COLLECTION="${KB_QDRANT_COLLECTION:-concept_historical_cdc}"
export KB_GEN_MODEL="${KB_GEN_MODEL:-qwen3:14b}"
export KB_EMBED_MODEL="${KB_EMBED_MODEL:-qwen3-embedding:0.6b}"
exec .venv-kb/bin/python run_service.py
