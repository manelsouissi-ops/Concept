# Local Fiche CDC Cutover

## Live deployment status

```text
IMPLEMENTED = YES
DEPLOYED = YES
LIVE VERIFIED = YES
FICHE GEMINI → LOCAL MIGRATION = COMPLETE
```

Live verification date: 2026-08-26 on `srv-ia`, using one fixture already listed in the authorized three-CDC benchmark. No document content or confidential extracted value is reproduced here.

- Live workflow: `CONCEPT - CDC Extraction` (`cdcExtractionV1`), active with its existing ID.
- A reversible pre-deployment workflow-only backup was retained outside the repository and is not part of this commit.
- Effective policy: confidential mode enabled, provider local, model `qwen3:14b`, external comparison disabled, external allowlist empty, automatic shadow disabled.
- Persisted evidence: job completed; provider `local`; model `qwen3:14b`; embedding model `qwen3-embedding:0.6b`; local validation passed; business status `fiche_a_valider`; Fiche status `draft`; no automatic human-validation timestamp.
- Execution-path evidence: the verified extraction ran `Call Local Fiche Extraction`, local response cleanup, canonical validation, success callback signing, and persistence callback. `HTTP Request → Gemini XML` was present only as a dormant explicitly controlled node and was not executed.
- Local runtime evidence: `/v1/extract` returned HTTP 200 and Ollama served local embedding/generation requests during the execution window.

The first live attempt correctly failed closed when the legacy n8n validator rejected an ElementTree self-closing control element. It did not execute Gemini. The provider-neutral validator was updated to accept canonical self-closing control elements, the same workflow ID was backed up and redeployed, and the normal API retry succeeded. The failed attempt remains unchanged in audit history.

## 1. Previous architecture

The split CDC pipeline converted PDFs locally with Docling, then the CDC extraction workflow sent Markdown to Gemini `gemini-3.6-flash`. Gemini XML was authoritative. A local `qwen3:14b` run could execute later as non-authoritative shadow telemetry.

## 2. New architecture

```text
PDF → local Docling → persisted Markdown
    → n8n CDC extraction W2
    → local service /v1/extract
    → Ollama qwen3:14b + qwen3-embedding:0.6b + Qdrant
    → strict grounding + canonical XML validation
    → signed canonical callback
    → fiche_a_valider
    → mandatory human review and validation
```

The provider cutover changes only Fiche generation. FCI A–D remain on their existing Gemini workflow. Historical Knowledge Base ingestion and FCI RAG are unchanged.

## 3. Provider policy

- `CDC_AI_PROVIDER` accepts `local` or `gemini` and defaults to `local`.
- `LOCAL_FICHE_MODEL` defaults to the proven `qwen3:14b` model.
- `CDC_WORKFLOW_MODE` defaults to `split`, which separates Docling conversion from structured Fiche extraction.
- The n8n W2 selector independently defaults to local and repeats external-provider authorization checks.
- Successful callbacks persist safe `provider`, `llm_model`, `embedding_model`, and validation metadata on the processing job.

Recommended normal configuration:

```dotenv
CDC_WORKFLOW_MODE=split
CONFIDENTIAL_MODE=true
CDC_AI_PROVIDER=local
LOCAL_FICHE_MODEL=qwen3:14b
EXTERNAL_AI_COMPARISON_ENABLED=false
EXTERNAL_AI_AUTHORIZED_CDC_IDS=
```

## 4. Confidentiality behavior

Local generation is permitted in confidential mode. Gemini is denied unless all of these conditions hold:

1. `CDC_AI_PROVIDER=gemini` is explicitly selected;
2. `CONFIDENTIAL_MODE=false`;
3. `EXTERNAL_AI_COMPARISON_ENABLED=true`;
4. the exact `code_interne` is present in `EXTERNAL_AI_AUTHORIZED_CDC_IDS`.

The allowlist defaults empty. Both launch and callback boundaries enforce the policy. A missing or stale provider label cannot be persisted as a local callback.

## 5. External-test allowlist

`EXTERNAL_AI_AUTHORIZED_CDC_IDS` is a comma-separated operator-managed list. No authorized business identifier is hardcoded in source or example configuration. Explicit comparison mode can use Gemini only for an identifier in this list. Automatic Gemini shadow comparison has been removed from the active workflow and disabled by the application resolver.

## 6. Failure behavior

The local extraction HTTP error branch goes directly to the signed failed callback with `LOCAL_FICHE_GENERATION_FAILED`. It has no graph edge to Gemini. Schema, grounding, response-identity, or canonical-XML failure therefore leaves the job in a truthful error/retry state; it never silently returns an external result.

## 7. Local model and validation contract

The authoritative endpoint reuses the benchmarked `/v1/extract` implementation:

- generation: Ollama `qwen3:14b`;
- embeddings: Ollama `qwen3-embedding:0.6b`;
- retrieval: the existing isolated per-document Qdrant collection;
- extraction: the proven local prompt, field routing, canonical interpretation, normalization, and deterministic fallbacks;
- quality: strict per-field grounding plus canonical 34-field XML/evaluation/control validation.

n8n verifies that the response declares `provider=local`, the expected model, `validation.passed=true`, and a non-empty `canonical_xml`, then applies the existing workflow XML validator before callback.

## 8. Tests

Targeted tests cover:

- local default and confidential local launch;
- external opt-in and empty-by-default allowlist;
- non-allowlisted denial at launch and callback;
- absence of a local-to-Gemini fallback edge;
- local response validation and provider metadata;
- disabled automatic shadow behavior;
- existing local schema, grounding, canonical, and routing rules.

The existing three-CDC benchmark artifacts remain the quality evidence for choosing `qwen3:14b`; the cutover does not require another external call.

## 9. Remaining Gemini dependencies

- FCI A, B, C, and D generation remains on Gemini and is out of scope for this cutover.
- The explicit, disabled-by-default authorized CDC comparison path retains the Gemini node.
- Legacy/inactive workflows and diagnostics may still contain Gemini code.

Gemini is no longer required by the checked-in normal split Fiche path. Deployment still requires importing/activating the updated W2 workflow and restarting application/n8n processes with the local provider configuration; this implementation does not mutate the live n8n database or restart services.

## 10. Next migration step

After deploying and observing the local Fiche cutover on approved fixtures, migrate FCI A–D as a separate project. Preserve validated-Fiche prerequisites, per-module human validation, RBAC, the A+B+C gate for D, and the final DG Go/No-Go decision.
