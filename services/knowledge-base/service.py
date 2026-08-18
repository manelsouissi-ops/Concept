#!/usr/bin/env python3
"""Isolated historical-CDC ingestion service. It never mutates tender state."""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import unicodedata
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

import requests

ROOT = Path(__file__).resolve().parent
PROCESSING_VERSION = os.getenv("KB_PROCESSING_VERSION", "historical-cdc-v1")
DOCLING_ENDPOINT = os.getenv("KB_DOCLING_ENDPOINT", "http://127.0.0.1:8010").rstrip("/")
OLLAMA_ENDPOINT = os.getenv("KB_OLLAMA_ENDPOINT", "http://127.0.0.1:11434").rstrip("/")
GEN_MODEL = os.getenv("KB_GEN_MODEL", "qwen3:14b")
EMBED_MODEL = os.getenv("KB_EMBED_MODEL", "qwen3-embedding:0.6b")
QDRANT_ENDPOINT = os.getenv("KB_QDRANT_ENDPOINT", "http://127.0.0.1:6333").rstrip("/")
QDRANT_COLLECTION = os.getenv("KB_QDRANT_COLLECTION", "concept_historical_cdc")
PG_DSN = os.getenv("KB_PG_DSN") or os.getenv("DATABASE_URL", "")
CHUNK_MAX_CHARS = int(os.getenv("KB_CHUNK_MAX_CHARS", "1800"))
CHUNK_OVERLAP_CHARS = int(os.getenv("KB_CHUNK_OVERLAP_CHARS", "120"))
HTTP_TIMEOUT = float(os.getenv("KB_HTTP_TIMEOUT", "120"))
PARSE_TIMEOUT_SECS = float(os.getenv("KB_PARSE_TIMEOUT_SECS", "1800"))
PARSE_POLL_SECS = float(os.getenv("KB_PARSE_POLL_SECS", "2"))
EMBED_BATCH = int(os.getenv("KB_EMBED_BATCH", "16"))
SCHEMA_PATH = ROOT / "schemas" / "cdc_metadata.schema.json"
PROMPT_PATH = ROOT / "prompts" / "cdc_metadata_extraction.fr.txt"
POINT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "concept.local/historical-cdc/v1")


class StageError(RuntimeError):
    def __init__(self, code: str, stage: str, message: str):
        super().__init__(message)
        self.code, self.stage = code, stage


@dataclass
class Chunk:
    chunk_index: int
    text: str
    section: str | None = None
    subsection: str | None = None
    page: int | None = None


@dataclass
class IngestResult:
    source_path: str
    source_filename: str
    status: str = "PROCESSING"
    sha256: str | None = None
    file_size: int | None = None
    document_id: int | None = None
    document_version_id: int | None = None
    document_key: str | None = None
    docling_job_id: str | None = None
    markdown_chars: int = 0
    metadata_status: str = "pending"
    chunk_count: int = 0
    embedding_count: int = 0
    embedding_dimension: int | None = None
    qdrant_collection: str = QDRANT_COLLECTION
    qdrant_status: str = "pending"
    catalog_status: str = "pending"
    outcome: str | None = None
    error_code: str | None = None
    error_stage: str | None = None
    error_message: str | None = None
    duration_seconds: float = 0
    metadata: dict[str, Any] | None = None
    _started: float = field(default_factory=time.monotonic, repr=False)


def sha256_file(path: str) -> tuple[str, int]:
    digest, size = hashlib.sha256(), 0
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def logical_document_key(filename: str) -> str:
    normalized = unicodedata.normalize("NFKC", Path(filename).name).casefold().strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]


def deterministic_point_id(document_version_id: int | str, sha256: str, chunk_index: int) -> str:
    return str(uuid.uuid5(POINT_NAMESPACE, f"{document_version_id}:{sha256}:{chunk_index}"))


HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def markdown_sections(markdown: str) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    section = subsection = None
    content: list[str] = []

    def flush() -> None:
        body = "\n".join(content).strip()
        if body:
            sections.append({"section": section, "subsection": subsection, "text": body, "page": None})

    for line in markdown.splitlines():
        match = HEADING.match(line)
        if not match:
            content.append(line)
            continue
        flush()
        content.clear()
        level, title = len(match.group(1)), match.group(2).strip()
        if level <= 2:
            section, subsection = title, None
        else:
            subsection = title
    flush()
    return sections or ([{"section": None, "subsection": None, "text": markdown.strip(), "page": None}] if markdown.strip() else [])


def _split_oversized(text: str, maximum: int, overlap: int) -> list[str]:
    """Split without dropping characters; overlap is context duplicated, never replacement."""
    if len(text) <= maximum:
        return [text]
    pieces, start = [], 0
    while start < len(text):
        hard_end = min(start + maximum, len(text))
        end = hard_end
        if hard_end < len(text):
            candidates = [text.rfind(token, start + maximum // 2, hard_end) for token in ("\n", ". ", "; ", " ")]
            end = max(candidates)
            if end <= start:
                end = hard_end
            elif text[end:end + 2] == ". ":
                end += 1
        pieces.append(text[start:end])
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return pieces


def section_aware_chunks(markdown: str, maximum: int = CHUNK_MAX_CHARS, overlap: int = CHUNK_OVERLAP_CHARS) -> list[Chunk]:
    if maximum < 100 or overlap < 0 or overlap >= maximum:
        raise ValueError("invalid chunk limits")
    result: list[Chunk] = []
    for block in markdown_sections(markdown):
        paragraphs = [item for item in re.split(r"\n\s*\n", block["text"]) if item]
        buffer = ""

        def emit(value: str) -> None:
            for piece in _split_oversized(value, maximum, overlap):
                result.append(Chunk(len(result), piece, block["section"], block["subsection"], block["page"]))

        for paragraph in paragraphs:
            candidate = f"{buffer}\n\n{paragraph}" if buffer else paragraph
            if len(candidate) <= maximum:
                buffer = candidate
            else:
                if buffer:
                    emit(buffer)
                buffer = ""
                if len(paragraph) > maximum:
                    emit(paragraph)
                else:
                    buffer = paragraph
        if buffer:
            emit(buffer)
    return result


METADATA_FAMILIES = {
    "identity": ("titre", "projet", "référence", "reference", "pays", "langue", "secteur", "mission"),
    "client_financing": ("client", "maître d'ouvrage", "autorité contractante", "financement", "bailleur", "banque"),
    "procedure": ("sélection", "selection", "publication", "date limite", "soumission", "durée", "duree"),
    "scope": ("étendue", "scope", "composante", "service", "prestation", "exigence technique", "termes de référence"),
    "personnel": ("personnel", "expert", "qualification", "profil", "expérience"),
    "financial_contractual": ("paiement", "financier", "garantie", "assurance", "contrat", "caution"),
}


def select_metadata_evidence(markdown: str, per_family_chars: int = 12000) -> dict[str, str]:
    blocks = markdown_sections(markdown)
    evidence: dict[str, str] = {}
    for family, terms in METADATA_FAMILIES.items():
        ranked = sorted(
            blocks,
            key=lambda block: -sum((block["section"] or "").casefold().count(term) * 4 + block["text"].casefold().count(term) for term in terms),
        )
        selected, used = [], 0
        for block in ranked:
            score = sum((block["section"] or "").casefold().count(term) * 4 + block["text"].casefold().count(term) for term in terms)
            if score == 0:
                continue
            label = " / ".join(filter(None, [block["section"], block["subsection"]])) or "Sans titre"
            fragment = f"## {label}\n{block['text']}"
            remaining = per_family_chars - used
            if remaining <= 0:
                break
            selected.append(fragment[:remaining])
            used += min(len(fragment), remaining)
        evidence[family] = "\n\n".join(selected)
    return evidence


def normalize_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    for key, definition in schema["properties"].items():
        if key not in metadata:
            types = definition.get("type", [])
            metadata[key] = [] if types == "array" else None
    return metadata


def validate_metadata(metadata: dict[str, Any]) -> None:
    import jsonschema
    try:
        jsonschema.validate(metadata, json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))
    except jsonschema.ValidationError as error:
        raise StageError("METADATA_INVALID", "metadata", error.message) from error


def extract_metadata(markdown: str, identity: dict[str, str], session=requests) -> dict[str, Any]:
    evidence = select_metadata_evidence(markdown)
    prompt = PROMPT_PATH.read_text(encoding="utf-8").replace("{EVIDENCE_JSON}", json.dumps(evidence, ensure_ascii=False))
    response = session.post(
        f"{OLLAMA_ENDPOINT}/api/generate",
        json={"model": GEN_MODEL, "prompt": prompt, "format": "json", "stream": False, "options": {"temperature": 0}},
        timeout=HTTP_TIMEOUT * 3,
    )
    response.raise_for_status()
    try:
        metadata = json.loads(response.json()["response"])
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise StageError("METADATA_INVALID", "metadata", f"invalid model JSON: {error}") from error
    metadata = normalize_metadata(metadata)
    metadata.update(identity)
    validate_metadata(metadata)
    return metadata


def poll_docling(path: str, session=requests, sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic) -> tuple[str, str]:
    try:
        with open(path, "rb") as source:
            submitted = session.post(f"{DOCLING_ENDPOINT}/convert", files={"file": (Path(path).name, source, "application/pdf")}, timeout=HTTP_TIMEOUT)
        submitted.raise_for_status()
        job_id = submitted.json().get("job_id")
        if not job_id:
            raise StageError("PARSER_FAILED", "docling_submit", "Docling returned no job_id")
        deadline = clock() + PARSE_TIMEOUT_SECS
        while clock() < deadline:
            result = session.get(f"{DOCLING_ENDPOINT}/result/{job_id}", timeout=HTTP_TIMEOUT)
            result.raise_for_status()
            payload = result.json()
            status = str(payload.get("status", "")).lower()
            if status == "completed":
                markdown = str(payload.get("markdown") or "")
                if not markdown.strip():
                    raise StageError("PARSER_FAILED", "docling_result", "completed job returned empty Markdown")
                return job_id, markdown
            if status == "failed":
                raise StageError("PARSER_FAILED", "docling_result", str(payload.get("error") or "Docling failed"))
            if status != "processing":
                raise StageError("PARSER_FAILED", "docling_result", f"unknown Docling status: {status}")
            sleep(PARSE_POLL_SECS)
        raise StageError("PARSER_TIMEOUT", "docling_poll", f"Docling job {job_id} exceeded {PARSE_TIMEOUT_SECS}s")
    except StageError:
        raise
    except Exception as error:
        raise StageError("PARSER_FAILED", "docling", str(error)) from error


def embed_texts(texts: list[str], session=requests) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start:start + EMBED_BATCH]
        response = session.post(f"{OLLAMA_ENDPOINT}/api/embed", json={"model": EMBED_MODEL, "input": batch}, timeout=HTTP_TIMEOUT * 2)
        response.raise_for_status()
        values = response.json().get("embeddings") or []
        if len(values) != len(batch):
            raise StageError("EMBEDDING_MISMATCH", "embedding", f"expected {len(batch)}, got {len(values)}")
        vectors.extend(values)
    return vectors


