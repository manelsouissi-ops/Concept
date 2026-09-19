# Local AI Migration Audit

Audit date: 2026-08-26  
Scope: current repository, sanitized runtime configuration, active n8n database, running local services, and existing benchmark artifacts.  
Method: read-only inspection. No document processing, generation, external AI request, workflow activation, configuration change, service restart, or database write was performed.

## 1. Executive summary

**Classification: STATUS B — PARTIALLY MIGRATED.**

The operational pipeline is local for PDF-to-Markdown conversion and has a running local Ollama/Qwen/Qdrant extraction stack in post-success shadow mode. It is **not** locally authoritative for either Fiche CDC generation or FCI generation:

- the active Fiche workflow sends CDC Markdown to the external Gemini API and treats the returned XML as authoritative;
- the active FCI workflow sends source data to the external Gemini API for modules A, B, C, and D;
- the local CDC result is comparison-only and is deliberately unable to change official Fiche or processing state;
- the historical Knowledge Base is implemented and running, but its catalog is empty, its ingestion workflows are inactive, and FCI does not query it;
- a local FCI benchmark exists in the uncommitted worktree, but it is not connected to the production generation path.

The live configuration does not set `CONFIDENTIAL_MODE`, `CDC_AI_PROVIDER`, or `FCI_GENERATION_PROVIDER`. Consequently, confidentiality fail-closed protection is not active. CDC resolves to shadow at the platform layer because `LOCAL_RAG_SHADOW_ENABLED=true`, but Gemini remains authoritative. FCI defaults to Gemini. There is no application-enforced allowlist limiting external processing to the three authorized CDCs.

| Component           | Current provider | Local? | RAG used? | External data exposure possible? | Migration status |
| ------------------- | ---------------- | -----: | --------: | -------------------------------: | ---------------- |
| CDC extraction      | Docling adapter (PDF → Markdown) | YES | NO | NO | Local operational |
| Fiche CDC           | Gemini `gemini-3.6-flash`; Qwen shadow after success | NO | Shadow only | YES | Partially migrated |
| FCI A               | Gemini `gemini-3.6-flash` | NO | NO | YES | Not migrated |
| FCI B               | Gemini `gemini-3.6-flash` | NO | NO | YES | Not migrated |
| FCI C               | Gemini `gemini-3.6-flash` | NO | NO | YES | Not migrated |
| FCI D               | Gemini `gemini-3.6-flash` | NO | NO | YES | Not migrated |
| Knowledge retrieval | Local historical-KB service, but empty and not connected to FCI | YES | YES | NO | Implemented, unused |
| Embeddings          | Ollama `qwen3-embedding:0.6b` | YES | YES | NO | Active supporting/shadow |

## 2. Current operational AI architecture

The reachable normal path is:

```text
CDC PDF
  → active n8n Document Processing workflow
  → local Docling-compatible adapter on 127.0.0.1:8010
  → stored Markdown
  → active n8n CDC Extraction workflow
  → external Gemini API / gemini-3.6-flash
  → authoritative Fiche XML
  → platform callback and human Fiche validation
  → optional local post-success shadow comparison
       Ollama qwen3:14b + qwen3-embedding:0.6b + Qdrant
  → active n8n FCI workflow
  → external Gemini API / gemini-3.6-flash for A, B, C, or D
  → needs_review
  → human validation and, later, DG Go/No-Go
```

Read-only runtime inspection found:

- Docling adapter alive on `127.0.0.1:8010`;
- local RAG alive on `127.0.0.1:8091`;
- historical Knowledge Base alive on `127.0.0.1:8092`;
- n8n alive on port `5678`;
- CONCEPT web alive on port `3000`;
- PostgreSQL alive on `127.0.0.1:5432`;
- Ollama active, with `qwen3:14b` and `qwen3-embedding:0.6b` available;
- Qdrant container running on ports `6333`/`6334`.

The application-facing services are loopback-bound. Ollama (`11434`) and Qdrant (`6333`/`6334`) were listening on all interfaces, which is a local-network exposure/hardening concern even though they are local providers.

## 3. CDC processing provider

The active `CONCEPT - Document Processing` workflow reads the PDF and invokes the configured document-parser endpoint. The current parser service is the Marker-compatible adapter in `scripts/document_parser_service.py`, backed by local Docling. Its health response identified `docling` as the parser.

- Provider: local Docling
- Function: PDF → Markdown/text
- Runtime endpoint: loopback port `8010`
- External AI required: **NO**
- AI/RAG involved: **NO**
- Operational evidence: active workflow and recent successful n8n executions

