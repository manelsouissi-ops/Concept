# Qwen3 embedding comparison for CONCEPT hybrid RAG

Evaluation date: 2026-08-11. Tender: `AO-20260810-0958`. Generation was pinned to `qwen3:14b`; only the embedding model and its isolated vector collection changed.

## A. Test setup

Both arms used the same 570,084-byte persisted CDC and identical:

- 206 deterministic 700/100 chunks plus one compact front-matter chunk;
- structural metadata and mandatory `appel_offre_id AND code_interne` filtering;
- local BM25, field-aware query expansion, 24+24 candidate pools, RRF (`k=60`), placeholder rejection, deterministic reranking, and final top-8;
- eight questions, ground truth, Qwen3:14b prompts, JSON validation, anti-hallucination questions, and isolation regression.

Vectors were never mixed:

- `qwen3-embedding:0.6b` → `concept_rag_embedding_compare_0_6b`.
- `qwen3-embedding:8b` → `concept_rag_embedding_compare_8b`.

Dimensions were derived from actual embedding responses before collection creation, not assumed from configuration.

## B. 0.6B results

- Dimension: 1,024.
- Chunks: 207.
- Dense evidence recall: 5/8; dense answers: 3/8.
- Hybrid evidence recall: 6/8; hybrid answers: 3/8.
- Hybrid+rerank evidence recall: **8/8**; answers: **5/8**; grounded citations: **5/8**.
- Structured extraction: **7/8**, valid JSON.
- Anti-hallucination: 3/3, zero hallucinations.
- Dense and lexical isolation: passed with zero mismatched results.

## C. 8B results

- Dimension: 4,096.
- Chunks: 207.
- Dense evidence recall: 5/8; dense answers: 5/8.
- Hybrid evidence recall: 5/8; hybrid answers: 4/8.
- Hybrid+rerank evidence recall: **8/8**; answers: **5/8**; grounded citations: **5/8**.
- Structured extraction: **6/8**, valid JSON.
- Anti-hallucination: 3/3, zero hallucinations.
- Dense and lexical isolation: passed with zero mismatched results.

## D. Side-by-side metrics

| Metric | 0.6B | 8B | Difference |
|---|---:|---:|---|
| Actual embedding dimension | 1,024 | 4,096 | 8B is 4× wider |
| Chunks | 207 | 207 | Identical |
| Embedding time | 6.469 s | 17.307 s | 8B is 2.68× slower |
| Qdrant indexing time | 0.106 s | 0.366 s | 8B is 3.44× slower |
| Mean combined retrieval latency | 0.102 s | 0.414 s | 8B is 4.07× slower |
| Dense recall | 5/8 | 5/8 | No recall gain |
| Hybrid recall | 6/8 | 5/8 | 8B loses one |
| Hybrid+rerank recall | 8/8 | 8/8 | Identical |
| Final answer accuracy | 5/8 | 5/8 | Identical |
| Final grounded citations | 5/8 | 5/8 | Identical |
| Structured extraction | 7/8 | 6/8 | 8B loses one |
| Final eight-answer generation time | 10.337 s | 10.890 s | Same generator; 8B context ordering was slightly slower |
| Structured generation time | 7.740 s | 7.452 s | Similar |
| Hallucinations | 0/3 | 0/3 | Identical |
| Tender isolation | Pass | Pass | Identical |

## E. Question-by-question comparison

Ranks below are final hybrid+rerank ranks for chunks containing the accepted ground-truth evidence. The raw reports contain every top-8 chunk with dense, lexical, fused, and reranked ranks and scores.

| Field | Expected | 0.6B evidence / rank | 8B evidence / rank | Final Qwen3:14b answer | Citation | Result/reason |
|---|---|---|---|---|---|---|
| Official reference | CI-PARU-365151-CS-QCBS/003/2024 | `chunk_6` #1; front matter #2 | `chunk_6` #1; front matter #2 | Correct for both | Correct for both | Success; no difference |
| Client | UC-PARU | `chunk_182` #1, `52` #2, `51` #8 | `chunk_52` #4, `51` #6, `182` #7 | `null` for both | Incorrect for both | Generation failure despite evidence; competing Client boilerplate |
| Country | Côte d'Ivoire | `chunk_6` #1, `182` #2, front matter #3 | front matter #1, `chunk_6` #2 | Correct for both | Correct for both | Success; 8B ranks compact evidence first but output is unchanged |
| Issue date | 06/08/2024 | front matter #1 | front matter #1 | `null` for both | Incorrect for both | Generation failure; competing blank date templates remain in context |
| Credit | Crédit IDA N°66860 | `chunk_7` #1 | `chunk_7` #1 | `66860` for both | Correct for both | Success; no difference |
| Selection method | SFQC | `chunk_130` #1 and five additional evidence chunks | `chunk_3` #1, `130` #2 and five additional evidence chunks | Correct for both | Correct for both | Success; ranking differs, outcome does not |
| Mission duration | 90 days / 3 months | `chunk_126` #1 | `chunk_126` #1 | `90 jours calendaire` for both | Incorrect for both | Generation failure; answer omits the equivalent 03 months |
| Financed project | PARU | `chunk_7` #1 | `chunk_7` #1 | Correct for both | Correct for both | Success; no difference |

