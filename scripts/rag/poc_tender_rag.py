#!/usr/bin/env python3
"""Isolated, tender-scoped RAG proof of concept for CONCEPT.

This script reads the Markdown already produced by Marker. It does not parse
PDFs and does not write to PostgreSQL, n8n, or any production workflow.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen
from uuid import NAMESPACE_URL, uuid5

from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import TextNode
from llama_index.core.vector_stores import (
    FilterCondition,
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
)
from llama_index.core.vector_stores.types import VectorStoreQuery
from llama_index.core.vector_stores.utils import node_to_metadata_dict
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.llms.ollama import Ollama
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient, models


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = (REPOSITORY_ROOT / "data").resolve()
ENV_FILE = REPOSITORY_ROOT / ".env.local"
COLLECTION_NAME = "concept_rag_poc"
OLLAMA_URL = "http://127.0.0.1:11434"
QDRANT_URL = "http://127.0.0.1:6333"
EMBEDDING_MODEL = "qwen3-embedding:0.6b"
LLM_MODEL = "qwen3:4b"
VECTOR_SIZE = 1024
DEFAULT_QUESTION = "Quel est l'intitule de la mission, le client et le pays d'execution ?"
CODE_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class PocError(RuntimeError):
    """Expected proof-of-concept failure with a user-readable message."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Index and query one CONCEPT tender in an isolated Qdrant collection."
    )
    parser.add_argument("--code-interne", required=True, help="Tender code, for example AO-YYYYMMDD-NNNN")
    parser.add_argument("--question", default=DEFAULT_QUESTION, help="Question asked after indexing")
    parser.add_argument("--top-k", type=int, default=5, help="Number of chunks to retrieve")
    args = parser.parse_args()
    if not CODE_PATTERN.fullmatch(args.code_interne):
        parser.error("--code-interne may contain only letters, digits, underscores, and hyphens")
    if args.top_k < 1 or args.top_k > 20:
        parser.error("--top-k must be between 1 and 20")
    return args


def read_env_value(key: str) -> str | None:
    existing = os.environ.get(key, "").strip()
    if existing:
        return existing
    if not ENV_FILE.is_file():
        return None
    for raw_line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        current_key, value = line.split("=", 1)
        if current_key.strip() != key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        return value or None
    return None


def resolve_tender(code_interne: str) -> dict[str, Any]:
    database_url = read_env_value("DATABASE_URL")
    if not database_url:
        raise PocError("DATABASE_URL is absent from the environment and .env.local.")

    # code_interne is restricted by CODE_PATTERN before it reaches this query.
    query = f"""
        select row_to_json(result)
        from (
          select
            ao.id as appel_offre_id,
            ao.code as code_interne,
            d.id as document_id,
            d.file_name as source_filename,
            d.storage_path,
            fp.status as fiche_status,
            fp.validated_at::text as fiche_validated_at
          from public.appels_offres ao
          left join public.documents d
            on d.appel_offres_id = ao.id
           and d.kind = 'fiche_markdown'
          left join cdc_fiches.fiches_projet fp
            on fp.code_interne = ao.code
          where ao.code = '{code_interne}'
          limit 1
        ) result;
    """
    try:
        completed = subprocess.run(
            ["psql", database_url, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query],
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as error:
        raise PocError("The psql client is required but was not found.") from error
    except subprocess.CalledProcessError as error:
        detail = error.stderr.strip() or "unknown PostgreSQL error"
        raise PocError(f"Unable to resolve tender metadata: {detail}") from error

    raw = completed.stdout.strip()
    if not raw:
        raise PocError(f"Tender {code_interne} does not exist.")
    record = json.loads(raw)
    if record.get("document_id") is None or not record.get("storage_path"):
        raise PocError(f"Tender {code_interne} has no fiche_markdown document record.")

    markdown_path = Path(record["storage_path"]).resolve()
    expected_path = (DATA_ROOT / code_interne / "cdc.md").resolve()
    if markdown_path != expected_path:
        raise PocError(
            f"Unexpected Markdown storage path for {code_interne}: {markdown_path}"
        )
    if not markdown_path.is_file():
        raise PocError(f"Markdown file does not exist: {markdown_path}")
    record["markdown_path"] = markdown_path
    return record


def get_json(url: str) -> dict[str, Any]:
    try:
        with urlopen(url, timeout=5) as response:
            return json.load(response)
    except (OSError, URLError, json.JSONDecodeError) as error:
        raise PocError(f"Local service unavailable or returned invalid JSON: {url}") from error


def check_ollama() -> None:
    payload = get_json(f"{OLLAMA_URL}/api/tags")
    available = {str(item.get("name")) for item in payload.get("models", [])}
    missing = [model for model in (EMBEDDING_MODEL, LLM_MODEL) if model not in available]
    if missing:
        raise PocError(f"Required Ollama model(s) unavailable: {', '.join(missing)}")


def ensure_test_collection(client: QdrantClient) -> None:
    try:
        collections = {item.name for item in client.get_collections().collections}
    except Exception as error:
        raise PocError(f"Qdrant is unavailable at {QDRANT_URL}: {error}") from error

    if COLLECTION_NAME not in collections:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=models.VectorParams(size=VECTOR_SIZE, distance=models.Distance.COSINE),
        )
        return

    info = client.get_collection(COLLECTION_NAME)
    vector_config = info.config.params.vectors
    if not isinstance(vector_config, models.VectorParams):
        raise PocError(f"Collection {COLLECTION_NAME} does not use a single dense vector.")
    if vector_config.size != VECTOR_SIZE or vector_config.distance != models.Distance.COSINE:
        raise PocError(
            f"Collection {COLLECTION_NAME} has incompatible vector settings: "
            f"size={vector_config.size}, distance={vector_config.distance}."
        )