Some workflow/node/config names retain “Marker” terminology, but the live implementation behind the compatible endpoint is Docling.

## 4. Fiche provider

- Provider: **Gemini, authoritative**
- Model: `gemini-3.6-flash`
- Code path: platform launch → n8n webhook → active CDC Extraction workflow → signed platform callback
- Active n8n workflow: `CONCEPT - CDC Extraction` (`cdcExtractionV1`)
- AI node: `HTTP Request → Gemini XML`
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- Credential type: bearer token from `GEMINI_API_KEY`
- Provider selection: n8n reads `CDC_AI_PROVIDER` and defaults to `gemini`; the platform resolver treats the legacy `LOCAL_RAG_SHADOW_ENABLED=true` flag as `shadow`
- Fallback: **none**. Gemini is primary, not a fallback. `local` is explicitly rejected as authoritative with `LOCAL_CANONICAL_CONTRACT_NOT_READY`.
- External network required: **YES**

After an accepted external success callback, the platform schedules `runLocalRagShadowAfterOfficialSuccess()`. With the current legacy shadow flag, this submits the stored Markdown and authoritative Gemini XML to the loopback local-RAG service. The artifact explicitly records `authoritative_provider: "gemini"`, `authoritative_persisted: true`, and `official_state_mutated_by_shadow: false`.

There is a configuration nuance: the n8n workflow's own provider selector does not consult `LOCAL_RAG_SHADOW_ENABLED`, so its internal local-shadow branch defaults to Gemini-only when `CDC_AI_PROVIDER` is unset. The platform callback independently resolves the legacy flag and is the currently enabled shadow connection.

## 5. FCI A provider

- Provider/model: external Gemini / `gemini-3.6-flash`
- Prompt: module-A prompt and JSON schema from the FCI runtime contract/registry, supplied to the shared n8n generation workflow
- Runtime path: FCI service → `FCI_N8N_WEBHOOK_URL` → active shared FCI workflow → Gemini → signed callback → `needs_review`
- External call: **YES**
- Local RAG used: **NO**

## 6. FCI B provider

- Provider/model: external Gemini / `gemini-3.6-flash`
- Prompt: module-B prompt and JSON schema from the FCI runtime contract/registry
- Runtime path: the same active shared FCI workflow and callback path as A
- External call: **YES**
- Local RAG used: **NO**

## 7. FCI C provider

- Provider/model: external Gemini / `gemini-3.6-flash`
- Prompt: module-C prompt and JSON schema from the FCI runtime contract/registry
- Runtime path: the same active shared FCI workflow and callback path as A
- External call: **YES**
- Local RAG used: **NO**

## 8. FCI D provider

- Provider/model: external Gemini / `gemini-3.6-flash`
- Prompt: module-D prompt and JSON schema from the FCI runtime contract/registry
- Runtime path: the same active shared FCI workflow and callback path as A
- External call: **YES**
- Local RAG used: **NO**

`assertFciDPrerequisitesValidated()` calls `getFciDMissingPrerequisiteModules()` and rejects generation unless A, B, and C are validated. The provider work has not bypassed this gate.

## 9. Local RAG status

### CDC local RAG

- Implemented: **YES**
- Running: **YES**, loopback port `8091`
- Models: `qwen3:14b` generation and `qwen3-embedding:0.6b` embeddings through Ollama
- Vector store: Qdrant
- Connected to production flow: **YES, after authoritative Gemini success only**
- Authority: **SHADOW ONLY**
- Feature state: enabled at the platform layer through `LOCAL_RAG_SHADOW_ENABLED=true`
- Official mutation: **NO**; artifacts are isolated comparison records

The service health contract was `local-cdc-shadow.v1`; Ollama models and Qdrant dependencies were healthy.

### Historical Knowledge Base

- Implemented: **YES**
- Running: **YES**, loopback port `8092`
- Ingestion: implemented, but the single-CDC and batch n8n ingestion workflows are inactive
- Catalog state: zero knowledge documents, versions, and ingestion runs at audit time
- Embeddings: local `qwen3-embedding:0.6b`
- Vector storage: local Qdrant collection `concept_historical_cdc`
- Answer generation: local `qwen3:14b`
- Connected to FCI: **NO**
- Classification: **EXPERIMENTAL / UNUSED in the business flow**

### Local FCI work

The worktree contains a local FCI benchmark harness and analysis, but these files are uncommitted and not imported by the production FCI service or active workflow. This is **EXPERIMENTAL**, not a migrated runtime path.

## 10. n8n AI endpoint audit

