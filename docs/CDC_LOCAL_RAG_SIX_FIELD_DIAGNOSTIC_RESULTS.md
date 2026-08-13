# CDC local RAG — six-field diagnostic results

Date: 2026-08-12. Experimental shadow path only. Gemini remains authoritative/default. No n8n, provider, parser, callback, database or canonical XML configuration was changed.

## A. Baseline

The preserved pre-change run on `AO-20260810-0958` emitted 34 canonical tags, populated 30 in that run, and took 62.88 s. The documented reference baseline was 29/34 at about 49 s. Current-run differences were generation variability, not contract changes.

Target baseline:

| Field | Baseline output | Baseline diagnosis |
|---|---|---|
| `type_procedure` | `Non trouvé` | official procedure heading existed, but shortlist tables occupied Top-2; correction remained null |
| `type_proposition` | `Non trouvé` | populated IC 15.2 row existed below template alternatives |
| `note_technique_minimale` | `Non trouvé` | exact 75-point heading existed below pre-selection maximum-score tables |
| `disciplines_techniques` | personnel job-title list | correct personnel tables ranked 1/2; generation copied roles instead of specialties |
| `contraintes_site` | ravinement/erosion constraint | correct in this baseline run, but historically unstable against pure locations |
| `exigences_es` | expert diploma/experience criteria | qualification scoring table ranked above project/contract E&S obligations |

## B. Six-field diagnostic

The focused diagnostic is `scripts/rag/diagnose_six_cdc_fields.py`. It reuses the production-like experimental node builder, embedding model, Qdrant store, BM25, RRF, reranker, Top-2/Top-1 evidence selection, Qwen extraction and canonical validator. It logs short previews only.

| Field | Failure layer | Correct evidence? | Old final rank | New final rank | Old output | New output | Classification |
|---|---|---:|---:|---:|---|---|---|
| `type_procedure` | routing/rerank + generation | yes | >2 | 1 | missing | `Demande de Propositions (DP) / Services de Consultants` | correct |
| `type_proposition` | rerank | yes | >2 | 1 | missing | `PTC` | correct |
| `note_technique_minimale` | rerank | yes | >2 | 1 | missing | `75 points` | correct |
| `disciplines_techniques` | Qwen semantic interpretation + validation | yes | 1/2 | 1/2 | job titles / sometimes missing | `génie civil, Hydraulicien, Routier, Paysagiste, gestion des déchets solides ménagers et assimilés, Topographe, Géotechnicien, Environnementaliste, Développement Social` | correct evidence-backed derivation |
| `contraintes_site` | semantic rerank/generation instability | yes | 2 | 1 | historically locations; baseline happened to be correct | ravinement/erosion and Bocabo urban-service constraints | correct, concise Top-1 evidence |
| `exigences_es` | routing/rerank then Qwen refusal | yes | >2 | 1 | expert qualifications | exact CES/EAS/HS contractual sentence | correct; deterministic exact-copy fallback after bounded correction |

Layer findings:

- Candidate generation contained correct evidence for all six fields.
- Tender-filtered dense and BM25 retrieval could find it, but generic template tables often ranked higher.
- RRF itself was not defective; field semantics needed stronger post-fusion discrimination.
- Evidence compaction preserved the required statements once the correct chunks ranked first.
- Qwen required semantic guards for disciplines and constraints.
- `exigences_es` still returned null twice at `temperature=0`; the stable result therefore uses an exact-sentence deterministic fallback after the one correction attempt, followed by the unchanged grounding validator.

## C. Changes made

1. Expanded only the six field rules, positive anchors and exclusions.
2. Added exact-pattern targeted boosts for official DP headings, populated IC 15.2, the explicit minimum-score heading, complete personnel tables, actual adverse site conditions and contract E&S duties.
3. Prevented targeted boosts when template/qualification exclusions match, except where an exact minimum-score statement overrides surrounding scoring content.
4. Made pure geography a `contraintes_site` penalty only when no adverse-condition anchor is present.
5. Added field-specific semantic validation:
   - locations alone cannot validate as constraints;
   - qualifications alone cannot validate as E&S obligations;
   - personnel job titles cannot validate as disciplines.
