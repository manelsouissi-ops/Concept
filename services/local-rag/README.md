# CONCEPT local RAG shadow service

This loopback-only service is the controlled semantic-extraction boundary for W2 shadow evaluation. It is deliberately separate from Docling and does not parse PDFs.

## Start

```bash
set -a
source .env.local
set +a
.venv-rag/bin/python services/local-rag/server.py
```

Required configuration:

- `LOCAL_RAG_SERVICE_TOKEN`
- local PostgreSQL through the repository's existing `DATABASE_URL`
- Ollama at `127.0.0.1:11434` with `qwen3:14b` and `qwen3-embedding:0.6b`
- Qdrant at `127.0.0.1:6333`

Optional configuration:

- `LOCAL_RAG_HOST` (default `127.0.0.1`)
- `LOCAL_RAG_PORT` (default `8091`)
- `LOCAL_RAG_SHADOW_LOG_DIR` (default `/tmp/concept-local-rag-shadow`)

## Endpoints

- `GET /health`
- `POST /v1/extract` — validated 34-field canonical local candidate; never persists business state
- `POST /v1/shadow` — compares the candidate with authoritative Gemini XML and writes idempotent JSONL telemetry

Both POST endpoints require `Authorization: Bearer $LOCAL_RAG_SERVICE_TOKEN`. Requests must include the exact `appel_offre_id`, `code_interne`, `document_id`, persisted Markdown path, and SHA-256. Mismatches fail with HTTP 409. Retrieval has no unfiltered fallback.

## Current safety boundary

The implementation covers all 34 canonical extraction tags, the three evaluation nodes,
deterministic control sections, and emits the existing canonical XML shape.  Coverage is
not the same as readiness: the August 2026 full-field benchmark still has missing and
conflicting values. Consequently W2 permits it in `shadow` mode only;
`CDC_AI_PROVIDER=local` continues to fail closed with
`LOCAL_CANONICAL_CONTRACT_NOT_READY`.
