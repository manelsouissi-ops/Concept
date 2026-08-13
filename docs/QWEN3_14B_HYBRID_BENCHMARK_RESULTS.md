# Qwen3:14B hybrid retrieval benchmark

Tender: `AO-20260810-0958` (`appel_offre_id=1812`, `document_id=1759`). Evaluation date: 2026-08-11. Ground truth and eight questions are unchanged from the dense baseline.

## A. Root cause of previous retrieval failures

All four missing facts exist in the Markdown cover sheet:

| Field | Exact source location | Legacy chunk | Diagnosis |
|---|---:|---:|---|
| Official reference | line 165 | `chunk_6` | Short exact identifier diluted by generic text; a nearby `[Insérer le numéro de référence]` placeholder competes lexically |
| Client | lines 169–170 | `chunk_6` | Value split across Markdown lines inside a mixed cover/TOC chunk; repeated generic Client clauses rank elsewhere |
| Country | line 171 | `chunk_6` | Very short label/value surrounded by unrelated vocabulary; country terms recur throughout boilerplate/TDR |
| Issue date | lines 173–175 | `chunk_6` | Label and value are separated by blank lines; many template dates/placeholders rank higher |

Legacy `chunk_6` starts in unrelated Section 9 boilerplate, then contains the cover sheet, an empty reference placeholder, all four populated facts, and the beginning of the table of contents. Correct content was present, but context dilution, duplicated boilerplate, exact-token weakness, and ranking caused dense top-8 misses. This was not a missing-source or tender-filter problem.

## B. Changes made to experimental RAG

- Preserved deterministic 700/100 base chunking.
- Added section and preceding-heading metadata.
- Added one compact, generically detected populated cover-sheet chunk; the rest of the document was not fragmented further.
- Added local BM25 retrieval over only the already tender-filtered node set.
- Added deterministic field-category query expansion without tender answers.
- Fused dense and lexical candidates using Reciprocal Rank Fusion.
- Added a lightweight local rule-based reranker and generic placeholder rejection.
- Kept generation pinned to `qwen3:14b` and embeddings to `qwen3-embedding:0.6b`.

No additional model or package was downloaded.

## C. Chunking and metadata changes

The index contains 206 unchanged base chunks plus one compact `front_matter_0` chunk. Every node contains:

- `section_heading` and `preceding_heading`
- `chunk_index`
- `document_type`
- `appel_offre_id` and `code_interne`
- `document_id`
- `source_filename`

No page number was invented. The compact front-matter selector is structural: it looks for a populated DP/DAO/AMI number heading and stops before the table of contents. It does not contain this tender's expected answers.

## D. Lexical retrieval implementation

The benchmark implements local Okapi BM25 with `k1=1.5` and `b=0.75`. It tokenizes normalized text plus heading metadata, retrieves 24 candidates, and operates only on nodes whose in-memory corpus was built for the resolved tender. It favors exact references, dates, acronyms, credit numbers, and organization terms that dense embeddings handle poorly.

## E. Hybrid fusion method

Dense and lexical retrieval each produce a 24-item pool. Candidates are deduplicated by deterministic node ID and fused with Reciprocal Rank Fusion:

`score = 1/(60 + dense_rank) + 1/(60 + lexical_rank)`

Raw cosine and BM25 scores are never averaged. The JSON result records dense rank/score, lexical rank/score, fused rank/RRF score, and reranked rank/score for every top-8 candidate.

## F. Reranker used

No neural reranker was installed. The measured reranker is a small deterministic local layer over RRF that:

- rewards populated, category-appropriate patterns such as real dates, multi-part references, labeled countries, organization acronyms, credit+number pairs, and duration+unit pairs;
- penalizes unpopulated template markers such as `Insérer`, `à compléter`, repeated ellipses, and bracketed generic fields;
- does not penalize a chunk merely for containing a placeholder when it also contains a populated identifier/date.

