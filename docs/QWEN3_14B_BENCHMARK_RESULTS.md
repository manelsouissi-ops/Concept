# Qwen3:14B benchmark — CONCEPT CDC AO-20260810-0958

Evaluation date: 2026-08-11. This benchmark is evaluation-only. It did not modify n8n, production application behavior, the database schema, callbacks, workflow mode, or business data.

## A. Local model verification

- Ollama served `qwen3:14b` and `qwen3-embedding:0.6b` from `127.0.0.1:11434`; no model was downloaded.
- A strict JSON generation probe returned `{"status":"ok"}`.
- Generation model: Qwen3 14.8B, Q4_K_M, 40,960-token native context. The benchmark deliberately used `num_ctx=32768`.
- Embedding model: Qwen3 595.78M, Q8_0, 32,768-token context, 1,024-dimensional embeddings.

## B. Hardware/runtime result

- GPU: NVIDIA GeForce RTX 5090, 32,607 MiB VRAM.
- After the run, `ollama ps` reported both models at **100% GPU**: 14 GB for `qwen3:14b` and 5.8 GB for the embedding model.
- Observed aggregate GPU allocation after the run: 22,305 MiB. This is a post-run observation, not a sampled peak.
- The local generation probe completed in 0.450 s at 156.5 generated tokens/s.

## C. Direct extraction results

The direct test did not send the 570,084-byte document blindly. It selected deterministic ±5/6-line windows around fixed identification keywords, deduplicated those windows, and capped the resulting context at 60,000 characters (552 selected source lines).

- Strict JSON: valid.
- Correct: 7/8 (87.5%).
- Exact string matches: country, issue date, and credit number (3/8).
- Semantically correct variants: official reference (label prefix), full client name containing UC-PARU, selection-method wording, and financed-project wording (4/8).
- Wrong: mission duration. The model returned `21,00 expert-mois`, confusing expert effort with the required delivery period of 90 calendar days / 3 months.
- Missing/partial: none.
- Duration: 2.896 s; 8,995 prompt tokens; 180 generated tokens; 128.2 generated tokens/s.

## D. RAG retrieval results

The existing PoC chunker was reused: deterministic 700-character chunks with 100-character overlap. The real CDC produced 206 chunks. Every query used the conjunctive filter `appel_offre_id = 1812 AND code_interne = AO-20260810-0958`.

Correct evidence appeared in top-8 for 4/8 questions (50%): credit number, selection method, mission duration, and financed project. It was absent for the official reference, client, country, and issue date. Pure dense retrieval therefore missed several high-value facts located near the document front matter.

## E. RAG generation results

End-to-end success was 3/8 (37.5%): credit number, selection method, and mission duration. The financed-project evidence was retrieved, but Qwen answered with the financing institution/credit instead of the project name, producing one generation failure. The remaining four failures were retrieval failures.

| Field | Expected | Direct | Evidence top-8 | RAG answer | Classification |
|---|---|---:|---:|---|---|
| Official reference | CI-PARU-365151-CS-QCBS/003/2024 | Correct (semantic) | No | Unrelated contract-form text | Retrieval failure |
| Client | UC-PARU | Correct (semantic) | No | `null` | Retrieval failure |
| Country | Côte d'Ivoire | Exact | No | `null` | Retrieval failure |
| Issue date | 06/08/2024 | Exact | No | `null` | Retrieval failure |
| Credit number | Crédit IDA N°66860 | Exact | Yes | 66860 | Success |
| Selection method | SFQC | Correct (semantic) | Yes | Correct | Success |
| Mission duration | 90 days / 3 months | Wrong | Yes | Correct | Success |
| Financed project | PARU | Correct (semantic) | Yes | Returned IDA credit instead | Generation failure |

The complete retrieved chunk IDs, cosine scores, answers, citations, timings, and excerpts are preserved in `docs/QWEN3_14B_BENCHMARK_RESULTS.json`.

## F. Structured JSON result

The combined RAG extraction returned valid JSON with all eight required field objects and source arrays. Field accuracy was 5/8 (62.5%): client, country, credit, selection method, and duration were correct. The official reference and issue date reproduced blank template placeholders, and the financed-project field returned the mission title rather than PARU.

JSON/schema compliance was strong, but valid JSON must not be confused with factual correctness.

## G. Citation/evidence result

