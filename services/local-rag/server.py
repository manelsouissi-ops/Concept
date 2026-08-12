#!/usr/bin/env python3
"""Controlled local-RAG HTTP boundary for CDC extraction shadow evaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import traceback
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter
from urllib.request import urlopen

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "scripts" / "rag"))

from llama_index.embeddings.ollama import OllamaEmbedding  # noqa: E402
from llama_index.vector_stores.qdrant import QdrantVectorStore  # noqa: E402
from llama_index.core.vector_stores.utils import node_to_metadata_dict  # noqa: E402
from qdrant_client import QdrantClient, models  # noqa: E402

from benchmark_qwen3_14b import MODEL, ollama_generate  # noqa: E402
from benchmark_qwen3_14b_hybrid import (  # noqa: E402
    BM25,
    build_enhanced_nodes,
    ensure_collection,
    populated_value_score,
    retrieve_modes,
    section_route_score,
)
from poc_tender_rag import (  # noqa: E402
    DATA_ROOT,
    EMBEDDING_MODEL,
    OLLAMA_URL,
    QDRANT_URL,
    resolve_tender,
)
from canonical import (  # noqa: E402
    EVALUATION_FIELDS,
    EXTRACTION_FIELDS,
    FIELD_GROUPS,
    FIELD_QUERIES,
    FIELD_ROUTES,
    FIELD_RULES,
    build_xml,
    deterministic_control,
    validate_canonical_xml,
    validate_field,
)

CONTRACT_VERSION = "local-cdc-shadow.v1"
COLLECTION_PREFIX = "concept_local_rag_shadow"
MAX_BODY_BYTES = 2 * 1024 * 1024
XML_FIELD_MAP = {key: key for key in EXTRACTION_FIELDS}
_EXTRACTION_LOCK = threading.Lock()
_LOG_LOCK = threading.Lock()


class ServiceError(RuntimeError):
    def __init__(self, message: str, *, code: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ServiceError(f"{name} is required.", code="SERVICE_CONFIGURATION_ERROR", status=500)
    return value


def validate_request(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ServiceError("JSON object required.", code="INVALID_REQUEST")
    required = ("contract_version", "appel_offre_id", "code_interne", "document_id", "markdown_path", "markdown_content_hash")
    for key in required:
        if key not in payload:
            raise ServiceError(f"Missing field: {key}", code="INVALID_REQUEST")
    if payload["contract_version"] != CONTRACT_VERSION:
        raise ServiceError("Unsupported local RAG contract version.", code="INVALID_CONTRACT_VERSION", status=409)
    code = str(payload["code_interne"])
    if not re.fullmatch(r"[A-Za-z0-9_-]+", code):
        raise ServiceError("Invalid code_interne.", code="INVALID_TENDER_IDENTITY")
    expected_path = (DATA_ROOT / code / "cdc.md").resolve()
    supplied_path = Path(str(payload["markdown_path"])).resolve()
    if supplied_path != expected_path or not supplied_path.is_file():
        raise ServiceError("Markdown path does not match the tender boundary.", code="TENDER_DOCUMENT_MISMATCH", status=409)
    markdown = supplied_path.read_text(encoding="utf-8")
    digest = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    supplied_hash = str(payload["markdown_content_hash"]).removeprefix("sha256:")
    if not re.fullmatch(r"[a-f0-9]{64}", supplied_hash) or digest != supplied_hash:
        raise ServiceError("Markdown hash mismatch.", code="MARKDOWN_INTEGRITY_MISMATCH", status=409)
    tender = resolve_tender(code)
    if int(payload["appel_offre_id"]) != int(tender["appel_offre_id"]) or int(payload["document_id"]) != int(tender["document_id"]):
        raise ServiceError("Tender/document metadata mismatch.", code="TENDER_DOCUMENT_MISMATCH", status=409)
    if tender["markdown_path"] != supplied_path:
        raise ServiceError("Persisted document does not belong to the tender.", code="TENDER_DOCUMENT_MISMATCH", status=409)
    return {"payload": payload, "tender": tender, "markdown": markdown, "sha256": digest}


def collection_name(tender: dict, digest: str) -> str:
    return f"{COLLECTION_PREFIX}_{int(tender['appel_offre_id'])}_{digest[:12]}"


def compact_field_snippet(key: str, text_value: str, heading: str | None) -> str:
    """Keep field-bearing units while preserving compact table relationships."""
    if len(text_value) <= 1800 or text_value.lstrip().startswith("|") or "\n|" in text_value:
        return text_value[:3200]
    route = FIELD_ROUTES[key]
    anchors = tuple(anchor.lower() for anchor in route[2])
    units = [unit.strip() for unit in re.split(r"\n+|(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ])", text_value) if unit.strip()]
    scored = []
    for index, unit in enumerate(units):
        normalized = normalize_for_compare(unit)
        score = sum(3 for anchor in anchors if normalize_for_compare(anchor) in normalized)
        score += int(bool(re.search(r"\d|\b(?:IDA|SFQC|PTC|PTS|SBN|VBG|EAS|HS)\b", unit)))
        scored.append((score, index))
    best = sorted(scored, key=lambda item: (-item[0], item[1]))[:3]
    selected_indexes = sorted({near for _, index in best for near in range(max(0, index - 1), min(len(units), index + 2))})
    body = "\n".join(units[index] for index in selected_indexes)
    prefix = f"SECTION: {heading}\n" if heading else ""
    return (prefix + body)[:3200]


def select_field_candidates(key: str, ranked: list[dict], nodes: list) -> list[dict]:
    """Select bounded structural continuations without changing global retrieval Top-K."""
    limit = 1 if key in {"contraintes_site", "exigences_es"} else 2
    structural_limits = {
        "zone_execution": 4,
        "volume_hommes_mois": 4,
        "nombre_profils_experts": 5,
        "profils_cles": 5,
        "disciplines_techniques": 5,
        "phases_mission": 4,
        "livrables_principaux": 4,
        "nombre_livrables_structurants": 4,
        "moyens_materiels": 3,
        "normes_referentiels": 3,
        "points_techniques_structurants": 3,
    }
    selected = []

    def add(item: dict) -> None:
        if all(existing["node"].node_id != item["node"].node_id for existing in selected):
            selected.append(item)

    # A populated structural clause is authoritative over nearby templates.
    populated = [node for node in nodes if populated_value_score(key, node.text) > 0]
    populated.sort(key=lambda node: (-section_route_score(key, node)[0], str(node.node_id)))
    scalar_populated_fields = {
        "intitule_mission", "client_maitre_ouvrage", "pays", "zone_execution", "projet_rattachement",
        "credit_financement", "nature_prestation", "type_proposition", "type_contrat",
        "date_emission", "date_limite_depot", "ponderation_technique_financiere",
        "methode_selection", "duree_totale", "volume_hommes_mois",
    }
    for node in populated[:1 if key in scalar_populated_fields else 2]:
        existing = next((item for item in ranked if item["node"].node_id == node.node_id), None)
        add(existing or {"node": node, **section_route_score(key, node)[1], "dense_rank": None, "lexical_rank": None, "routed_rank": None, "fused_rank": None, "reranked_rank": None})

    if not populated or key not in scalar_populated_fields:
        for item in ranked[:limit]:
            add(item)

    if key == "zone_execution":
        continuations = [node for node in nodes if node.metadata.get("chunk_profile") == "structured_section" and node.metadata.get("section_family") == "sites" and not re.search(r"D[eé]signation des experts|Qualification|Temps de mobilisation", node.text, re.I)]
    elif key in {"volume_hommes_mois", "nombre_profils_experts", "profils_cles", "disciplines_techniques"}:
        continuations = [node for node in nodes if node.metadata.get("chunk_profile") == "compact_table" and re.search(
            r"D[eé]signation des experts|Total Personnel cl[eé]|Temps de mobilisation|Composition de l.[eé]quipe",
            node.text, re.I,
        )]
    elif key in {"livrables_principaux", "nombre_livrables_structurants", "phases_mission"}:
        continuations = [node for node in nodes if node.metadata.get("chunk_profile") in {"compact_table", "structured_section"} and re.search(
            r"Rapport de d[eé]marrage|rapport final|livrables?|production des rapports|phase (?:des travaux|pr[eé]paratoire|de garantie)",
            node.text, re.I,
        ) and not re.search(r"FORMULAIRE TECH-5|liste des livrables/t[aâ]ches", node.text, re.I)]
    elif key in structural_limits:
        primary = set(FIELD_ROUTES[key][0])
        continuations = [node for node in nodes if node.metadata.get("section_family") in primary and section_route_score(key, node)[0] > 0]
    else:
        continuations = []
    if key == "contraintes_site":
        constraints = [node for node in nodes if re.search(
            r"ravinement|[eé]rosion r[eé]gressive|inondation|occupations anarchiques|d[eé]p[oô]ts sauvages|sites? (?:sont|[eé]tant) ind[eé]pendants|d[eé]calage de .{0,20} mois|maintien du service",
            node.text, re.I,
        )]
        constraints.sort(key=lambda node: (-section_route_score(key, node)[0], str(node.node_id)))
        selected = []
        for node in constraints[:1]:
            existing = next((item for item in ranked if item["node"].node_id == node.node_id), None)
            add(existing or {"node": node, **section_route_score(key, node)[1], "dense_rank": None, "lexical_rank": None, "routed_rank": None, "fused_rank": None, "reranked_rank": None})
    continuations.sort(key=lambda node: (str(node.metadata.get("section_heading") or ""), str(node.metadata.get("chunk_index"))))
    for node in continuations:
        if len(selected) >= structural_limits.get(key, limit):
            break
        existing = next((item for item in ranked if item["node"].node_id == node.node_id), None)
        add(existing or {"node": node, **section_route_score(key, node)[1], "dense_rank": None, "lexical_rank": None, "routed_rank": None, "fused_rank": None, "reranked_rank": None})
    return selected[:structural_limits.get(key, limit)]


def group_prompt(group: str, fields: tuple[str, ...], evidence: dict[str, str], correction: str | None = None) -> str:
    schema = {key: {"value": "extracted value", "supported": True, "source_chunks": ["chunk_id"]} for key in fields}
    rules = "\n".join(f"- {key}: {FIELD_RULES[key]}" for key in fields)
    focused_guards = {
        "type_procedure": "An official populated heading 'Demande de Propositions Services de Consultants' directly supports the procedure value 'Demande de Propositions (DP) / Services de Consultants'.",
        "type_proposition": "Return only the single type explicitly required by the populated 15.2 clause; never return PTC and PTS alternatives together.",
        "note_technique_minimale": "Return the complete explicit minimum score including 'points'; reject maximum criterion scores and T/F weighting.",
        "disciplines_techniques": "Convert profile labels to their exact specialty terms by removing role prefixes: 'Ingénieur génie civil' becomes 'génie civil', 'Expert Hydraulicien' becomes 'Hydraulicien', and 'Architecte Paysagiste' becomes 'Paysagiste'. Do not output Expert, Ingénieur, Architecte, or Chef de Mission.",
        "contraintes_site": "Return only adverse site conditions/problems (for example erosion, ravinement, flooding, occupation or waste), not neutral locations, dimensions, drainage inputs or geographic descriptions.",
        "exigences_es": "Return project/contract E&S duties only. Never return expert education, profile, years, missions or scoring criteria.",
    }
    focused = "\n".join(f"- {key}: {focused_guards[key]}" for key in fields if key in focused_guards)
    correction_text = f"\nONE CORRECTION ATTEMPT. Fix: {correction}" if correction else ""
    evidence_text = "\n\n".join(f"[{chunk_id}]\n{text}" for chunk_id, text in evidence.items())
    return f"""You are a strict evidence extraction engine for the {group} domain.
