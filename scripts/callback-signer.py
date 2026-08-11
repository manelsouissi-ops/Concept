#!/usr/bin/env python3
"""Minimal local HMAC signer required by the CDC and FCI n8n workflows."""

import hashlib
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = os.getenv("CALLBACK_SIGNER_HOST", "127.0.0.1")
PORT = int(os.getenv("CALLBACK_SIGNER_PORT", "8899"))
SECRET = (
    os.getenv("FCI_CALLBACK_HMAC_SECRET")
    or os.getenv("N8N_CALLBACK_SECRET")
    or ""
).strip()


def signature(timestamp: str, raw_body: str) -> str:
    payload = f"{timestamp}.{raw_body}".encode("utf-8")
    return hmac.new(SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
        else:
            self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/sign":
            self.send_json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request = json.loads(self.rfile.read(length).decode("utf-8"))
            timestamp = str(request.get("callback_timestamp") or "").strip()
            raw_body = str(request.get("callback_raw_body") or "")
            if not timestamp or not raw_body:
                raise ValueError("callback_timestamp and callback_raw_body are required")
            request["callback_signature"] = signature(timestamp, raw_body)
            self.send_json(200, request)
        except (json.JSONDecodeError, ValueError) as error:
            self.send_json(400, {"error": str(error)})

    def log_message(self, format: str, *args: object) -> None:
        print(f"signer: {format % args}", flush=True)


if __name__ == "__main__":
    if not SECRET:
        raise SystemExit("FCI_CALLBACK_HMAC_SECRET or N8N_CALLBACK_SECRET is required")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