| Workflow / status | AI node | Provider and endpoint | Model | Credential | Classification |
| --- | --- | --- | --- | --- | --- |
| `CONCEPT - CDC Extraction` / active | `HTTP Request → Gemini XML` | Gemini, `generativelanguage.googleapis.com/.../chat/completions` | `gemini-3.6-flash` | `GEMINI_API_KEY` bearer | External, authoritative |
| `CONCEPT - CDC Extraction` / active | local shadow request | Local RAG, `127.0.0.1:8091/v1/shadow` | service-pinned `qwen3:14b` | `LOCAL_RAG_SERVICE_TOKEN` bearer | Local, shadow; n8n branch not selected by current unset `CDC_AI_PROVIDER` |
| `FCI Module Generation - Gemini JSON` / active | Gemini JSON request | Gemini, `generativelanguage.googleapis.com/.../chat/completions` | `FCI_GENERATION_MODEL` = `gemini-3.6-flash` | `GEMINI_API_KEY` bearer | External, authoritative for A–D |
| `CONCEPT - Document Processing` / active | document-parser request | local adapter on port `8010` | Docling, no LLM | local HTTP | Local, authoritative conversion |
| Knowledge Base single/batch ingestion / inactive | KB service requests | local historical-KB service on port `8092` | local Qwen models | local service authentication/config | Local, not reachable in normal flow |

The n8n execution database showed recent successful executions for Document Processing, CDC Extraction, and FCI Gemini generation. This establishes runtime reachability, not merely checked-in workflow definitions.

## 11. Active Gemini dependencies

### ACTIVE GEMINI DEPENDENCIES

1. Authoritative Fiche CDC generation in the active CDC Extraction workflow.
2. Authoritative FCI A, B, C, and D proposal generation in the active shared FCI workflow.
3. Live runtime availability of `GEMINI_API_KEY` and `FCI_GENERATION_MODEL=gemini-3.6-flash`.
4. Local CDC shadow comparison is sequenced after Gemini success and uses persisted Gemini XML as its reference; shadow evaluation therefore also depends on a preceding Gemini result, although all shadow computation is local.

### FALLBACK GEMINI DEPENDENCIES

None were found in the current normal architecture. Gemini is the primary provider for Fiche and FCI, not a local-primary fallback.

### TEST-ONLY GEMINI DEPENDENCIES

- Existing benchmark/comparison tooling reads already-persisted Gemini/reference XML for comparison; it does not need to call Gemini.
- Repository test/diagnostic scripts and documentation mention Gemini. These strings do not make those scripts operational dependencies.
- The three-authorized-CDC benchmark compares persisted Gemini or human-validated references against local results.

### DEAD / LEGACY GEMINI CODE

- Inactive historical workflow definitions and diagnostic helpers containing Gemini calls are not reachable through the active normal workflow.
- Checked-in workflow repair/export scripts are maintenance artifacts, not running AI calls.

The still-active Gemini dependencies above must not be misclassified as legacy merely because local services also exist.

## 12. Active local AI dependencies

| Dependency | Classification | Actual role |
| --- | --- | --- |
| Docling | `ACTIVE_OPERATIONAL` | Authoritative PDF-to-Markdown conversion |
| Ollama | `ACTIVE_SUPPORTING` | Serves local generation and embedding models |
| `qwen3:14b` | `SHADOW` | CDC post-success local extraction/comparison; also configured for the unused historical KB |
| `qwen3-embedding:0.6b` | `ACTIVE_SUPPORTING` / `SHADOW` | Local CDC retrieval embeddings; configured for historical KB |
| Qdrant | `ACTIVE_SUPPORTING` / `SHADOW` | Vector storage for local CDC RAG and historical KB |
| Local CDC RAG service | `SHADOW` | Connected after official Gemini success; cannot mutate official state |
| Historical KB service | `EXPERIMENTAL` | Running, but empty and not connected to FCI |
| Local FCI benchmark | `EXPERIMENTAL` | Read-only evaluation code, not production generation |

No local LLM is currently `ACTIVE_OPERATIONAL` as the authoritative Fiche or FCI generator.

## 13. Confidential-data exposure paths

| Operational workflow | Could content leave the Office/local environment? | Path |
| --- | --- | --- |
| PDF → Markdown | **NO** | PDF is sent to the loopback Docling adapter only |
| Markdown → Fiche XML | **YES** | CDC Markdown is sent to `generativelanguage.googleapis.com` by the active Gemini node |
| Local CDC shadow | **NO** | Markdown/reference XML remain on loopback Ollama/Qdrant/local-RAG services |
| FCI A | **YES** | FCI source payload and prompt are sent to Gemini |
| FCI B | **YES** | FCI source payload and prompt are sent to Gemini |
| FCI C | **YES** | FCI source payload and prompt are sent to Gemini |
| FCI D | **YES** | FCI source payload and prompt are sent to Gemini |
| Historical KB | **NO** when used as implemented | Ollama, embeddings, Qdrant, and KB service are local |

