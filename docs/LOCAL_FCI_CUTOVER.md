# Local FCI cutover (A, B and C)

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
IMPLEMENTED = YES
DEPLOYED = YES
LIVE VERIFIED = YES
GEMINI → LOCAL MIGRATION = COMPLETE

FCI D
Gemini (unchanged)
```

Live verification dates: FCI A on 2026-08-26, FCI B on 2026-08-27, FCI C on
2026-08-27, all on `srv-ia`, all using `AO-20260818-1144` — one of the three
explicitly authorized benchmark fixtures, selected because it has an existing
human-validated Fiche, unlike `AO-20260824-1322` which remained in
`fiche_a_valider` at the time and was correctly not used for any module.
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

### FCI C live evidence

- Live workflow: the same `FCI Module Generation - Provider Routed JSON`
  (`kEdTbJ7VBcg54Gkn`) workflow, already updated for A/B, was exported as a
  pre-deployment backup, then imported/published/activated with C's routing
  live, and n8n was restarted to load it.
- Effective policy at test time: identical to A's and B's —
  `CONFIDENTIAL_MODE=true`, `FCI_C_GENERATION_PROVIDER` unset (defaults to
  `local`), `LOCAL_FCI_MODEL` unset (defaults to `qwen3:14b`),
  `EXTERNAL_AI_COMPARISON_ENABLED=false`, `EXTERNAL_AI_AUTHORIZED_CDC_IDS`
  empty. No configuration change was needed.
- Trigger path: authenticated `POST /api/appels-offres/AO-20260818-1144/fci/C/regenerate`
  as `marc.leroy@concept.local`, the Operations user specifically assigned to
  module C on this tender, via the normal login flow (no RBAC bypass).
- Persisted evidence (`fci_generation_jobs` id 2834): `provider=local`,
  `model=qwen3:14b`, `status=completed`, `source_fiche_version` matches the
  validated Fiche timestamp, no error code.
- n8n execution-path evidence (execution 383, deserialized directly from the
  n8n execution store): the same single generation node
  `HTTP Request → Selected FCI Provider` resolved `llm_provider=local`,
  `ai_url=http://127.0.0.1:11434/api/chat`, and no Gemini authorization
  header was attached (`ai_authorization` empty). No separate Gemini node
  exists in the graph, and the executed-node list for this run contains only
  the success path (no Gemini node ran on any of the attempts below either).
- Quality evidence (persisted field metadata, not values): 0 grounding
  violations on the successful run (the run would have failed closed with
  `AI_GROUNDING_VALIDATION_FAILED` otherwise), and every protected
  current-internal-state field — `capacite_absorption_globale.{quantite_disponible,
  membre_du_groupement_qui_lapporte, disponible_au_demarrage}` and
  `repartition_des_composantes_techniques.{membre_responsable,
  experts_affectes}` — persisted as `internal_required` / null /
  `confidence=none` / `requires_human_input=true`, never fabricated. The
  platform-computed `ecart` field was also returned as an `internal_required`
  placeholder by the model, matching the prompt's instruction, and is left
  untouched by the guardrail (it is recomputed for display from
  `quantite_requise`/`quantite_disponible` in `rendering.ts`, independent of
  whatever placeholder value is stored).
- Lifecycle: module C status is `needs_review`, `validated_at` is null — no
  automatic validation occurred.

#### Debugging process (honest account)

Live verification took 9 generation attempts (jobs 2788, 2789, 2790, 2791,
2792, 2793, 2794, 2795, 2834; n8n executions 375–383) against the same
authorized fixture, all fail-closed, none ever falling back to Gemini and
none ever corrupting or partially persisting module C's prior state. Four
distinct, genuine defects were found and fixed along the way — each
confirmed by inspecting the exact AJV error and the raw AI JSON via n8n's
execution store before touching anything:

1. `repartition_des_composantes_techniques[]` used the wrong column names
   entirely (attempt 1). Fixed by rewriting the "Module-Specific Field
   Instructions" section of `ai/prompts/fci-operations.md` to bind each
   template section to its own explicit column list instead of one flat,
   undifferentiated list.
2. A stale in-process prompt cache (`runtimeContractCache` in
   `ai-runtime.ts`, populated once per module code per `concept-web`
   process lifetime) meant attempt 1's prompt fix did not take effect until
   `concept-web` was restarted — required after every subsequent prompt
   edit in this session too.
