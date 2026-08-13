# Qwen3:14B generation optimization benchmark

Evaluation date: 2026-08-11. Tender: `AO-20260810-0958`. This experiment keeps `qwen3-embedding:0.6b`, Qdrant, BM25, RRF, reranking, chunking, ground truth, and Qwen3:14b unchanged. It changes only evidence selection, prompt structure, grounding validation, and bounded correction behavior.

## A. Three original generation failures

| Field/question | Expected | Correct evidence and rank | Other context previously supplied | Previous output |
|---|---|---|---|---|
| Client: “Quel est le nom du Client ?” | UC-PARU | `chunk_182` rank 1; `chunk_52` rank 2; `chunk_51` rank 8 | Six chunks dominated by contract definitions, consultant clauses, and generic Client language | `null` |
| Issue date: “À quelle date la DP a-t-elle été émise ?” | 06/08/2024 | `front_matter_0` rank 1 | Seven chunks about validity/deadline/opening dates, including blank template dates | `null` |
| Mission duration: “Quel est le délai de réalisation de la mission ?” | 90 calendar days, i.e. 3 months | `chunk_126` rank 1 | Personnel effort, report deadlines, award deadlines, and other duration vocabulary | `90 jours calendaire` |

## B. Root cause of each

- Client: **A context dilution + B conflicting evidence + C prompt interpretation.** The correct organization was available, but repeated generic definitions made the conservative model decline.
- Issue date: **B conflicting evidence + C prompt interpretation.** A populated issue date competed with unrelated and blank date templates.
- Mission duration: **D incomplete extraction.** Qwen selected the correct sentence but omitted its explicitly equivalent three-month duration.

No failure was caused by normalization, missing retrieval evidence, or tender isolation.

## C. Context-selection changes

The experiment tested already-reranked evidence at top‑1, top‑2, top‑3, and top‑5. It no longer sends all top‑8 chunks automatically.

| Selected evidence count | Correct fields | Corrections attempted | First-pass generation time |
|---:|---:|---:|---:|
| 1 | 7/8 | 1 | 3.067 s |
| 2 | **8/8** | 0 | 3.567 s |
| 3 | **8/8** | 0 | 3.854 s |
| 5 | 7/8 | 0 | 4.060 s |

Top‑2 is selected because it is the smallest context achieving the best score. Each selected chunk is reduced to the strongest complete field-bearing unit plus an adjacent unit on either side. Answer-bearing sentences are preserved intact.

The selector uses only generic signals: labeled dates, client/authority terms, concise credit/loan identifiers, selection-method terms, mission duration phrasing, and financing-project language. It does not contain tender answers.

## D. Prompt changes

Individual prompts now use an evidence-first strict JSON contract:

```json
{
  "value": "...",
  "supported": true,
  "source_chunks": ["chunk_X"]
}
```

The prompt explicitly requires evidence-only extraction, populated values over labels, exact identifiers/dates/numbers, complete equivalent durations, placeholder rejection, `null` on insufficient/conflicting evidence, and no prose or reasoning outside JSON.

## E. Field-specific extraction changes

Each of the eight generic field categories has a focused instruction. Important distinctions include:

- client organization versus definitions of “Client”;
- issue date versus proposal deadlines;
- credit identifier versus financing prose;
- mission delivery duration versus personnel effort or report deadlines;
- financed project/programme versus funding institution, credit, service title, or works description.

These instructions contain no expected value from this tender.

## F. Validation rules added

The deterministic validator checks:

- exact three-key individual JSON schema;
- non-null values require `supported=true` and at least one supplied source;
- every cited ID belongs to selected evidence;
- the normalized claimed value appears in cited evidence;
- template/placeholder markers are rejected;
- official references have a populated multi-part identifier shape;
- issue dates have a complete date shape;
- credit identifiers contain a number;
- mission-duration output contains every explicit day/month equivalence in the cited duration sentence.

Validation checks grounding, not benchmark ground truth. Ground truth is used only for final evaluation.

## G. Correction/retry behavior

At most one correction is allowed after validation failure. The correction receives the original field, selected evidence, invalid answer, and deterministic reason. All first and corrected outputs and timings are recorded.

The selected top‑2 run required **zero corrections**. The top‑1 experiment exercised one bounded correction path. The combined structured run also passed on its first attempt, so no structured retry was issued.

## H. Previous versus optimized results

| Metric | Previous hybrid+rerank | Optimized |
|---|---:|---:|
| Evidence recall | 8/8 | 8/8 |
| Individual factual extraction | 5/8 | **8/8** |
| Grounded citations | 5/8 | **8/8** |
| Structured extraction | 7/8 | **8/8** |
| Strict structured JSON | Valid | Valid |
| Anti-hallucination | 3/3 | 3/3 |
| Tender isolation | Pass | Pass |

### Optimized question results

