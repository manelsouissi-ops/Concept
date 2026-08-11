#!/usr/bin/env python3
"""Marker-compatible HTTP adapter backed by the local Docling environment.

The HTTP process runs with the existing Marker FastAPI environment. Each
conversion is delegated to the isolated Docling Python interpreter, so neither
environment needs additional packages.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import uuid


INLINE_IMAGE_RE = re.compile(
    r"!\[([^\]]*)\]\(\s*data:image/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+\s*\)",
    re.IGNORECASE,
)


def remove_embedded_images(markdown: str) -> str:
    """Remove binary image payloads while retaining surrounding document text."""

    def replacement(match: re.Match[str]) -> str:
        alt = match.group(1).strip()
        return f"[Image: {alt}]" if alt else "<!-- image -->"

    cleaned = INLINE_IMAGE_RE.sub(replacement, markdown)
    if re.search(r"data:image/[^;\s]+;base64,", cleaned, re.IGNORECASE):
        raise ValueError("Docling Markdown still contains an embedded base64 image")
    return cleaned


def convert_pdf(source: Path, destination: Path) -> None:
    from docling.datamodel.accelerator_options import AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.types.doc import ImageRefMode

    options = PdfPipelineOptions(
        accelerator_options=AcceleratorOptions(
            device=os.environ.get("DOCLING_ACCELERATOR_DEVICE", "auto")
        ),
        generate_page_images=False,
        generate_picture_images=False,
        generate_table_images=False,
        do_picture_description=False,
    )
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )
    result = converter.convert(source)
    markdown = result.document.export_to_markdown(
        image_mode=ImageRefMode.PLACEHOLDER,
        image_placeholder="<!-- image -->",
    )
    cleaned = remove_embedded_images(markdown)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".md.tmp")
    temporary.write_text(cleaned, encoding="utf-8")
    temporary.replace(destination)


def run_service() -> None:
    from fastapi import BackgroundTasks, FastAPI, File, UploadFile
    from fastapi.responses import JSONResponse

    # FastAPI resolves postponed annotations in module globals.
    globals().update(BackgroundTasks=BackgroundTasks, UploadFile=UploadFile)

    app = FastAPI(title="CONCEPT Docling Parser Adapter")
    jobs: dict[str, dict[str, str]] = {}
    jobs_lock = threading.Lock()
    data_root = Path(os.environ.get("DOCLING_DATA_ROOT", str(Path.home() / ".n8n-files")))
    incoming = data_root / "incoming"
    output_root = data_root / "docling_output"
    docling_python = Path(
        os.environ.get("DOCLING_PYTHON", str(Path.home() / ".venv-docling/bin/python"))
    )

    def process(job_id: str, source: Path, destination: Path) -> None:
        try:
            completed = subprocess.run(
                [
                    str(docling_python),
                    str(Path(__file__).resolve()),
                    "--convert",
                    str(source),
                    "--output",
                    str(destination),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            if completed.returncode != 0:
                detail = (completed.stderr or completed.stdout).strip()[-4000:]
                raise RuntimeError(detail or f"Docling exited with code {completed.returncode}")
            with jobs_lock:
                jobs[job_id]["status"] = "completed"
                jobs[job_id]["markdown_path"] = str(destination)
        except Exception as exc:
            with jobs_lock:
                jobs[job_id]["status"] = "failed"
                jobs[job_id]["error"] = str(exc)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "parser": "docling"}

    @app.post("/convert")
    async def submit(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
        original = Path(file.filename or "cdc.pdf").name
        if Path(original).suffix.lower() != ".pdf":
            return JSONResponse(status_code=400, content={"detail": "Only PDF files are accepted"})
        if not docling_python.is_file():
            return JSONResponse(status_code=503, content={"detail": f"Docling Python not found: {docling_python}"})
        job_id = uuid.uuid4().hex
        source = incoming / f"{job_id}-{original}"
        destination = output_root / job_id / "cdc.md"
        source.parent.mkdir(parents=True, exist_ok=True)
        with source.open("wb") as target:
            shutil.copyfileobj(file.file, target)
        with jobs_lock:
            jobs[job_id] = {"status": "processing", "original_filename": original}
        background_tasks.add_task(process, job_id, source, destination)
        return {"status": "processing", "job_id": job_id, "original_filename": original}

    @app.get("/status/{job_id}")
    def status(job_id: str):
        with jobs_lock:
            job = dict(jobs.get(job_id, {}))
        if not job:
            return JSONResponse(status_code=404, content={"detail": "Job not found"})
        response = {"status": job["status"], "job_id": job_id}
        if job["status"] == "failed":
            response["error"] = job.get("error", "Docling conversion failed")
        return response

    @app.get("/result/{job_id}")
    def result(job_id: str):
        with jobs_lock:
            job = dict(jobs.get(job_id, {}))
        if not job:
            return JSONResponse(status_code=404, content={"detail": "Job not found"})
        if job["status"] == "processing":
            return {"status": "processing", "job_id": job_id}
        if job["status"] == "failed":
            return {"status": "failed", "job_id": job_id, "error": job.get("error")}
        markdown = Path(job["markdown_path"]).read_text(encoding="utf-8")
        return {
            "status": "completed",
            "job_id": job_id,
            "original_filename": job["original_filename"],
            "markdown": markdown,
        }

    globals()["app"] = app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--convert", type=Path)
    parser.add_argument("--clean-markdown", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.convert:
        if not args.output:
            parser.error("--output is required with --convert")
        convert_pdf(args.convert, args.output)
        return
    if args.clean_markdown:
        if not args.output:
            parser.error("--output is required with --clean-markdown")
        cleaned = remove_embedded_images(args.clean_markdown.read_text(encoding="utf-8"))
        args.output.write_text(cleaned, encoding="utf-8")
        return
    run_service()


if __name__ == "__main__":
    main()
else:
    run_service()
