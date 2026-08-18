# Historical CDC knowledge-base ingestion

This is an additive, loopback-only preparation path for historical CDCs. It is separate from the production CDC → Fiche → FCI → Go/No-Go pipelines and from the local-RAG shadow service on port 8091.

## Architecture and ports

```text
n8n 5678 -> KB service 8092 -> Docling 8010 (async submit/poll)
                            -> Ollama 11434
                            -> Qdrant 6333 / concept_historical_cdc
                            -> PostgreSQL / knowledge_base schema
local RAG shadow remains independently on 8091
```

Verified office defaults:

- metadata generation: `qwen3:14b`
- embeddings: `qwen3-embedding:0.6b`, 1024 dimensions
- Qdrant distance: cosine
- processing version: `historical-cdc-v1`

## Configuration

The service reads existing `.env.local` through `start.sh` without logging it. Optional overrides are `KB_PG_DSN`, `KB_DOCLING_ENDPOINT`, `KB_OLLAMA_ENDPOINT`, `KB_QDRANT_ENDPOINT`, `KB_QDRANT_COLLECTION`, `KB_GEN_MODEL`, `KB_EMBED_MODEL`, `KB_PORT`, `KB_PARSE_TIMEOUT_SECS`, `KB_PARSE_POLL_SECS`, `KB_CHUNK_MAX_CHARS`, and `KB_CHUNK_OVERLAP_CHARS`.

For a future batch, set `KB_SOURCE_DIR` in the n8n process environment. `list_pdfs.py` recursively emits JSONL and safely handles spaces, apostrophes, Unicode, and nested directories. It does not invoke a shell parser.

## Install and start

```bash
cd ~/Concept/services/knowledge-base
python3 -m venv .venv-kb
.venv-kb/bin/pip install -r requirements.txt
./start.sh
curl http://127.0.0.1:8092/health
```

Stop a foreground service with `Ctrl-C`. For a temporary background pilot, record the PID and use `kill <pid>`; no production systemd unit is installed by this task.

## Catalog and vector collection

Apply `scripts/sql/20260818_knowledge_base.sql` to the same database configured by `DATABASE_URL`. It creates only:

- `knowledge_base.knowledge_documents` — logical filename identity;
- `knowledge_base.knowledge_document_versions` — immutable SHA/version history;
- `knowledge_base.knowledge_ingestion_runs` — attempts and failures.

The empty `concept_historical_cdc` Qdrant collection uses 1024-dimensional cosine vectors. UUIDv5 point IDs derive from document-version ID, SHA-256, and chunk index, so retries upsert the same points.

Exact successful SHA repeats return `SKIPPED_DUPLICATE` before Docling or embedding. A known filename with different bytes creates a new version and reports `UPDATED`. Failed versions are retried deterministically. `SUCCESS` requires completed non-empty Docling Markdown, schema-valid metadata, non-empty chunks, matching embedding count, successful Qdrant upsert, and a committed catalog transaction.

## Chunking and metadata

Markdown headings retain section/subsection provenance. Oversized paragraphs split into multiple overlapping chunks without truncation. Page remains null unless a future parser supplies trustworthy page provenance. Payloads include document/version identity, SHA, filename, document type, metadata filters, section, subsection, chunk index, and full chunk text.

Metadata evidence is selected across the full Markdown by six families: identity, client/financing, procedure, scope, personnel, and financial/contractual. Missing evidence becomes null or an empty list. Full document content is independently chunked and indexed regardless of metadata completeness.

## Tests and failure inspection

```bash
python3 -m unittest discover -s services/knowledge-base -p 'test_*.py' -v
curl http://127.0.0.1:8092/health
```

Inspect `knowledge_base.knowledge_document_versions` and `knowledge_base.knowledge_ingestion_runs` for `error_code`, `error_stage`, and `error_message`. The dense `query.py` helper is diagnostic only; historical retrieval will later join the existing LlamaIndex dense/BM25/hybrid/reranking architecture.

## When historical CDCs arrive

1. Place only an approved pilot document in a dedicated directory and set `KB_SOURCE_DIR`.
2. Confirm Docling 8010, Ollama 11434, Qdrant 6333, PostgreSQL, n8n 5678, and KB 8092 health.
3. Keep Batch inactive; invoke the inactive Single workflow manually for exactly one approved PDF.
4. Verify catalog version, chunk/vector counts, metadata evidence, and Qdrant provenance.
5. Re-run the identical PDF and require `SKIPPED_DUPLICATE` with unchanged version/point counts.
6. Only after those gates, activate/run Batch with concurrency 1 against five approved PDFs.
7. Review retrieval evidence before considering a 20-document pilot. Never point the workflow at the full archive initially.