Return strict JSON only, with exactly these top-level keys and exact nested shapes:
{json.dumps(schema, ensure_ascii=False)}

FIELD RULES:
{rules}
FOCUSED SEMANTIC GUARDS:
{focused or '- none'}

RULES:
1. Use only the supplied tender evidence and cite only supplied chunk identifiers.
2. Reject templates, labels, examples, placeholders and blank values.
3. Never infer a value. For insufficient or conflicting evidence return value=null, supported=false, source_chunks=[].
4. A populated value requires supported=true and direct source_chunks.
5. Preserve identifiers, dates, numbers and units. Lists remain concise strings.
6. For list or synthesized fields, return every directly supported item visible in the evidence; a supported partial list is preferable to null, but never claim it is exhaustive.
7. The displayed shape is illustrative: replace chunk_id with actual supplied identifiers. Do not copy the words "extracted value".
8. Do not output explanations, reasoning, Markdown or extra keys.{correction_text}

EVIDENCE:
{evidence_text}"""


def extract_group(group: str, fields: tuple[str, ...], evidence: dict[str, str]) -> tuple[dict, dict]:
    started = perf_counter()
    answer, first_metrics = ollama_generate(group_prompt(group, fields, evidence), num_predict=1800)
    failures = []
    if not isinstance(answer, dict) or set(answer) != set(fields):
        failures.append("top-level keys must exactly match the requested group")
    else:
        for key in fields:
            valid, reason = validate_field(key, answer[key], evidence)
            if not valid:
                failures.append(f"{key}: {reason}")
    corrected = None
    correction_metrics = None
    if failures:
        corrected, correction_metrics = ollama_generate(group_prompt(group, fields, evidence, "; ".join(failures)), num_predict=1800)
        answer = corrected
        failures = []
        if not isinstance(answer, dict) or set(answer) != set(fields):
            failures.append("top-level keys must exactly match the requested group")
        else:
            for key in fields:
                valid, reason = validate_field(key, answer[key], evidence)
                if not valid:
                    failures.append(f"{key}: {reason}")
    deterministic_fallback = False
    # E&S contractual obligations are sometimes refused by Qwen even at
    # temperature=0. After the single correction fails, copy only an exact
    # obligation sentence from the cited Top-1 evidence and validate it again.
    if failures and fields == ("exigences_es",):
        for source, text_value in evidence.items():
            sentences = re.split(r"(?<=[.!?])\s+|\n+", text_value)
            exact = next((sentence.strip() for sentence in sentences if re.search(
                r"incorpore des dispositions pour refl[eé]ter le Cadre Environnemental et Social|doit soumettre son Code de Conduite|ne doit pas employer ou engager le travail forc[eé]|travail des enfants",
                sentence, re.I,
            )), None)
            if not exact:
                continue
            fallback = {"value": exact, "supported": True, "source_chunks": [source]}
            valid, reason = validate_field("exigences_es", fallback, evidence)
            if valid:
                answer = {"exigences_es": fallback}
                failures = []
                deterministic_fallback = True
                break
    if failures and fields == ("contraintes_site",):
        for source, text_value in evidence.items():
            sentences = re.split(r"(?<=[.!?])\s+|\n+", text_value)
            exact = next((sentence.strip() for sentence in sentences if re.search(
                r"ravinement|[eé]rosion r[eé]gressive|inondation|occupations anarchiques|d[eé]p[oô]ts sauvages|sites? (?:sont|[eé]tant) ind[eé]pendants|d[eé]calage de .{0,20} mois|maintien du service",
                sentence, re.I,
            )), None)
            if not exact:
                continue
            fallback = {"value": exact, "supported": True, "source_chunks": [source]}
            valid, _reason = validate_field("contraintes_site", fallback, evidence)
            if valid:
                answer = {"contraintes_site": fallback}
                failures = []
                deterministic_fallback = True
                break
    return answer if isinstance(answer, dict) else {}, {
        "validation_failures": failures,
        "correction_required": corrected is not None,
        "first_generation": first_metrics,
        "correction_generation": correction_metrics,
        "deterministic_fallback": deterministic_fallback,
        "wall_ms": round((perf_counter() - started) * 1000, 3),
    }


def evaluation_prompt(fields: dict) -> str:
    facts = {key: item["value"] for key, item in fields.items() if item["value"] is not None}
    shape = {
        "complexite_technique": {"note": 1, "justification": ""},
        "difficulte_terrain": {"note": 1, "justification": ""},
        "risque_sous_dimensionnement": {"note": 1, "charge_estimee": "", "justification": ""},
    }
    return f"""Evaluate these extracted CDC facts. Return strict JSON only and exactly this shape: {json.dumps(shape, ensure_ascii=False)}
