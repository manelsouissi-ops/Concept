#!/usr/bin/env python3
"""Emit safe JSONL PDF discovery from KB_SOURCE_DIR; no shell path parsing."""
import json
import os
from pathlib import Path

root_value = os.getenv("KB_SOURCE_DIR", "").strip()
if not root_value:
    raise SystemExit("KB_SOURCE_DIR is required")
root = Path(root_value).expanduser().resolve(strict=True)
if not root.is_dir():
    raise SystemExit("KB_SOURCE_DIR must be a directory")
for item in sorted(root.rglob("*"), key=lambda path: str(path).casefold()):
    if item.is_file() and item.suffix.casefold() == ".pdf":
        print(json.dumps({"source_path": str(item), "source_filename": item.name}, ensure_ascii=False))
