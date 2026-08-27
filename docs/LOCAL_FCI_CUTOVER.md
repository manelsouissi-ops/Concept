# Local FCI cutover (A and B)

## Live deployment status

```text
FCI A
IMPLEMENTED = YES
DEPLOYED = YES
LIVE VERIFIED = YES
GEMINI → LOCAL MIGRATION = COMPLETE

FCI B
IMPLEMENTED = YES
DEPLOYED = YES
LIVE VERIFIED = YES
GEMINI → LOCAL MIGRATION = COMPLETE

FCI C
Gemini (unchanged)

FCI D
Gemini (unchanged)
```

Live verification dates: FCI A on 2026-08-26, FCI B on 2026-08-27, both on
`srv-ia`, both using `AO-20260818-1144` — one of the three explicitly
authorized benchmark fixtures, selected because it has an existing
human-validated Fiche, unlike `AO-20260824-1322` which remained in
`fiche_a_valider` at the time and was correctly not used for either module.
No FCI content or confidential business value is reproduced here.

### FCI A live evidence

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

### FCI B live evidence

- Live workflow: the same `FCI Module Generation - Provider Routed JSON`
  (`kEdTbJ7VBcg54Gkn`) workflow was updated in place — the `Build FCI Context`
  node now also recognizes `module_code === 'B'` for local routing and its own
  authorized-external-comparison gate, while `C`/`D` remain hard-locked to
  Gemini — then imported, published, activated, and n8n was restarted. A
  pre-deployment workflow-only backup was retained outside the repository.
- Effective policy at test time: identical to A's — `CONFIDENTIAL_MODE=true`,
  `FCI_B_GENERATION_PROVIDER` unset (defaults to `local`), `LOCAL_FCI_MODEL`
  unset (defaults to `qwen3:14b`), `EXTERNAL_AI_COMPARISON_ENABLED=false`,
  `EXTERNAL_AI_AUTHORIZED_CDC_IDS` empty. No configuration change was needed.
- Trigger path: authenticated `POST /api/appels-offres/AO-20260818-1144/fci/B/regenerate`
  as `sophie.bernard@concept.local`, the Finance user specifically assigned to
  module B on this tender, via the normal login flow (no RBAC bypass).
- Persisted evidence (`fci_generation_jobs` id 2721): `provider=local`,
  `model=qwen3:14b`, `status=completed`, `source_fiche_version` matches the
  validated Fiche timestamp, no error code.
- n8n execution-path evidence (execution 374, deserialized directly from the
  n8n execution store): the same single generation node
  `HTTP Request → Selected FCI Provider` resolved `llm_provider=local`,
  `ai_url=http://127.0.0.1:11434/api/chat`, and no Gemini authorization header
  was attached. No separate Gemini node exists in the graph.
- Local runtime evidence: Ollama's own request log shows one `POST /api/chat`
  from `127.0.0.1` returning HTTP 200 in the same window as the job's
  completion timestamp (16,128 tokens processed).
- Quality evidence (persisted field metadata, not values), read from both the
  raw stored AI-contract envelope and the real rendered UI form returned by
  `GET /api/appels-offres/{code}/fci/B`: 21 raw fields (5 `internal_required`,
  3 `fiche_cdc`, 7 `ai_inference`, 6 `unavailable`), 0 grounding violations
  (the run would have failed closed with `AI_GROUNDING_VALIDATION_FAILED`
  otherwise), and every protected financial/internal field —
  `taux_de_change_applique_et_source`, `coefficient_de_charges_de_structure`,
  `marge_cible_visee` in the raw envelope; the rendered
  `b1_elements_financiers.{taux_change, coefficient_charges_structure,
  marge_cible}` and `identification_commune.{prepared_by_name,
  validated_by_name}` in the UI form — persisted as `null` /
  `internal_required` (raw) or `human`/`human_required` (rendered), never
  fabricated.
- Lifecycle: module B status is `needs_review`, `validated_at` is null — no
  automatic validation occurred.

### Cross-module confirmation (both live runs)

- FCI A and C were not touched by the B run (their most recent
  generation timestamps are unchanged: A from 2026-08-26, C from its
  original 2026-08-19 Gemini run). FCI D remains `not_started`; the A+B+C
  gate was not exercised for either live run.
- No decision-leakage terms (`go_no_go`, `decision_finale`,
  `validation_finale`, `recommandation`) appear anywhere in the persisted B
  payload.
- Historical Knowledge Base: unchanged across both runs (`knowledge_base` row
  count and max `updated_at` unchanged from before this task; `knowledge_vectors`
  remains empty). No consultant/CV data or the 80 GB archive was accessed.

## Scope and provider state

FCI A and FCI B are both migrated and live-verified (see above).

| Module | Checked-in provider | Model | Live state |
|---|---|---|---|
| A | local Ollama | `qwen3:14b` | Live, verified |
| B | local Ollama | `qwen3:14b` | Live, verified |
| C | Gemini (unchanged) | existing `FCI_GENERATION_MODEL` | Live, unchanged |
| D | Gemini (unchanged) | existing `FCI_GENERATION_MODEL` | Live, unchanged |