6. Added conservative field prompts that preserve tender terminology and forbid inferred completion.
7. Limited `contraintes_site` and `exigences_es` to their strongest compact snippet; all other fields retain Top-2.
8. Added the exact E&S sentence fallback described above. It cannot synthesize or cite outside Top-1 evidence.

No global Top-K, dense/BM25/RRF architecture, Qdrant isolation or grounding threshold was weakened.

## D. Regression tests

24/24 local-RAG tests pass. New synthetic coverage verifies:

- official procedure evidence outranks shortlist/template content;
- populated PTC evidence outranks PTC/PTS alternatives;
- 75-point minimum outranks T/F weighting and maximum criterion scores;
- personnel job-title synthesis is rejected for disciplines;
- location-only evidence is rejected for constraints;
- expert qualifications are rejected for E&S;
- a project Code of Conduct obligation is accepted;
- exact E&S fallback happens only after two Qwen calls (initial + one correction).

## E. Full 34-field comparison

| Metric | Documented baseline | Final |
|---|---:|---:|
| Canonical fields | 34 | 34 |
| Populated | 29 | 33 |
| Correctly `Non trouvé` | 1 | 1 (`date_limite_depot`) |
| Incorrectly missing | 4 | 0 among the six targets |
| Six-field semantic conflicts | 2 | 0 |
| Unsupported claims | 0 | 0 |
| Canonical XML | valid | valid |

The increase is accepted because each recovered target is directly sourced and the two prior semantic confusions are now rejected or corrected. It is not treated as evidence of multi-tender generalization.

## F. Five-run stability

All 34 canonical field values were identical in 5/5 final runs. The six targets were also identical 5/5:

| Target field | Stability |
|---|---|
| `type_procedure` | 5/5 stable |
| `type_proposition` | 5/5 stable |
| `note_technique_minimale` | 5/5 stable |
| `disciplines_techniques` | 5/5 stable |
| `contraintes_site` | 5/5 stable |
| `exigences_es` | 5/5 stable |

The complete field result was 5/5 stable for every extraction tag. Before the exact E&S fallback, a separate five-run audit failed closed 5/5 on Qwen returning null; this failure is retained as the reason for the deterministic fallback.

## G. Runtime impact

Final runs:

| Run | Retrieval | Generation | Total |
|---:|---:|---:|---:|
| 1 | 7.27 s | 24.92 s | 45.74 s |
| 2 | 7.12 s | 25.08 s | 45.47 s |
| 3 | 7.26 s | 25.89 s | 46.66 s |
| 4 | 7.12 s | 24.59 s | 45.28 s |
| 5 | 7.11 s | 25.81 s | 46.15 s |

Mean total runtime: 45.86 s, modestly better than the prior section-aware ~49 s and within the existing 45–63 s observed range. Runtime was not optimized in this task.

## H. Tender isolation

Preserved unchanged: collection names remain tender/hash scoped, dense filters use `appel_offre_id` and `code_interne`, BM25 nodes are built from one tender only, and request validation rejects document/hash/tender mismatches.

## I. Unsupported claims

Zero. Every populated result cites supplied tender-scoped evidence. The canonical builder still rejects the whole local candidate when any field remains invalid.

## J. Remaining blockers

- Only one genuinely distinct procurement dossier is available. `AO-20260810-0828` and `AO-20260810-0958` are conversions of the same dossier.
- Several non-target list/synthesis fields remain semantically partial relative to Gemini even though grounded.
- The E&S exact-copy fallback needs shadow evidence on structurally different tenders.
- Gemini/local agreement is not a substitute for source-based review.

## K. Readiness

**B — ready for more shadow testing.**

The six targeted defects are fixed and stable for this dossier, but local-only W2 readiness cannot be upgraded without at least one genuinely different tender and broader source-based review. Gemini remains authoritative/default.