Scores are integers 1 (low) to 5 (very high). Complexity considers disciplines/methods/deliverables. Terrain difficulty considers sites and constraints. Under-sizing risk compares duration, expert-months, profiles, sites and deliverables. Justifications must cite only facts present below, without inventing numbers. charge_estimee describes the documented charge and any evidence-grounded tension; do not invent a replacement estimate.
FACTS: {json.dumps(facts, ensure_ascii=False)}"""


def validate_evaluations(value: object) -> tuple[bool, str]:
    if not isinstance(value, dict) or set(value) != set(EVALUATION_FIELDS):
        return False, "evaluation keys invalid"
    for key in EVALUATION_FIELDS:
        item = value[key]
        expected = {"note", "justification", "charge_estimee"} if key == "risque_sous_dimensionnement" else {"note", "justification"}
        if not isinstance(item, dict) or set(item) != expected:
            return False, f"evaluation shape invalid: {key}"
        if not isinstance(item["note"], int) or not 1 <= item["note"] <= 5 or not str(item["justification"]).strip():
            return False, f"evaluation content invalid: {key}"
        if key == "risque_sous_dimensionnement" and not str(item["charge_estimee"]).strip():
            return False, "charge_estimee missing"
    return True, "valid"


def run_extraction(validated: dict) -> dict:
    tender = validated["tender"]
    markdown = validated["markdown"]
    total_started = perf_counter()
    nodes, content_hash = build_enhanced_nodes(markdown, tender)
    embedding = OllamaEmbedding(model_name=EMBEDDING_MODEL, base_url=OLLAMA_URL, embed_batch_size=16, keep_alive="10m")
    dimension = len(embedding.get_text_embedding("CONCEPT local RAG dimension probe"))
    qdrant = QdrantClient(url=QDRANT_URL, timeout=60)
    current_collection = collection_name(tender, content_hash)
    ensure_collection(qdrant, current_collection, dimension)
    embed_started = perf_counter()
    vectors = embedding.get_text_embedding_batch([node.text for node in nodes])
    embedding_ms = round((perf_counter() - embed_started) * 1000, 3)
    points = []
    for node, vector in zip(nodes, vectors, strict=True):
        node.embedding = vector
        metadata = node_to_metadata_dict(node, remove_text=False, flat_metadata=True)
        metadata["document_id"] = int(tender["document_id"])
        points.append(models.PointStruct(id=node.node_id, vector=vector, payload=metadata))
    for offset in range(0, len(points), 128):
        qdrant.upsert(current_collection, points[offset:offset + 128], wait=True)
    store = QdrantVectorStore(client=qdrant, collection_name=current_collection, stores_text=True)
    bm25 = BM25(nodes)
    nodes_by_id = {node.node_id: node for node in nodes}
    fields = {}
    field_evidence = {}
    retrieval_audit = {}
    retrieval_ms = 0.0
    routing_ms = 0.0
    generation_ms = 0.0
    for key in EXTRACTION_FIELDS:
        question = FIELD_QUERIES[key]
        modes, retrieval_seconds = retrieve_modes(store, embedding, bm25, nodes_by_id, tender, key, question)
        retrieval_ms += retrieval_seconds * 1000
        routing_started = perf_counter()
        # These two semantic fields are harmed by merging unrelated evidence:
        # one strongest obligation/constraint snippet is safer than Top-2.
        selected_candidates = select_field_candidates(key, modes["hybrid_rerank"], nodes)
        field_evidence[key] = {}
        retrieval_audit[key] = []
        for item in selected_candidates:
            node = item["node"]
            source_id = f"chunk_{node.metadata['chunk_index']}"
            snippet = compact_field_snippet(key, node.text, node.metadata.get("section_heading"))
            field_evidence[key][source_id] = snippet
            retrieval_audit[key].append({
                "chunk_id": source_id, "section_family": item.get("section_family"),
                "heading": node.metadata.get("section_heading"), "chunk_profile": node.metadata.get("chunk_profile"),
                "dense_rank": item.get("dense_rank"), "lexical_rank": item.get("lexical_rank"),
                "routed_rank": item.get("routed_rank"),
                "fused_rank": item.get("fused_rank"), "section_boost": item.get("section_boost"),
                "anchor_boost": item.get("anchor_boost"), "final_rank": item.get("reranked_rank"),
                "excerpt": snippet[:700],
            })
        routing_ms += (perf_counter() - routing_started) * 1000
    group_metrics = {}
    invalid = []
    for group, group_fields in FIELD_GROUPS.items():
        group_metrics[group] = {"fields": {}, "wall_ms": 0.0, "correction_count": 0}
        for key in group_fields:
            answer, metrics = extract_group(group, (key,), field_evidence[key])
            group_metrics[group]["fields"][key] = metrics
            group_metrics[group]["wall_ms"] += metrics["wall_ms"]
            group_metrics[group]["correction_count"] += int(metrics["correction_required"])
            generation_ms += metrics["wall_ms"]
            if metrics["validation_failures"]:
                invalid.extend(metrics["validation_failures"])
                continue
            fields[key] = {**answer[key], "validation_passed": True, "correction_required": metrics["correction_required"]}
    if invalid:
        raise ServiceError(f"Local grounding validation failed: {', '.join(invalid)}", code="LOCAL_VALIDATION_FAILED", status=422)
    evaluations, evaluation_metrics = ollama_generate(evaluation_prompt(fields), num_predict=900)
    valid_evaluations, evaluation_reason = validate_evaluations(evaluations)
    generation_ms += evaluation_metrics["wall_seconds"] * 1000
    if not valid_evaluations:
        raise ServiceError(f"Local evaluation validation failed: {evaluation_reason}", code="LOCAL_VALIDATION_FAILED", status=422)
    control = deterministic_control(fields)
    canonical_xml = build_xml(tender["code_interne"], fields, evaluations, control)
    try:
        validate_canonical_xml(canonical_xml)
    except (ValueError, ET.ParseError) as error:
        raise ServiceError(f"Canonical XML validation failed: {error}", code="CANONICAL_XML_INVALID", status=422) from error
    return {
        "contract_version": CONTRACT_VERSION,
        "provider": "local",
        "generation_model": MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "appel_offre_id": int(tender["appel_offre_id"]),
        "code_interne": tender["code_interne"],
        "document_id": int(tender["document_id"]),
        "markdown_content_hash": f"sha256:{content_hash}",
        "fields": fields,
        "evaluations": evaluations,
        "control": control,
        "canonical_xml": canonical_xml,
        "retrieval_audit": retrieval_audit,
        "validation": {"passed": True, "invalid_fields": [], "unsupported_claims": 0},
        "metrics": {
            "chunk_count": len(nodes),
            "embedding_dimension": dimension,
            "embedding_ms": embedding_ms,
            "retrieval_ms": round(retrieval_ms, 3),
            "section_routing_ms": round(routing_ms, 3),
            "generation_ms": round(generation_ms, 3),
            "total_ms": round((perf_counter() - total_started) * 1000, 3),
            "groups": group_metrics,
        },
    }


def xml_values(xml: str) -> dict[str, str | None]:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as error:
        raise ServiceError("Authoritative Gemini XML is invalid.", code="AUTHORITATIVE_XML_INVALID", status=422) from error
    return {key: ((root.findtext(f"./extraction/{tag}") or "").strip() or None) for key, tag in XML_FIELD_MAP.items()}


def compare_shadow(local: dict, authoritative_xml: str) -> dict:
    gemini = xml_values(authoritative_xml)
    comparisons = {}
    disagreements = []
    missing = []
    for key in EXTRACTION_FIELDS:
        local_value = local["fields"][key]["value"]
        gemini_value = gemini[key]
        agrees = values_agree(local_value, gemini_value)
        comparisons[key] = {"gemini": gemini_value, "local": local_value, "agrees": agrees, "source_chunks": local["fields"][key]["source_chunks"]}
        if not local_value or not gemini_value:
            missing.append(key)
        elif not agrees:
            disagreements.append(key)
    return {"fields": comparisons, "disagreements": disagreements, "missing_fields": missing, "local_validation_passed": local["validation"]["passed"]}


def normalize_for_compare(value: object) -> str:
    import unicodedata
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def values_agree(left: object, right: object) -> bool:
    if not left or not right:
        return False
    normalized_left = normalize_for_compare(left)
    normalized_right = normalize_for_compare(right)
    date_pattern = re.compile(r"^\d{1,2}[/-]\d{1,2}[/-]\d{4}$")
    if date_pattern.fullmatch(str(left).strip()) and date_pattern.fullmatch(str(right).strip()):
        return str(left).strip() == str(right).strip()
    if normalized_left in normalized_right or normalized_right in normalized_left:
        return True
    left_tokens = set(normalized_left.split())
    right_tokens = set(normalized_right.split())
    union = left_tokens | right_tokens
    return bool(union) and len(left_tokens & right_tokens) / len(union) >= 0.75


def write_shadow_log(record: dict) -> tuple[Path, bool]:
    log_root = Path(os.environ.get("LOCAL_RAG_SHADOW_LOG_DIR", "/tmp/concept-local-rag-shadow")).resolve()
    log_root.mkdir(parents=True, exist_ok=True)
    path = log_root / f"{record['code_interne']}.jsonl"
    idempotency_key = (record.get("processing_job_id"), record.get("correlation_id"))
    with _LOG_LOCK:
        if path.is_file():
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    existing = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if (existing.get("processing_job_id"), existing.get("correlation_id")) == idempotency_key:
                    return path, False
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    return path, True


def health() -> dict:
    tags = json.load(urlopen(f"{OLLAMA_URL}/api/tags", timeout=5))
    available = {item.get("name") for item in tags.get("models", [])}
    missing = [model for model in (EMBEDDING_MODEL, MODEL) if model not in available]
    qdrant = QdrantClient(url=QDRANT_URL, timeout=5)
    qdrant.get_collections()
    return {"status": "ok" if not missing else "degraded", "contract_version": CONTRACT_VERSION, "models": {"generation": MODEL, "embedding": EMBEDDING_MODEL}, "missing_models": missing, "qdrant": "ok"}


class Handler(BaseHTTPRequestHandler):
    server_version = "ConceptLocalRag/1.0"

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write(f"{now_iso()} {self.address_string()} {format % args}\n")

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authenticate(self) -> None:
        expected = required_env("LOCAL_RAG_SERVICE_TOKEN")
        if self.headers.get("Authorization", "") != f"Bearer {expected}":
            raise ServiceError("Unauthorized.", code="UNAUTHORIZED", status=401)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ServiceError("Invalid request size.", code="INVALID_REQUEST", status=413)
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ServiceError("Invalid JSON.", code="INVALID_JSON") from error

    def do_GET(self) -> None:  # noqa: N802
        try:
            if self.path != "/health":
                raise ServiceError("Not found.", code="NOT_FOUND", status=404)
            self.send_json(200, health())
        except ServiceError as error:
            self.send_json(error.status, {"error": str(error), "code": error.code})
        except Exception as error:
            self.send_json(503, {"error": str(error), "code": "DEPENDENCY_UNAVAILABLE"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            self.authenticate()
            request = self.read_json()
            if self.path not in {"/v1/extract", "/v1/shadow"}:
                raise ServiceError("Not found.", code="NOT_FOUND", status=404)
            validated = validate_request(request)
            with _EXTRACTION_LOCK:
                local = run_extraction(validated)
            if self.path == "/v1/extract":
                self.send_json(200, local)
                return
            authoritative_xml = request.get("authoritative_xml")
            if not isinstance(authoritative_xml, str) or not authoritative_xml.strip():
                raise ServiceError("authoritative_xml is required in shadow mode.", code="INVALID_REQUEST")
            comparison = compare_shadow(local, authoritative_xml)
            record = {
                "recorded_at": now_iso(),
                "mode": "shadow",
                "authoritative_provider": "gemini",
                "authoritative_persisted": True,
                "local_persisted": False,
                "processing_job_id": request.get("processing_job_id"),
                "correlation_id": request.get("correlation_id"),
                "appel_offre_id": local["appel_offre_id"],
                "code_interne": local["code_interne"],
                "document_id": local["document_id"],
                "local": local,
                "comparison": comparison,
            }
            log_path, recorded = write_shadow_log(record)
            self.send_json(200, {"status": "recorded" if recorded else "duplicate", "authoritative_provider": "gemini", "local_persisted": False, "comparison": comparison, "local_metrics": local["metrics"], "log_file": str(log_path)})
        except ServiceError as error:
            self.send_json(error.status, {"error": str(error), "code": error.code})
        except Exception as error:
            traceback.print_exc()
            self.send_json(500, {"error": str(error), "code": "LOCAL_RAG_INTERNAL_ERROR"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("LOCAL_RAG_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("LOCAL_RAG_PORT", "8091")))
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(json.dumps({"service": "concept-local-rag", "host": args.host, "port": args.port, "contract_version": CONTRACT_VERSION}))
    server.serve_forever()


if __name__ == "__main__":
    main()
