#!/usr/bin/env python3
"""Offline, read-only comparison of local Qwen models on already-persisted CDCs.

Reuses the existing production extraction/grounding/canonical-XML pipeline
(services/local-rag/server.py + canonical.py) unmodified. Only two things are
monkeypatched for the duration of a run:
  - the generation model name (server.py normally hardcodes qwen3:14b)
  - the Qdrant collection name (isolated under a benchmark_ prefix so this
    never touches the production concept_local_rag_shadow_* collections)

No writes to PostgreSQL, documents, processing_jobs, or any fiche.xml/status.json.
No calls to Gemini or any external service.
"""

from __future__ import annotations

import json
import subprocess
import sys
import traceback
from pathlib import Path
from time import perf_counter

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "rag"))
sys.path.insert(0, str(REPO_ROOT / "services" / "local-rag"))

import benchmark_qwen3_14b as bq14  # noqa: E402
import server  # noqa: E402
from poc_tender_rag import resolve_tender  # noqa: E402

DATA_ROOT = REPO_ROOT / "data"
RESULTS_DIR = REPO_ROOT / "tmp" / "concept-runtime" / "benchmark-3cdc"
MODELS = ["qwen3:14b", "qwen3:30b"]
CODES = ["AO-20260824-1322", "AO-20260818-1144", "AO-20260818-1132"]


def gpu_snapshot() -> dict:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
        util, used, total = [p.strip() for p in out.split(",")]
        return {"gpu_util_pct": int(util), "vram_used_mib": int(used), "vram_total_mib": int(total)}
    except Exception:
        return {"gpu_util_pct": None, "vram_used_mib": None, "vram_total_mib": None}


def read_reference(code: str) -> dict:
    xml_path = DATA_ROOT / code / "fiche.xml"
    xml = xml_path.read_text(encoding="utf-8")
    # Reuse the exact production check for validated vs pending reference type.
    completed = subprocess.run(
        ["psql", bq14_database_url(), "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
         f"select status, (validated_at is not null) from cdc_fiches.fiches_projet where code_interne='{code}'"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    status, has_validated = (completed.split("|") + [None, None])[:2]
    reference_type = "human_validated" if has_validated == "t" else "gemini_current"
    return {"xml": xml, "reference_type": reference_type, "fiche_status": status}


def bq14_database_url() -> str:
    from poc_tender_rag import read_env_value
    return read_env_value("DATABASE_URL")


def run_one(code: str, model: str) -> dict:
    model_slug = model.replace(":", "_").replace(".", "_")

    def bench_collection_name(tender: dict, digest: str) -> str:
        return f"concept_local_rag_BENCHMARK_{model_slug}_{int(tender['appel_offre_id'])}_{digest[:12]}"

    bq14.MODEL = model
    server.MODEL = model
    server.collection_name = bench_collection_name

    tender = resolve_tender(code)
    markdown = tender["markdown_path"].read_text(encoding="utf-8")
    reference = read_reference(code)

    started = perf_counter()
    gpu_before = gpu_snapshot()
    outcome = {
        "code_interne": code, "model": model, "reference_type": reference["reference_type"],
        "gpu_before": gpu_before,
    }
    try:
        local = server.run_extraction({"tender": tender, "markdown": markdown})
        comparison = server.compare_shadow(local, reference["xml"])
        outcome.update({
            "status": "SUCCESS",
            "schema_valid": True,
            "grounding_valid": True,
            "metrics": local["metrics"],
            "comparison_summary": {
                "fields_total": comparison["fields_total"],
                "exact_matches": comparison["exact_matches"],
                "normalized_matches": comparison["normalized_matches"],
                "differences": comparison["differences"],
                "gemini_only": comparison["gemini_only"],
                "local_only": comparison["local_only"],
                "both_null": comparison["both_null"],
            },
            "field_classifications": {
                key: {
                    "match_status": item["match_status"],
                    "had_source_chunks": bool(item["source_chunks"]),
                }
                for key, item in comparison["fields"].items()
            },
        })
    except server.ServiceError as error:
        failed_fields = []
        if error.code == "LOCAL_VALIDATION_FAILED":
            for part in str(error).split(": ", 1)[-1].split(", "):
                if ": " in part:
                    field, reason = part.split(": ", 1)
                    failed_fields.append({"field": field.strip(), "reason": reason.strip()})
        outcome.update({
            "status": "VALIDATION_FAILED",
            "schema_valid": error.code != "CANONICAL_XML_INVALID",
            "grounding_valid": False,
            "error_code": error.code,
            "failed_fields": failed_fields,
        })
    except Exception as error:  # noqa: BLE001
        outcome.update({
            "status": "ERROR",
            "schema_valid": False,
            "grounding_valid": False,
            "error_code": "UNEXPECTED_ERROR",
            "error_message": str(error),
            "traceback": traceback.format_exc(),
        })
    outcome["gpu_after"] = gpu_snapshot()
    outcome["runtime_seconds"] = round(perf_counter() - started, 3)
    return outcome


def main() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    for code in CODES:
        for model in MODELS:
            print(json.dumps({"event": "start", "code": code, "model": model}), flush=True)
            try:
                result = run_one(code, model)
            except Exception as error:  # noqa: BLE001
                print(json.dumps({"event": "fatal", "code": code, "model": model, "error": str(error)}), flush=True)
                traceback.print_exc()
                continue
            out_path = RESULTS_DIR / f"{code}__{model.replace(':', '_')}.json"
            out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({
                "event": "done", "code": code, "model": model, "status": result["status"],
                "runtime_seconds": result["runtime_seconds"], "output": str(out_path),
            }), flush=True)


if __name__ == "__main__":
    main()