The application resolves A to `FCI_A_GENERATION_PROVIDER=local` and B to
`FCI_B_GENERATION_PROVIDER=local`, both by default, sharing the same
`LOCAL_FCI_MODEL=qwen3:14b`. The two modules are resolved independently of
each other (an operator can flip one without affecting the other) through the
same `resolveFciProvider` policy function — no second, parallel provider
system was created for Finance. The workflow sends local requests only to the
loopback Ollama `/api/chat` endpoint for either module. There is no
local-to-Gemini fallback for A or B.

An exceptional Gemini comparison for A or B requires all of:
`CONFIDENTIAL_MODE=false`, the matching `FCI_A_GENERATION_PROVIDER` or
`FCI_B_GENERATION_PROVIDER` set to `gemini`, `EXTERNAL_AI_COMPARISON_ENABLED=true`,
and the exact CDC code in `EXTERNAL_AI_AUTHORIZED_CDC_IDS`. The default
allowlist is empty. The application and workflow both enforce this boundary
for both modules; C and D remain hard-locked to Gemini in the workflow (any
other provider value for C or D is rejected before any HTTP call is made).

## Contract, grounding and human ownership

### FCI A (Commercial)

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

### FCI B (Finance)

The existing `fci-finance.schema.json` and its provider-independent finance
prompt (`ai/prompts/fci-finance.md`) remain authoritative and unchanged; the
UI's 15 human-visible FCI B fields and all API field names are unchanged.
Input is limited to the validated Fiche and current CDC-derived structured
information already permitted by the existing flow — no historical RAG,
archive, CV, or historical financial database is connected.

`lib/appels-offres/fci/finance-quality.ts` (new, mirrors the shape of
`commercial-quality.ts` without touching it) provides:

- `applyFinanceGenerationGuardrails`: deterministically forces the three
  current/internal financial policy inputs to `null` / `internal_required` /
  `confidence=none` / `requires_human_input=true` regardless of model output —
  `taux_de_change_applique_et_source`, `coefficient_de_charges_de_structure`,
  and `marge_cible_visee`. Unlike A, B's header identification fields
  (`reference_interne_code_dossier`, `intitule_offre`, `date_depot`) are
  platform-injected rather than AI-generated, so they need no guardrail.
- `validateFinanceGrounding`: rejects any `fiche_cdc`-labelled claim whose
  value/excerpt is not literally present in the validated launch evidence
  (same rule as A), plus a finance-specific check: any numeric substring
  (an amount, percentage, or coefficient) inside a value must itself appear
  in the evidence, whichever `source_type` carries it. `ai_inference` is not
  rejected outright for B — the finance prompt explicitly permits it for
  qualitative cash-flow/guarantee risk signals — but a hard number smuggled
  into an `ai_inference` field is treated as a fabricated figure and rejected.
  Every `calculs_financiers[].inputs[]` value that fed a computation must
  also be grounded; the computed `result` itself is not held to a literal
  evidence-match bar since it is expected to be genuinely computed rather
  than quoted.

Both A and B share the identical fail-closed shape: schema validation, then
the module's guardrail, then (for A and B only) grounding validation, before
persistence. C and D are unaffected — C has no guardrail/grounding step
today, and D's existing `strategy-quality.ts` is untouched.

## Failure and lifecycle

Ollama, JSON, schema, grounding, callback, or canonical validation failure uses
the existing explicit failed/retryable job path for both A and B. It never
switches provider. Successful generation remains a proposal in `needs_review`;
validation remains a human RBAC-protected action (Commercial for A, Finance
for B — unchanged by this migration). Neither A nor B contains a GO/NO-GO
decision. Existing D gating still requires human-validated A, B, and C.

## Benchmark evidence

### FCI A

The pre-existing authorized fixture report for `AO-20260824-1322` was reused
offline; no new external call was made. Its FCI A run used `qwen3:14b` and
reported generation PASS, schema PASS, quality/grounding PASS, eight human
blockers, zero unsupported claims, zero internal-claim violations, and no
decision leakage. The benchmark harness and report remain evaluation-only and
do not write official FCI data or processing state.

### FCI B

Unit- and service-level tests (`finance-quality.test.ts`, `provider-policy.test.ts`,
`local-cutover-workflow.test.ts`, and two `service.test.ts` scenarios exercising
a full launch → callback → persist cycle against a synthetic test tender) were
the pre-deployment evidence. A real live generation has since been run and
verified — see "FCI B live evidence" above — using the same authorized
`AO-20260818-1144` fixture already used for A's live verification.

## Deployment and future work

Both FCI A's and FCI B's checked-in workflow changes have been imported,
published, activated, and live verified on `srv-ia` (see "Live deployment
status" above). The `Build FCI Context` node in
`n8n/workflows/fci-module-generation.json` now recognizes `module_code === 'B'`
alongside `'A'` for local routing and its own authorized-external-comparison
gate, while `C`/`D` remain hard-locked to Gemini in the same node — verified
directly from the live n8n execution store, not assumed. FCI C/D migration
and targeted historical RAG remain separate future phases; neither was
started, touched, or scoped by this checkpoint.