def detect_embedding_dimension(session=requests) -> int:
    vectors = embed_texts(["dimension probe"], session)
    if not vectors or not vectors[0]:
        raise StageError("EMBEDDING_FAILED", "embedding", "empty dimension probe")
    return len(vectors[0])


def qdrant_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if os.getenv("KB_QDRANT_API_KEY"):
        headers["api-key"] = os.environ["KB_QDRANT_API_KEY"]
    return headers


def ensure_qdrant_collection(dimension: int, session=requests) -> None:
    url = f"{QDRANT_ENDPOINT}/collections/{QDRANT_COLLECTION}"
    current = session.get(url, headers=qdrant_headers(), timeout=HTTP_TIMEOUT)
    if current.status_code == 200:
        size = current.json()["result"]["config"]["params"]["vectors"]["size"]
        if size != dimension:
            raise StageError("QDRANT_FAILED", "qdrant", f"collection dimension {size} != {dimension}")
        return
    created = session.put(url, headers=qdrant_headers(), json={"vectors": {"size": dimension, "distance": "Cosine"}}, timeout=HTTP_TIMEOUT)
    if created.status_code not in (200, 201):
        raise StageError("QDRANT_FAILED", "qdrant", created.text)
    for key in ("country", "client", "funding_institution", "sector", "project_type", "document_id", "document_version_id", "sha256"):
        indexed = session.put(f"{url}/index", headers=qdrant_headers(), json={"field_name": key, "field_schema": "keyword"}, timeout=HTTP_TIMEOUT)
        if indexed.status_code not in (200, 201):
            raise StageError("QDRANT_FAILED", "qdrant", f"index {key}: {indexed.text}")


