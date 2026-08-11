#!/usr/bin/env bash
set -u
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/tmp/concept-runtime"

stop_one() {
  local name="$1" pid_file="$2"
  [[ -f "$pid_file" ]] || { printf '[INFO] %s was not started by this script.\n' "$name"; return; }
  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    for _ in {1..20}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid"; fi
    printf '[OK] Stopped %s (PID %s).\n' "$name" "$pid"
  else
    printf '[INFO] %s PID %s was already stopped.\n' "$name" "$pid"
  fi
  rm -f "$pid_file"
}

stop_one concept "$RUN_DIR/concept.pid"
stop_one n8n "$RUN_DIR/n8n.pid"
stop_one callback-signer "$RUN_DIR/signer.pid"
stop_one docling-parser "$RUN_DIR/docling-parser.pid"
stop_one marker "$RUN_DIR/marker.pid"
printf '[INFO] PostgreSQL is a shared system service and was intentionally left running.\n'
