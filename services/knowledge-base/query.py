#!/usr/bin/env python3
"""Dense retrieval diagnostic only; future Assistant IA remains hybrid."""
import argparse
import os
import requests

OLLAMA = os.getenv("KB_OLLAMA_ENDPOINT", "http://127.0.0.1:11434").rstrip("/")
QDRANT = os.getenv("KB_QDRANT_ENDPOINT", "http://127.0.0.1:6333").rstrip("/")
COLLECTION = os.getenv("KB_QDRANT_COLLECTION", "concept_historical_cdc")
MODEL = os.getenv("KB_EMBED_MODEL", "qwen3-embedding:0.6b")

parser = argparse.ArgumentParser()
parser.add_argument("question")
parser.add_argument("--top", type=int, default=8)
args = parser.parse_args()
vector = requests.post(f"{OLLAMA}/api/embed", json={"model": MODEL, "input": [args.question]}, timeout=120).json()["embeddings"][0]
response = requests.post(f"{QDRANT}/collections/{COLLECTION}/points/query", json={"query": vector, "limit": args.top, "with_payload": True}, timeout=120)
response.raise_for_status()
for hit in response.json().get("result", {}).get("points", []):
    payload = hit.get("payload", {})
    print(f"{hit.get('score'):.4f}\t{payload.get('filename')}\t{payload.get('section')}\t{payload.get('chunk_index')}")
    print((payload.get("text") or "")[:400], "\n")
