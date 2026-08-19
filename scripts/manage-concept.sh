#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
command_name="${1:-}"; shift || true
profile=--core; target=""
for argument in "$@"; do case "$argument" in --core|--full) profile="$argument" ;; --all) profile=--full ;; *) target="$argument" ;; esac; done
core_units=(concept-docling concept-n8n concept-web)
full_units=(concept-local-rag concept-kb)

install_units() {
  mkdir -p "$UNIT_DIR"
  for name in concept-n8n concept-docling concept-web concept-kb concept-local-rag; do
    sed "s|@REPO_ROOT@|$REPO_ROOT|g" "$SCRIPT_DIR/systemd/$name.service" > "$UNIT_DIR/$name.service"
  done
  systemctl --user daemon-reload
}
ensure_installed() { [[ -f "$UNIT_DIR/concept-web.service" ]] || install_units; }
start_container() { local name="$1"; docker inspect "$name" >/dev/null 2>&1 || { printf 'Optional container %s is not installed.\n' "$name"; return 0; }; [[ "$(docker inspect -f '{{.State.Running}}' "$name")" == true ]] || docker start "$name"; }
wait_health() { local url="$1"; for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS --max-time 2 "$url" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

case "$command_name" in
  install) install_units ;;
  start)
    ensure_installed
    systemctl is-active --quiet postgresql@18-main.service || systemctl start postgresql@18-main.service
    if [[ "$profile" == --full ]]; then
      systemctl is-active --quiet ollama.service || systemctl start ollama.service
      start_container qdrant; start_container open-webui
    fi
    systemctl --user start concept-docling concept-n8n
    wait_health http://127.0.0.1:8010/health
    "$SCRIPT_DIR/check-n8n-runtime.sh" >/dev/null
    if [[ "$profile" == --full ]]; then
      systemctl --user start "${full_units[@]}"
      wait_health http://127.0.0.1:8091/health
      wait_health http://127.0.0.1:8092/health
    fi
    systemctl --user start concept-web
    wait_health http://127.0.0.1:3000/login
    "$SCRIPT_DIR/check-concept.sh" "$profile"
    ;;
  stop)
    ensure_installed
    systemctl --user stop concept-web concept-n8n concept-docling
    [[ "$profile" == --full ]] && systemctl --user stop "${full_units[@]}"
    printf 'Stopped CONCEPT-owned user services. PostgreSQL, Ollama, Qdrant and Open WebUI were left running.\n'
    ;;
  restart)
    ensure_installed
    systemctl --user restart concept-docling concept-n8n
    [[ "$profile" == --full ]] && systemctl --user restart "${full_units[@]}"
    systemctl --user restart concept-web
    "$SCRIPT_DIR/manage-concept.sh" start "$profile"
    ;;
  status|check) "$SCRIPT_DIR/check-concept.sh" "$profile" ;;
  logs)
    case "$target" in
      n8n|"") unit=concept-n8n ;;
      docling) unit=concept-docling ;;
      web) unit=concept-web ;;
      kb) unit=concept-kb ;;
      rag) unit=concept-local-rag ;;
      *) printf 'Usage: %s logs {n8n|docling|web|kb|rag}\n' "$0" >&2; exit 2 ;;
    esac
    journalctl --user -u "$unit" -n 100 --no-pager
    ;;
  *) printf 'Usage: %s {install|start|stop|restart|status|check|logs} [--core|--full] [service]\n' "$0" >&2; exit 2 ;;
esac
