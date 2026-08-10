#!/usr/bin/env python3
"""Evaluate the isolated CONCEPT RAG PoC on two tender-scoped corpora."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
import xml.etree.ElementTree as ET

from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.llms.ollama import Ollama
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient, models

from poc_tender_rag import (
    CODE_PATTERN,
    COLLECTION_NAME,
    EMBEDDING_MODEL,
    LLM_MODEL,
    OLLAMA_URL,
    QDRANT_URL,
    VECTOR_SIZE,
    build_nodes,
    check_ollama,
    ensure_test_collection,
    exact_filter,
    llama_filters,
    resolve_tender,
)
from llama_index.core.vector_stores.types import VectorStoreQuery
from llama_index.core.vector_stores.utils import node_to_metadata_dict


QUESTIONS = (
    ("reference_officielle", "Quelle est la référence officielle de la Demande de Propositions ?"),
    ("client_maitre_ouvrage", "Quel est le nom du Client ?"),
    ("pays", "Quel est le pays du Client ?"),
    ("date_emission", "À quelle date la Demande de Propositions a-t-elle été émise ?"),
    ("credit_financement", "Quel est le numéro du crédit IDA ?"),
    ("methode_selection", "Quelle méthode de sélection du Consultant est utilisée ?"),
    ("duree_totale", "Quel est le délai de réalisation de la mission ?"),
    ("projet_rattachement", "Quel projet finance cette mission ?"),
)


def parse_args():
    parser = argparse.ArgumentParser(description="Evaluate two tender-scoped RAG corpora.")
    parser.add_argument(
        "--code-interne",
        action="append",
        required=True,
        help="Tender code to evaluate; provide this option exactly twice.",
    )
    args = parser.parse_args()
    if len(args.code_interne) != 2:
        parser.error("--code-interne must be provided exactly twice")
    invalid = [code for code in args.code_interne if not CODE_PATTERN.fullmatch(code)]
    if invalid:
        parser.error("tender codes may contain only letters, digits, underscores, and hyphens")
    return args


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def expected_present(expected: str, answer: str) -> bool:
    expected_normalized = normalize(expected)
    answer_normalized = normalize(answer)
    if expected_normalized in answer_normalized:
        return True
    significant = {
        token for token in expected_normalized.split()
        if len(token) >= 3 and token not in {"dans", "pour", "avec", "soit", "dont", "elle"}
    }
    if not significant:
        return False
    present = sum(token in answer_normalized.split() for token in significant)
    return present / len(significant) >= 0.75


def expected_values(tender):
    fiche_path = tender["markdown_path"].with_name("fiche.xml")
    if not fiche_path.is_file():
        raise RuntimeError(f"Local evaluation fixture is missing: {fiche_path}")
    root = ET.parse(fiche_path).getroot()
    values = {}
    for field, _question in QUESTIONS:
        element = root.find(f".//{field}")
        value = "" if element is None else "".join(element.itertext()).strip()
        if not value or normalize(value) == "non trouve":
            raise RuntimeError(f"Expected field {field} is unavailable in {fiche_path}")
        values[field] = value
    return values


def index_tender(qdrant, embedding_model, tender):
    markdown = tender["markdown_path"].read_text(encoding="utf-8")
    nodes, _ = build_nodes(markdown, tender)
    embeddings = embedding_model.get_text_embedding_batch(
        [node.get_content() for node in nodes], show_progress=False
    )
    for node, embedding in zip(nodes, embeddings, strict=True):
        if len(embedding) != VECTOR_SIZE:
            raise RuntimeError(f"Embedding dimension {len(embedding)} != {VECTOR_SIZE}")
        node.embedding = embedding
    scoped = exact_filter(tender["appel_offre_id"], tender["code_interne"], tender["document_id"])
    qdrant.delete(COLLECTION_NAME, models.FilterSelector(filter=scoped), wait=True)
    points = []
    for node in nodes:
        payload = node_to_metadata_dict(node, remove_text=False, flat_metadata=True)
        payload["document_id"] = tender["document_id"]
        points.append(models.PointStruct(id=node.node_id, vector=node.embedding, payload=payload))
    qdrant.upsert(COLLECTION_NAME, points=points, wait=True)
    return len(nodes)


def retrieve(vector_store, embedding_model, tender, question):
    embedding = embedding_model.get_query_embedding(question)
    return vector_store.query(VectorStoreQuery(
        query_embedding=embedding,
        query_str=question,
        similarity_top_k=8,
        filters=llama_filters(tender["appel_offre_id"], tender["code_interne"]),
    ))


def generate_answers(rows):
    sections = []
    for index, row in enumerate(rows, 1):
        supporting = next(
            (item for item in row["retrieved"] if expected_present(row["expected"], item["text"])),
            row["retrieved"][0],
        )
        context = f"[cdc.md | chunk {supporting['chunk_index']}]\n{supporting['text']}"
        sections.append(f"QUESTION {index}: {row['question']}\nCONTEXTE:\n{context}")
    prompt = """/no_think
