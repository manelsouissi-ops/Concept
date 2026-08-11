#!/usr/bin/env python3
"""Experimental raw Markdown A/B benchmark: Marker versus Docling."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys
from time import perf_counter
from typing import Any

from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.core.vector_stores.utils import node_to_metadata_dict
from qdrant_client import QdrantClient, models

from evaluate_tender_rag import (
    QUESTIONS,
    expected_present,
    generate_answers,
    retrieve,
)
from poc_tender_rag import (
    CODE_PATTERN,
    EMBEDDING_MODEL,
    OLLAMA_URL,
    QDRANT_URL,
    VECTOR_SIZE,
    build_nodes,
    check_ollama,
    exact_filter,
    resolve_tender,
)


COLLECTIONS = {
    "marker": "concept_rag_marker_benchmark",
    "docling": "concept_rag_docling_benchmark",
}

EXPECTED = {
    "reference_officielle": "CI-PARU-365151-CS-QCBS/003/2024",
    "client_maitre_ouvrage": "UC-PARU",
    "pays": "Côte d’Ivoire",
    "date_emission": "06/08/2024",
    "credit_financement": "Crédit IDA N°66860",
    "methode_selection": "Sélection Fondée sur la Qualité et le Coût (SFQC)",
    "duree_totale": "90 jours calendaires, soit 3 mois",
    "projet_rattachement": "Projet d’Assainissement et de Résilience Urbaine (PARU)",
}


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--code-interne", required=True)
    parser.add_argument("--marker-path", type=Path, required=True)
    parser.add_argument("--docling-path", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not CODE_PATTERN.fullmatch(args.code_interne):
        parser.error("invalid --code-interne")
    for label in ("marker_path", "docling_path"):
        path = getattr(args, label).expanduser().resolve()
        if not path.is_file():
            parser.error(f"file does not exist: {path}")
        setattr(args, label, path)
    return args


def ensure_collection(client: QdrantClient, name: str):
    names = {item.name for item in client.get_collections().collections}
    if name not in names:
        client.create_collection(
            collection_name=name,
            vectors_config=models.VectorParams(
                size=VECTOR_SIZE,
                distance=models.Distance.COSINE,
            ),
        )
    info = client.get_collection(name)
    config = info.config.params.vectors
    if not isinstance(config, models.VectorParams):
        raise RuntimeError(f"{name} is not a single-vector collection")
    if config.size != VECTOR_SIZE or config.distance != models.Distance.COSINE:
        raise RuntimeError(f"{name} has incompatible vector settings")


def structure_metrics(path: Path, markdown: str):
    lines = markdown.splitlines()
    images = re.findall(
        r"!\[[^\]]*\]\(data:image/[^;]+;base64,([^)]*)\)",
        markdown,
        flags=re.IGNORECASE,
    )
    stripped = re.sub(
        r"!\[[^\]]*\]\(data:image/[^;]+;base64,[^)]*\)",
        "[EMBEDDED_IMAGE]",
        markdown,
        flags=re.IGNORECASE,
    )
    normalized_lines = [" ".join(line.split()) for line in lines if line.strip()]
    repeated = sum(count - 1 for count in Counter(normalized_lines).values() if count > 1)
    return {
        "bytes": path.stat().st_size,
        "line_count": len(lines),
        "word_count": len(markdown.split()),
        "heading_count": sum(bool(re.match(r"^#{1,6}\s", line)) for line in lines),
        "pipe_table_line_count": sum(line.count("|") >= 2 for line in lines),
        "html_table_tag_count": len(re.findall(r"<(?:table|tr|td|th)\b", markdown, re.I)),
        "embedded_image_count": len(images),
        "base64_character_count": sum(map(len, images)),
        "base64_percent_of_file": round(
            100 * sum(map(len, images)) / max(1, len(markdown.encode("utf-8"))), 3
        ),
        "bytes_without_embedded_images": len(stripped.encode("utf-8")),
        "maximum_line_length": max(map(len, lines), default=0),
        "duplicate_nonempty_line_occurrences": repeated,
    }


def token_overlap(expected: str, answer: str):
    normalize = lambda value: set(re.findall(r"[a-z0-9]+", value.lower()))
    expected_tokens = {token for token in normalize(expected) if len(token) >= 2}
    if not expected_tokens:
        return 0.0
    return len(expected_tokens & normalize(answer)) / len(expected_tokens)


def citation_chunk_ids(raw_citations):
    chunk_ids = []
    for value in raw_citations:
        if isinstance(value, int):
            chunk_ids.append(value)
            continue
        match = re.search(r"(?:chunk\s*)?(\d+)", str(value), flags=re.IGNORECASE)
        if match:
            chunk_ids.append(int(match.group(1)))
    return chunk_ids


def run_source(
    source: str,
    path: Path,
    base_tender: dict[str, Any],
    qdrant: QdrantClient,
    embedding_model: OllamaEmbedding,
):
    collection_name = COLLECTIONS[source]
    ensure_collection(qdrant, collection_name)
    tender = dict(base_tender)
    tender["markdown_path"] = path
    tender["source_filename"] = path.name
    markdown = path.read_text(encoding="utf-8")

    chunk_started = perf_counter()
    nodes, content_hash = build_nodes(markdown, tender)
    chunk_seconds = perf_counter() - chunk_started

    embedding_started = perf_counter()
    embeddings = embedding_model.get_text_embedding_batch(
        [node.get_content() for node in nodes],
        show_progress=True,
    )
    embedding_seconds = perf_counter() - embedding_started
    for node, embedding in zip(nodes, embeddings, strict=True):
        if len(embedding) != VECTOR_SIZE:
            raise RuntimeError(f"embedding dimension {len(embedding)} != {VECTOR_SIZE}")
        node.embedding = embedding

    scoped = exact_filter(
        tender["appel_offre_id"], tender["code_interne"], tender["document_id"]
    )
    index_started = perf_counter()
    qdrant.delete(
        collection_name=collection_name,
        points_selector=models.FilterSelector(filter=scoped),
        wait=True,
    )
    points = []
    for node in nodes:
        payload = node_to_metadata_dict(node, remove_text=False, flat_metadata=True)
        payload["document_id"] = tender["document_id"]
        payload["benchmark_source"] = source
        points.append(models.PointStruct(id=node.node_id, vector=node.embedding, payload=payload))
    upsert_batch_size = 128
    for offset in range(0, len(points), upsert_batch_size):
        qdrant.upsert(
            collection_name=collection_name,
            points=points[offset : offset + upsert_batch_size],
            wait=True,
        )
    qdrant_seconds = perf_counter() - index_started

    vector_store = QdrantVectorStore(
        client=qdrant,
        collection_name=collection_name,
        stores_text=True,
    )
    rows = []
    for key, question in QUESTIONS:
        retrieval_started = perf_counter()
        result = retrieve(vector_store, embedding_model, tender, question)
        retrieval_seconds = perf_counter() - retrieval_started
        retrieved = []
        for node, score in zip(result.nodes or [], result.similarities or [], strict=True):
            retrieved.append(
                {
                    "chunk_index": node.metadata["chunk_index"],
                    "score": round(float(score), 6),
                    "text": node.get_content(),
                }
            )
        rows.append(
            {
                "key": key,
                "question": question,
                "expected": EXPECTED[key],
                "retrieval_seconds": round(retrieval_seconds, 6),
                "retrieved": retrieved,
            }
        )

    generation_started = perf_counter()
    generated = generate_answers(rows)
    generation_seconds = perf_counter() - generation_started
    generated_by_number = {int(item["question"]): item for item in generated}

    correct = partial = citations_correct = 0
    for number, row in enumerate(rows, 1):
        generated_row = generated_by_number[number]
        answer = str(generated_row["answer"])
        citations = citation_chunk_ids(generated_row.get("citations", []))
        answer_correct = expected_present(row["expected"], answer)
        overlap = token_overlap(row["expected"], answer)
        status = "correct" if answer_correct else "partial" if overlap >= 0.4 else "failed"
        correct += status == "correct"
        partial += status == "partial"
        by_chunk = {item["chunk_index"]: item for item in row["retrieved"]}
        citation_correct = any(
            chunk in by_chunk
            and expected_present(row["expected"], by_chunk[chunk]["text"])
            for chunk in citations
        )
        citations_correct += citation_correct
        row.update(
            {
                "retrieved_chunk_ids": [item["chunk_index"] for item in row["retrieved"]],
                "similarity_scores": [item["score"] for item in row["retrieved"]],
                "answer": answer,
                "citations": citations,
                "answer_status": status,
                "citation_correct": citation_correct,
            }
        )
        del row["retrieved"]

    normalized_markdown = " ".join(markdown.split())
    expected_presence = {
        key: {
            "expected": value,
            "found": expected_present(value, normalized_markdown),
        }
        for key, value in EXPECTED.items()
    }
    count = qdrant.count(
        collection_name=collection_name,
        count_filter=scoped,
        exact=True,
    ).count
    return {
        "source": source,
        "path": str(path),
        "collection": collection_name,
        "content_hash": content_hash,
        "structure": structure_metrics(path, markdown),
        "expected_value_presence": expected_presence,
        "chunk_count": len(nodes),
        "qdrant_scoped_point_count": count,
        "timing_seconds": {
            "chunking": round(chunk_seconds, 6),
            "embedding": round(embedding_seconds, 6),
            "qdrant_replace_and_upsert": round(qdrant_seconds, 6),
            "embedding_and_indexing": round(embedding_seconds + qdrant_seconds, 6),
            "generation_batch": round(generation_seconds, 6),
            "generation_per_question_mean": round(generation_seconds / len(rows), 6),
        },
        "summary": {
            "fully_correct": correct,
            "partial": partial,
            "failed": len(rows) - correct - partial,
            "correct_citations": citations_correct,
        },
        "questions": rows,
    }


def main():
    args = parse_args()
    check_ollama()
    tender = resolve_tender(args.code_interne)
    qdrant = QdrantClient(url=QDRANT_URL, timeout=120)
    embedding_model = OllamaEmbedding(
        model_name=EMBEDDING_MODEL,
        base_url=OLLAMA_URL,
        embed_batch_size=16,
        keep_alive="10m",
    )
    probe = embedding_model.get_text_embedding("CONCEPT A/B benchmark dimension probe")
    if len(probe) != VECTOR_SIZE:
        raise RuntimeError(f"embedding dimension {len(probe)} != {VECTOR_SIZE}")

    report = {
        "settings": {
            "embedding_model": EMBEDDING_MODEL,
            "llm_model": "qwen3:4b",
            "vector_size": VECTOR_SIZE,
            "distance": "Cosine",
            "chunk_size": 700,
            "chunk_overlap": 100,
            "top_k": 8,
            "filters": ["appel_offre_id", "code_interne"],
            "generation_mode": "one unchanged batch for eight questions",
        },
        "tender": {
            "appel_offre_id": tender["appel_offre_id"],
            "code_interne": tender["code_interne"],
            "document_id": tender["document_id"],
        },
        "runs": [],
    }
    for source, path in (("marker", args.marker_path), ("docling", args.docling_path)):
        print(f"Running {source}: {path}", file=sys.stderr, flush=True)
        report["runs"].append(
            run_source(source, path, tender, qdrant, embedding_model)
        )
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
        print(f"Report written to {args.output}", file=sys.stderr)
    else:
        print(rendered)


if __name__ == "__main__":
    main()
