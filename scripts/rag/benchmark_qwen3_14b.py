#!/usr/bin/env python3
"""Offline CONCEPT benchmark for qwen3:14b. Evaluation-only; no production writes."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from time import perf_counter
from urllib.request import Request, urlopen

from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.core.vector_stores.types import VectorStoreQuery
from llama_index.core.vector_stores.utils import node_to_metadata_dict
from qdrant_client import QdrantClient, models

from poc_tender_rag import (
    OLLAMA_URL, QDRANT_URL, EMBEDDING_MODEL, VECTOR_SIZE,
    build_nodes, exact_filter, llama_filters, resolve_tender,
)

MODEL = "qwen3:14b"
COLLECTION = "concept_rag_qwen3_14b_benchmark"
FIELDS = {
    "official_reference": ("Quelle est la référence officielle de la Demande de Propositions ?", "CI-PARU-365151-CS-QCBS/003/2024"),
    "client": ("Quel est le nom du Client ?", "UC-PARU"),
    "country": ("Quel est le pays du Client ?", "Côte d'Ivoire"),
    "issue_date": ("À quelle date la Demande de Propositions a-t-elle été émise ?", "06/08/2024"),
    "credit_number": ("Quel est le numéro du crédit IDA ?", "Crédit IDA N°66860"),
    "selection_method": ("Quelle méthode de sélection du Consultant est utilisée ?", "Sélection Fondée sur la Qualité et le Coût (SFQC)"),
    "mission_duration": ("Quel est le délai de réalisation de la mission ?", "90 jours calendaires, soit 03 mois"),
    "financed_project": ("Quel projet finance cette mission ?", "Projet d’Assainissement et de Résilience Urbaine (PARU)"),
}
KEYWORDS = ("CI-PARU", "UC-PARU", "Côte d'Ivoire", "06/08/2024", "66860", "SFQC", "Qualité et le Coût", "90 jours", "03 mois", "Résilience Urbaine", "PARU")
REQUIRED_EVIDENCE = {
    "official_reference": (("ci paru 365151 cs qcbs 003 2024",),),
    "client": (("uc paru",),),
    "country": (("cote d ivoire",),),
    "issue_date": (("06 08 2024",),),
    "credit_number": (("66860",),),
    "selection_method": (("sfqc",), ("qualite", "cout")),
    "mission_duration": (("90 jours", "03 mois"), ("90 jours", "3 mois")),
    "financed_project": (("projet d assainissement et de resilience urbaine",), ("projet", "paru")),
}

def normalize(value: str) -> str:
    import unicodedata
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()

def correct(key: str, actual: object) -> bool:
    if not isinstance(actual, str): return False
    value = normalize(actual)
    return any(all(term in value for term in alternative) for alternative in REQUIRED_EVIDENCE[key])

def ollama_generate(prompt: str, *, json_mode: bool = True, num_predict: int = 900) -> tuple[object, dict]:
    payload = {"model": MODEL, "prompt": "/no_think\n" + prompt, "stream": False, "think": False,
               "options": {"temperature": 0, "num_ctx": 32768, "num_predict": num_predict}}
    if json_mode: payload["format"] = "json"
    started = perf_counter()
    request = Request(f"{OLLAMA_URL}/api/generate", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=600) as response: raw = json.load(response)
    wall = perf_counter() - started
    text = raw.get("response", "").strip()
    parsed = json.loads(text) if json_mode else text
    eval_count = int(raw.get("eval_count") or 0); eval_ns = int(raw.get("eval_duration") or 0)
    metrics = {"wall_seconds": round(wall, 4), "total_duration_seconds": round(int(raw.get("total_duration") or 0) / 1e9, 4),
               "load_duration_seconds": round(int(raw.get("load_duration") or 0) / 1e9, 4), "prompt_tokens": int(raw.get("prompt_eval_count") or 0),
               "generated_tokens": eval_count, "tokens_per_second": round(eval_count / (eval_ns / 1e9), 3) if eval_ns else None}
    return parsed, metrics

def direct_context(markdown: str) -> tuple[str, list[int]]:
    lines = markdown.splitlines(); selected: set[int] = set()
    for i, line in enumerate(lines):
        if any(normalize(k) in normalize(line) for k in KEYWORDS):
            selected.update(range(max(0, i - 5), min(len(lines), i + 7)))
    ordered = sorted(selected); blocks, current, previous = [], [], -2
    for i in ordered:
        if i != previous + 1 and current: blocks.append("\n".join(current)); current = []
        current.append(lines[i]); previous = i
    if current: blocks.append("\n".join(current))
    return "\n\n--- SECTION SÉLECTIONNÉE ---\n\n".join(blocks)[:60000], ordered

def ensure_collection(client: QdrantClient):
    names = {x.name for x in client.get_collections().collections}
    if COLLECTION in names: client.delete_collection(COLLECTION)
    client.create_collection(COLLECTION, vectors_config=models.VectorParams(size=VECTOR_SIZE, distance=models.Distance.COSINE))

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--code-interne", default="AO-20260810-0958"); parser.add_argument("--output", type=Path, required=True); args = parser.parse_args()
    tender = resolve_tender(args.code_interne); markdown_path = tender["markdown_path"]; markdown = markdown_path.read_text(encoding="utf-8")
    tags = json.load(urlopen(f"{OLLAMA_URL}/api/tags", timeout=10)); by_name = {x["name"]: x for x in tags["models"]}
    if MODEL not in by_name or EMBEDDING_MODEL not in by_name: raise RuntimeError("Required local models are missing")
    probe, probe_metrics = ollama_generate('Retourne uniquement {"status":"ok"}.', num_predict=30)
    direct_text, selected_lines = direct_context(markdown)
    direct_prompt = "Extrait les 8 champs uniquement depuis le CDC fourni. Valeur null si absente. Retourne strictement un objet JSON avec exactement ces clés: " + ", ".join(FIELDS) + ".\nCDC:\n" + direct_text
    direct, direct_metrics = ollama_generate(direct_prompt, num_predict=700)

    qdrant = QdrantClient(url=QDRANT_URL, timeout=60); ensure_collection(qdrant)
    nodes, content_hash = build_nodes(markdown, tender)
    embedding = OllamaEmbedding(model_name=EMBEDDING_MODEL, base_url=OLLAMA_URL, embed_batch_size=16, keep_alive="10m")
    embed_start = perf_counter(); vectors = embedding.get_text_embedding_batch([n.get_content() for n in nodes], show_progress=True); embed_seconds = perf_counter() - embed_start
    for node, vector in zip(nodes, vectors, strict=True): node.embedding = vector
    points = []
    for node in nodes:
        payload = node_to_metadata_dict(node, remove_text=False, flat_metadata=True); payload["document_id"] = int(tender["document_id"])
        points.append(models.PointStruct(id=node.node_id, vector=node.embedding, payload=payload))
    index_start = perf_counter()
    for offset in range(0, len(points), 128): qdrant.upsert(COLLECTION, points[offset:offset+128], wait=True)
    index_seconds = perf_counter() - index_start
    store = QdrantVectorStore(client=qdrant, collection_name=COLLECTION, stores_text=True)
    rows = []
    for key, (question, expected) in FIELDS.items():
        started = perf_counter(); query_vector = embedding.get_query_embedding(question)
        result = store.query(VectorStoreQuery(query_embedding=query_vector, query_str=question, similarity_top_k=8, filters=llama_filters(int(tender["appel_offre_id"]), tender["code_interne"])))
        retrieval_seconds = perf_counter() - started
        retrieved = [{"chunk_id": f"chunk_{n.metadata['chunk_index']}", "chunk_index": n.metadata["chunk_index"], "score": round(float(s), 6), "text": n.get_content()} for n, s in zip(result.nodes or [], result.similarities or [], strict=True)]
        evidence = [x for x in retrieved if correct(key, x["text"])]
        context = "\n\n".join(f"[{x['chunk_id']}]\n{x['text']}" for x in retrieved)
        answer_obj, gen_metrics = ollama_generate(f'Retourne strictement {{"answer": string|null, "sources": ["chunk_N"]}}. Réponds uniquement depuis le contexte; null si absent.\nQuestion: {question}\nContexte:\n{context}', num_predict=220)
        answer = answer_obj.get("answer") if isinstance(answer_obj, dict) else None; sources = answer_obj.get("sources", []) if isinstance(answer_obj, dict) else []
        answer_ok = correct(key, answer); cited = {str(x) for x in sources}; evidence_ids = {x["chunk_id"] for x in evidence}
        rows.append({"key": key, "question": question, "expected": expected, "retrieved_chunk_ids": [x["chunk_id"] for x in retrieved], "similarity_scores": [x["score"] for x in retrieved], "relevant_excerpt": re.sub(r"\s+", " ", evidence[0]["text"])[:500] if evidence else None, "evidence_in_top_k": bool(evidence), "answer": answer, "sources": sources, "answer_correct": answer_ok, "citation_correct": bool(cited & evidence_ids), "classification": "SUCCESS" if evidence and answer_ok else "GENERATION_FAILURE" if evidence else "RETRIEVAL_FAILURE", "retrieval_seconds": round(retrieval_seconds, 4), "generation": gen_metrics})

    combined_chunks = sorted({cid for row in rows for cid in row["retrieved_chunk_ids"]})
    scroll = qdrant.scroll(COLLECTION, scroll_filter=exact_filter(int(tender["appel_offre_id"]), tender["code_interne"]), limit=len(points), with_payload=True, with_vectors=False)[0]
    payload_by_chunk = {f"chunk_{p.payload.get('chunk_index')}": p.payload.get("_node_content", "") for p in scroll}
    # Use retrieved node text retained in the rows' evidence previews via a fresh filtered retrieval per field.
    structured_context_parts = []
    for key, (question, _) in FIELDS.items():
        qv = embedding.get_query_embedding(question); rr = store.query(VectorStoreQuery(query_embedding=qv, similarity_top_k=5, filters=llama_filters(int(tender["appel_offre_id"]), tender["code_interne"])))
        structured_context_parts.extend(f"[chunk_{n.metadata['chunk_index']}]\n{n.get_content()}" for n in rr.nodes or [])
    structured_context = "\n\n".join(dict.fromkeys(structured_context_parts))
    shape = {key: {"value": "string|null", "sources": ["chunk_N"]} for key in FIELDS}
    structured, structured_metrics = ollama_generate(f"Extrait les champs uniquement depuis les preuves. Retourne exactement cette structure JSON: {json.dumps(shape)}. Aucun fait non prouvé.\nPREUVES:\n{structured_context}", num_predict=900)

    unsupported_questions = ["Quel est le budget exact de la mission en FCFA ?", "Quel est le nom du chef de projet proposé par le consultant ?", "Quelle est la date exacte de démarrage des travaux ?"]
    hallucinations = []
    for question in unsupported_questions:
        qv = embedding.get_query_embedding(question); rr = store.query(VectorStoreQuery(query_embedding=qv, similarity_top_k=5, filters=llama_filters(int(tender["appel_offre_id"]), tender["code_interne"])))
        context = "\n\n".join(f"[chunk_{n.metadata['chunk_index']}]\n{n.get_content()}" for n in rr.nodes or [])
        obj, metrics = ollama_generate(f'Retourne {{"answer": string|null, "sources": []}}. Si la réponse exacte n’est pas explicitement prouvée, answer doit être null.\nQuestion: {question}\nContexte:\n{context}', num_predict=180)
        answer = obj.get("answer") if isinstance(obj, dict) else None
        hallucinations.append({"question": question, "answer": answer, "passed": answer is None or "indispon" in str(answer).lower() or "insuff" in str(answer).lower(), "generation": metrics})

    wrong_code = tender["code_interne"] + "-MISMATCH"
    qv = embedding.get_query_embedding(FIELDS["client"][0]); isolated = store.query(VectorStoreQuery(query_embedding=qv, similarity_top_k=8, filters=llama_filters(int(tender["appel_offre_id"]), wrong_code)))
    direct_fields = {key: {"actual": direct.get(key) if isinstance(direct, dict) else None, "correct": correct(key, direct.get(key) if isinstance(direct, dict) else None)} for key in FIELDS}
    structured_fields = {}
    for key, (_, expected) in FIELDS.items():
        item = structured.get(key, {}) if isinstance(structured, dict) else {}; value = item.get("value") if isinstance(item, dict) else None; sources = item.get("sources", []) if isinstance(item, dict) else []
        structured_fields[key] = {"value": value, "sources": sources, "correct": correct(key, value), "evidence_references_valid": bool(sources) and all(str(x) in combined_chunks for x in sources)}
    report = {"benchmark": {"model": MODEL, "embedding_model": EMBEDDING_MODEL, "collection": COLLECTION, "markdown": str(markdown_path), "sha256": hashlib.sha256(markdown.encode()).hexdigest(), "appel_offre_id": tender["appel_offre_id"], "document_id": tender["document_id"]}, "model_verification": {"generation_probe": probe, "metrics": probe_metrics, "model_details": by_name[MODEL].get("details", {})}, "direct_extraction": {"strategy": "keyword line windows ±5/6, deduplicated, capped at 60k characters", "selected_line_count": len(selected_lines), "context_characters": len(direct_text), "json_valid": isinstance(direct, dict), "fields": direct_fields, "metrics": direct_metrics}, "rag": {"chunk_count": len(nodes), "content_hash": content_hash, "embedding_seconds": round(embed_seconds, 4), "qdrant_index_seconds": round(index_seconds, 4), "questions": rows}, "structured_rag": {"json_valid": isinstance(structured, dict), "fields": structured_fields, "metrics": structured_metrics}, "anti_hallucination": {"tests": hallucinations, "hallucination_count": sum(not x["passed"] for x in hallucinations)}, "isolation": {"mismatched_code": wrong_code, "retrieved_count": len(isolated.nodes or []), "passed": len(isolated.nodes or []) == 0}}
    args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"); print(json.dumps({"output": str(args.output), "direct_correct": sum(x["correct"] for x in direct_fields.values()), "rag_success": sum(x["classification"] == "SUCCESS" for x in rows), "hallucinations": report["anti_hallucination"]["hallucination_count"], "isolation_passed": report["isolation"]["passed"]}, ensure_ascii=False))

if __name__ == "__main__": main()
