# FCI C targeted RAG pilot — `rex_projet_reference`

Date: 2026-08-27
Scope: architecture confirmation + minimal local-only pilot implementation +
tests. No live service was modified or restarted. No historical company
data was ingested, scanned in bulk, or sent anywhere. Nothing in FCI C's
generation path, schema, RBAC, or lifecycle was changed.

```text
PILOT IMPLEMENTATION       = YES
SYNTHETIC-FIXTURE TESTING  = YES  (20 tests, zero network/DB calls)
REAL HISTORICAL CORPUS     = NO   (0 records anywhere in this system)
REAL RAG VERIFICATION      = NO   (nothing to verify against yet)
LIVE DEPLOYMENT            = NO   (no endpoint/UI, no Qdrant collection, no schema change)
```

This is a pilot of the retrieval *contract*, proven against synthetic
fixtures only. It must not be described as "production historical RAG" or
"RAG verified against CONCEPT history" until a real, approved historical
corpus exists and has been evaluated (see §14, §17 and the planned next
step: a small controlled 5–20-record local ingestion batch).

## 1. Business purpose

FCI C's `rex_projet_reference` section asks Operations to identify a
comparable CONCEPT project/offer and explain its similarity and
differences to the current tender. The current validated Fiche cannot
supply this — it describes the current tender, not CONCEPT's own project
history. Today this section is filled entirely by hand. The pilot's goal
is narrow: retrieve a small number of candidate historical projects that
look similar to the current tender, show *why* (with provenance), and let
Operations decide whether to use, edit, or ignore each suggestion. The
pilot never writes a value into FCI C on its own.

## 2. Why FCI C / project references were selected

`docs/FCI_TARGETED_RAG_ANALYSIS.md` (2026-08-26, read as planning context,
not re-derived here) ranked "FCI C — comparable reference project" as the
#1 targeted-RAG opportunity across all 95 human-visible FCI fields: it has
concrete, bounded evidence requirements, does not touch current-resource
availability, current pricing, or any decision, and directly fills a
genuine three-field evidence gap (`identite`, `niveau_similitude`,
`differences_cles`). No repository change since that audit invalidates its
analysis; this pilot builds on it rather than repeating the 95-field audit.

## 3. Current REX field boundary (confirmed, unchanged)

Verified directly in the current repository (not assumed from the prior
audit):

- `rex_projet_reference`, `rex_ecarts_couts`, `rex_standards_client`,
  `rex_recommandations` exist **only** in `rendering.ts`'s departmental UI
  field definitions (module C, manual-edit path).
