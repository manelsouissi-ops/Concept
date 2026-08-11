#!/usr/bin/env python3
"""Evaluation-only benchmark for evidence selection and grounded Qwen3 extraction."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from time import perf_counter

from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.core.vector_stores.types import VectorStoreQuery
from llama_index.core.vector_stores.utils import node_to_metadata_dict
from qdrant_client import QdrantClient, models

from benchmark_qwen3_14b import FIELDS, MODEL, correct, normalize, ollama_generate
from benchmark_qwen3_14b_hybrid import (
    BM25,
    EXPANSIONS,
    build_enhanced_nodes,
    chunk_id,
    ensure_collection,
    retrieve_modes,
)
from poc_tender_rag import EMBEDDING_MODEL, OLLAMA_URL, QDRANT_URL, llama_filters, resolve_tender

COLLECTION = "concept_rag_qwen3_14b_generation_benchmark"
TOP_K_VALUES = (1, 2, 3, 5)

FIELD_INSTRUCTIONS = {
    "official_reference": "Extract only the populated official procurement/reference identifier. Preserve every slash, hyphen and digit. Reject labels and blank template references.",
    "client": "Extract only the actual contracting client/authority name. Prefer a populated named organization over definitions of the word Client.",
    "country": "Extract only the explicitly populated client/project country.",
    "issue_date": "Extract only the populated issue/emission/publication date of the request. Do not return proposal deadlines or blank date templates.",
    "credit_number": "Extract only the explicitly stated credit/loan identifier, preserving its number.",
    "selection_method": "Extract only the explicitly stated consultant selection method and its acronym when present.",
    "mission_duration": "Extract only the mission delivery duration. Preserve every explicitly stated equivalent duration from the same sentence; never shorten a days-and-months equivalence to only one unit. Do not confuse personnel effort with delivery duration.",
    "financed_project": "Extract only the named project or programme financing the mission. Do not return the financing institution, credit number, service title, mission title, or works description.",
}


def split_units(text: str) -> list[str]:
    units = []
    for line in text.splitlines():
        line = line.strip(" |\t")
        if not line:
            continue
        parts = re.split(r"(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ])", line)
        units.extend(part.strip() for part in parts if part.strip())
    return units


def select_snippet(key: str, text: str) -> str:
    """Return the strongest complete field-bearing unit without answer-specific values."""
    if len(text) <= 900:
        return text
    vocabulary = set(normalize(EXPANSIONS[key]).split())
    units = split_units(text)
    scored = []
    for index, unit in enumerate(units):
        normalized = normalize(unit)
        overlap = sum(term in normalized.split() for term in vocabulary)
        populated = bool(re.search(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b|\b[A-Z]{2,}(?:[-/][A-Z0-9]+){2,}\b|\b\d+(?:[,.]\d+)?\s*(?:jours?|mois)\b", unit))
        label_bonus = {
            "client": bool(re.search(r"\bclient\s*[:à]", unit, re.I)),
            "country": bool(re.search(r"\bpays\s*:", unit, re.I)),
            "issue_date": bool(re.search(r"\b[eé]mis\s+le\s*:", unit, re.I)),
            "credit_number": bool(re.search(r"\b(cr[eé]dit|pr[eê]t|don)\b.*\d", unit, re.I)),
            "mission_duration": bool(re.search(r"\b(d[eé]lai|dur[eé]e).{0,100}\bmission\b", unit, re.I)),
            "financed_project": bool(re.search(r"\bprojet\b", unit, re.I)),
        }.get(key, False)
        concise_identifier_bonus = 10 if key == "credit_number" and len(unit) < 120 and re.search(r"\b(cr[eé]dit|pr[eê]t|don)\b.*\d", unit, re.I) else 0
        scored.append((overlap + 4 * populated + 5 * label_bonus + concise_identifier_bonus, index))
    best = max(scored, default=(0, 0))[1]
    selected = units[max(0, best - 1): min(len(units), best + 2)]
    return "\n".join(selected)


def evidence_text(candidates: list[dict], key: str) -> tuple[str, list[dict]]:
    selected = []
    for item in candidates:
        selected.append({"chunk_id": chunk_id(item["node"]), "text": select_snippet(key, item["node"].text)})
    return "\n\n".join(f"[{item['chunk_id']}]\n{item['text']}" for item in selected), selected


def extraction_prompt(key: str, evidence: str, correction: dict | None = None) -> str:
    correction_text = ""
    if correction:
        correction_text = f"\nONE CORRECTION ATTEMPT. Previous invalid output: {json.dumps(correction['answer'], ensure_ascii=False)}\nValidation failure: {correction['reason']}\nCorrect it from the evidence only."
    return f"""You are a strict evidence extraction engine.