def upsert_qdrant(points: list[dict[str, Any]], session=requests) -> None:
    response = session.put(f"{QDRANT_ENDPOINT}/collections/{QDRANT_COLLECTION}/points?wait=true", headers=qdrant_headers(), json={"points": points}, timeout=HTTP_TIMEOUT * 3)
    if response.status_code not in (200, 201):
        raise StageError("QDRANT_FAILED", "qdrant", response.text)


class Catalog:
    def __init__(self, dsn: str = PG_DSN):
        if not dsn:
            raise StageError("CATALOG_FAILED", "catalog", "KB_PG_DSN/DATABASE_URL is required")
        self.dsn = dsn

    def _connect(self):
        try:
            import psycopg
            return psycopg.connect(self.dsn)
        except Exception as error:
            raise StageError("CATALOG_FAILED", "catalog", str(error)) from error

    def begin(self, result: IngestResult) -> dict[str, Any]:
        try:
            with self._connect() as connection, connection.cursor() as cursor:
                cursor.execute("SELECT id, document_id, status FROM knowledge_base.knowledge_document_versions WHERE sha256=%s", (result.sha256,))
                exact = cursor.fetchone()
                if exact and exact[2] == "SUCCESS":
                    return {"duplicate": True, "version_id": exact[0], "document_id": exact[1], "updated": False}
                cursor.execute("SELECT id FROM knowledge_base.knowledge_documents WHERE document_key=%s", (result.document_key,))
                document = cursor.fetchone()
                updated = document is not None
                if not document:
                    cursor.execute("INSERT INTO knowledge_base.knowledge_documents(document_key, filename, source_path) VALUES (%s,%s,%s) RETURNING id", (result.document_key, result.source_filename, result.source_path))
                    document = cursor.fetchone()
                cursor.execute("SELECT coalesce(max(version_number),0)+1 FROM knowledge_base.knowledge_document_versions WHERE document_id=%s", (document[0],))
                version_number = cursor.fetchone()[0]
                cursor.execute("""INSERT INTO knowledge_base.knowledge_document_versions
                    (document_id,version_number,filename,source_path,sha256,file_size,status,processing_version,qdrant_collection)
                    VALUES (%s,%s,%s,%s,%s,%s,'PROCESSING',%s,%s)
                    ON CONFLICT (sha256) DO UPDATE SET status='PROCESSING', error_code=null,error_stage=null,error_message=null
                    RETURNING id""", (document[0], version_number, result.source_filename, result.source_path, result.sha256, result.file_size, PROCESSING_VERSION, QDRANT_COLLECTION))
                version_id = cursor.fetchone()[0]
                cursor.execute("INSERT INTO knowledge_base.knowledge_ingestion_runs(document_id,document_version_id,status) VALUES (%s,%s,'PROCESSING')", (document[0], version_id))
                return {"duplicate": False, "version_id": version_id, "document_id": document[0], "updated": updated}
        except StageError:
            raise
        except Exception as error:
            raise StageError("CATALOG_FAILED", "catalog", str(error)) from error

    def success(self, result: IngestResult, metadata: dict[str, Any]) -> None:
        try:
            with self._connect() as connection, connection.cursor() as cursor:
                cursor.execute("""UPDATE knowledge_base.knowledge_document_versions SET
                    status='SUCCESS', title=%s,country=%s,client=%s,funding_institution=%s,sector=%s,project_type=%s,
                    metadata=%s,chunk_count=%s,embedding_count=%s,embedding_dimension=%s,processed_at=now()
                    WHERE id=%s""", (metadata.get("project_title"), metadata.get("country"), metadata.get("client"), metadata.get("funding_institution"), metadata.get("sector"), metadata.get("project_type"), json.dumps(metadata, ensure_ascii=False), result.chunk_count, result.embedding_count, result.embedding_dimension, result.document_version_id))
                cursor.execute("UPDATE knowledge_base.knowledge_documents SET current_version_id=%s,filename=%s,source_path=%s,updated_at=now() WHERE id=%s", (result.document_version_id, result.source_filename, result.source_path, result.document_id))
                cursor.execute("UPDATE knowledge_base.knowledge_ingestion_runs SET status='SUCCESS',finished_at=now(),chunk_count=%s,embedding_count=%s WHERE document_version_id=%s AND status='PROCESSING'", (result.chunk_count, result.embedding_count, result.document_version_id))
        except Exception as error:
            raise StageError("CATALOG_FAILED", "catalog", str(error)) from error

    def failure(self, result: IngestResult) -> None:
        if not result.document_version_id:
            return
        try:
            with self._connect() as connection, connection.cursor() as cursor:
                cursor.execute("UPDATE knowledge_base.knowledge_document_versions SET status='FAILED',error_code=%s,error_stage=%s,error_message=%s WHERE id=%s", (result.error_code, result.error_stage, result.error_message, result.document_version_id))
                cursor.execute("UPDATE knowledge_base.knowledge_ingestion_runs SET status='FAILED',finished_at=now(),error_code=%s,error_stage=%s,error_message=%s WHERE document_version_id=%s AND status='PROCESSING'", (result.error_code, result.error_stage, result.error_message, result.document_version_id))
        except Exception:
            pass


