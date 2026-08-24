# Fail-closed confidential mode

`CONFIDENTIAL_MODE` is the CDC confidentiality invariant. It is parsed strictly as `true` or `false`; unset defaults to `false`. It is not a provider preference and has priority over `CDC_AI_PROVIDER` and the legacy `LOCAL_RAG_SHADOW_ENABLED` flag.

## Resolution rules

| Confidential | CDC provider | Result |
|---|---|---|
| false | gemini | Existing Gemini CDC route is permitted. |
| false | shadow | Gemini remains authoritative; callback-side local comparison is permitted. |
| false | local | Blocked because local CDC authority is not approved. |
| true | gemini | Blocked before n8n/Gemini. |
| true | shadow | Blocked before n8n/Gemini; no shadow task is scheduled. |
| true | local | Fails closed with `CONFIDENTIAL_LOCAL_PROVIDER_NOT_READY`. |

`CDC_AI_PROVIDER` is authoritative when explicitly set. For backward compatibility only, `LOCAL_RAG_SHADOW_ENABLED=true` resolves to `shadow` when `CDC_AI_PROVIDER` is unset. The flag cannot override an explicit provider or confidential mode.

## Enforcement boundaries

- The Next.js analysis launcher resolves policy before creating processing state or calling an n8n webhook.
- The versioned CDC extraction workflow repeats a strict pre-Gemini guard. A blocked branch has no graph path to the Gemini HTTP node.
- The signed Fiche callback rejects external CDC callbacks while confidential mode is active, before official persistence.
- Callback-side local shadow execution uses the same resolver. n8n no longer independently calls the local shadow endpoint.
- Local-RAG uses loopback Ollama and Qdrant. Service, embedding, generation, or grounding failure returns a local error and has no Gemini/cloud fallback.

## Local-only boundary for the future Knowledge Base

When confidential mode is enabled, future CDC, project-history, consultant-profile, and internal-company Knowledge Base operations may use only:

- local filesystem and database storage;
- local Docling/approved local parsing;
- loopback Ollama generation and embedding models;
- loopback Qdrant retrieval.

They must not use Gemini, another external LLM API, an external embedding API, telemetry containing document content, or any cloud fallback. This document defines the reusable invariant only; it does not activate or implement Knowledge Base ingestion.

## Current operational state

The default remains `CONFIDENTIAL_MODE=false` and `CDC_AI_PROVIDER=gemini`. Confidential mode is deliberately not operationally activatable for CDC processing until local authority passes its separate quality gate. Setting it to `true` now produces an explicit blocked state rather than falling back externally.