3. A false lead: attempts 1–4 were mis-diagnosed mid-session as an extra,
   disallowed `ecart` key on `capacite_absorption_globale[]`. Re-reading
   `fci-operations.schema.json` directly showed `ecart` is in fact a
   **required** key (the TypeScript contract in `ai-contracts.ts` already
   agreed - this project's earlier assumption to the contrary was wrong).
   The prompt was corrected to require `ecart` as an `internal_required`
   placeholder like its four sibling columns, undoing the incorrect
   "never produce ecart" instruction from attempts 2–3.
4. An intermittent single-letter casing slip: qwen3:14b occasionally
   rendered the `source_references` key as `source_References` on exactly
   one of the six near-identical sibling fields in
   `risques_coordination_mitigation` (observed on 3 of 9 attempts, migrating
   to a different sibling field each time). Prompt-only reminders reduced
   but did not eliminate it, since Ollama runs this route at `temperature:
   0` and a prompt-unchanged retry reproduces the identical output. Fixed
   at the code level instead: `validateFciAiPayload` in
   `lib/appels-offres/fci/ai-validation.ts` now case-normalizes the six
   fixed structural wrapper keys (`value`, `source_type`, `confidence`,
   `requires_human_input`, `justification`, `source_references`) on every
   object in the payload before AJV validation. This is content-neutral —
   it never touches business values, never relaxes `additionalProperties`
   or `required`, and does nothing when a key is genuinely missing (a
   dedicated test in the new `ai-validation.test.ts` asserts a truly
   missing `source_references` is still rejected). Covered by three new
   tests in `lib/appels-offres/fci/ai-validation.test.ts`.

Two smaller, already-diagnosed regressions along the way (a
`repartition_des_composantes_techniques[]` shape regression on attempt 5,
and a `composante`/`description` key-invention variant on attempt 6) were
both resolved by adding the same concrete "Forme valide"/"Interdit" JSON
example pattern already used successfully elsewhere in this prompt, rather
than relying on prose alone — this pattern proved reliable every time it
was tried and is now used for all four array/object sections of the
Operations prompt.

### Cross-module confirmation (all three live runs)

- FCI A and B were not touched by the C run (their most recent generation
  timestamps, 2026-08-26 for A and 2026-08-27 09:40 for B, both predate this
  C session's first attempt at 2026-08-27 10:56 by over an hour). FCI D
  remains `not_started`. With A, B, and C all at `needs_review` (none
  `validated`), `assertFciDPrerequisitesValidated` in `service.ts` still
  throws `FCI_D_PREREQUISITES_NOT_VALIDATED` (409) for any D
  generate/regenerate attempt — the gate was not exercised but is confirmed
  still armed.
- No decision-leakage terms (`go_no_go`, `decision_finale`,
  `validation_finale`, `recommandation`) appear anywhere in the persisted B
  or C payloads.
- Historical Knowledge Base: unchanged across all three runs (`knowledge_base`
  row count and max `updated_at` unchanged from before this task;
  `knowledge_vectors` remains empty). No consultant/CV data or the 80 GB
  archive was accessed. `LOCAL_RAG_SHADOW_ENABLED` remains `false`.

## Scope and provider state

FCI A, FCI B, and FCI C are migrated and live-verified (see above).

| Module | Checked-in provider | Model | Live state |
|---|---|---|---|
| A | local Ollama | `qwen3:14b` | Live, verified |
| B | local Ollama | `qwen3:14b` | Live, verified |
| C | local Ollama | `qwen3:14b` | Live, verified |
| D | Gemini (unchanged) | existing `FCI_GENERATION_MODEL` | Live, unchanged |

The application resolves A to `FCI_A_GENERATION_PROVIDER=local`, B to
`FCI_B_GENERATION_PROVIDER=local`, and C to `FCI_C_GENERATION_PROVIDER=local`,
all three by default, sharing the same `LOCAL_FCI_MODEL=qwen3:14b`. The three
modules are resolved independently of each other (an operator can flip one
without affecting the others) through the same `resolveFciProvider` policy
function — no second, parallel provider system was created for Operations.
The workflow sends local requests only to the loopback Ollama `/api/chat`
endpoint for any of the three. There is no local-to-Gemini fallback for A, B,
or C.

An exceptional Gemini comparison for A, B, or C requires all of:
`CONFIDENTIAL_MODE=false`, the matching `FCI_A_GENERATION_PROVIDER`,
`FCI_B_GENERATION_PROVIDER`, or `FCI_C_GENERATION_PROVIDER` set to `gemini`,
`EXTERNAL_AI_COMPARISON_ENABLED=true`, and the exact CDC code in
`EXTERNAL_AI_AUTHORIZED_CDC_IDS`. The default allowlist is empty. The
application and workflow both enforce this boundary for all three modules; D
remains hard-locked to Gemini in the workflow (any other provider value for D
is rejected before any HTTP call is made).

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

### FCI C (Operations)

The existing `fci-operations.schema.json` and its provider-independent
Operations prompt (`ai/prompts/fci-operations.md`) remain authoritative and
unchanged. The UI defines 45 human-visible fields across ten sections — the
shared header (5), and nine Operations-specific sections — confirmed exactly
by counting `rendering.ts`'s module-C field definitions. Input is limited to
the validated Fiche and current CDC-derived structured information already
permitted by the existing flow — no historical RAG, archive, CV, or
historical-project database is connected.

**Important finding, not a code change**: 4 of those 10 sections —
`rex_projet_reference`, `rex_ecarts_couts`, `rex_standards_client`,
`rex_recommandations` (12 of the 45 fields) — exist only in the UI rendering
definition and the manual-edit path. They are absent from the raw AI schema
(`FciOperationsData`/`fci-operations.schema.json`) and from
`mapAiPayloadToFciModulePayload`'s AI→UI mapping. Concretely: **neither
Gemini today nor local qwen3:14b tomorrow is ever asked to produce this
data** — a human fills it in directly through the edit UI, entirely outside
AI generation. This is exactly the field group a future targeted-RAG pass
over historical projects would populate with real evidence; until that
exists, the current, already-safe behavior (structurally impossible for the
AI to invent, because the schema boundary excludes it) is preserved
unchanged. No schema or rendering change was made to keep this true.

`lib/appels-offres/fci/operations-quality.ts` (new, self-contained like
`finance-quality.ts`) provides:

- `applyOperationsGenerationGuardrails`: deterministically forces five
  current-internal-state columns to `null` / `internal_required` /
  `confidence=none` / `requires_human_input=true` regardless of model
  output — `capacite_absorption_globale[].quantite_disponible`,
  `.membre_du_groupement_qui_lapporte`, `.disponible_au_demarrage`, and
  `repartition_des_composantes_techniques[].membre_responsable`,
  `.experts_affectes`. These are exactly the columns
  `mapAiPayloadToFciModulePayload` already renders as `sourceLabel: "human"`
  independently of provider; this guardrail makes that the same guarantee at
  the persistence layer. Deliberately **not** forced:
  `probabilite_disponibilite_experts` and free-text fields like
  `action_requise`/`commentaire_ou_risque` — the Operations prompt explicitly
  permits a cautious probability/risk *signal* there; grounding validation
  below still catches a fabricated number or an outright assertion hiding
  inside one.
- `validateOperationsGrounding`: the same `fiche_cdc`-excerpt and
  ungrounded-number checks as A/B, plus two Operations-specific checks
  applied to non-null `ai_inference` values: an **availability-claim**
  pattern (e.g. "est disponible", "confirmée disponible", "accord ferme") and
  a **historical-claim** pattern (e.g. "a déjà réalisé", "par le passé",
  "expérience antérieure"). A match that is not itself literally present in
  the validated evidence is rejected — this is the concrete mechanism
  preventing qwen3:14b from simulating the future Knowledge Base described
  above.

All three of A, B, and C share the identical fail-closed shape: schema
validation, then the module's guardrail, then grounding validation, before
persistence. D is unaffected — its existing `strategy-quality.ts` is
untouched.

## Failure and lifecycle

Ollama, JSON, schema, grounding, callback, or canonical validation failure uses
the existing explicit failed/retryable job path for A, B, and C. It never
switches provider. Successful generation remains a proposal in `needs_review`;
validation remains a human RBAC-protected action (Commercial for A, Finance
for B, Operations for C — unchanged by this migration). None of A, B, or C
contains a GO/NO-GO decision. Existing D gating still requires human-validated
A, B, and C — a generated-but-unvalidated C does not satisfy it.

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

### FCI C

Unit- and service-level tests (`operations-quality.test.ts`,
`provider-policy.test.ts`, `local-cutover-workflow.test.ts`, two
`service.test.ts` scenarios) were the pre-deployment evidence. A real live
generation has since been run and verified — see "FCI C live evidence"
above — using the same authorized `AO-20260818-1144` fixture already used
for A's and B's live verification. `ai-validation.test.ts` (new) covers the
key-casing normalization fix found during that live verification.

## Deployment and future work

FCI A's, FCI B's, and FCI C's checked-in workflow changes have all been
imported, published, activated, and live verified on `srv-ia` (see "Live
deployment status" above). The `Build FCI Context` node in
`n8n/workflows/fci-module-generation.json` now recognizes
`module_code === 'A'`/`'B'`/`'C'` for local routing and each module's own
authorized-external-comparison gate; `D` alone remains hard-locked to
Gemini.

FCI D migration and targeted historical RAG remain separate future phases;
neither was started, touched, or scoped by this checkpoint. When targeted
RAG is eventually built, the `rex_projet_reference`/`rex_ecarts_couts`/
`rex_standards_client`/`rex_recommandations` UI sections documented above are
the natural first integration point — they already exist in the UI, are
already excluded from the AI contract, and are exactly where retrieved
historical-project evidence would need to enter the schema for the first
time.