- None of these four sections appear in `FciOperationsData`
  (`ai-contracts.ts`), `ai/schemas/fci-operations.schema.json`, or
  `ai/prompts/fci-operations.md`. Confirmed by a dedicated test
  (`rex-project-rag.test.ts`, "rex_projet_reference remains outside the raw
  FCI C AI contract after this pilot") that reads these three files
  directly and asserts the string is absent from all of them.
- This pilot does **not** add `rex_projet_reference` to the AI schema, the
  Qwen prompt, or `FciOperationsData`. It creates a wholly separate
  suggestion/evidence path (`lib/appels-offres/fci/rex-project-rag.ts`)
  that never touches FCI C generation, guardrails, grounding, schema
  validation, or persistence.

## 4. Local-only architecture

```text
Current VALIDATED Fiche (readSourceFicheSnapshot)
        |
buildRexProjectQuery()  -- pure, reads real extraction fields only
        |
embedTextLocally()  -- Ollama /api/embed, qwen3-embedding:0.6b, loopback only
        |
queryHistoricalProjectsInQdrant()  -- Qdrant REST query, loopback only
        |
rankHistoricalProjectCandidates()  -- pure cosine similarity, threshold-gated
        |
buildSuggestion() x N  -- provenance + deterministic differences, never LLM invention
        |
suggestRexProjectReferences()  -- orchestrates the above, returns a plain result
        |
(human-facing UI/API — NOT built in this pilot)
```

No step in this chain calls Gemini, Claude, OpenAI, or any external
embedding/vector-DB API. `embedTextLocally` and
`queryHistoricalProjectsInQdrant` both hardcode `http://127.0.0.1:...`
endpoints (not configurable via environment variable), and a dedicated
test asserts the module's own source contains no external provider
hostname. This mirrors the existing loopback-enforcement pattern already
used by `lib/appels-offres/fci/local-benchmark.ts`'s `requestLocalFci`.

## 5. Current knowledge sources (read-only audit performed this session)

| Component | State found | Reused as-is? |
| --- | --- | --- |
| Historical KB service (`services/knowledge-base/`, port 8092) | Running, healthy, but **hardcoded to CDC documents only** (schema, prompt, payload tagging, `document_type: "historical_cdc"` are all CDC-specific) | Not reused directly — see §6 |
| `knowledge_base.*` PostgreSQL tables | Running, **0 rows** in all three tables (`knowledge_documents`, `knowledge_document_versions`, `knowledge_ingestion_runs`) | Documented as the future catalog to extend, not modified |
| Qdrant `concept_historical_cdc` collection | Running, **0 points** | Not reused (CDC-scoped); a parallel collection is proposed, not created |
| Other 19 Qdrant collections | All benchmark/scratch artifacts from `scripts/rag/*.py` experiments, unrelated to a project-reference corpus | Not touched |
| n8n KB ingestion workflows (single/batch CDC) | Both `active: false`, CDC-only | Not touched, not activated |
| Any "historical project / past offer / closeout" table | **Does not exist anywhere in the schema or codebase** | N/A — genuinely new domain |

No historical project data exists anywhere in this system today. This is
not a gap this pilot could close without real ingestion, which is
explicitly out of scope (see §14).

## 6. Why a new module instead of extending the KB service in this task

The existing historical-KB service is the closest existing local
architecture, but it is not a generic "document" service — its Postgres
schema, Qdrant payload shape, extraction prompt, and PDF discovery are all
CDC-specific, and it exposes **no query/search HTTP endpoint at all**
(only `/ingest` and `/health`; retrieval is a Python CLI diagnostic
script). Genuinely reusing it for project-reference retrieval would
require adding a `document_type` discriminator to the schema, a new
Qdrant collection, and a new query endpoint to that Python service —
real production work, not something to do inside a discovery-scoped pilot
with zero real data. Building a **second, parallel Python service** was
explicitly out of scope too ("do not create another independent RAG
microservice"). The smallest correct choice was a new TypeScript module
inside `lib/appels-offres/fci/` (the same directory as every other FCI C
module) that talks to the same local Ollama and Qdrant infrastructure
directly, with a collection name (`concept_historical_projects`) chosen to
sit *parallel* to `concept_historical_cdc` rather than reusing it. No
second embedding model, no second local LLM, no second vector database
technology was introduced — only a second Qdrant *collection* name and a
second retrieval contract, both documented here as **not yet created**.

## 7. Retrieval unit

One **historical project/offer record** (`HistoricalProjectCandidate`),
never a bare text chunk with no project identity — per the pilot brief,
`rex_projet_reference` needs a citable project, not an arbitrary passage.
Each candidate carries one embedding (representing the project as a
whole, e.g. from a summary/reference-sheet chunk) plus project-level
metadata (title, country, client, funding institution, sector, project
type, year) and a pointer back to its source document/version.

## 8. Query construction (evidence-based, not guessed)

`buildRexProjectQuery(fiche: FichePayload)` reads exactly these real
extraction keys from `lib/types.ts`'s `EXTRACTION_FIELD_DEFINITIONS`
(the same canonical list used for closest-CDC/FCI generation elsewhere in
the app): `secteur`, `nature_prestation`, `pays`, `zone_execution`,
`disciplines_techniques`, `livrables_principaux`, `profils_cles`,
`duree_totale`, `volume_hommes_mois`, `type_contrat`,
`source_financement`, `points_techniques_structurants`. These were chosen
because they carry sector, scope, discipline, geography, scale, and
contract-type signal — exactly the matching dimensions
`FCI_TARGETED_RAG_ANALYSIS.md` recommends for reference-project retrieval.
Fields absent from the current Fiche are omitted, never defaulted or
guessed. The function only ever reads from the current **validated**
Fiche snapshot (the same `readSourceFicheSnapshot` used everywhere else in
FCI); it never reads raw/unvalidated FCI C draft data or historical KB
content.

## 9. Provenance model (mandatory, not optional)

Every `RexProjectSuggestion` carries a non-empty `sources[]` array with,
per source: `sourceDocumentId`, `sourceDocumentVersionId`,
`sourceReference` (safe path/label, not raw filesystem content),
`sourceSection`, `retrievalScore` (the cosine similarity, never presented
as a factual-confidence percentage), and `retrievedAt` (ISO timestamp).
`queryHistoricalProjectsInQdrant` reads `sourceReference` only from a
future payload's `source_reference` field and deliberately has no fallback
to a raw `source_path` — a future ingestion pipeline must always populate
the safe label; a missing one surfaces as an empty string, never as a
filesystem path. There is no code path that produces a suggestion without provenance —
`buildSuggestion` always populates `sources` from the retrieved
candidate's own identity fields.

## 10. Human review boundary

`RexProjectSuggestion.reviewStatus` is a literal type with a single value:
`"suggested"`. No function anywhere in this module (or in FCI C's
generation/persistence code) ever produces `"accepted"`, `"edited"`, or
`"rejected"` — those states, and the UI/API action that would set them,
are explicitly **not built in this pilot** (see §14). This keeps the
distinction between "RAG proposed" and "human accepted" structurally
simple for now: nothing in the current codebase can accidentally treat a
suggestion as validated business data, because no acceptance code path
exists yet to do so.

## 11. No-autofill rule

`suggestRexProjectReferences` returns a plain result object
(`{status, query, suggestions}`) to its caller. It does not import, call,
or reference `applyFciSuccessCallback`, `upsertFciModuleData`,
`saveFciModuleEdits`, or `validateFciModule` — confirmed by a dedicated
test that greps the module's own source for these names. There is no code
path, accidental or intentional, by which running this module could
change a real FCI C record.

## 12. Zero-result and low-confidence behavior

- **Zero result**: if retrieval returns no candidates, or every candidate
  falls below `REX_PROJECT_MIN_SIMILARITY` (0.55), the result status is
  `"no_evidence"` with an empty `suggestions` array. The threshold is a
  fixed constant; nothing in this pilot lowers it to force a match.
- **Empty query**: if the current Fiche has none of the query fields
  populated, the function short-circuits to `"no_evidence"` **before**
  calling the embedding or retrieval functions at all (tested explicitly).
- **Low confidence**: a surviving candidate with similarity between 0.55
  and 0.75 is labelled `confidence: "medium"` and the overall result
  status is `"low_confidence"`, not `"ok"` — only a `>= 0.75` top match
  reaches `"ok"`. This is a deliberately conservative reading of "insufficient
  similarity" (Step 18 of the pilot brief): a merely-plausible match is
  never presented with the same confidence as a strong one.

## 13. Resource-availability guard

`sanitizeMetadataForDifferences` strips any candidate metadata key
matching a staffing/availability/consultant pattern
(`disponib|availability|staffing|assignment|assigne|consultant|expert_dispo|cv_|current_resource`,
case-insensitive) before it can appear in `matchedFeatures` or
`differences`. A dedicated test injects a malformed candidate carrying a
`disponibilite_experts` key directly into its metadata (bypassing the type
system, simulating a corrupted upstream record) and asserts the resulting
suggestion's entire serialized JSON never contains that content. Historical
project evidence proves what was true *then*; it can never be read as a
statement about current staff/equipment availability, which remains
exclusively `operations-quality.ts`'s guardrail's responsibility for real
FCI C generation — untouched by this pilot.

## 14. Current limitations / what is still needed before real historical rollout

1. **No historical project data exists anywhere in the system.** The
   Postgres knowledge tables and every Qdrant collection relevant to this
   domain are empty. This pilot was built and tested entirely against
   synthetic in-memory fixtures (`rex-project-rag.test.ts`), exactly as
   directed when the KB is not populated.
2. **No `concept_historical_projects` Qdrant collection exists.** It is
   named and documented (§4, §6) as the intended target, but creating it
   is itself a live-infrastructure action and was not performed in this
   task.
3. **No ingestion pipeline exists** for project/offer PDFs analogous to
   the CDC one. The minimum real ingestion format needed: one record per
   approved historical project/offer with, at minimum, a source
   document/version, `sector`, `country`, `project_type`,
   `funding_institution`, a short reference-sheet or summary text (used to
   compute the project-level embedding), and an approval/validation status
   confirming it is cleared for reuse as evidence.
4. **No human-facing UI or API route exists yet.** This pilot delivers the
   retrieval/ranking/provenance *contract* only, ready to be called from a
   future `GET`-style suggestion endpoint feeding the FCI C UI. Building
   that endpoint, and the accept/edit/reject persistence it would need, is
   future work, not part of this task.
5. **`differences_cles` is deterministic, not LLM-generated**, in this
   first pilot: it compares query fields against candidate metadata field
   by field (country, sector, funding institution). This was a deliberate
   simplification for v1 — it has nothing to hallucinate and needs no
   separate grounding check. A future iteration could layer a local
   qwen3:14b summarization on top, but only with mandatory citations back
   to the same retrieved chunks (Step 19 of the pilot brief), which is not
   built here.

## 15. Relationship to future Knowledge Base work

This pilot deliberately does not generalize the existing historical-CDC KB
service into a multi-domain document service. `FCI_TARGETED_RAG_ANALYSIS.md`
already scoped that as later phases (commercial memory, CV/expert
retrieval, finance history), each needing its own ACL/PII/authorization
design before implementation. This pilot's `concept_historical_projects`
collection name and its Postgres extension point (a `document_type`
discriminator column, or a parallel table under the same schema) are
proposed as the first concrete step in that direction, not implemented
now.

## 16. Distinction from the deterministic closest-CDC search

An exhaustive search of this repository (`lib/`, `scripts/`) for any
"closest CDC" / 21-feature deterministic proximity algorithm found: **not
implemented in current codebase.** This is a statement about what exists
in the repository today, not a claim about whether such a business
requirement exists or matters — it may well be planned or documented
elsewhere outside this codebase. There is nothing in this repository that
this pilot could have touched, weakened, or replaced, precisely because
there is nothing here to touch. The two problems remain conceptually
distinct regardless: a future closest-CDC algorithm (deterministic,
coverage/count/proximity/recency-based, matching *current or past CDCs*)
would answer "which historical tender most resembles this one," while this
pilot answers a different question — "which CONCEPT-delivered *project*
provides citable return-of-experience evidence for FCI C" — using semantic
similarity over project records, not CDC proximity. Neither should ever
be implemented by replacing the other.

## 17. Test status

All 20 tests in `lib/appels-offres/fci/rex-project-rag.test.ts` pass, no
network calls, no database, no live service dependency:

- local-only / no external provider (3 tests)
- query construction from real extraction fields (3 tests)
- ranking (2 tests)
- end-to-end suggestion assembly (1 test)
- zero-result / low-confidence (4 tests)
- provenance (1 test)
- no-autofill / human boundary (2 tests)
- resource-availability safety (1 test)
- REX schema/prompt boundary (1 test)

Full existing FCI regression suites (A/B/C/D provider routing, guardrails,
grounding, lifecycle, RBAC, readiness) were re-run unmodified in the same
session and continue to pass — see the accompanying task report for exact
counts.