Overall answer: **YES, confidential data can currently reach external AI.** The live configuration allows the active Fiche and FCI Gemini paths. `CONFIDENTIAL_MODE` is unset, and the active code does not enforce the three-authorized-CDC boundary. Operational/process controls may restrict use, but that restriction is not enforced by the traced provider code.

Separately, Ollama and Qdrant listening on all network interfaces should be reviewed as an internal network-security issue; it is not external-AI transmission, but it weakens local-service isolation.

## 14. Authorized 3-CDC benchmark evidence

- Benchmark exists: **YES**
- Harness: `scripts/rag/benchmark_3cdc_local_models.py`
- Scope: exactly three configured CDC identifiers; no CDC contents are reproduced here
- Providers/models compared: persisted Gemini or human-validated reference vs local RAG-assisted `qwen3:14b` and local RAG-assisted `qwen3:30b`
- Supporting stack: local Qwen embeddings and isolated benchmark Qdrant collections
- Metrics: schema validity, grounding validity, 34-field exact/normalized/different/reference-only/local-only/both-null classifications, runtime, and GPU snapshots
- Safety design: no Gemini calls and no writes to PostgreSQL, official Fiche XML, status, documents, or processing jobs

Observed outcome:

- `qwen3:14b`: 3/3 runs succeeded with schema and grounding validation passing;
- `qwen3:30b`: 0/3 passed; all three reached schema-valid output but failed strict grounding validation;
- the 14B field comparison still showed material differences from the references, including reference-only fields.

Conclusion reached: `qwen3:14b` is the better validated local candidate under this benchmark and `qwen3:30b` is not acceptable under the current strict pipeline. This is evidence of technical viability, **not evidence that local generation was approved or connected as authoritative**.

## 15. Business-gate verification

The audited provider work preserves the existing responsibility boundaries:

- Human Fiche validation: **preserved**. Generated Fiches enter a validation state rather than becoming silently final.
- Human FCI validation: **preserved**. Successful AI callbacks set module output to `needs_review`.
- FCI D prerequisites: **preserved**. A, B, and C must be validated before D generation.
- RBAC: **preserved**. View, edit, generate, validate, and coordination checks remain in service code.
- Final DG Go/No-Go: **preserved and separate** from AI generation; DG authorization remains required.
- Null/human-required fields: **preserved** through strict schemas, validation, completeness handling, and human-review rendering.
- Local shadow authority: **none**. It is fail-open relative to the already authoritative Gemini result and explicitly cannot change official state.

## 16. Migration classification

**STATUS B — PARTIALLY MIGRATED**

This is not Status A because an operational stage—PDF conversion—is local, and the local AI/RAG stack is running and connected in shadow. It is not Status C because local AI is not the primary Fiche or FCI provider. It is not Status D because both important structured-generation stages require the external Gemini API in the current reachable runtime.

## 17. What remains to finish the migration

1. Make the validated local CDC contract authoritative, then switch the active CDC workflow/provider from Gemini to local without weakening schema, grounding, callback, idempotency, or human-validation controls.
2. Implement and validate a production local provider for FCI A–D, including targeted local retrieval where justified, while preserving module schemas, RBAC, human review, and the A+B+C gate for D.
3. Populate and validate the historical Knowledge Base through approved local-only ingestion before allowing FCI retrieval; its current empty catalog cannot support production decisions.
4. Enable and verify fail-closed confidential configuration for both CDC and FCI. FCI currently has a Gemini default but no equivalent traced local/confidential provider guard.
5. Enforce the external-testing authorization boundary in code/configuration during transition, rather than relying solely on procedure.
6. Remove the normal-path requirement for `GEMINI_API_KEY` only after local acceptance criteria, rollback design, and human validation have been verified.
7. Restrict Ollama and Qdrant network binding/firewall exposure appropriately for an Office-local confidential stack.

## 18. Recommended next step

The best next step is a controlled, fail-closed CDC cutover design: define explicit acceptance thresholds from the completed three-CDC `qwen3:14b` evidence, close the remaining field-quality gaps, and enable local authority only behind an explicit confidential provider configuration. Keep Gemini disabled for non-authorized records by an enforceable allowlist during transition. After the CDC contract is proven, apply the same provider abstraction and gated benchmark process separately to FCI A–D; do not connect the empty historical KB to production FCI until local ingestion and retrieval quality have been validated.