def exact_filter(appel_offre_id: int, code_interne: str, document_id: int | None = None) -> models.Filter:
    conditions: list[models.FieldCondition] = [
        models.FieldCondition(
            key="appel_offre_id", match=models.MatchValue(value=appel_offre_id)
        ),
        models.FieldCondition(key="code_interne", match=models.MatchValue(value=code_interne)),
    ]
    if document_id is not None:
        conditions.append(
            models.FieldCondition(key="document_id", match=models.MatchValue(value=document_id))
        )
    return models.Filter(must=conditions)


def llama_filters(appel_offre_id: int, code_interne: str) -> MetadataFilters:
    return MetadataFilters(
        filters=[
            MetadataFilter(
                key="appel_offre_id", value=appel_offre_id, operator=FilterOperator.EQ
            ),
            MetadataFilter(key="code_interne", value=code_interne, operator=FilterOperator.EQ),
        ],
        condition=FilterCondition.AND,
    )


def build_nodes(markdown: str, tender: dict[str, Any]) -> tuple[list[TextNode], str]:
    splitter = SentenceSplitter(chunk_size=700, chunk_overlap=100)
    chunks = [chunk.strip() for chunk in splitter.split_text(markdown) if chunk.strip()]
    if not chunks:
        raise PocError("Marker Markdown is empty after deterministic chunking.")

    content_hash = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    nodes: list[TextNode] = []
    for chunk_index, text in enumerate(chunks):
        metadata = {
            "appel_offre_id": int(tender["appel_offre_id"]),
            "code_interne": tender["code_interne"],
            "document_id": int(tender["document_id"]),
            "document_type": "cdc_markdown",
            "source_filename": tender["source_filename"],
            "chunk_index": chunk_index,
            "page_number": None,
            "content_hash": content_hash,
            "fiche_status": tender.get("fiche_status"),
            "fiche_validated_at": tender.get("fiche_validated_at"),
        }
        node_id = str(
            uuid5(
                NAMESPACE_URL,
                f"concept-rag-poc:{tender['appel_offre_id']}:{tender['code_interne']}:"
                f"{tender['document_id']}:{content_hash}:{chunk_index}",
            )
        )
        nodes.append(TextNode(id_=node_id, text=text, metadata=metadata))
    return nodes, content_hash


def retrieve(
    vector_store: QdrantVectorStore,
    embedding_model: OllamaEmbedding,
    question: str,
    appel_offre_id: int,
    code_interne: str,
    top_k: int,
):
    retrieval_query = (
        f"{question}\n"
        "Informations spécifiques de la demande de propositions : titre exact des services "
        "de consultant, agence d'exécution du Client et pays du projet."
    )
    query_embedding = embedding_model.get_query_embedding(retrieval_query)
    return vector_store.query(
        VectorStoreQuery(
            query_embedding=query_embedding,
            query_str=question,
            similarity_top_k=top_k,
            filters=llama_filters(appel_offre_id, code_interne),
        )
    )


def grounded_answer(question: str, result: Any) -> str:
    context_parts = []
    for node in result.nodes or []:
        metadata = node.metadata
        context_parts.append(
            f"[cdc.md | chunk {metadata['chunk_index']}]\n{node.get_content()}"
        )
    context = "\n\n---\n\n".join(context_parts)
    prompt = f"""Tu réponds à une question sur un appel d'offres.

Règles strictes :
- Utilise uniquement le contexte récupéré ci-dessous.
- N'invente aucune information.
- Si l'information demandée est absente, réponds exactement :
  Information non disponible dans les documents récupérés.
- Préserve la langue originale des informations lorsque c'est possible.
- Ajoute les citations pertinentes sous la forme [cdc.md | chunk N].
- Réponds directement, sans afficher ton raisonnement ou tes étapes de réflexion.

Question :
{question}

Contexte récupéré :
{context}
"""
    llm = Ollama(
        model=LLM_MODEL,
        base_url=OLLAMA_URL,
        request_timeout=240.0,
        temperature=0.0,
        thinking=False,
    )
    answer = str(llm.complete(prompt)).strip()
    if "</think>" in answer:
        answer = answer.rsplit("</think>", 1)[-1].strip()
    answer = re.sub(r"<think>[\s\S]*?</think>", "", answer, flags=re.IGNORECASE).strip()
    return answer


