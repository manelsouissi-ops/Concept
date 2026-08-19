#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
TEMPLATE="$SCRIPT_DIR/systemd/concept-n8n.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_FILE="$UNIT_DIR/concept-n8n.service"

usage() {
  printf 'Usage: %s {install|start|stop|restart|status|check|logs}\n' "$0" >&2
  exit 2
}

command_name="${1:-}"
case "$command_name" in
  install)
    mkdir -p "$UNIT_DIR"
    escaped_root="${REPO_ROOT//\/\\}"
    escaped_root="${escaped_root//&/\\&}"
    escaped_root="${escaped_root//|/\\|}"
    sed "s|@REPO_ROOT@|$escaped_root|g" "$TEMPLATE" > "$UNIT_FILE"
    printf 'Installed %s\n' "$UNIT_FILE"
    printf 'Running: systemctl --user daemon-reload\n'
    systemctl --user daemon-reload
    ;;
  start|stop|restart)
    printf 'Running: systemctl --user %s concept-n8n\n' "$command_name"
    systemctl --user "$command_name" concept-n8n
    ;;
  status)
    printf 'Running: systemctl --user status concept-n8n\n'
    systemctl --user status concept-n8n --no-pager
    ;;
  check)
    "$SCRIPT_DIR/check-n8n-runtime.sh"
    ;;
  logs)
    printf 'Running: journalctl --user -u concept-n8n -n 100 --no-pager\n'
    journalctl --user -u concept-n8n -n 100 --no-pager
    ;;
  *) usage ;;
esac