This costs negligible compute and no extra VRAM. Its benefit was measured rather than assumed: evidence recall rose from 6/8 after RRF to 8/8 after reranking.

## G–I. Retrieval and answer comparison

The frozen prior dense baseline remains the apples-to-apples reference. “Citation” below requires a correct answer and a cited chunk containing the expected evidence.

| Metric | Dense baseline | Experimental dense | Hybrid RRF | Hybrid + rerank |
|---|---:|---:|---:|---:|
| Evidence recall | 4/8 | 5/8 | 6/8 | **8/8** |
| Answer accuracy | 3/8 | 3/8 | 3/8 | **5/8** |
| Grounded citation accuracy | 3/8 | 2/8 | 3/8 | **5/8** |
| Total generation time, 8 queries | 12.583 s | 12.031 s | 11.775 s | 10.172 s |
| Mean retrieval time | 0.098 s | \- | \- | 0.103 s shared dense+BM25+fusion |

Experimental dense includes field-aware query expansion and the enhanced 207-node index, so it is reported separately rather than silently replacing the frozen 4/8 baseline.

### Hybrid + rerank question detail

Notation is `chunk[dense rank/lexical rank/fused rank/reranked rank]`; `-` means absent from that 24-item source pool. The machine-readable report contains scores and 600-character excerpts.

| Field | Expected | Retrieved top-8 with ranks | Answer / citation | Result |
|---|---|---|---|---|
| Official reference | CI-PARU-365151-CS-QCBS/003/2024 | `6[22/1/5/1] front[-/23/34/2] 10[6/3/1/3] 3[5/5/2/4] 4[1/10/3/5] 22[13/4/4/6] 21[21/6/7/7] 9[11/18/9/8]` | Correct; `chunk_6`, `front_matter_0` | Success |
| Client | UC-PARU | `182[4/3/2/1] 52[8/11/4/2] 154[5/17/5/3] 155[7/16/6/4] 43[10/24/7/5] 20[18/19/8/6] 21[22/22/9/7] 51[-/2/11/8]` | `null`; cited retrieved set | Generation failure |
| Country | Côte d'Ivoire | `6[18/19/9/1] 182[9/-/17/2] front[-/17/29/3] 173[2/3/2/4] 186[13/2/4/5] 55[14/4/5/6] 164[20/7/7/7] 68[17/24/10/8]` | Correct; cited evidence | Success |
| Issue date | 06/08/2024 | `front[-/14/27/1] 51[1/3/1/2] 36[2/7/2/3] 29[11/5/3/4] 37[5/13/4/5] 56[8/21/5/6] 68[18/12/7/7] 46[21/16/9/8]` | `null`; cited retrieved set | Generation failure |
| Credit | Crédit IDA N°66860 | `7[1/1/1/1] 8[2/2/2/2] 151[3/3/3/3] 19[6/6/4/4] 20[13/4/5/5] 90[7/-/13/6] 2[-/8/15/7] 68[9/-/16/8]` | `66860`; `chunk_7` | Success |
| Selection method | SFQC | `130[1/2/1/1] 3[4/1/2/2] 39[3/3/3/3] 10[2/5/4/4] 196[10/9/6/5] 41[13/8/7/6] 11[20/4/8/7] 191[18/11/10/8]` | Correct; `chunk_130` | Success |
| Mission duration | 90 days / 3 months | `126[1/1/1/1] 127[4/4/3/2] 45[7/11/6/3] 44[21/7/7/4] 176[-/8/15/5] 49[-/10/18/6] 50[-/12/20/7] 182[-/14/24/8]` | Partial: `90 jours calendaire`; `chunk_126` | Generation failure |
| Financed project | PARU | `7[4/9/1/1] 151[3/16/2/2] 100[-/1/7/3] 180[-/2/10/4] 25[-/3/11/5] 4[8/-/18/6] 24[-/8/19/7] 178[18/-/32/8]` | Correct; `chunk_7` | Success |

## J. Structured extraction results

