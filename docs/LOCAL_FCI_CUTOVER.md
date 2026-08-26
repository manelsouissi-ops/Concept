# Local FCI A cutover

## Live deployment status

```text
IMPLEMENTED = YES
DEPLOYED = YES
LIVE VERIFIED = YES
FCI A GEMINI → LOCAL MIGRATION = COMPLETE
```

Live verification date: 2026-08-26 on `srv-ia`, using `AO-20260818-1144` — one of the
three explicitly authorized benchmark fixtures, selected because it has an existing
human-validated Fiche, unlike `AO-20260824-1322` which was still in `fiche_a_valider`
at the time and was correctly not used. No FCI content or confidential business value
is reproduced here.

- Live workflow: `FCI Module Generation - Provider Routed JSON` (`kEdTbJ7VBcg54Gkn`),
  imported, published, and activated; n8n restarted to load it. A pre-deployment
  workflow-only backup was retained outside the repository (not part of this commit).
- Effective policy at test time: `CONFIDENTIAL_MODE=true`, `FCI_A_GENERATION_PROVIDER`
  unset (defaults to `local`), `LOCAL_FCI_MODEL` unset (defaults to `qwen3:14b`),
  `EXTERNAL_AI_COMPARISON_ENABLED=false`, `EXTERNAL_AI_AUTHORIZED_CDC_IDS` empty.
- Trigger path: authenticated `POST /api/appels-offres/AO-20260818-1144/fci/A/regenerate`
  as the tender's real Commercial owner via the normal login flow (no RBAC bypass).
- Persisted evidence (`fci_generation_jobs` id 2434): `provider=local`,
  `model=qwen3:14b`, `status=completed`, `source_fiche_version` matches the validated
  Fiche timestamp, no error code.
- n8n execution-path evidence (execution 373, deserialized directly from the n8n
  execution store): the single generation node `HTTP Request → Selected FCI Provider`
  resolved `llm_provider=local`, `ai_url=http://127.0.0.1:11434/api/chat`, and no
  Gemini authorization header was attached. The unified workflow graph has no
  separate Gemini node for this call, so there was nothing else that could have run.
- Local runtime evidence: Ollama's own request log shows one `POST /api/chat` from
  `127.0.0.1` returning HTTP 200 in the same window as the job's completion timestamp.
- Quality evidence (persisted field metadata, not values): 0 fields with
  `source_type=ai_inference` (the grounding validator's unsupported-claim class),
  0 grounding violations (the run would have failed closed with
  `AI_GROUNDING_VALIDATION_FAILED` otherwise), and every protected/human-only field
  (preparer, validator, differentiator, vulnerability, target price, transit,
  deposit owner, local representation, and undocumented competitor
  strengths/history) persisted as `internal_required` / null / `confidence=none` /
  `requires_human_input=true`, never fabricated.
- Lifecycle: module A status is `needs_review`, `validated_at` is null — no automatic
  validation occurred.
- FCI B and C were not touched (their most recent jobs remain their original
  2026-08-19 Gemini runs). FCI D remains `not_started`; the gate was not exercised.
- Historical Knowledge Base: unchanged (`knowledge_base` row count and max
  `updated_at` unchanged from before this task; `knowledge_vectors` remains empty).

## Scope and provider state

This checkpoint migrates only FCI A generation in the checked-in workflow. It is not a live deployment.

| Module | Checked-in provider after this change | Model |
|---|---|---|
| A | local Ollama | `qwen3:14b` |
| B | Gemini (unchanged) | existing `FCI_GENERATION_MODEL` |
| C | Gemini (unchanged) | existing `FCI_GENERATION_MODEL` |
| D | Gemini (unchanged) | existing `FCI_GENERATION_MODEL` |

The application resolves A to `FCI_A_GENERATION_PROVIDER=local` by default and
`LOCAL_FCI_MODEL=qwen3:14b`. The workflow sends local requests only to the
loopback Ollama `/api/chat` endpoint. There is no local-to-Gemini fallback.

An exceptional A Gemini comparison requires all of: `CONFIDENTIAL_MODE=false`,
`FCI_A_GENERATION_PROVIDER=gemini`, `EXTERNAL_AI_COMPARISON_ENABLED=true`, and
the exact CDC code in `EXTERNAL_AI_AUTHORIZED_CDC_IDS`. The default allowlist is
empty. The application and workflow both enforce this boundary.

## Contract, grounding and human ownership

The existing `fci-commercial.schema.json` and provider-independent commercial
prompt remain authoritative. The UI's 18 human-visible FCI A fields and all API
field names are unchanged. Input remains limited to the validated Fiche,
platform metadata, and the explicit shortlist extracted from the current CDC.
No historical RAG, archive, CV, or commercial-memory source is connected.

Schema validation still runs before persistence. Commercial guardrails rebuild
competitors only from the explicit current shortlist and force current/internal
fields to `null`, `internal_required`, `confidence=none`, and
`requires_human_input=true`: preparer, validator, strengths and client history,
differentiator, vulnerability, target price, transit commitment, deposit owner,
and local representation. Grounding validation then rejects non-null AI
inferences and Fiche claims whose cited excerpts are absent from the validated
launch evidence.

## Failure and lifecycle

Ollama, JSON, schema, grounding, callback, or canonical validation failure uses
the existing explicit failed/retryable job path. It never switches provider.
Successful generation remains a proposal in `needs_review`; validation remains
a human RBAC-protected action. FCI A contains no GO/NO-GO decision. Existing D
gating still requires human-validated A, B, and C.

## Benchmark evidence

The pre-existing authorized fixture report for `AO-20260824-1322` was reused
offline; no new external call was made. Its FCI A run used `qwen3:14b` and
reported generation PASS, schema PASS, quality/grounding PASS, eight human
blockers, zero unsupported claims, zero internal-claim violations, and no
decision leakage. The benchmark harness and report remain evaluation-only and
do not write official FCI data or processing state.

## Deployment and future work

The checked-in workflow has since been imported, published, activated, and live
verified on `srv-ia` (see "Live deployment status" above). FCI B/C/D migration and
targeted historical RAG remain separate future phases.