- Individual QA citation correctness: 3/8 end-to-end successes had both a correct answer and a citation to a chunk containing the expected evidence.
- A fourth query (financed project) retrieved and cited a relevant chunk but generated the wrong answer.
- Structured extraction used only valid retrieved chunk identifiers (8/8 fields), but only 5/8 values were factually correct. Thus identifier validity is high while evidence/value alignment remains insufficient.
- Some chunks are large enough that the stored 500-character report preview does not display the matching phrase even though the full chunk contains it; the JSON retains IDs and scores, while the source CDC remains the authority.

## H. Anti-hallucination result

Hallucinations: **0/3**. Qwen returned `null` for all deliberately unsupported questions:

1. Exact mission budget in FCFA.
2. Name of the consultant's proposed project lead.
3. Exact works start date.

## I. Tender isolation result

Passed. A query using the real `appel_offre_id` with the deliberately mismatched code `AO-20260810-0958-MISMATCH` retrieved zero chunks. There was no unfiltered fallback.

## J. Performance

| Operation | Result |
|---|---:|
| Embed 206 chunks | 6.389 s |
| Qdrant upsert/index | 0.114 s |
| Individual retrieval | 0.095–0.106 s/query |
| Individual Qwen generation | 1.109–2.182 s/query |
| Individual generation throughput | about 128–137 tokens/s |
| Direct extraction | 2.896 s, 128.2 tokens/s |
| Combined structured RAG extraction | 7.196 s, 111.4 tokens/s |
| Unsupported-query generation | 0.778–2.230 s/query |
| Observed post-run GPU memory | 22,305 / 32,607 MiB |

The model is comfortably usable for interactive local evaluation on this GPU. No optimization was attempted.

## K. Failure analysis: retrieval vs generation

- Retrieval failures: 4/8. Dense semantic search alone did not reliably surface short front-matter identifiers, especially reference, organization acronym, country, and exact date.
- Generation failures after successful retrieval: 1/8. Qwen conflated “project financed” with “financing source.”
- Successes: 3/8.
- Direct extraction's 7/8 result shows that the model can extract most fields when supplied with deterministic high-recall evidence. The current bottleneck is primarily retrieval, followed by prompt/evidence disambiguation for closely related facts.

## L. Qwen3:14b readiness classification

**PROMISING BUT NEEDS RAG IMPROVEMENT**

| Dimension | Score | Basis |
|---|---:|---|
| Raw extraction accuracy | 8.5/10 | 7/8 correct; one material duration confusion |
| RAG retrieval accuracy | 5.0/10 | Evidence in top-8 for 4/8 |
| RAG answer accuracy | 3.8/10 | 3/8 end-to-end successes |
| Structured JSON reliability | 8.0/10 | Valid, complete schema; 5/8 factual values |
| Citation/evidence reliability | 5.0/10 | Valid IDs, but insufficient evidence/value alignment |
| Hallucination resistance | 10/10 | 3/3 unsupported questions correctly refused |
| Performance | 9.0/10 | Fully GPU-offloaded and fast locally |

The model should not replace Gemini or enter W2 yet. Runtime fitness and refusal behavior are good, but factual RAG accuracy is below a controlled-integration threshold.

## M. Recommended next step

Keep this outside production and improve retrieval first:

1. Add deterministic metadata/front-matter extraction or a keyword/BM25 leg for identifiers, dates, references, and acronyms.
2. Fuse lexical and dense results, then rerank before generation.
3. Use field-specific prompts and validators (date, reference, duration, organization) and reject placeholders.
4. Re-run the same frozen benchmark and require materially higher retrieval recall, answer accuracy, and evidence alignment before controlled n8n integration.

For the eventual architecture, keep the intended boundary: CONCEPT → W2 n8n → local RAG service → Qdrant / Qwen embedding / Qwen3:14b → structured result → existing CONCEPT validation → existing signed callback. LlamaIndex is useful for experimentation and chunk/vector-store adapters, but the production runtime can be a smaller dedicated retrieval service because the required path is narrow: deterministic chunking, strict filters, hybrid retrieval, validation, and Ollama calls. Do not remove LlamaIndex until the improved benchmark proves functional parity.

## N. Files created/changed

- `scripts/rag/benchmark_qwen3_14b.py` — isolated, reproducible benchmark harness pinned to `qwen3:14b` and a dedicated Qdrant collection.
- `docs/QWEN3_14B_BENCHMARK_RESULTS.json` — machine-readable raw measurements and per-query evidence.
- `docs/QWEN3_14B_BENCHMARK_RESULTS.md` — this report.

No commit or push was performed.