- Valid strict JSON: yes.
- Correct fields: **7/8**.
- Valid retrieved citation IDs: 8/8.
- Unsupported claims: 0. The only wrong field was supported by its cited text but answered the wrong semantic category.
- Remaining error: `financed_project` returned the tender's service/mission title instead of `Projet d’Assainissement et de Résilience Urbaine (PARU)`.

Correct fields were official reference, client, country, issue date, credit, selection method, and mission duration. This improves the prior structured result from 5/8 to 7/8.

## K. Anti-hallucination result

**3/3 passed; hallucination count 0.** The improved hybrid pipeline returned `null` for the exact budget, proposed consultant project lead, and exact works start date.

## L. Tender-isolation result

Passed with deliberately mismatched `AO-20260810-0958-MISMATCH`:

- Dense results: 0.
- Lexical results: 0.
- No unfiltered fallback exists.

Dense filtering remains `appel_offre_id AND code_interne`. Lexical BM25 is constructed only from nodes that already carry the resolved tender identity, and its explicit mismatch regression also returned zero.

## M. Performance impact

- Embed 207 chunks: 6.567 s on the final run.
- Qdrant index/upsert: 0.119 s.
- Mean combined query embedding + dense + BM25 + fusion/rerank: 0.103 s.
- Hybrid+rerank Qwen generation: 0.594–1.657 s per factual query, 10.172 s total.
- Structured extraction: 7.812 s.
- Anti-hallucination queries: 1.65–2.84 s.

The extra lexical/fusion/rule reranking work had no material observed latency penalty relative to the 0.098 s dense baseline average. A separate microbenchmark would be needed to isolate sub-millisecond BM25 and reranker costs precisely.

## N. Remaining failures

With evidence now present for all eight questions, the three individual failures are generation failures:

1. Client: Qwen returned `null` despite multiple chunks containing UC-PARU, likely because retrieved boilerplate contains many competing definitions of “Client.”
2. Issue date: Qwen returned `null` despite `front_matter_0`; blank date templates in the other seven chunks made the conservative prompt reject the populated date.
3. Mission duration: Qwen returned only `90 jours calendaire`, omitting the equivalent `03 mois`; this is partial, not accepted as correct by the unchanged ground truth validator.

The combined structured prompt resolves the first two and the full duration, showing that prompt/context selection—not retrieval recall—is now the limiting stage. The structured financed-project error still requires better semantic field disambiguation.

## O. Controlled W2 readiness

**Not ready for controlled W2 integration yet.** The retrieval target (8/8) and structured target (7/8) were met with zero unsupported claims, but individual grounded answer accuracy is still only 5/8 and structured extraction still has a material category error. The next evaluation should add evidence compression/context selection and field-specific output validators, then rerun this frozen benchmark plus additional tenders.

## P. Recommended production architecture

Prefer an eventual dedicated local RAG service:

```text
Dedicated local RAG service
├── Qdrant dense retrieval with mandatory tender filters
├── tender-scoped lexical BM25
├── RRF and lightweight deterministic reranking
├── qwen3-embedding:0.6b
├── Ollama / qwen3:14b
└── schema, evidence, and field validators
```

LlamaIndex should remain in the experimental environment for chunking and adapter convenience. The measured production path is narrow enough that a dedicated service would make filtering, fusion, validation, and failure behavior more explicit. Do not remove LlamaIndex until multi-tender parity is demonstrated.

## Q. Files created/changed

- `scripts/rag/benchmark_qwen3_14b_hybrid.py` — isolated hybrid benchmark.
- `docs/QWEN3_14B_HYBRID_BENCHMARK_RESULTS.json` — full per-candidate ranks, scores, evidence, answers, citations, and timings.
- `docs/QWEN3_14B_HYBRID_BENCHMARK_RESULTS.md` — this report.

No production files, n8n workflows, database objects, callbacks, business data, or workflow-mode settings were changed. No commit or push was performed.