| Field | Final answer | Supporting source | Result |
|---|---|---|---|
| Official reference | CI-PARU-365151-CS-QCBS/003/2024 | `chunk_6`, `front_matter_0` | Success |
| Client | Unité de Coordination du Projet d'Assainissement et de Résilience Urbaine (UC-PARU) | `chunk_52` | Success |
| Country | Côte d'Ivoire | `chunk_6`, `chunk_182` | Success |
| Issue date | 06/08/2024 | `front_matter_0` | Success |
| Credit | 66860 | `chunk_7` | Success; semantically exact identifier |
| Selection method | Sélection Fondée sur la Qualité et le Coût (SFQC) | `chunk_130` | Success |
| Mission duration | 90 jours calendaire, soit 03 mois | `chunk_126` | Success; complete equivalence preserved |
| Financed project | Projet d'Assainissement et de Résilience Urbaine (PARU) | `chunk_7` | Success |

## I. Structured extraction result

- Correct: **8/8**.
- Grounding-valid: **8/8**.
- Required keys: complete.
- JSON: valid.
- Unsupported additional values: 0.
- Null behavior: no supported field was returned null.
- Correction required: no.
- Generation time: 2.912 s.

## J. Citation accuracy

Individual citation accuracy is **8/8**. Every accepted value cites only supplied chunks, and the deterministic validator confirmed that each normalized value is present in its cited evidence. Structured citation grounding is also 8/8.

## K. Anti-hallucination result

**3/3 passed, zero hallucinations.** The exact budget, proposed consultant project lead, and exact works start date all returned:

```json
{"value": null, "supported": false, "source_chunks": []}
```

## L. Tender-isolation result

Passed with mismatched `AO-20260810-0958-MISMATCH`:

- dense retrieval: 0 chunks;
- lexical retrieval: 0 chunks;
- unfiltered fallback: none.

## M. Performance

| Operation | Final measurement |
|---|---:|
| Embed 207 chunks | 6.335 s |
| Index/upsert | 0.104 s |
| Mean hybrid retrieval | 0.092 s/query |
| Evidence selection | 0.794 ms/query average; 6.350 ms total |
| Deterministic validation | 0.057 ms/query average; 0.459 ms total |
| Top‑2 individual generation | 0.446 s/query average; 3.567 s total |
| Correction retry | 0 s in selected run |
| Selection + generation + validation | 3.573 s for all eight fields |
| Combined structured generation | 2.912 s |
| Three anti-hallucination generations | about 1.005 s total |

Compared with the prior top‑8 hybrid+rerank generation total of 10.337 s, top‑2 field-selected generation took 3.567 s while improving accuracy from 5/8 to 8/8.

## N. Remaining failures

There are no factual, citation, schema, hallucination, or isolation failures in this frozen eight-question run. The main remaining risk is generalization: this is one real tender, and the selector/validator must be tested against additional CDC layouts, languages, malformed tables, conflicting populated values, and genuinely absent fields.

## O. Readiness classification

**READY FOR CONTROLLED W2 LOCAL-AI INTEGRATION**

All requested thresholds were met in the final audited run:

- retrieval evidence 8/8;
- individual extraction 8/8;
- structured extraction 8/8;
- valid JSON 100%;
- unsupported claims 0;
- anti-hallucination 3/3;
- isolation pass.

This is readiness for a controlled integration experiment, not authorization for production replacement or removal of Gemini.

## P. Exact recommendation for W2 integration

Do not integrate during this task. The next controlled implementation should:

1. Put the optimized extraction behind a local RAG service boundary called only by a new W2 feature flag.
2. Preserve current CONCEPT validation, signed callback contract, RBAC, timeouts, and existing fallback behavior unchanged.
3. Run in shadow mode first: execute local AI, persist only evaluation telemetry, and compare against the existing path without affecting business results.
4. Enforce mandatory tender filters and reject any response failing schema, grounding, source, placeholder, or field validators.
5. Allow exactly one bounded correction, then fail closed or use the existing approved fallback.
6. Add multi-tender regression fixtures and require the same thresholds across representative document layouts before any canary rollout.
7. Canary only after explicit approval, with latency, validation failures, retries, hallucination tests, and callback outcomes monitored separately.

## Q. Files created/changed

- `scripts/rag/benchmark_qwen3_14b_generation.py` — isolated context/prompt/validation/correction benchmark.
- `docs/QWEN3_14B_GENERATION_OPTIMIZATION_RESULTS.json` — complete raw experiments for top‑1/2/3/5, validation, retries, structured extraction, anti-hallucination, isolation, and timings.
- `docs/QWEN3_14B_GENERATION_OPTIMIZATION_RESULTS.md` — this report.

No production behavior, n8n workflow, W1/W2 code, database schema, callback, business data, embedding model, Qdrant architecture, or workflow-mode setting was changed. No model was downloaded. No commit or push was performed.