def main() -> int:
    args = parse_args()
    tender = resolve_tender(args.code_interne)
    check_ollama()

    qdrant = QdrantClient(url=QDRANT_URL, timeout=30)
    ensure_test_collection(qdrant)

    markdown = tender["markdown_path"].read_text(encoding="utf-8")
    nodes, content_hash = build_nodes(markdown, tender)
    embedding_model = OllamaEmbedding(
        model_name=EMBEDDING_MODEL,
        base_url=OLLAMA_URL,
        embed_batch_size=16,
        keep_alive="10m",
    )
    probe = embedding_model.get_text_embedding("CONCEPT embedding dimension verification")
    if len(probe) != VECTOR_SIZE:
        raise PocError(
            f"Embedding model returned {len(probe)} dimensions; expected {VECTOR_SIZE}."
        )

    embeddings = embedding_model.get_text_embedding_batch(
        [node.get_content() for node in nodes], show_progress=True
    )
    for node, embedding in zip(nodes, embeddings, strict=True):
        if len(embedding) != VECTOR_SIZE:
            raise PocError(f"Chunk embedding has {len(embedding)} dimensions; expected {VECTOR_SIZE}.")
        node.embedding = embedding

    tender_filter = exact_filter(
        int(tender["appel_offre_id"]), tender["code_interne"], int(tender["document_id"])
    )
    qdrant.delete(
        collection_name=COLLECTION_NAME,
        points_selector=models.FilterSelector(filter=tender_filter),
        wait=True,
    )

    points = []
    for node in nodes:
        payload = node_to_metadata_dict(node, remove_text=False, flat_metadata=True)
        # LlamaIndex reserves "document_id" for its own relationship identifier.
        # Restore CONCEPT's numeric document ID after building the compatible
        # node payload so retrieval can still reconstruct TextNode instances.
        payload["document_id"] = int(tender["document_id"])
        points.append(
            models.PointStruct(id=node.node_id, vector=node.get_embedding(), payload=payload)
        )
    qdrant.upsert(collection_name=COLLECTION_NAME, points=points, wait=True)

    vector_store = QdrantVectorStore(
        client=qdrant,
        collection_name=COLLECTION_NAME,
        stores_text=True,
    )

    indexed_count = qdrant.count(
        collection_name=COLLECTION_NAME, count_filter=tender_filter, exact=True
    ).count
    if indexed_count != len(nodes):
        raise PocError(f"Qdrant contains {indexed_count} scoped points; expected {len(nodes)}.")

    result = retrieve(
        vector_store,
        embedding_model,
        args.question,
        int(tender["appel_offre_id"]),
        tender["code_interne"],
        args.top_k,
    )
    if not result.nodes:
        raise PocError("Filtered retrieval returned no chunks for the selected tender.")

    fake_code = f"{tender['code_interne']}-ISOLATION-PROBE"
    negative = retrieve(
        vector_store,
        embedding_model,
        args.question,
        int(tender["appel_offre_id"]),
        fake_code,
        args.top_k,
    )
    if negative.nodes:
        raise PocError("NEGATIVE ISOLATION TEST FAILED: mismatched code_interne returned chunks.")

    answer = grounded_answer(args.question, result)
    collection = qdrant.get_collection(COLLECTION_NAME)

    print("\n=== CONCEPT RAG POC ===")
    print(f"Tender: {tender['code_interne']} (appel_offre_id={tender['appel_offre_id']})")
    print(f"Document: {tender['source_filename']} (document_id={tender['document_id']})")
    print(f"Markdown: {tender['markdown_path']}")
    print(f"Content SHA-256: {content_hash}")
    print(f"Collection: {COLLECTION_NAME} | vectors={VECTOR_SIZE} | distance=Cosine")
    print(f"Chunks indexed for tender/document: {indexed_count}")
    print(f"Collection points total: {collection.points_count}")
    print(f"\nQuestion: {args.question}")
    print("\nRetrieved chunks:")
    similarities = result.similarities or [None] * len(result.nodes)
    for rank, (node, score) in enumerate(zip(result.nodes, similarities, strict=True), start=1):
        metadata = node.metadata
        preview = node.get_content().replace("\n", " ")[:500]
        score_label = "n/a" if score is None else f"{score:.6f}"
        print(
            f"\n#{rank} score={score_label} citation=[cdc.md | chunk {metadata['chunk_index']}]"
        )
        print(f"metadata={json.dumps(metadata, ensure_ascii=False, sort_keys=True)}")
        print(f"text={preview}{'…' if len(node.get_content()) > 500 else ''}")

    print("\nFinal grounded answer:")
    print(answer)
    print("\nNegative isolation test:")
    print(
        f"PASS — filters appel_offre_id={tender['appel_offre_id']} and "
        f"code_interne={fake_code} returned 0 chunks."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PocError as error:
        print(f"RAG POC ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error