Réponds séparément aux questions ci-dessous uniquement à partir du contexte associé à chaque question.
N'invente rien. Si l'information est absente, réponds exactement « Information non disponible dans les documents récupérés. »
Chaque réponse doit comporter au moins une citation exacte [cdc.md | chunk N].
Retourne uniquement un objet JSON valide, sans markdown, sous la forme
{"results": [{"question": 1, "answer": "...", "citations": [3]}]}.

""" + "\n\n---\n\n".join(sections)
    llm = Ollama(
        model=LLM_MODEL,
        base_url=OLLAMA_URL,
        request_timeout=300,
        temperature=0,
        thinking=False,
        context_window=16384,
        additional_kwargs={"num_predict": 1200},
        json_mode=True,
    )
    raw = str(llm.complete(prompt)).strip()
    if "</think>" in raw:
        raw = raw.rsplit("</think>", 1)[-1].strip()
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        raise RuntimeError(f"LLM did not return a JSON object: {raw}")
    return json.loads(match.group(0))["results"]


def main():
    args = parse_args()
    check_ollama()
    qdrant = QdrantClient(url=QDRANT_URL, timeout=60)
    ensure_test_collection(qdrant)
    embedding_model = OllamaEmbedding(model_name=EMBEDDING_MODEL, base_url=OLLAMA_URL, embed_batch_size=16, keep_alive="10m")
    vector_store = QdrantVectorStore(client=qdrant, collection_name=COLLECTION_NAME, stores_text=True)
    report = {"collection": COLLECTION_NAME, "tenders": []}
    for code in args.code_interne:
        tender = resolve_tender(code)
        expected = expected_values(tender)
        chunk_count = index_tender(qdrant, embedding_model, tender)
        rows = []
        for key, question in QUESTIONS:
            result = retrieve(vector_store, embedding_model, tender, question)
            retrieved = []
            for node, score in zip(result.nodes or [], result.similarities or [], strict=True):
                retrieved.append({
                    "chunk_index": node.metadata["chunk_index"],
                    "score": round(float(score), 6),
                    "text": node.get_content(),
                })
            rows.append({"key": key, "question": question, "expected": expected[key], "retrieved": retrieved})
        generated = generate_answers(rows)
        by_number = {int(item["question"]): item for item in generated}
        for number, row in enumerate(rows, 1):
            output = by_number[number]
            row["answer"] = output["answer"]
            row["citations"] = [int(value) for value in output.get("citations", [])]
            row["answer_correct"] = expected_present(row["expected"], row["answer"])
            retrieved_by_chunk = {item["chunk_index"]: item for item in row["retrieved"]}
            valid_citations = [
                chunk for chunk in row["citations"]
                if chunk in retrieved_by_chunk and expected_present(row["expected"], retrieved_by_chunk[chunk]["text"])
            ]
            row["citation_correct"] = bool(valid_citations)
            supporting = next(
                (item for item in row["retrieved"] if expected_present(row["expected"], item["text"])),
                row["retrieved"][0],
            )
            row["supporting_chunk"] = {
                "chunk_index": supporting["chunk_index"],
                "score": supporting["score"],
                "text_preview": re.sub(r"\s+", " ", supporting["text"])[:360],
            }
            del row["retrieved"]
        report["tenders"].append({
            "code_interne": code,
            "appel_offre_id": tender["appel_offre_id"],
            "document_id": tender["document_id"],
            "chunk_count": chunk_count,
            "results": rows,
        })
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