The final reranked answers are identical question by question. The generator is unchanged, so the 8B dense-only answer improvement (5/8 versus 3/8) comes from different evidence ordering, not better generation capability. That improvement disappears after the full hybrid reranking pipeline.

## F. Embedding dimension comparison

Ollama metadata and live response lengths agreed:

- 0.6B: 1,024 floats/vector.
- 8B: 4,096 floats/vector.

At float32 and 207 chunks, raw vectors are approximately 0.81 MiB versus 3.23 MiB before Qdrant indexing/payload overhead. The 8B collection therefore starts with a 4× vector-memory/storage cost.

## G. Performance and resource comparison

Ollama reported both models fully GPU-offloaded at a 32,768 context:

- 0.6B runtime residency: approximately 5.8 GB.
- 8B runtime residency: approximately 10 GB.

Safe runtime snapshots observed 7,805 MiB total GPU memory while the 0.6B embedder was active, 18,799 MiB while both embedding models were resident, and 27,161 MiB while 8B and Qwen3:14b were resident. These are observations, not instrumented peak-memory measurements. Package sizes were 639 MB and 4.7 GB respectively.

The 8B model raises embedding time by 10.838 seconds, index time by 0.260 seconds, and mean retrieval latency by 0.312 seconds for no final recall or answer gain.

## H. Retrieval quality comparison

The 8B embeddings alter dense ranks and improve dense-only answers, but they do not improve dense evidence recall (both 5/8). Pure RRF hybrid recall is actually lower with 8B (5/8 versus 6/8). The deterministic reranker compensates for both models and produces the same 8/8 evidence recall.

For this document and field-oriented hybrid architecture, lexical exact-match signals, compact front matter, and deterministic field patterns contribute more to final retrieval quality than increasing embedding-model size.

## I. Final answer quality comparison

Final individual QA is identical: five successes and the same three generation failures. Structured extraction is worse with 8B because its retrieved/context ordering caused Qwen3:14b to output only `90 jours calendaire`, omitting `03 mois`; both models still confuse the financed-project field with the service title.

This is evidence that the next improvement should target evidence compression, competing-template removal, field-specific context selection, and output validation—not a larger embedding model.

## J. Recommended embedding model for CONCEPT

**Classification A — `qwen3-embedding:0.6b` is sufficient.**

Use 0.6B for subsequent CONCEPT experiments. It matches 8B on final evidence recall, answer accuracy, citations, hallucination resistance, and isolation; it is better on structured extraction in this run; and it has materially lower latency, vector width, disk footprint, and GPU residency.

This conclusion is limited to the frozen eight-question benchmark on one real tender. A future multi-tender corpus could revisit it, but the current evidence does not justify 8B's resource cost.

## K. Controlled W2 readiness

The local RAG pipeline is **not yet ready for controlled W2 integration**. Both embedding models retrieve evidence for 8/8 fields after reranking, but final individual answers remain 5/8, and structured extraction is at best 7/8. The remaining failures are generation/context-selection problems, so swapping embedding models does not clear the readiness threshold.

## L. Files created/changed

- `scripts/rag/benchmark_qwen3_14b_hybrid.py` — parameterized embedding model, dynamic dimension probe, and per-model collection support.
- `docs/QWEN3_EMBEDDING_0_6B_RESULTS.json` — complete 0.6B measurements.
- `docs/QWEN3_EMBEDDING_8B_RESULTS.json` — complete 8B measurements.
- `docs/QWEN3_EMBEDDING_MODEL_COMPARISON.md` — this comparison report.

No n8n workflow, W1/W2 behavior, production application code, database schema, callback, or business data was changed. No commit or push was performed.