def quality_gate(result: IngestResult, metadata: dict[str, Any], markdown: str) -> None:
    failures = []
    for name, ok in {
        "sha": bool(result.sha256), "docling": bool(result.docling_job_id and markdown.strip()),
        "metadata": result.metadata_status == "valid", "chunks": result.chunk_count > 0,
        "embedding_count": result.embedding_count == result.chunk_count,
        "qdrant": result.qdrant_status == "ok", "catalog": result.catalog_status == "ok",
    }.items():
        if not ok:
            failures.append(name)
    if failures:
        code = "CATALOG_FAILED" if "catalog" in failures else "QDRANT_FAILED" if "qdrant" in failures else "QUALITY_GATE_FAILED"
        raise StageError(code, "quality", f"failed gates: {', '.join(failures)}")
    validate_metadata(metadata)


def ingest_document(source_path: str, *, catalog: Catalog | None = None, session=requests) -> IngestResult:
    result = IngestResult(source_path=source_path, source_filename=Path(source_path).name)
    catalog = catalog or Catalog()
    try:
        if not Path(source_path).is_file():
            raise StageError("SOURCE_NOT_FOUND", "identity", "source file does not exist")
        result.sha256, result.file_size = sha256_file(source_path)
        result.document_key = logical_document_key(result.source_filename)
        decision = catalog.begin(result)
        result.document_id, result.document_version_id = decision["document_id"], decision["version_id"]
        if decision["duplicate"]:
            result.status = result.outcome = "SKIPPED_DUPLICATE"
            result.catalog_status = "ok"
            return result
        result.outcome = "UPDATED" if decision["updated"] else "PROCESSED"
        result.docling_job_id, markdown = poll_docling(source_path, session=session)
        result.markdown_chars = len(markdown)
        identity = {"document_id": str(result.document_id), "document_version_id": str(result.document_version_id), "source_filename": result.source_filename, "source_path": result.source_path, "source_hash": result.sha256}
        metadata = extract_metadata(markdown, identity, session=session)
        result.metadata, result.metadata_status = metadata, "valid"
        chunks = section_aware_chunks(markdown)
        result.chunk_count = len(chunks)
        vectors = embed_texts([chunk.text for chunk in chunks], session=session)
        result.embedding_count = len(vectors)
        if not vectors or result.embedding_count != result.chunk_count:
            raise StageError("EMBEDDING_MISMATCH", "embedding", "embedding count does not match chunks")
        result.embedding_dimension = len(vectors[0])
        if any(len(vector) != result.embedding_dimension for vector in vectors):
            raise StageError("EMBEDDING_MISMATCH", "embedding", "inconsistent vector dimensions")
        ensure_qdrant_collection(result.embedding_dimension, session=session)
        common = {"document_id": str(result.document_id), "document_version_id": str(result.document_version_id), "sha256": result.sha256, "filename": result.source_filename, "document_type": "historical_cdc", "title": metadata.get("project_title"), "country": metadata.get("country"), "client": metadata.get("client"), "funding_institution": metadata.get("funding_institution"), "sector": metadata.get("sector"), "project_type": metadata.get("project_type")}
        points = [{"id": deterministic_point_id(result.document_version_id, result.sha256, chunk.chunk_index), "vector": vector, "payload": {**common, **asdict(chunk)}} for chunk, vector in zip(chunks, vectors)]
        upsert_qdrant(points, session=session)
        result.qdrant_status = "ok"
        result.catalog_status = "ok"
        catalog.success(result, metadata)
        quality_gate(result, metadata, markdown)
        result.status = "SUCCESS"
    except StageError as error:
        result.status = "FAILED"
        result.error_code, result.error_stage, result.error_message = error.code, error.stage, str(error)
        catalog.failure(result)
    except Exception as error:
        result.status, result.error_code, result.error_stage, result.error_message = "FAILED", "INTERNAL_ERROR", "pipeline", str(error)
        catalog.failure(result)
    finally:
        result.duration_seconds = round(time.monotonic() - result._started, 3)
    return result


def health_payload(session=requests) -> dict[str, Any]:
    checks = {}
    for name, url in {"parser": f"{DOCLING_ENDPOINT}/health", "ollama": f"{OLLAMA_ENDPOINT}/api/tags", "qdrant": f"{QDRANT_ENDPOINT}/collections"}.items():
        try:
            checks[name] = session.get(url, timeout=3).status_code == 200
        except Exception:
            checks[name] = False
    return {"status": "ok" if all(checks.values()) and bool(PG_DSN) else "degraded", "parser": "docling-async", "embedding_model": EMBED_MODEL, "generation_model": GEN_MODEL, "qdrant_collection": QDRANT_COLLECTION, "processing_version": PROCESSING_VERSION, "dependencies": checks, "catalog_configured": bool(PG_DSN)}


def build_app():
    from fastapi import FastAPI
    from pydantic import BaseModel

    class Request(BaseModel):
        source_path: str

    app = FastAPI(title="CONCEPT Historical CDC Knowledge Base", version=PROCESSING_VERSION)

    @app.get("/health")
    def health():
        return health_payload()

    @app.post("/ingest")
    def ingest(request: Request):
        return asdict(ingest_document(request.source_path))

    return app
