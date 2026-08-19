#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
for script in manage-concept.sh check-concept.sh start-concept.sh start-docling-local.sh start-concept-web-local.sh start-kb-local.sh start-local-rag.sh; do bash -n "$SCRIPT_DIR/$script"; done
grep -q 'exec "$SCRIPT_DIR/manage-concept.sh" start --full' "$SCRIPT_DIR/start-concept.sh"
grep -q 'check-n8n-runtime.sh' "$SCRIPT_DIR/check-concept.sh"
for unit in concept-docling concept-web concept-kb concept-local-rag; do
  grep -q "ExecStart=@REPO_ROOT@/scripts/" "$SCRIPT_DIR/systemd/$unit.service"
  ! grep -q 'ExecStart=.*n8n start' "$SCRIPT_DIR/systemd/$unit.service"
done
! rg -q '/home/concept/Concept' "$SCRIPT_DIR/manage-concept.sh" "$SCRIPT_DIR/check-concept.sh" "$SCRIPT_DIR/start-concept.sh" "$SCRIPT_DIR/systemd"
printf 'CONCEPT runtime static tests: PASS\n'
