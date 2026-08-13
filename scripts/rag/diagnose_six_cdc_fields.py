#!/usr/bin/env python3
"""Focused, non-mutating diagnostics for the six remaining CDC fields."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "local-rag"))

from llama_index.core.vector_stores.utils import node_to_metadata_dict
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient, models

from benchmark_qwen3_14b_hybrid import BM25, build_enhanced_nodes, ensure_collection, retrieve_modes
from canonical import FIELD_QUERIES, FIELD_ROUTES, FIELD_RULES
from poc_tender_rag import EMBEDDING_MODEL, OLLAMA_URL, QDRANT_URL, resolve_tender

sys.path.insert(0, str(ROOT / "services" / "local-rag"))
import server as local_server  # noqa: E402

TARGETS = (
    "type_procedure", "type_proposition", "note_technique_minimale",
    "disciplines_techniques", "contraintes_site", "exigences_es",
)


def candidate(item: dict, rank: int) -> dict:
    node = item["node"]
    return {
        "rank": rank, "score": item.get("dense_score") or item.get("lexical_score") or item.get("rrf_score"),
        "dense_rank": item.get("dense_rank"), "lexical_rank": item.get("lexical_rank"),
        "fused_rank": item.get("fused_rank"), "routed_rank": item.get("routed_rank"),
        "section_family": item.get("section_family"), "section_heading": node.metadata.get("section_heading"),
        "chunk_index": node.metadata.get("chunk_index"), "section_boost": item.get("section_boost"),
        "anchor_boost": item.get("anchor_boost"), "exclusion_penalty": item.get("exclusion_penalty"),
        "targeted_boost": item.get("targeted_boost"), "final_score": item.get("rerank_score"),
        "preview": " ".join(node.text.split())[:420],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code-interne", default="AO-20260810-0958")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    tender = resolve_tender(args.code_interne)
    nodes, digest = build_enhanced_nodes(tender["markdown_path"].read_text(encoding="utf-8"), tender)
    embedding = OllamaEmbedding(model_name=EMBEDDING_MODEL, base_url=OLLAMA_URL, embed_batch_size=16)
    vectors = embedding.get_text_embedding_batch([node.text for node in nodes])
    qdrant = QdrantClient(url=QDRANT_URL, timeout=60)
    collection = f"concept_rag_six_field_diagnostic_{int(tender['appel_offre_id'])}_{digest[:12]}"
    ensure_collection(qdrant, collection, len(vectors[0]))
    points = []
    for node, vector in zip(nodes, vectors, strict=True):
        node.embedding = vector
        payload = node_to_metadata_dict(node, remove_text=False, flat_metadata=True)
        payload["document_id"] = int(tender["document_id"])
        points.append(models.PointStruct(id=node.node_id, vector=vector, payload=payload))
    qdrant.upsert(collection, points, wait=True)
    store = QdrantVectorStore(client=qdrant, collection_name=collection, stores_text=True)
    bm25, by_id = BM25(nodes), {node.node_id: node for node in nodes}
    report = {"code_interne": args.code_interne, "fields": {}}
    for key in TARGETS:
        query = FIELD_QUERIES[key]
        modes, _ = retrieve_modes(store, embedding, bm25, by_id, tender, key, query)
        selected = modes["hybrid_rerank"][:1 if key in {"contraintes_site", "exigences_es"} else 2]
        evidence = {
            f"chunk_{item['node'].metadata['chunk_index']}": local_server.compact_field_snippet(key, item["node"].text, item["node"].metadata.get("section_heading"))
            for item in selected
        }
        answer, validation = local_server.extract_group("focused_diagnostic", (key,), evidence)
        route = FIELD_ROUTES[key]
        report["fields"][key] = {
            "semantic_definition": FIELD_RULES[key], "query": query,
            "primary_families": route[0], "fallback_families": route[1],
            "positive_anchors": route[2], "exclusion_signals": route[3],
            "dense": [candidate(item, rank) for rank, item in enumerate(modes["dense"][:5], 1)],
            "bm25": [candidate(item, rank) for rank, item in enumerate(sorted(modes["hybrid_rerank"], key=lambda row: row.get("lexical_rank") or 999)[:5], 1)],
            "rrf": [candidate(item, rank) for rank, item in enumerate(modes["hybrid"][:5], 1)],
            "reranked": [candidate(item, rank) for rank, item in enumerate(modes["hybrid_rerank"][:5], 1)],
            "final_evidence": [{"chunk_id": chunk, "preview": " ".join(text.split())[:700]} for chunk, text in evidence.items()],
            "qwen_raw_field_output": answer.get(key) if isinstance(answer, dict) else answer,
            "canonical_accepted": not validation["validation_failures"],
            "validation": validation,
        }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
