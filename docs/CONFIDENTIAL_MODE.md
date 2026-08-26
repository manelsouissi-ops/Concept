# Fail-closed confidential mode

`CONFIDENTIAL_MODE` is the CDC confidentiality invariant. It is parsed strictly as `true` or `false`. The authoritative Fiche provider defaults to local independently of this flag.

## Resolution rules

| Confidential | CDC provider | Result |
|---|---|---|
| unset/false | local or unset | Local `qwen3:14b` Fiche generation is allowed. |
| true | local or unset | Local `qwen3:14b` Fiche generation is allowed. |
| true | gemini | Blocked before the external call. |
| false | gemini, comparison disabled | Blocked. |
| false | gemini, comparison enabled, CDC absent from allowlist | Blocked. |
| false | gemini, comparison enabled, CDC allowlisted | Explicit controlled external comparison is allowed. |

The external allowlist defaults empty. `LOCAL_RAG_SHADOW_ENABLED` no longer changes provider resolution and cannot start an automatic comparison.

## Enforcement boundaries

- The Next.js launcher checks provider policy before creating processing state or calling n8n.
- The split CDC extraction workflow independently defaults to local and repeats the external opt-in and allowlist checks.
- The signed callback accepts a local result only while local is authoritative. External callbacks must pass the same explicit provider and per-CDC policy.
- Local HTTP, grounding, schema, or canonical XML failure produces a failed job and has no Gemini fallback edge.
- The local service uses Ollama and Qdrant and returns provider/model/validation metadata for auditability.

## Scope

This invariant covers Fiche CDC generation. FCI A–D still use their existing provider path and require a separate migration. Historical Knowledge Base ingestion and FCI retrieval are not activated by this cutover.
