import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parents[2]
TMP_DIR = REPO_ROOT / "tmp"
HOST = "127.0.0.1"
PORT = 8898
STATE_FILE = TMP_DIR / "marker-stub-state.json"
REQUEST_DIR = TMP_DIR / "marker-stub-requests"
REQUEST_DIR.mkdir(parents=True, exist_ok=True)


def load_mode() -> str:
    if not STATE_FILE.exists():
        return "failed"
    try:
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return "failed"
    return str(payload.get("mode") or "failed").strip().lower()


class Handler(BaseHTTPRequestHandler):
    counter = 0

    def _write_json(self, status: int, payload: dict):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(length)
        Handler.counter += 1
        (REQUEST_DIR / f"marker_post_{Handler.counter:03d}.bin").write_bytes(raw_body)

        if self.path != "/convert":
            self._write_json(404, {"error": "not_found"})
            return

        self._write_json(200, {"job_id": "test-job-001"})

    def do_GET(self):
        Handler.counter += 1
        parsed = urlparse(self.path)
        if parsed.path != "/result/test-job-001":
            self._write_json(404, {"error": "not_found"})
            return

        mode = load_mode()
        if mode == "completed":
            self._write_json(
                200,
                {
                    "status": "completed",
                    "markdown": "# Safe test\n\nThis is a controlled local test markdown payload.",
                },
            )
            return

        self._write_json(
            200,
            {
                "status": "failed",
                "error": "Controlled local Marker stub failure.",
            },
        )

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    STATE_FILE.write_text(json.dumps({"mode": "failed"}, indent=2), encoding="utf-8")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()
