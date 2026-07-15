import hashlib
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TMP_DIR = REPO_ROOT / "tmp"
HOST = "127.0.0.1"
PORT = 8899
OUTPUT_DIR = TMP_DIR / "callback-captures"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SIGN_OUTPUT_DIR = TMP_DIR / "callback-sign-requests"
SIGN_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CALLBACK_SECRET = os.environ.get("N8N_CALLBACK_SECRET", "replace-with-hmac-secret")
CALLBACK_TOKEN = os.environ.get("PLATFORM_CALLBACK_TOKEN", "replace-with-callback-bearer-token")


def build_signature(timestamp: str, raw_body: str) -> str:
    payload = f"{timestamp}.{raw_body}".encode("utf-8")
    return hmac.new(CALLBACK_SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def normalize_signature(value: str | None) -> str:
    if not value:
        return ""
    return value[7:] if value.startswith("sha256=") else value


def verify_callback(headers: dict[str, str], raw_body: str) -> dict:
    authorization = headers.get("Authorization", "")
    timestamp = headers.get("X-Callback-Timestamp", "")
    provided_signature = normalize_signature(headers.get("X-Callback-Signature"))
    expected_signature = build_signature(timestamp, raw_body) if timestamp else ""

    token_verified = authorization == f"Bearer {CALLBACK_TOKEN}"
    signature_verified = bool(
        timestamp and provided_signature and hmac.compare_digest(provided_signature, expected_signature)
    )

    return {
        "authorization_present": bool(authorization),
        "timestamp_present": bool(timestamp),
        "signature_present": bool(provided_signature),
        "token_verified": token_verified,
        "signature_verified": signature_verified,
        "expected_signature": expected_signature if signature_verified else None,
    }


class Handler(BaseHTTPRequestHandler):
    counter = 0
    sign_counter = 0

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(length).decode("utf-8")
        headers = {key: value for key, value in self.headers.items()}

        if self.path == "/sign":
            try:
                request_payload = json.loads(raw_body)
            except json.JSONDecodeError:
                self.send_error(400, "invalid_json")
                return

            timestamp = str(request_payload.get("callback_timestamp") or "").strip()
            callback_raw_body = str(request_payload.get("callback_raw_body") or "")
            if not timestamp or not callback_raw_body:
                self.send_error(400, "missing_signature_fields")
                return

            Handler.sign_counter += 1
            sign_record = {
                "method": self.command,
                "path": self.path,
                "headers": headers,
                "raw_body": raw_body,
                "json_body": request_payload,
            }
            sign_output_path = SIGN_OUTPUT_DIR / f"sign_{Handler.sign_counter:03d}.json"
            sign_output_path.write_text(json.dumps(sign_record, ensure_ascii=False, indent=2), encoding="utf-8")

            response = dict(request_payload)
            response["callback_signature"] = build_signature(timestamp, callback_raw_body)
            encoded = json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
            return

        Handler.counter += 1

        record = {
            "method": self.command,
            "path": self.path,
            "headers": headers,
            "raw_body": raw_body,
            "json_body": None,
            "verification": verify_callback(headers, raw_body),
        }
        try:
            record["json_body"] = json.loads(raw_body)
        except json.JSONDecodeError:
            record["json_body"] = None

        output_path = OUTPUT_DIR / f"callback_{Handler.counter:03d}.json"
        output_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")

        response = {"received": True, "index": Handler.counter, "path": self.path}
        encoded = json.dumps(response).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()