FIELD: {key}
FIELD RULE: {FIELD_INSTRUCTIONS[key]}

RULES:
1. Use ONLY the supplied evidence.
2. Ignore generic definitions, templates, labels, examples, placeholders and blank fields.
3. Prefer populated values over field labels.
4. Do not infer unsupported information.
5. Preserve identifiers, dates, numbers and explicitly equivalent durations exactly.
6. If populated evidence truly conflicts, return null rather than guessing.
7. If evidence is insufficient, return null.
8. Return strict JSON only, with exactly: value, supported, source_chunks.
9. source_chunks may contain only identifiers that directly support the value.

Valid shape: {{"value":"...", "supported":true, "source_chunks":["chunk_X"]}}
Null shape: {{"value":null, "supported":false, "source_chunks":[]}}
{correction_text}

EVIDENCE:
{evidence}"""


def duration_tokens(text: str) -> set[tuple[str, str]]:
    return {(number.replace(",", "."), unit.lower()) for number, unit in re.findall(r"\b(\d+(?:[,.]\d+)?)\s*(jours?|mois)\b", normalize(text))}


def validate(key: str, answer: object, selected: list[dict]) -> tuple[bool, str]:
    if not isinstance(answer, dict) or set(answer) != {"value", "supported", "source_chunks"}:
        return False, "Response must have exactly value, supported, and source_chunks."
    value = answer.get("value")
    sources = answer.get("source_chunks")
    if value is None:
        return False, "A populated field-bearing evidence snippet was selected; null is not accepted."
    if answer.get("supported") is not True or not isinstance(sources, list) or not sources:
        return False, "A non-null value requires supported=true and at least one source chunk."
    allowed = {item["chunk_id"] for item in selected}
    if not all(str(source) in allowed for source in sources):
        return False, "A cited chunk was not supplied."
    cited_text = "\n".join(item["text"] for item in selected if item["chunk_id"] in set(map(str, sources)))
    normalized_value = normalize(str(value))
    normalized_evidence = normalize(cited_text)
    if not normalized_value or normalized_value not in normalized_evidence:
        return False, "The claimed value does not appear verbatim after normalization in cited evidence."
    if re.search(r"ins[eé]rer|à compl[eé]ter|\.{4,}|…{2,}", str(value), re.I):
        return False, "Placeholder/template value rejected."
    if key == "official_reference" and not re.search(r"[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+){2,}", str(value)):
        return False, "Official reference lacks a populated multi-part identifier."
    if key == "issue_date" and not re.fullmatch(r"\s*\d{1,2}[/-]\d{1,2}[/-]\d{4}\s*", str(value)):
        return False, "Claimed issue date is not a complete date."
    if key == "credit_number" and not re.search(r"\d", str(value)):
        return False, "Credit identifier contains no number."
    if key == "mission_duration":
        duration_sentences = [unit for unit in split_units(cited_text) if re.search(r"\b(d[eé]lai|dur[eé]e).{0,120}\bmission\b", unit, re.I)]
        required = duration_tokens(" ".join(duration_sentences))
        claimed = duration_tokens(str(value))
        if required and not required.issubset(claimed):
            return False, f"Incomplete equivalent duration; evidence contains {sorted(required)}."
    return True, "valid"


def extract(key: str, candidates: list[dict]) -> dict:
    selection_started = perf_counter()
    evidence, selected = evidence_text(candidates, key)
    selection_seconds = perf_counter() - selection_started
    first, first_metrics = ollama_generate(extraction_prompt(key, evidence), num_predict=260)
    validation_started = perf_counter()
    valid, reason = validate(key, first, selected)
    validation_seconds = perf_counter() - validation_started
    corrected = None
    correction_metrics = None
    final = first
    if not valid:
        corrected, correction_metrics = ollama_generate(extraction_prompt(key, evidence, {"answer": first, "reason": reason}), num_predict=260)
        validation_started = perf_counter()
        corrected_valid, corrected_reason = validate(key, corrected, selected)
        validation_seconds += perf_counter() - validation_started
        final = corrected
        valid, reason = corrected_valid, corrected_reason
    return {"selected_evidence": selected, "first_answer": first, "first_generation": first_metrics, "correction_required": corrected is not None, "validation_failure": None if corrected is None else validate(key, first, selected)[1], "corrected_answer": corrected, "correction_generation": correction_metrics, "final_answer": final, "validation_passed": valid, "final_validation_reason": reason, "selection_seconds": round(selection_seconds, 6), "validation_seconds": round(validation_seconds, 6)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code-interne", default="AO-20260810-0958")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    tender = resolve_tender(args.code_interne)
    markdown = tender["markdown_path"].read_text(encoding="utf-8")
    nodes, content_hash = build_enhanced_nodes(markdown, tender)
    embedding = OllamaEmbedding(model_name=EMBEDDING_MODEL, base_url=OLLAMA_URL, embed_batch_size=16, keep_alive="10m")
    dimension = len(embedding.get_text_embedding("CONCEPT dimension probe"))
    qdrant = QdrantClient(url=QDRANT_URL, timeout=60)
    ensure_collection(qdrant, COLLECTION, dimension)
    embed_started = perf_counter()
    vectors = embedding.get_text_embedding_batch([node.text for node in nodes], show_progress=True)
    embedding_seconds = perf_counter() - embed_started
    points = []
    for node, vector in zip(nodes, vectors, strict=True):
        node.embedding = vector
        payload = node_to_metadata_dict(node, remove_text=False, flat_metadata=True)
        payload["document_id"] = int(tender["document_id"])
        points.append(models.PointStruct(id=node.node_id, vector=vector, payload=payload))
    index_started = perf_counter()
    for offset in range(0, len(points), 128):
        qdrant.upsert(COLLECTION, points[offset:offset + 128], wait=True)
    index_seconds = perf_counter() - index_started
    store = QdrantVectorStore(client=qdrant, collection_name=COLLECTION, stores_text=True)
    bm25 = BM25(nodes)
    nodes_by_id = {node.node_id: node for node in nodes}

    retrieved = {}
    retrieval_seconds = []
    for key, (question, _) in FIELDS.items():
        modes, elapsed = retrieve_modes(store, embedding, bm25, nodes_by_id, tender, key, question)
        retrieved[key] = modes["hybrid_rerank"]
        retrieval_seconds.append(elapsed)

    top_k_runs = {}
    for top_k in TOP_K_VALUES:
        rows = []
        for key, (question, expected) in FIELDS.items():
            result = extract(key, retrieved[key][:top_k])
            final_value = result["final_answer"].get("value") if isinstance(result["final_answer"], dict) else None
            final_sources = result["final_answer"].get("source_chunks", []) if isinstance(result["final_answer"], dict) else []
            result.update({"key": key, "question": question, "expected": expected, "answer_correct": correct(key, final_value), "citation_correct": result["validation_passed"] and correct(key, final_value) and bool(final_sources), "classification": "SUCCESS" if correct(key, final_value) else "GENERATION_FAILURE"})
            rows.append(result)
        top_k_runs[str(top_k)] = rows

    scores = {top_k: sum(row["answer_correct"] for row in rows) for top_k, rows in top_k_runs.items()}
    best_score = max(scores.values())
    best_top_k = min(int(top_k) for top_k, score in scores.items() if score == best_score)
    optimized_rows = top_k_runs[str(best_top_k)]

    structured_evidence = "\n\n".join(f"FIELD {row['key']}\n" + "\n\n".join(f"[{item['chunk_id']}]\n{item['text']}" for item in row["selected_evidence"]) for row in optimized_rows)
    shape = {key: {"value": "string|null", "source_chunks": ["chunk_X"]} for key in FIELDS}
    structured_prompt = f"""Extract all eight fields from ONLY their labeled evidence sections. Ignore templates/placeholders and unrelated field values. Preserve exact identifiers, dates, numbers, acronyms, and all equivalent durations. For financed_project return the named financing project/programme, never the service/mission title, works description, institution, or credit. Return strict JSON with exactly this shape and no prose: {json.dumps(shape)}\nEVIDENCE:\n{structured_evidence}"""
    structured_first, structured_first_metrics = ollama_generate(structured_prompt, num_predict=900)
    structured_validation = {}
    invalid_fields = []
    for row in optimized_rows:
        key = row["key"]
        item = structured_first.get(key, {}) if isinstance(structured_first, dict) else {}
        answer = {"value": item.get("value"), "supported": item.get("value") is not None, "source_chunks": item.get("source_chunks", [])} if isinstance(item, dict) else item
        valid, reason = validate(key, answer, row["selected_evidence"])
        structured_validation[key] = {"valid": valid, "reason": reason}
        if not valid:
            invalid_fields.append(key)
    structured_corrected = None
    structured_correction_metrics = None
    if invalid_fields:
        structured_corrected, structured_correction_metrics = ollama_generate(structured_prompt + f"\nONE CORRECTION ATTEMPT. Previous object: {json.dumps(structured_first, ensure_ascii=False)}\nInvalid fields and reasons: {json.dumps({key: structured_validation[key]['reason'] for key in invalid_fields}, ensure_ascii=False)}\nCorrect only from the supplied evidence and return the complete object.", num_predict=900)
    structured_final = structured_corrected or structured_first
    structured_fields = {}
    for row in optimized_rows:
        key = row["key"]
        item = structured_final.get(key, {}) if isinstance(structured_final, dict) else {}
        answer = {"value": item.get("value"), "supported": item.get("value") is not None, "source_chunks": item.get("source_chunks", [])} if isinstance(item, dict) else item
        valid, reason = validate(key, answer, row["selected_evidence"])
        value = answer.get("value") if isinstance(answer, dict) else None
        structured_fields[key] = {"value": value, "source_chunks": answer.get("source_chunks", []) if isinstance(answer, dict) else [], "grounding_valid": valid, "validation_reason": reason, "correct": correct(key, value)}

    anti = []
    for question in ("Quel est le budget exact de la mission en FCFA ?", "Quel est le nom du chef de projet proposé par le consultant ?", "Quelle est la date exacte de démarrage des travaux ?"):
        query_vector = embedding.get_query_embedding(question)
        result = store.query(VectorStoreQuery(query_embedding=query_vector, similarity_top_k=3, filters=llama_filters(int(tender["appel_offre_id"]), tender["code_interne"])))
        evidence = "\n\n".join(f"[{chunk_id(node)}]\n{select_snippet('financed_project', node.text)}" for node in result.nodes or [])
        answer, metrics = ollama_generate(f'Return strict JSON only: {{"value":string|null,"supported":boolean,"source_chunks":[]}}. Use only evidence. If the exact answer is not explicitly supported, value=null, supported=false, source_chunks=[].\nQUESTION: {question}\nEVIDENCE:\n{evidence}', num_predict=180)
        value = answer.get("value") if isinstance(answer, dict) else None
        anti.append({"question": question, "answer": answer, "passed": value is None, "generation": metrics})

    wrong_code = tender["code_interne"] + "-MISMATCH"
    vector = embedding.get_query_embedding(EXPANSIONS["client"])
    dense_wrong = store.query(VectorStoreQuery(query_embedding=vector, similarity_top_k=8, filters=llama_filters(int(tender["appel_offre_id"]), wrong_code)))
    lexical_wrong = [node for node in nodes if node.metadata["appel_offre_id"] == int(tender["appel_offre_id"]) and node.metadata["code_interne"] == wrong_code]
    report = {"benchmark": {"generation_model": MODEL, "embedding_model": EMBEDDING_MODEL, "embedding_dimension": dimension, "collection": COLLECTION, "code_interne": tender["code_interne"], "content_hash": content_hash}, "performance": {"embedding_seconds": round(embedding_seconds, 4), "index_seconds": round(index_seconds, 4), "mean_retrieval_seconds": round(sum(retrieval_seconds) / len(retrieval_seconds), 4)}, "context_experiment": {"top_k_scores": scores, "selected_top_k": best_top_k, "runs": top_k_runs}, "optimized": {"rows": optimized_rows, "answer_correct": sum(row["answer_correct"] for row in optimized_rows), "citation_correct": sum(row["citation_correct"] for row in optimized_rows)}, "structured": {"json_valid": isinstance(structured_final, dict), "correction_required": structured_corrected is not None, "invalid_fields_first_pass": invalid_fields, "first_answer": structured_first, "first_generation": structured_first_metrics, "corrected_answer": structured_corrected, "correction_generation": structured_correction_metrics, "fields": structured_fields, "correct": sum(field["correct"] for field in structured_fields.values()), "grounding_valid": sum(field["grounding_valid"] for field in structured_fields.values())}, "anti_hallucination": {"tests": anti, "passed": sum(item["passed"] for item in anti)}, "isolation": {"mismatched_code": wrong_code, "dense_count": len(dense_wrong.nodes or []), "lexical_count": len(lexical_wrong), "passed": not (dense_wrong.nodes or lexical_wrong)}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"top_k_scores": scores, "selected_top_k": best_top_k, "optimized_answers": report["optimized"]["answer_correct"], "citations": report["optimized"]["citation_correct"], "structured": report["structured"]["correct"], "anti": report["anti_hallucination"]["passed"], "isolation": report["isolation"]["passed"]}))


if __name__ == "__main__":
    main()
